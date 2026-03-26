import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Animated,
} from 'react-native';
import { Text, TextInput as PaperInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sitesApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { Site } from '@/types';
import { useGeofenceRadiusSuggestion } from '@/api/analytics';

// ─── Design tokens ────────────────────────────────────────────────────────────
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

// ─── Map thumbnail placeholder ────────────────────────────────────────────────

function MapThumb({ site }: { site: Site }) {
  return (
    <View style={styles.mapThumb}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface2, borderRadius: 12 }]} />
      {/* Grid lines for map feel */}
      <View style={styles.mapGrid}>
        {[0, 1, 2].map(i => (
          <View key={`h${i}`} style={[styles.mapGridLine, styles.mapGridH, { top: `${30 + i * 18}%` as any }]} />
        ))}
        {[0, 1, 2].map(i => (
          <View key={`v${i}`} style={[styles.mapGridLine, styles.mapGridV, { left: `${20 + i * 25}%` as any }]} />
        ))}
      </View>
      {/* Radius circle hint */}
      <View style={[styles.mapCircle, { opacity: site.is_active ? 0.3 : 0.12 }]} />
      <MaterialCommunityIcons
        name="map-marker"
        size={24}
        color={site.is_active ? C.teal : C.textMuted}
      />
    </View>
  );
}

// ─── Site Card ────────────────────────────────────────────────────────────────

function SiteCard({ site, onEdit }: { site: Site; onEdit: () => void }) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const handlePressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onEdit}>
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
        {/* Left: map placeholder */}
        <MapThumb site={site} />

        {/* Center: info */}
        <View style={styles.cardBody}>
          <Text style={styles.siteName} numberOfLines={1}>{site.name}</Text>
          <View style={styles.cardMeta}>
            <MaterialCommunityIcons name="map-marker-outline" size={12} color={C.textMuted} />
            <Text style={styles.siteAddress} numberOfLines={1}>{site.address || 'No address set'}</Text>
          </View>
          <View style={styles.radiusBadge}>
            <MaterialCommunityIcons name="target" size={11} color={C.teal} />
            <Text style={styles.radiusText}>{site.radius_meters}m</Text>
          </View>
        </View>

        {/* Right: status dot + edit */}
        <View style={styles.cardRight}>
          <View style={[styles.statusDot, { backgroundColor: site.is_active ? C.success : C.textMuted }]} />
          <Pressable onPress={onEdit} style={styles.editBtn} hitSlop={8}>
            <MaterialCommunityIcons name="pencil" size={17} color={C.textMuted} />
          </Pressable>
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ─── Site Form Modal ──────────────────────────────────────────────────────────

interface SiteFormModalProps {
  visible: boolean;
  onClose: () => void;
  editingSite?: Site | null;
  orgId: string;
}

