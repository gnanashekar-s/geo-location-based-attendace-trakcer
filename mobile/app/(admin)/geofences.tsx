import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Text, Surface, Button, TextInput as PaperInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sitesApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { Site } from '@/types';

// ─── Site Card ────────────────────────────────────────────────────────────────

function SiteCard({ site, onEdit }: { site: Site; onEdit: () => void }) {
  return (
    <Pressable onPress={onEdit}>
      <Surface style={styles.card} elevation={1}>
        <View style={[styles.cardAccent, { backgroundColor: site.is_active ? '#10B981' : '#94A3B8' }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.siteName}>{site.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: site.is_active ? '#D1FAE5' : '#F1F5F9' }]}>
              <Text style={[styles.statusText, { color: site.is_active ? '#059669' : '#94A3B8' }]}>
                {site.is_active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
          <View style={styles.cardMeta}>
            <MaterialCommunityIcons name="map-marker-outline" size={13} color="#94A3B8" />
            <Text style={styles.siteAddress} numberOfLines={1}>{site.address || 'No address'}</Text>
          </View>
          <View style={styles.cardMeta}>
            <MaterialCommunityIcons name="target" size={13} color="#4F46E5" />
            <Text style={styles.siteRadius}>Radius: {site.radius_meters}m</Text>
            <MaterialCommunityIcons name="crosshairs-gps" size={13} color="#94A3B8" style={{ marginLeft: 12 }} />
            <Text style={styles.siteCoords}>
              {site.center_lat?.toFixed(4)}, {site.center_lng?.toFixed(4)}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />
      </Surface>
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

  React.useEffect(() => {
    if (visible) {
      setName(editingSite?.name ?? '');
      setAddress(editingSite?.address ?? '');
      setLat(editingSite?.center_lat?.toString() ?? '');
      setLng(editingSite?.center_lng?.toString() ?? '');
      setRadius(editingSite?.radius_meters?.toString() ?? '100');
    }
  }, [visible, editingSite]);

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
    if (isNaN(latNum) || latNum < -90 || latNum > 90) return Alert.alert('Validation', 'Enter a valid latitude (-90 to 90).');
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) return Alert.alert('Validation', 'Enter a valid longitude (-180 to 180).');
    if (isNaN(radNum) || radNum < 10) return Alert.alert('Validation', 'Radius must be at least 10 metres.');
    isEditing ? updateMutation.mutate() : createMutation.mutate();
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{isEditing ? 'Edit Site' : 'Add New Site'}</Text>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <MaterialCommunityIcons name="close" size={22} color="#64748B" />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Site Name *</Text>
            <PaperInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Main Office"
              mode="outlined"
              style={styles.input}
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              left={<PaperInput.Icon icon="office-building-outline" />}
              disabled={isLoading}
            />

            <Text style={styles.fieldLabel}>Address</Text>
            <PaperInput
              value={address}
              onChangeText={setAddress}
              placeholder="e.g. 123 Tech Park, Kuala Lumpur"
              mode="outlined"
              style={styles.input}
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              left={<PaperInput.Icon icon="map-marker-outline" />}
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
                outlineColor="#E2E8F0"
                activeOutlineColor="#4F46E5"
                keyboardType="numeric"
                left={<PaperInput.Icon icon="latitude" />}
                disabled={isLoading}
              />
              <View style={{ width: 10 }} />
              <PaperInput
                value={lng}
                onChangeText={setLng}
                placeholder="Longitude"
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
                outlineColor="#E2E8F0"
                activeOutlineColor="#4F46E5"
                keyboardType="numeric"
                left={<PaperInput.Icon icon="longitude" />}
                disabled={isLoading}
              />
            </View>

            <View style={styles.hintBox}>
              <MaterialCommunityIcons name="information-outline" size={14} color="#4F46E5" />
              <Text style={styles.hintText}>
                Open Google Maps, long-press your office location and copy the coordinates shown at the top.
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Check-in Radius (metres) *</Text>
            <PaperInput
              value={radius}
              onChangeText={setRadius}
              mode="outlined"
              style={styles.input}
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              keyboardType="numeric"
              left={<PaperInput.Icon icon="target" />}
              disabled={isLoading}
            />
            <Text style={styles.subHint}>Recommended: 50–200m. Larger radius = more lenient check-ins.</Text>

            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading}
              style={styles.submitBtn}
              buttonColor="#4F46E5"
              contentStyle={{ paddingVertical: 4 }}
              labelStyle={{ fontSize: 15, fontWeight: '700' }}
            >
              {isEditing ? 'Save Changes' : 'Create Site'}
            </Button>

            {isEditing && editingSite?.is_active && (
              <Button
                mode="outlined"
                onPress={() =>
                  Alert.alert('Deactivate Site', 'This will prevent check-ins at this location. Continue?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Deactivate', style: 'destructive', onPress: () => deactivateMutation.mutate() },
                  ])
                }
                loading={deactivateMutation.isPending}
                style={[styles.submitBtn, { borderColor: '#EF4444' }]}
                textColor="#EF4444"
                icon="map-marker-off-outline"
              >
                Deactivate Site
              </Button>
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Geofences</Text>
        <Text style={styles.subtitle}>{sites?.length ?? 0} site{sites?.length !== 1 ? 's' : ''} registered</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#4F46E5" style={{ marginTop: 40 }} />
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="map-marker-plus-outline" size={56} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No Sites Yet</Text>
              <Text style={styles.emptySubtitle}>
                Add your first office location so employees can check in.
              </Text>
            </View>
          }
        />
      )}

      <Pressable style={styles.fab} onPress={() => { setEditingSite(null); setShowForm(true); }}>
        <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
        <Text style={styles.fabLabel}>Add Site</Text>
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  subtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100, gap: 10 },
  card: {
    borderRadius: 14, backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden', paddingRight: 12,
  },
  cardAccent: { width: 4, alignSelf: 'stretch' },
  cardBody: { flex: 1, padding: 12, gap: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  siteName: { fontSize: 15, fontWeight: '700', color: '#1E293B', flex: 1 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  siteAddress: { fontSize: 12, color: '#64748B', flex: 1 },
  siteRadius: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },
  siteCoords: { fontSize: 11, color: '#94A3B8' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: '#4F46E5', borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, gap: 8, shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  // Modal
  modal: { flex: 1, backgroundColor: '#F8FAFC' },
  modalContent: { padding: 20, gap: 4, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#FFFFFF', marginBottom: 2 },
  row: { flexDirection: 'row' },
  hintBox: { flexDirection: 'row', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 10, padding: 12, marginVertical: 6, alignItems: 'flex-start' },
  hintText: { flex: 1, fontSize: 12, color: '#4338CA', lineHeight: 18 },
  subHint: { fontSize: 11, color: '#94A3B8', marginTop: 2, marginBottom: 4 },
  submitBtn: { borderRadius: 12, marginTop: 16 },
});
