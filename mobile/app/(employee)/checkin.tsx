import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Pressable,
  Animated,
} from 'react-native';
import { Text, Button, Surface, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, sitesApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { CheckInPayload, AttendanceToday } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

// Fallback office location used while site data is loading
const DEFAULT_OFFICE = {
  latitude: 3.1478,
  longitude: 101.6953,
  radius: 100,
  name: 'Office',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

// ─── Animated Dot ─────────────────────────────────────────────────────────────

function PulsingDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.4, duration: 700, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={dotStyles.container}>
      <Animated.View style={[dotStyles.ring, { opacity, transform: [{ scale }] }]} />
      <View style={dotStyles.dot} />
    </View>
  );
}

const dotStyles = StyleSheet.create({
  container: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.3)',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#3B82F6',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

// ─── Camera Sheet ─────────────────────────────────────────────────────────────

interface CameraSheetProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
}

function CameraSheet({ onCapture, onClose }: CameraSheetProps) {
  // Camera not supported on web — auto-close
  if (Platform.OS === 'web') {
    return (
      <View style={cameraStyles.permissionContainer}>
        <MaterialCommunityIcons name="camera-off" size={48} color="#94A3B8" />
        <Text style={cameraStyles.permissionText}>
          Selfie verification is not available on web. Your attendance will be recorded without a photo.
        </Text>
        <Button mode="contained" onPress={onClose} buttonColor="#4F46E5">
          Continue Without Photo
        </Button>
      </View>
    );
  }

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.6,
        exif: false,
      });
      if (photo?.base64) {
        if (Platform.OS !== 'web') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onCapture(photo.base64);
      }
    } catch (err) {
      console.error('[Camera] Error taking photo:', err);
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={cameraStyles.permissionContainer}>
        <MaterialCommunityIcons name="camera-off" size={48} color="#94A3B8" />
        <Text style={cameraStyles.permissionText}>
          Camera permission is required for attendance verification.
        </Text>
        <Button mode="contained" onPress={requestPermission} buttonColor="#4F46E5">
          Grant Permission
        </Button>
        <Button onPress={onClose}>Skip</Button>
      </View>
    );
  }

  return (
    <View style={cameraStyles.container}>
      <CameraView
        ref={cameraRef}
        style={cameraStyles.camera}
        facing="front"
      >
        <View style={cameraStyles.overlay}>
          {/* Face guide oval */}
          <View style={cameraStyles.faceGuide} />
          <Text style={cameraStyles.guideText}>
            Position your face in the oval
          </Text>

          <View style={cameraStyles.controls}>
            <Pressable style={cameraStyles.cancelBtn} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={28} color="#FFFFFF" />
            </Pressable>

            <Pressable
              style={[cameraStyles.captureBtn, capturing && { opacity: 0.6 }]}
              onPress={takePhoto}
              disabled={capturing}
            >
              {capturing ? (
                <ActivityIndicator color="#4F46E5" />
              ) : (
                <View style={cameraStyles.captureBtnInner} />
              )}
            </Pressable>

            <View style={{ width: 48 }} />
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const cameraStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  faceGuide: {
    width: 220,
    height: 280,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    borderStyle: 'dashed',
  },
  guideText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginTop: -80,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
  },
  cancelBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
    backgroundColor: '#000',
  },
  permissionText: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CheckInScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mapRef = useRef<MapView>(null);

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isMocked, setIsMocked] = useState(false);

  const user = useAuthStore((s) => s.user);
  const orgId = user?.org_id ?? '';

  // Fetch sites from API
  const { data: sitesData } = useQuery({
    queryKey: ['sites', orgId],
    queryFn: () => sitesApi.list(orgId).then((r) => r.data),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });

  // Use first active site; fall back to DEFAULT_OFFICE while loading
  const activeSite = sitesData?.find((s) => s.is_active) ?? null;
  const office = activeSite
    ? {
        latitude: activeSite.center_lat,
        longitude: activeSite.center_lng,
        radius: activeSite.radius_meters,
        name: activeSite.name,
      }
    : DEFAULT_OFFICE;

  // Today's attendance status
  const { data: todayData } = useQuery<AttendanceToday>({
    queryKey: ['attendance', 'today'],
    queryFn: () => attendanceApi.today().then((r) => r.data),
  });

  const isCheckedIn = !!(todayData?.check_in_time && !todayData?.check_out_time);

  // Distance & geofence
  const distance = location
    ? haversineDistance(
        location.coords.latitude,
        location.coords.longitude,
        office.latitude,
        office.longitude
      )
    : null;

  const withinGeofence = distance !== null && distance <= office.radius;

  // ── Location watcher ──────────────────────────────────────────────────────

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Cannot verify attendance.');
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 3000,
          distanceInterval: 2,
        },
        (loc) => {
          setLocation(loc);
          setIsMocked(!!(loc as any).mocked);

          // Pan map to current position
          mapRef.current?.animateToRegion(
            {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              latitudeDelta: 0.003,
              longitudeDelta: 0.003,
            },
            500
          );
        }
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  // ── Check-in / out mutation ───────────────────────────────────────────────

  const checkInMutation = useMutation({
    mutationFn: (payload: CheckInPayload) => attendanceApi.checkIn(payload),
    onSuccess: async (response) => {
      const { fraud_score, fraud_flags, requires_approval } = response.data;

      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      queryClient.invalidateQueries({ queryKey: ['attendance'] });

      const flagged = (fraud_score ?? 0) > 0.3 && fraud_flags?.length > 0;

      if (requires_approval || (fraud_score ?? 0) > 0.5) {
        const flagMsg = flagged
          ? `\n\nFlags detected: ${fraud_flags.join(', ')}`
          : '';
        Alert.alert(
          'Pending Approval',
          `Your attendance has been submitted and is pending manager approval.${flagMsg}`,
          [{ text: 'OK', onPress: () => router.replace('/(employee)') }]
        );
      } else if (flagged) {
        Alert.alert(
          isCheckedIn ? '✓ Checked Out (Flagged)' : '✓ Checked In (Flagged)',
          `Your check-in was flagged for review.\n\nFlags: ${fraud_flags.join(', ')}`,
          [{ text: 'OK', onPress: () => router.replace('/(employee)') }]
        );
      } else {
        Alert.alert(
          isCheckedIn ? '✓ Checked Out' : '✓ Checked In',
          isCheckedIn
            ? 'Your check-out has been recorded successfully.'
            : 'Your attendance has been recorded successfully.',
          [{ text: 'Great!', onPress: () => router.replace('/(employee)') }]
        );
      }
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 400 && detail?.includes('Already checked in')) {
        Alert.alert('Already Checked In', 'You have already checked in today. Use Check Out instead.');
      } else if (status === 400 && detail?.includes('Already checked out')) {
        Alert.alert('Already Checked Out', 'You have already checked out today.');
      } else if (status === 422) {
        Alert.alert(
          'Outside Office Area',
          'You are outside all registered geofences. You can request a manual attendance approval from your supervisor.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Manual Request', onPress: () => router.push('/(employee)/manual-checkin' as any) },
          ]
        );
      } else if (status === 403) {
        Alert.alert('Blocked', detail ?? 'Check-in blocked due to suspicious activity.');
      } else {
        Alert.alert('Error', detail ?? 'Failed to record attendance. Please try again.');
      }
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePhotoCapture = useCallback((base64: string) => {
    setCapturedPhoto(base64);
    setShowCamera(false);
  }, []);

  const handleCheckIn = useCallback(() => {
    if (!location) {
      Alert.alert('No Location', 'Waiting for GPS signal. Please try again in a moment.');
      return;
    }

    if (isMocked) {
      Alert.alert(
        'Mock Location Detected',
        'Fake GPS detected. Real location required for attendance.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!withinGeofence) {
      Alert.alert(
        'Out of Range',
        `You are ${formatDistance(distance ?? 0)} from ${office.name}. You must be within ${office.radius}m to check in.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Manual Request', onPress: () => router.push('/(employee)/manual-checkin' as any) },
          {
            text: 'Try Anyway',
            style: 'destructive',
            onPress: () => submitCheckIn(),
          },
        ]
      );
      return;
    }

    submitCheckIn();
  }, [location, isMocked, withinGeofence, distance, capturedPhoto]);

  const submitCheckIn = useCallback(() => {
    if (!location) return;
    const payload: CheckInPayload = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? 0,
      altitude: location.coords.altitude ?? undefined,
      photo_base64: capturedPhoto ?? undefined,
      is_checkout: isCheckedIn,
    };
    checkInMutation.mutate(payload);
  }, [location, capturedPhoto, isCheckedIn]);

  // ── Render ────────────────────────────────────────────────────────────────

  const geofenceColor = withinGeofence ? '#10B981' : '#EF4444';
  const initialRegion = {
    latitude: office.latitude,
    longitude: office.longitude,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E293B" />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isCheckedIn ? 'Check Out' : 'Check In'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Mock location warning */}
      {isMocked && (
        <View style={styles.mockWarning}>
          <MaterialCommunityIcons name="alert" size={16} color="#FFFFFF" />
          <Text style={styles.mockWarningText}>
            Fake GPS detected — attendance may be flagged
          </Text>
        </View>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass
          rotateEnabled={false}
        >
          {/* Office geofence circle */}
          <Circle
            center={{ latitude: office.latitude, longitude: office.longitude }}
            radius={office.radius}
            strokeColor={geofenceColor}
            strokeWidth={2}
            fillColor={`${geofenceColor}22`}
          />

          {/* Office pin */}
          <Marker
            coordinate={{ latitude: office.latitude, longitude: office.longitude }}
            title={office.name}
            pinColor="#4F46E5"
          />

          {/* Animated user location dot */}
          {location && (
            <Marker
              coordinate={{
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <PulsingDot />
            </Marker>
          )}
        </MapView>

        {/* GPS loading overlay */}
        {!location && !locationError && (
          <View style={styles.gpsLoading}>
            <ActivityIndicator color="#4F46E5" size="small" />
            <Text style={styles.gpsLoadingText}>Acquiring GPS…</Text>
          </View>
        )}
      </View>

      {/* Info Panel */}
      <Surface style={styles.panel} elevation={4}>
        {/* Distance + geofence status */}
        <View style={styles.distanceRow}>
          <MaterialCommunityIcons
            name={withinGeofence ? 'map-marker-check' : 'map-marker-remove'}
            size={24}
            color={geofenceColor}
          />
          <View style={styles.distanceInfo}>
            {distance !== null ? (
              <>
                <Text style={styles.distanceText}>
                  You are{' '}
                  <Text style={[styles.distanceValue, { color: geofenceColor }]}>
                    {formatDistance(distance)}
                  </Text>{' '}
                  from {office.name}
                </Text>
                <Text
                  style={[
                    styles.geofenceStatus,
                    { color: geofenceColor },
                  ]}
                >
                  {withinGeofence ? 'Within geofence ✓' : 'Outside geofence'}
                </Text>
              </>
            ) : (
              <Text style={styles.distanceText}>
                {locationError ?? 'Calculating distance…'}
              </Text>
            )}
          </View>

          {/* Accuracy badge */}
          {location && (
            <Chip
              compact
              style={styles.accuracyChip}
              textStyle={styles.accuracyChipText}
            >
              ±{Math.round(location.coords.accuracy ?? 0)}m
            </Chip>
          )}
        </View>

        {/* Photo preview */}
        {capturedPhoto && (
          <View style={styles.photoRow}>
            <MaterialCommunityIcons name="camera" size={18} color="#10B981" />
            <Text style={styles.photoText}>Selfie captured</Text>
            <Pressable onPress={() => setCapturedPhoto(null)}>
              <Text style={styles.photoRetake}>Retake</Text>
            </Pressable>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          <Button
            mode="outlined"
            icon="camera"
            onPress={() => setShowCamera(true)}
            style={styles.cameraBtn}
            textColor="#4F46E5"
          >
            {capturedPhoto ? 'Retake Selfie' : 'Take Selfie'}
          </Button>

          <Button
            mode="contained"
            icon={isCheckedIn ? 'clock-out' : 'clock-in'}
            onPress={handleCheckIn}
            loading={checkInMutation.isPending}
            disabled={checkInMutation.isPending || !location}
            style={styles.checkInBtn}
            buttonColor={isCheckedIn ? '#7C3AED' : '#10B981'}
            contentStyle={styles.checkInBtnContent}
            labelStyle={styles.checkInBtnLabel}
          >
            {checkInMutation.isPending
              ? 'Submitting…'
              : isCheckedIn
              ? 'Check Out'
              : 'Check In'}
          </Button>
        </View>
      </Surface>

      {/* Camera overlay */}
      {showCamera && (
        <CameraSheet
          onCapture={handlePhotoCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  mockWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  mockWarningText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  gpsLoading: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  gpsLoadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  distanceInfo: {
    flex: 1,
    gap: 2,
  },
  distanceText: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '500',
  },
  distanceValue: {
    fontWeight: '800',
    fontSize: 15,
  },
  geofenceStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  accuracyChip: {
    backgroundColor: '#EEF2FF',
    height: 26,
  },
  accuracyChipText: {
    fontSize: 11,
    color: '#4F46E5',
    fontWeight: '600',
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    backgroundColor: '#D1FAE5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
    fontWeight: '500',
  },
  photoRetake: {
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cameraBtn: {
    flex: 1,
    borderColor: '#4F46E5',
    borderRadius: 12,
  },
  checkInBtn: {
    flex: 1.5,
    borderRadius: 12,
  },
  checkInBtnContent: {
    paddingVertical: 4,
  },
  checkInBtnLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});