function SiteFormModal({ visible, onClose, editingSite, orgId }: SiteFormModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editingSite;

  const [name, setName] = useState(editingSite?.name ?? '');
  const [address, setAddress] = useState(editingSite?.address ?? '');
  const [lat, setLat] = useState(editingSite?.center_lat?.toString() ?? '');
  const [lng, setLng] = useState(editingSite?.center_lng?.toString() ?? '');
  const [radius, setRadius] = useState(editingSite?.radius_meters?.toString() ?? '100');

  const {
    data: radiusSuggestion,
    isLoading: suggestionLoading,
    error: suggestionError,
  } = useGeofenceRadiusSuggestion(editingSite?.id ?? null);

  const [usedSuggestion, setUsedSuggestion] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(editingSite?.name ?? '');
      setAddress(editingSite?.address ?? '');
      setLat(editingSite?.center_lat?.toString() ?? '');
      setLng(editingSite?.center_lng?.toString() ?? '');
      setRadius(editingSite?.radius_meters?.toString() ?? '100');
    }
  }, [visible, editingSite]);

  useEffect(() => {
    setUsedSuggestion(false);
  }, [editingSite]);

  const createMutation = useMutation({
    mutationFn: () =>
      sitesApi.create(orgId, {
        name: name.trim(),
        address: address.trim(),
        center_lat: parseFloat(lat),
        center_lng: parseFloat(lng),
        radius_meters: parseInt(radius, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to create site.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      sitesApi.update(orgId, editingSite!.id, {
        name: name.trim(),
        address: address.trim(),
        center_lat: parseFloat(lat),
        center_lng: parseFloat(lng),
        radius_meters: parseInt(radius, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to update site.');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => sitesApi.deactivate(orgId, editingSite!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) return Alert.alert('Validation', 'Site name is required.');
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radNum = parseInt(radius, 10);
    if (isNaN(latNum) || latNum < -90 || latNum > 90)
      return Alert.alert('Validation', 'Enter a valid latitude (-90 to 90).');
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180)
      return Alert.alert('Validation', 'Enter a valid longitude (-180 to 180).');
    if (isNaN(radNum) || radNum < 10)
      return Alert.alert('Validation', 'Radius must be at least 10 metres.');
    isEditing ? updateMutation.mutate() : createMutation.mutate();
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  const confColor = (c?: string) =>
    c === 'high' ? C.success : c === 'medium' ? C.warning : C.danger;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Drag handle */}
            <View style={styles.dragHandle} />

            {/* Modal header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {isEditing ? 'Edit Site' : 'Add New Site'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {isEditing ? 'Update geofence configuration' : 'Configure a new check-in zone'}
                </Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <MaterialCommunityIcons name="close" size={20} color={C.textSecondary} />
              </Pressable>
            </View>

            {/* Map placeholder (200px height, dark-styled) */}
            <View style={styles.modalMapBox}>
              <LinearGradient
                colors={['#1E3A5F', '#0F2744']}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.mapGridOverlay}>
                {[0, 1, 2, 3].map(i => (
                  <View key={`mh${i}`} style={[styles.mapGridLine, styles.mapGridH, { top: `${15 + i * 20}%` as any }]} />
                ))}
                {[0, 1, 2, 3, 4].map(i => (
                  <View key={`mv${i}`} style={[styles.mapGridLine, styles.mapGridV, { left: `${10 + i * 20}%` as any }]} />
                ))}
              </View>
              <View style={styles.modalMapCircle} />
              <View style={styles.modalMapPinWrapper}>
                <MaterialCommunityIcons name="map-marker" size={36} color={C.primary} />
              </View>
              <View style={styles.modalMapHint}>
                <MaterialCommunityIcons name="information-outline" size={13} color={C.textSecondary} />
                <Text style={styles.modalMapHintText}>
                  Enter GPS coordinates below. Open Google Maps, long-press your office and copy the coordinates.
                </Text>
              </View>
            </View>

            {/* Fields */}
            <Text style={styles.fieldLabel}>Site Name *</Text>
            <PaperInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Main Office"
              mode="outlined"
              style={styles.input}
              outlineColor={C.border}
              activeOutlineColor={C.primary}
              placeholderTextColor={C.textMuted}
              textColor={C.textPrimary}
              left={<PaperInput.Icon icon="office-building-outline" color={C.textSecondary} />}
              theme={{ colors: { background: C.surface2 } }}
              disabled={isLoading}
            />

            <Text style={styles.fieldLabel}>Address</Text>
            <PaperInput
              value={address}
              onChangeText={setAddress}
              placeholder="e.g. 123 Tech Park, Kuala Lumpur"
              mode="outlined"
              style={styles.input}
              outlineColor={C.border}
              activeOutlineColor={C.primary}
              placeholderTextColor={C.textMuted}
              textColor={C.textPrimary}
              left={<PaperInput.Icon icon="map-marker-outline" color={C.textSecondary} />}
              theme={{ colors: { background: C.surface2 } }}
              disabled={isLoading}
            />

            <Text style={styles.fieldLabel}>GPS Coordinates *</Text>
            <View style={styles.row}>
              <PaperInput
                value={lat}
                onChangeText={setLat}
                placeholder="Latitude"
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
                outlineColor={C.border}
                activeOutlineColor={C.primary}
                placeholderTextColor={C.textMuted}
                textColor={C.textPrimary}
                keyboardType="numeric"
                left={<PaperInput.Icon icon="latitude" color={C.textSecondary} />}
                theme={{ colors: { background: C.surface2 } }}
                disabled={isLoading}
              />
              <View style={{ width: 10 }} />
              <PaperInput
                value={lng}
                onChangeText={setLng}
                placeholder="Longitude"
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
                outlineColor={C.border}
                activeOutlineColor={C.primary}
                placeholderTextColor={C.textMuted}
                textColor={C.textPrimary}
                keyboardType="numeric"
                left={<PaperInput.Icon icon="longitude" color={C.textSecondary} />}
                theme={{ colors: { background: C.surface2 } }}
                disabled={isLoading}
              />
            </View>

            <Text style={styles.fieldLabel}>Check-in Radius (metres) *</Text>
            <PaperInput
              value={radius}
              onChangeText={setRadius}
              mode="outlined"
              style={styles.input}
              outlineColor={C.border}
              activeOutlineColor={C.primary}
              placeholderTextColor={C.textMuted}
              textColor={C.textPrimary}
              keyboardType="numeric"
              left={<PaperInput.Icon icon="target" color={C.textSecondary} />}
              theme={{ colors: { background: C.surface2 } }}
              disabled={isLoading}
            />
            <Text style={styles.subHint}>Recommended: 50–200m. Larger radius = more lenient check-ins.</Text>

            {/* AI Suggestion card */}
            {editingSite?.id && suggestionLoading && (
              <View style={styles.suggestionLoading}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.suggestionLoadingText}>Analysing check-in data…</Text>
              </View>
            )}
            {editingSite?.id && !suggestionLoading && !suggestionError && radiusSuggestion && (
              <View style={styles.suggestionCard}>
                <View style={styles.suggestionTopRow}>
                  <View style={styles.suggestionIconBox}>
                    <MaterialCommunityIcons name="robot" size={16} color={C.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionLabel}>AI Suggested</Text>
                    <Text style={styles.suggestionValue}>
                      {Math.round(radiusSuggestion.suggested_radius_meters)}m
                      {'  '}
                      <Text style={[styles.confBadge, { color: confColor(radiusSuggestion.confidence) }]}>
                        {radiusSuggestion.confidence} confidence
                      </Text>
                    </Text>
                  </View>
                  {radiusSuggestion.sample_count > 0 && (
                    <Pressable
                      onPress={() => {
                        setRadius(String(Math.round(radiusSuggestion.suggested_radius_meters)));
                        setUsedSuggestion(true);
                      }}
                      style={styles.useSuggestedBtn}
                    >
                      <Text style={styles.useSuggestedText}>
                        {usedSuggestion ? 'Applied ✓' : 'Apply'}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {radiusSuggestion.sample_count === 0 ? (
                  <Text style={styles.suggestionMuted}>Insufficient check-in data for a suggestion</Text>
                ) : (
                  <Text style={styles.suggestionMuted}>
                    Based on {radiusSuggestion.sample_count} check-ins at this site
                  </Text>
                )}
              </View>
            )}

            {/* Save button */}
            <Pressable
              onPress={handleSubmit}
              disabled={isLoading}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: 20 }]}
            >
              <LinearGradient
                colors={['#6366F1', '#8B5CF6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveBtn}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={isEditing ? 'content-save-outline' : 'map-marker-plus-outline'}
                      size={18}
                      color="#FFFFFF"
                    />
                    <Text style={styles.saveBtnText}>
                      {isEditing ? 'Save Changes' : 'Create Site'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Cancel button */}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            {/* Deactivate */}
            {isEditing && editingSite?.is_active && (
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Deactivate Site',
                    'This will prevent check-ins at this location. Continue?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Deactivate', style: 'destructive', onPress: () => deactivateMutation.mutate() },
                    ],
                  )
                }
                disabled={deactivateMutation.isPending}
                style={styles.deactivateBtn}
              >
                {deactivateMutation.isPending ? (
                  <ActivityIndicator size="small" color={C.danger} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="map-marker-off-outline" size={16} color={C.danger} />
                    <Text style={styles.deactivateBtnText}>Deactivate Site</Text>
                  </>
                )}
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function GeofencesScreen() {
  const user = useAuthStore(s => s.user);
  const orgId = user?.org_id ?? '';
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: sites, isLoading, refetch } = useQuery<Site[]>({
    queryKey: ['sites', orgId],
    queryFn: () => sitesApi.list(orgId).then(r => r.data),
    enabled: !!orgId,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const activeSites = (sites ?? []).filter(s => s.is_active).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <LinearGradient colors={['#1E293B', '#0F172A']} style={styles.header}>
        <View>
          <Text style={styles.title}>Geofences</Text>
          <View style={styles.headerBadgeRow}>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>
                {sites?.length ?? 0} site{(sites?.length ?? 0) !== 1 ? 's' : ''}
              </Text>
            </View>
            {activeSites > 0 && (
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeBadgeText}>{activeSites} active</Text>
              </View>
            )}
          </View>
        </View>
        {/* Header FAB */}
        <Pressable
          style={styles.headerFab}
          onPress={() => { setEditingSite(null); setShowForm(true); }}
        >
          <LinearGradient
            colors={['#6366F1', '#8B5CF6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerFabGradient}
          >
            <MaterialCommunityIcons name="plus" size={22} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.loadingText}>Loading sites…</Text>
        </View>
      ) : (
        <FlatList
          data={sites ?? []}
          keyExtractor={s => s.id}
          renderItem={({ item }) => (
            <SiteCard
              site={item}
              onEdit={() => { setEditingSite(item); setShowForm(true); }}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[C.primary]}
              tintColor={C.primary}
              progressBackgroundColor={C.surface}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconBox}>
                <MaterialCommunityIcons name="map-marker-off" size={40} color={C.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No geofences configured</Text>
              <Text style={styles.emptySubtitle}>
                Add your first site so employees can check in from a verified location.
              </Text>
              <Pressable
                style={styles.emptyBtn}
                onPress={() => { setEditingSite(null); setShowForm(true); }}
              >
                <LinearGradient
                  colors={['#6366F1', '#8B5CF6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.emptyBtnGradient}
                >
                  <MaterialCommunityIcons name="map-marker-plus" size={16} color="#FFFFFF" />
                  <Text style={styles.emptyBtnText}>Add Site</Text>
                </LinearGradient>
              </Pressable>
            </View>
          }
        />
      )}

      {/* FAB — bottom right */}
      <Pressable
        style={styles.fab}
        onPress={() => { setEditingSite(null); setShowForm(true); }}
      >
        <LinearGradient
          colors={['#6366F1', '#8B5CF6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <MaterialCommunityIcons name="map-marker-plus" size={26} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>

      <SiteFormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditingSite(null); }}
        editingSite={editingSite}
        orgId={orgId}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 24, fontWeight: '800', color: C.textPrimary },
  headerBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  countBadge: {
    backgroundColor: C.surface2,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  countBadgeText: { fontSize: 11, fontWeight: '600', color: C.textSecondary },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  activeBadgeText: { fontSize: 11, fontWeight: '600', color: C.success },
  headerFab: {
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  headerFabGradient: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },

  // Loading
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: C.textSecondary, fontSize: 14 },

  // List
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 10 },

  // Site card
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 12,
    marginBottom: 0,
  },
  mapThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mapGrid: { ...StyleSheet.absoluteFillObject },
  mapGridLine: { position: 'absolute', backgroundColor: 'rgba(148,163,184,0.1)' },
  mapGridH: { left: 0, right: 0, height: 1 },
  mapGridV: { top: 0, bottom: 0, width: 1 },
  mapCircle: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.teal,
    backgroundColor: 'rgba(20,184,166,0.08)',
  },
  cardBody: { flex: 1, gap: 4 },
  siteName: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  siteAddress: { fontSize: 12, color: C.textMuted, flex: 1 },
  radiusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(20,184,166,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  radiusText: { fontSize: 11, fontWeight: '700', color: C.teal },
  cardRight: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  editBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 32 },
  emptyIconBox: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  emptySubtitle: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 8, borderRadius: 14, overflow: 'hidden',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  emptyBtnGradient: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 28,
  },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 12,
  },
  fabGradient: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },

  // Modal
  modal: { flex: 1, backgroundColor: C.bg },
  modalContent: { padding: 20, gap: 4, paddingBottom: 48 },
  dragHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.surface2,
    alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary },
  modalSubtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // Modal map box (200px dark-styled)
  modalMapBox: {
    height: 200,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  mapGridOverlay: { ...StyleSheet.absoluteFillObject },
  modalMapCircle: {
    position: 'absolute',
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: C.primary,
    backgroundColor: 'rgba(99,102,241,0.1)',
  },
  modalMapPinWrapper: { alignItems: 'center', justifyContent: 'center' },
  modalMapHint: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    padding: 10,
    backgroundColor: 'rgba(15,23,42,0.78)',
  },
  modalMapHintText: { flex: 1, fontSize: 11, color: C.textSecondary, lineHeight: 16 },

  // Form fields
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 4,
  },
  input: { backgroundColor: C.surface2, marginBottom: 2 },
  row: { flexDirection: 'row' },
  subHint: { fontSize: 11, color: C.textMuted, marginTop: 2, marginBottom: 4 },

  // Suggestion card
  suggestionLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  suggestionLoadingText: { color: C.textSecondary, fontSize: 13 },
  suggestionCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.teal,
    gap: 6,
  },
  suggestionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionIconBox: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  suggestionLabel: {
    fontSize: 11, color: C.textMuted, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  suggestionValue: { fontSize: 15, fontWeight: '700', color: C.textPrimary, marginTop: 1 },
  confBadge: { fontSize: 12, fontWeight: '600' },
  useSuggestedBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  useSuggestedText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  suggestionMuted: { fontSize: 11, color: C.textMuted },

  // Save button
  saveBtn: {
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Cancel button
  cancelBtn: {
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  cancelBtnText: { color: C.textMuted, fontSize: 14, fontWeight: '600' },

  // Deactivate button
  deactivateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.06)',
  },
  deactivateBtnText: { color: C.danger, fontSize: 14, fontWeight: '600' },
});
