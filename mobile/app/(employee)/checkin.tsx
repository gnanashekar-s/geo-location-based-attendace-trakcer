import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Pressable,
  Animated,
  StatusBar,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { attendanceApi, sitesApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { CheckInPayload, AttendanceToday } from '@/types';

// ─── Design System ────────────────────────────────────────────────────────────

const C = {
  bg: '#09090B', surface: '#18181B', surface2: '#27272A',
  border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)',
  primary: '#6366F1', primaryDark: '#4F46E5', accent: '#8B5CF6',
  success: '#22C55E', successLight: 'rgba(34,197,94,0.10)',
  warning: '#F59E0B', warningLight: 'rgba(245,158,11,0.10)',
  danger: '#EF4444', dangerLight: 'rgba(239,68,68,0.10)',
  purple: '#A855F7', purpleLight: 'rgba(168,85,247,0.10)',
  teal: '#14B8A6', tealLight: 'rgba(20,184,166,0.10)',
  textPrimary: '#FAFAFA', textSecondary: '#A1A1AA', textMuted: '#71717A',
};

// ─── Constants ────────────────────────────────────────────────────────────────

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
  const R = 6371000;
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

// ─── Dark Map Style ───────────────────────────────────────────────────────────

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c1a2e' }] },
];

// ─── Pulsing Map Dot ──────────────────────────────────────────────────────────

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
    backgroundColor: 'rgba(99,102,241,0.4)',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

// ─── Pulsing Check-In Button Ring ─────────────────────────────────────────────

function PulseRing({ color }: { color: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0.6, duration: 800, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: 90,
        height: 90,
        borderRadius: 45,
        borderWidth: 2,
        borderColor: color,
        transform: [{ scale: pulseAnim }],
        opacity: opacityAnim,
      }}
    />
  );
}

// ─── Camera Sheet ─────────────────────────────────────────────────────────────

interface CameraSheetProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
}

