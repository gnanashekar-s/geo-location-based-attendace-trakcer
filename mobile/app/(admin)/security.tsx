import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  TextInput as RNTextInput,
  TouchableOpacity,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { whitelistApi, adminDevicesApi, ipRulesApi } from '@/services/api';

// ─── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg: '#09090B', surface: '#18181B', surface2: '#27272A',
  border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)',
  primary: '#6366F1', primaryDark: '#4F46E5',
  success: '#22C55E', successLight: 'rgba(34,197,94,0.12)',
  warning: '#F59E0B',
  danger: '#EF4444', dangerLight: 'rgba(239,68,68,0.12)',
  teal: '#14B8A6',
  textPrimary: '#FAFAFA', textSecondary: '#A1A1AA', textMuted: '#71717A',
};

// ─── Types ───────────────────────────────────────────────────────────────────
type Tab = 'whitelist' | 'devices' | 'iprules';

interface WhitelistEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  device_fingerprint: string;
  reason: string;
  created_at: string;
}

interface DeviceEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  platform: string;
  device_fingerprint: string;
  is_trusted: boolean;
  last_seen_at: string | null;
}

interface IPRule {
  id: string;
  rule_type: 'block' | 'allow';
  ip_cidr: string;
  reason: string;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function truncFp(fp: string): string {
  if (fp.length <= 16) return fp;
  return fp.slice(0, 8) + '…' + fp.slice(-6);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd MMM yyyy'); } catch { return iso; }
}

function platformIcon(p: string): 'android' | 'apple-ios' | 'web' {
  if (p === 'android') return 'android';
  if (p === 'ios') return 'apple-ios';
  return 'web';
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function SecurityScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('whitelist');
  const [modalVisible, setModalVisible] = useState(false);

  // Form state
  const [wlUserId, setWlUserId] = useState('');
  const [wlFingerprint, setWlFingerprint] = useState('');
  const [wlReason, setWlReason] = useState('');
  const [ipCidr, setIpCidr] = useState('');
  const [ipRuleType, setIpRuleType] = useState<'block' | 'allow'>('block');
  const [ipReason, setIpReason] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const wlQuery = useQuery<WhitelistEntry[]>({
    queryKey: ['security-whitelist'],
    queryFn: () => whitelistApi.list().then((r: any) => r.data),
  });

  const devQuery = useQuery<DeviceEntry[]>({
    queryKey: ['security-devices'],
    queryFn: () => adminDevicesApi.list().then((r: any) => r.data),
  });

  const iprQuery = useQuery<IPRule[]>({
    queryKey: ['security-iprules'],
    queryFn: () => ipRulesApi.list().then((r: any) => r.data),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addWl = useMutation({
    mutationFn: (p: { user_id: string; device_fingerprint: string; reason: string }) =>
      whitelistApi.add(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-whitelist'] });
      closeModal();
    },
    onError: () => Alert.alert('Error', 'Failed to add whitelist entry.'),
  });

  const removeWl = useMutation({
    mutationFn: (id: string) => whitelistApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-whitelist'] }),
    onError: () => Alert.alert('Error', 'Failed to remove entry.'),
  });

  const trustDev = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => adminDevicesApi.trust(id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-devices'] }),
    onError: () => Alert.alert('Error', 'Failed to update device trust.'),
  });

  const addIpr = useMutation({
    mutationFn: (p: { rule_type: 'block' | 'allow'; ip_cidr: string; reason: string }) =>
      ipRulesApi.add(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-iprules'] });
      closeModal();
    },
    onError: () => Alert.alert('Error', 'Failed to create IP rule. Check the IP/CIDR format.'),
  });

  const removeIpr = useMutation({
    mutationFn: (id: string) => ipRulesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-iprules'] }),
    onError: () => Alert.alert('Error', 'Failed to remove IP rule.'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  function openModal() {
    setWlUserId(''); setWlFingerprint(''); setWlReason('');
    setIpCidr(''); setIpRuleType('block'); setIpReason('');
    setModalVisible(true);
  }

  function closeModal() { setModalVisible(false); }

  function submitModal() {
    if (tab === 'whitelist') {
      if (!wlUserId.trim() || !wlFingerprint.trim()) {
        Alert.alert('Missing fields', 'User ID and device fingerprint are required.');
        return;
      }
      addWl.mutate({ user_id: wlUserId.trim(), device_fingerprint: wlFingerprint.trim(), reason: wlReason.trim() });
    } else if (tab === 'iprules') {
      if (!ipCidr.trim()) {
        Alert.alert('Missing field', 'IP address or CIDR range is required.');
        return;
      }
      addIpr.mutate({ rule_type: ipRuleType, ip_cidr: ipCidr.trim(), reason: ipReason.trim() });
    }
  }

  function confirmDelete(id: string, label: string, type: Tab) {
    Alert.alert('Remove', `Remove "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          if (type === 'whitelist') removeWl.mutate(id);
          else if (type === 'iprules') removeIpr.mutate(id);
        },
      },
    ]);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderWhitelistCard({ item }: { item: WhitelistEntry }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={[styles.avatarCircle, { backgroundColor: C.primary + '22' }]}>
            <MaterialCommunityIcons name="shield-check" size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.cardTitle}>{item.user_name}</Text>
            <Text style={styles.cardSub}>{item.user_email}</Text>
          </View>
          <TouchableOpacity
            onPress={() => confirmDelete(item.id, item.user_name, 'whitelist')}
            style={styles.deleteBtn}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={C.danger} />
          </TouchableOpacity>
        </View>
        <View style={styles.fpRow}>
          <MaterialCommunityIcons name="cellphone-key" size={13} color={C.textMuted} />
          <Text style={styles.fpText}>{truncFp(item.device_fingerprint)}</Text>
        </View>
        {item.reason ? (
          <Text style={styles.reasonText}>{item.reason}</Text>
        ) : null}
        <Text style={styles.dateText}>Added {fmtDate(item.created_at)}</Text>
      </View>
    );
  }

  function renderDeviceCard({ item }: { item: DeviceEntry }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={[styles.avatarCircle, { backgroundColor: C.teal + '22' }]}>
            <MaterialCommunityIcons name={platformIcon(item.platform)} size={18} color={C.teal} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.cardTitle}>{item.user_name}</Text>
            <Text style={styles.cardSub}>{item.user_email}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.chipText, { color: item.is_trusted ? C.success : C.textMuted }]}>
              {item.is_trusted ? 'Trusted' : 'Untrusted'}
            </Text>
            <Switch
              value={item.is_trusted}
              onValueChange={(v) => trustDev.mutate({ id: item.id, v })}
              trackColor={{ false: C.surface2, true: C.success + '66' }}
              thumbColor={item.is_trusted ? C.success : C.textMuted}
            />
          </View>
        </View>
        <View style={styles.fpRow}>
          <MaterialCommunityIcons name="cellphone-key" size={13} color={C.textMuted} />
          <Text style={styles.fpText}>{truncFp(item.device_fingerprint)}</Text>
          <View style={[styles.platformChip, { marginLeft: 8 }]}>
            <Text style={styles.chipText}>{item.platform}</Text>
          </View>
        </View>
        {item.last_seen_at ? (
          <Text style={styles.dateText}>Last seen {fmtDate(item.last_seen_at)}</Text>
        ) : null}
      </View>
    );
  }

  function renderIPRuleCard({ item }: { item: IPRule }) {
    const isBlock = item.rule_type === 'block';
    return (
      <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: isBlock ? C.danger : C.success }]}>
        <View style={styles.cardRow}>
          <View style={[styles.ruleTypeBadge, { backgroundColor: isBlock ? C.dangerLight : C.successLight }]}>
            <MaterialCommunityIcons
              name={isBlock ? 'block-helper' : 'check-circle-outline'}
              size={14}
              color={isBlock ? C.danger : C.success}
            />
            <Text style={[styles.ruleTypeText, { color: isBlock ? C.danger : C.success }]}>
              {isBlock ? 'BLOCK' : 'ALLOW'}
            </Text>
          </View>
          <Text style={styles.ipText}>{item.ip_cidr}</Text>
          <TouchableOpacity
            onPress={() => confirmDelete(item.id, item.ip_cidr, 'iprules')}
            style={styles.deleteBtn}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={C.danger} />
          </TouchableOpacity>
        </View>
        {item.reason ? (
          <Text style={styles.reasonText}>{item.reason}</Text>
        ) : null}
        <Text style={styles.dateText}>Added {fmtDate(item.created_at)}</Text>
      </View>
    );
  }

  // ── Active data & loading ─────────────────────────────────────────────────
  const activeData =
    tab === 'whitelist' ? (wlQuery.data ?? []) :
    tab === 'devices'   ? (devQuery.data ?? []) :
    (iprQuery.data ?? []);

  const isLoading =
    tab === 'whitelist' ? wlQuery.isLoading :
    tab === 'devices'   ? devQuery.isLoading :
    iprQuery.isLoading;

  const refetch =
    tab === 'whitelist' ? wlQuery.refetch :
    tab === 'devices'   ? devQuery.refetch :
    iprQuery.refetch;

  const renderItem =
    tab === 'whitelist' ? renderWhitelistCard :
    tab === 'devices'   ? renderDeviceCard :
    renderIPRuleCard;

  const sectionDesc =
    tab === 'whitelist'
      ? 'Whitelisted devices bypass all fraud checks — VPN, mock GPS, impossible travel, etc.'
      : tab === 'devices'
      ? 'Trusted devices get a lower fraud weight for "unknown device" flag.'
      : 'Block or allow specific IPs/CIDRs at check-in. BLOCK overrides all other checks.';

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <LinearGradient
        colors={['#1E1B4B', '#09090B']}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <MaterialCommunityIcons name="shield-lock" size={24} color={C.primary} />
          <Text style={styles.headerTitle}>Security</Text>
        </View>

        {/* Segment strip */}
        <View style={styles.segmentStrip}>
          {(['whitelist', 'devices', 'iprules'] as Tab[]).map((t) => {
            const label = t === 'whitelist' ? 'Whitelist' : t === 'devices' ? 'Devices' : 'IP Rules';
            const icon = t === 'whitelist' ? 'shield-check' : t === 'devices' ? 'cellphone-lock' : 'ip-network';
            const active = tab === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setTab(t)}
              >
                <MaterialCommunityIcons name={icon as any} size={14} color={active ? '#fff' : C.textMuted} />
                <Text style={[styles.segmentLabel, active && { color: '#fff' }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </LinearGradient>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={activeData as any[]}
          keyExtractor={(item) => item.id}
          renderItem={renderItem as any}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.descCard}>
              <Text style={styles.descText}>{sectionDesc}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="shield-check-outline" size={48} color={C.textMuted} />
              <Text style={styles.emptyTitle}>Nothing here</Text>
              <Text style={styles.emptyText}>
                {tab === 'whitelist' ? 'No whitelisted devices.' :
                 tab === 'devices'   ? 'No registered devices.' :
                 'No IP rules defined.'}
              </Text>
            </View>
          }
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      {/* FAB — hidden on Devices tab (trust is inline) */}
      {tab !== 'devices' && (
        <Pressable style={styles.fab} onPress={openModal}>
          <MaterialCommunityIcons name="plus" size={26} color="#fff" />
        </Pressable>
      )}

      {/* Add Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <SafeAreaView style={styles.modal}>
          <LinearGradient colors={['#1E1B4B', '#09090B']} style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {tab === 'whitelist' ? 'Add Whitelist Entry' : 'Add IP Rule'}
            </Text>
            <TouchableOpacity onPress={closeModal}>
              <MaterialCommunityIcons name="close" size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </LinearGradient>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {tab === 'whitelist' ? (
              <>
                <Text style={styles.fieldLabel}>User ID</Text>
                <RNTextInput
                  style={styles.input}
                  value={wlUserId}
                  onChangeText={setWlUserId}
                  placeholder="UUID of the user"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                />
                <Text style={styles.fieldLabel}>Device Fingerprint</Text>
                <RNTextInput
                  style={styles.input}
                  value={wlFingerprint}
                  onChangeText={setWlFingerprint}
                  placeholder="Device fingerprint string"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                />
                <Text style={styles.fieldLabel}>Reason</Text>
                <RNTextInput
                  style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                  value={wlReason}
                  onChangeText={setWlReason}
                  placeholder="Why is this device whitelisted?"
                  placeholderTextColor={C.textMuted}
                  multiline
                />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>IP Address or CIDR</Text>
                <RNTextInput
                  style={styles.input}
                  value={ipCidr}
                  onChangeText={setIpCidr}
                  placeholder="e.g. 1.2.3.4 or 10.0.0.0/8"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  keyboardType="default"
                />
                <Text style={styles.fieldLabel}>Rule Type</Text>
                <View style={styles.ruleTypeRow}>
                  <TouchableOpacity
                    style={[styles.ruleTypePill, ipRuleType === 'block' && { backgroundColor: C.dangerLight, borderColor: C.danger }]}
                    onPress={() => setIpRuleType('block')}
                  >
                    <MaterialCommunityIcons name="block-helper" size={14} color={ipRuleType === 'block' ? C.danger : C.textMuted} />
                    <Text style={[styles.ruleTypePillText, ipRuleType === 'block' && { color: C.danger }]}>Block</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ruleTypePill, ipRuleType === 'allow' && { backgroundColor: C.successLight, borderColor: C.success }]}
                    onPress={() => setIpRuleType('allow')}
                  >
                    <MaterialCommunityIcons name="check-circle-outline" size={14} color={ipRuleType === 'allow' ? C.success : C.textMuted} />
                    <Text style={[styles.ruleTypePillText, ipRuleType === 'allow' && { color: C.success }]}>Allow</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.fieldHint}>
                  {ipRuleType === 'block'
                    ? 'BLOCK: immediately rejects check-ins from this IP (score=1.0).'
                    : 'ALLOW: skips external IP reputation check for this IP.'}
                </Text>
                <Text style={styles.fieldLabel}>Reason</Text>
                <RNTextInput
                  style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                  value={ipReason}
                  onChangeText={setIpReason}
                  placeholder="Why is this rule needed?"
                  placeholderTextColor={C.textMuted}
                  multiline
                />
              </>
            )}
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, (addWl.isPending || addIpr.isPending) && { opacity: 0.6 }]}
              onPress={submitModal}
              disabled={addWl.isPending || addIpr.isPending}
            >
              {(addWl.isPending || addIpr.isPending)
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>Save</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: C.textPrimary },

  segmentStrip: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 8,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  segmentBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  segmentLabel: { fontSize: 12, fontWeight: '600', color: C.textMuted },

  listContent: { padding: 14, gap: 10, paddingBottom: 100 },

  descCard: {
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 4,
  },
  descText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },

  card: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 6,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.textPrimary },
  cardSub: { fontSize: 12, color: C.textSecondary },

  fpRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fpText: { fontSize: 11, fontFamily: 'monospace', color: C.textMuted },

  platformChip: {
    backgroundColor: C.surface2, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  chipText: { fontSize: 10, fontWeight: '600', color: C.textMuted },

  reasonText: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' },
  dateText: { fontSize: 11, color: C.textMuted },

  deleteBtn: { padding: 6 },

  ruleTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  ruleTypeText: { fontSize: 11, fontWeight: '700' },
  ipText: { flex: 1, fontSize: 14, fontWeight: '700', color: C.textPrimary, marginLeft: 8 },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: C.textSecondary },
  emptyText: { fontSize: 13, color: C.textMuted },

  fab: {
    position: 'absolute', right: 20, bottom: 32,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
    elevation: 8,
  },

  // Modal
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  modalBody: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  modalActions: {
    flexDirection: 'row', gap: 12, padding: 20,
    borderTopWidth: 1, borderTopColor: C.border,
  },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.textSecondary, marginBottom: 6, marginTop: 14 },
  fieldHint: { fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 16 },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderStrong,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.textPrimary, fontSize: 14,
  },

  ruleTypeRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  ruleTypePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  ruleTypePillText: { fontSize: 13, fontWeight: '600', color: C.textMuted },

  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    backgroundColor: C.surface2, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: C.textSecondary },
  submitBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center',
  },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