function CameraSheet({ onCapture, onClose }: CameraSheetProps) {
  if (Platform.OS === 'web') {
    return (
      <View style={cameraStyles.permissionContainer}>
        <MaterialCommunityIcons name="camera-off" size={48} color={C.textSecondary} />
        <Text style={cameraStyles.permissionText}>
          Selfie verification is not available on web. Your attendance will be recorded without a photo.
        </Text>
        <Button mode="contained" onPress={onClose} buttonColor={C.primary}>
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
        <MaterialCommunityIcons name="camera-off" size={48} color={C.textSecondary} />
        <Text style={cameraStyles.permissionText}>
          Camera permission is required for attendance verification.
        </Text>
        <Button mode="contained" onPress={requestPermission} buttonColor={C.primary}>
          Grant Permission
        </Button>
        <Button onPress={onClose} textColor={C.textSecondary}>Skip</Button>
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
          <View style={cameraStyles.faceGuide} />
          <Text style={cameraStyles.guideText}>Position your face in the oval</Text>
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
                <ActivityIndicator color={C.primary} />
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
  camera: { flex: 1 },
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

  const { data: sitesData } = useQuery({
    queryKey: ['sites', orgId],
    queryFn: () => sitesApi.list(orgId).then((r) => r.data),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });

  const activeSite = sitesData?.find((s) => s.is_active) ?? null;
  const office = activeSite
    ? {
        latitude: activeSite.center_lat,
        longitude: activeSite.center_lng,
        radius: activeSite.radius_meters,
        name: activeSite.name,
        address: activeSite.address ?? null,
      }
    : { ...DEFAULT_OFFICE, address: null };

  const { data: todayData } = useQuery<AttendanceToday>({
    queryKey: ['attendance', 'today'],
    queryFn: () => attendanceApi.today().then((r) => r.data),
  });

  const isCheckedIn = !!(todayData?.check_in_time && !todayData?.check_out_time);

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

  // ── Mutation ──────────────────────────────────────────────────────────────

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
  }, [location, isMocked, withinGeofence, distance, capturedPhoto, submitCheckIn]);

  // ── Render vars ───────────────────────────────────────────────────────────

  const geofenceColor = withinGeofence ? C.success : C.danger;
  const checkBtnColor = isCheckedIn ? C.accent : C.primary;
  const checkBtnGradient: [string, string] = isCheckedIn
    ? ['#7C3AED', '#4F46E5']
    : ['#6366F1', '#8B5CF6'];

  const initialRegion = {
    latitude: office.latitude,
    longitude: office.longitude,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── Gradient Header ── */}
      <LinearGradient
        colors={['#1E1B4B', C.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isCheckedIn ? 'Check Out' : 'Check In'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {office.name}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {/* ── Mock Location Warning ── */}
      {isMocked && (
        <View style={styles.mockWarning}>
          <MaterialCommunityIcons name="alert" size={15} color="#FFFFFF" />
          <Text style={styles.mockWarningText}>
            Fake GPS detected — attendance may be flagged
          </Text>
        </View>
      )}

      {/* ── Map Section ── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={initialRegion}
          customMapStyle={DARK_MAP_STYLE}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
        >
          {/* Geofence circle */}
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
            pinColor={C.primary}
          />

          {/* User location dot */}
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

        {/* GPS acquiring overlay */}
        {!location && !locationError && (
          <View style={styles.gpsLoading}>
            <ActivityIndicator color={C.primary} size="small" />
            <Text style={styles.gpsLoadingText}>Acquiring GPS…</Text>
          </View>
        )}

        {/* Location error overlay */}
        {locationError && (
          <View style={styles.gpsError}>
            <MaterialCommunityIcons name="map-marker-off" size={16} color={C.danger} />
            <Text style={styles.gpsErrorText}>{locationError}</Text>
          </View>
        )}
      </View>

      {/* ── Bottom Panel ── */}
      <View style={styles.panel}>

        {/* Location Status Card */}
        <View style={[
          styles.locationCard,
          {
            backgroundColor: withinGeofence
              ? C.successLight
              : distance === null
              ? 'rgba(148,163,184,0.08)'
              : C.dangerLight,
            borderColor: withinGeofence
              ? `${C.success}40`
              : distance === null
              ? C.border
              : `${C.danger}40`,
          },
        ]}>
          <View style={styles.locationCardRow}>
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={16}
              color={location ? C.primary : C.textMuted}
            />
            <Text style={styles.coordsText} numberOfLines={1}>
              {location
                ? `${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`
                : 'Acquiring GPS…'}
            </Text>
            {location && (
              <View style={styles.accuracyBadge}>
                <Text style={styles.accuracyText}>
                  ±{Math.round(location.coords.accuracy ?? 0)}m
                </Text>
              </View>
            )}
          </View>

          <View style={styles.locationCardRow}>
            <MaterialCommunityIcons
              name={withinGeofence ? 'map-marker-check' : distance === null ? 'map-marker-outline' : 'map-marker-remove'}
              size={16}
              color={withinGeofence ? C.success : distance === null ? C.textMuted : C.danger}
            />
            <Text style={styles.locationCardLabel}>Distance to site</Text>
            <Text style={[styles.locationCardDistance, { color: withinGeofence ? C.success : distance === null ? C.textSecondary : C.danger }]}>
              {distance !== null ? formatDistance(distance) : '—'}
            </Text>
          </View>

          <View style={styles.geofenceBadgeRow}>
            <View style={[
              styles.geofenceBadge,
              {
                backgroundColor: withinGeofence ? C.successLight : distance === null ? 'rgba(148,163,184,0.1)' : C.dangerLight,
                borderColor: withinGeofence ? `${C.success}50` : distance === null ? C.border : `${C.danger}50`,
              },
            ]}>
              <View style={[styles.geofenceDot, { backgroundColor: withinGeofence ? C.success : distance === null ? C.textMuted : C.danger }]} />
              <Text style={[styles.geofenceBadgeText, { color: withinGeofence ? C.success : distance === null ? C.textMuted : C.danger }]}>
                {withinGeofence
                  ? 'Within Geofence ✓'
                  : distance === null
                  ? 'Locating…'
                  : 'Outside Geofence ✗'}
              </Text>
            </View>
          </View>
        </View>

        {/* Photo captured row */}
        {capturedPhoto && (
          <View style={styles.photoRow}>
            <MaterialCommunityIcons name="camera-check" size={16} color={C.success} />
            <Text style={styles.photoText}>Selfie captured</Text>
            <Pressable onPress={() => setCapturedPhoto(null)}>
              <Text style={styles.photoRetake}>Retake</Text>
            </Pressable>
          </View>
        )}

        {/* Site Info Card */}
        <View style={styles.siteInfoCard}>
          <LinearGradient
            colors={[C.primary, C.accent]}
            style={styles.siteIconBg}
          >
            <MaterialCommunityIcons name="office-building" size={16} color="#FFFFFF" />
          </LinearGradient>
          <View style={styles.siteInfoText}>
            <Text style={styles.siteName} numberOfLines={1}>{office.name}</Text>
            {office.address ? (
              <Text style={styles.siteAddress} numberOfLines={1}>{office.address}</Text>
            ) : null}
            <Text style={styles.siteRadius}>Allowed radius: {office.radius}m</Text>
          </View>
          <View style={[
            styles.siteStatusDot,
            { backgroundColor: withinGeofence ? C.success : distance === null ? C.warning : C.danger },
          ]} />
        </View>

        {/* Action Row: Selfie + Main check-in button */}
        <View style={styles.actions}>
          {/* Selfie button */}
          <Pressable
            style={({ pressed }) => [
              styles.selfieBtn,
              capturedPhoto && styles.selfieBtnCaptured,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setShowCamera(true)}
          >
            <MaterialCommunityIcons
              name={capturedPhoto ? 'camera-check' : 'camera'}
              size={18}
              color={capturedPhoto ? C.success : C.textSecondary}
            />
            <Text style={[styles.selfieBtnText, capturedPhoto && { color: C.success }]}>
              {capturedPhoto ? 'Retake' : 'Selfie'}
            </Text>
          </Pressable>

          {/* Main circular check-in button with pulsing ring */}
          <View style={styles.checkBtnWrapper}>
            {!checkInMutation.isPending && location && (
              <PulseRing color={checkBtnColor} />
            )}
            <Pressable
              onPress={async () => {
                if (Platform.OS !== 'web') {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }
                handleCheckIn();
              }}
              disabled={checkInMutation.isPending || !location}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <LinearGradient
                colors={
                  checkInMutation.isPending || !location
                    ? ['#334155', '#1E293B']
                    : checkBtnGradient
                }
                style={styles.checkBtn}
              >
                {checkInMutation.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <MaterialCommunityIcons
                    name="fingerprint"
                    size={36}
                    color={!location ? C.textMuted : '#FFFFFF'}
                  />
                )}
              </LinearGradient>
            </Pressable>
            <Text style={styles.checkBtnLabel}>
              {checkInMutation.isPending
                ? 'Submitting…'
                : !location
                ? 'Waiting GPS…'
                : isCheckedIn
                ? 'Tap to Check Out'
                : 'Tap to Check In'}
            </Text>
          </View>
        </View>
      </View>

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
    backgroundColor: C.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: C.textMuted,
    fontWeight: '500',
  },

  // Mock warning
  mockWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.danger,
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 8,
  },
  mockWarningText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },

  // Map
  mapContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#1E293B',
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
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  gpsLoadingText: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '500',
  },
  gpsError: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.dangerLight,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: `${C.danger}40`,
  },
  gpsErrorText: {
    fontSize: 13,
    color: C.danger,
    fontWeight: '500',
    maxWidth: 260,
  },

  // Bottom Panel
  panel: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },

  // Location Status Card
  locationCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  locationCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coordsText: {
    flex: 1,
    fontSize: 12,
    color: C.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  accuracyBadge: {
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  accuracyText: {
    fontSize: 11,
    color: C.primary,
    fontWeight: '700',
  },
  locationCardLabel: {
    flex: 1,
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '500',
  },
  locationCardDistance: {
    fontSize: 14,
    fontWeight: '800',
  },
  geofenceBadgeRow: {
    flexDirection: 'row',
  },
  geofenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  geofenceDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  geofenceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Photo row
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.successLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: `${C.success}40`,
  },
  photoText: {
    flex: 1,
    fontSize: 13,
    color: C.success,
    fontWeight: '500',
  },
  photoRetake: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '600',
  },

  // Site Info Card
  siteInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  siteIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  siteInfoText: {
    flex: 1,
    gap: 2,
  },
  siteName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
  },
  siteAddress: {
    fontSize: 12,
    color: C.textSecondary,
  },
  siteRadius: {
    fontSize: 11,
    color: C.textMuted,
  },
  siteStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },

  // Actions row
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },

  // Selfie button
  selfieBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  selfieBtnCaptured: {
    backgroundColor: C.successLight,
    borderColor: `${C.success}40`,
  },
  selfieBtnText: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '600',
  },

  // Check-in button
  checkBtnWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
  },
  checkBtn: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  checkBtnLabel: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '600',
  },
});
