import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  ActivityIndicator,
  Image,
  Alert,
  StatusBar,
  ScrollView,
  TextInput as RNTextInput,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { approvalsApi } from '@/services/api';
import type { Approval } from '@/types';

// ─── Design Tokens ────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function avatarGradient(name: string): [string, string] {
  const gradients: [string, string][] = [
    ['#4F46E5', '#7C3AED'], ['#7C3AED', '#A855F7'],
    ['#DB2777', '#EC4899'], ['#DC2626', '#EF4444'],
    ['#059669', '#10B981'], ['#0284C7', '#0EA5E9'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return gradients[Math.abs(h) % gradients.length];
}

function formatDate(iso: string) {
  try { return format(parseISO(iso), 'MMM d, HH:mm'); } catch { return iso; }
}

function formatDateShort(iso: string) {
  try { return format(parseISO(iso), 'MMM d'); } catch { return iso; }
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type TabKey = 'pending' | 'approved' | 'rejected';

// ─── Fraud Bar ────────────────────────────────────────────────────────────────

function FraudBar({ score }: { score: number }) {
  const color = score > 0.6 ? C.danger : score > 0.3 ? C.warning : C.success;
  return (
    <View style={fraudStyles.row}>
      <View style={fraudStyles.track}>
        <View style={[fraudStyles.fill, { width: `${score * 100}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[fraudStyles.label, { color }]}>{Math.round(score * 100)}%</Text>
    </View>
  );
}

const fraudStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 5, backgroundColor: 'rgba(148,163,184,0.1)', borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  label: { fontSize: 11, fontWeight: '700', width: 28, textAlign: 'right' },
});

// ─── Escalation Badge ─────────────────────────────────────────────────────────

function EscalationBadge({ level }: { level: string }) {
  const cfg = level === 'critical'
    ? { color: C.danger, bg: C.dangerLight }
    : level === 'high'
    ? { color: C.warning, bg: C.warningLight }
    : { color: C.primary, bg: 'rgba(99,102,241,0.12)' };
  return (
    <View style={[escStyles.badge, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
      <Text style={[escStyles.text, { color: cfg.color }]}>{level.toUpperCase()}</Text>
    </View>
  );
}

const escStyles = StyleSheet.create({
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  text: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});

// ─── Approval Detail Modal ────────────────────────────────────────────────────

function ApprovalDetailModal({
  approval, visible, onClose, onApprove, onReject,
}: {
  approval: Approval;
  visible: boolean;
  onClose: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [grad] = useState(() => avatarGradient(approval.employee_name));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={detailStyles.root}>
        {/* Header */}
        <View style={detailStyles.header}>
          <LinearGradient colors={['#1E293B', '#0F172A']} style={StyleSheet.absoluteFill} />
          <View style={detailStyles.headerRow}>
            <View>
              <Text style={detailStyles.headerTitle}>Approval Request</Text>
              <Text style={detailStyles.headerSub}>Review & take action</Text>
            </View>
            <Pressable onPress={onClose} style={detailStyles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={detailStyles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Employee header */}
          <View style={detailStyles.empRow}>
            <LinearGradient colors={grad} style={detailStyles.avatar}>
              <Text style={detailStyles.initials}>{getInitials(approval.employee_name)}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={detailStyles.empName}>{approval.employee_name}</Text>
              <Text style={detailStyles.empEmail}>{approval.employee_email}</Text>
            </View>
            <EscalationBadge level={approval.escalation_level} />
          </View>

          {/* Info rows */}
          <View style={detailStyles.infoCard}>
            <View style={detailStyles.infoRow}>
              <MaterialCommunityIcons name="clock-outline" size={15} color={C.teal} />
              <Text style={detailStyles.infoLabel}>Submitted</Text>
              <Text style={detailStyles.infoValue}>
                {format(parseISO(approval.submitted_at), 'dd MMM yyyy HH:mm')}
              </Text>
            </View>
            <View style={[detailStyles.infoRow, detailStyles.infoRowBorder]}>
              <MaterialCommunityIcons name="map-marker-outline" size={15} color={C.purple} />
              <Text style={detailStyles.infoLabel}>Location</Text>
              <Text style={detailStyles.infoValue}>
                {approval.latitude?.toFixed(4) ?? '—'}, {approval.longitude?.toFixed(4) ?? '—'} (±{approval.accuracy ?? 0}m)
              </Text>
            </View>
          </View>

          {/* Reason */}
          <View style={detailStyles.reasonCard}>
            <Text style={detailStyles.sectionLabel}>Reason</Text>
            <Text style={detailStyles.reasonText}>{approval.reason}</Text>
          </View>

          {/* Fraud score */}
          <View style={detailStyles.fraudCard}>
            <View style={detailStyles.fraudHeader}>
              <Text style={detailStyles.sectionLabel}>Fraud Score</Text>
              <FraudBar score={approval.fraud_score} />
            </View>
            {approval.fraud_flags.length > 0 && (
              <View style={detailStyles.flagsRow}>
                {approval.fraud_flags.map(flag => (
                  <View key={flag} style={detailStyles.flagChip}>
                    <Text style={detailStyles.flagText}>{flag.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Photo */}
          {approval.photo_url ? (
            <Image source={{ uri: approval.photo_url }} style={detailStyles.photo} resizeMode="cover" />
          ) : null}

          {/* Note input */}
          <Text style={detailStyles.fieldLabel}>Review Note (optional)</Text>
          <View style={detailStyles.noteWrapper}>
            <RNTextInput
              style={detailStyles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Add a review note…"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Action buttons */}
          <View style={detailStyles.actionRow}>
            <Pressable
              style={({ pressed }) => [detailStyles.approveBtn, pressed && { opacity: 0.85 }]}
              onPress={() => onApprove(note)}
            >
              <LinearGradient colors={['#059669', '#10B981']} style={detailStyles.btnGrad}>
                <MaterialCommunityIcons name="check" size={16} color="#fff" />
                <Text style={detailStyles.btnText}>Approve</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              style={[detailStyles.rejectBtn, ({ pressed }: any) => pressed && { opacity: 0.85 }]}
              onPress={() => onReject(note)}
            >
              <MaterialCommunityIcons name="close" size={16} color={C.danger} />
              <Text style={[detailStyles.btnText, { color: C.danger }]}>Reject</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const detailStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { overflow: 'hidden' },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  headerSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 16, fontWeight: '700', color: '#fff' },
  empName: { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  empEmail: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  infoCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  infoLabel: { flex: 1, fontSize: 12, color: C.textMuted },
  infoValue: { fontSize: 12, fontWeight: '600', color: C.textPrimary, textAlign: 'right', flex: 2 },
  reasonCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14, gap: 8,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  reasonText: { fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  fraudCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14, gap: 10,
  },
  fraudHeader: { gap: 8 },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flagChip: {
    backgroundColor: C.warningLight, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  flagText: { fontSize: 10, fontWeight: '600', color: C.warning },
  photo: { width: '100%', height: 200, borderRadius: 14 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
  },
  noteWrapper: {
    backgroundColor: C.surface2, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, padding: 12,
  },
  noteInput: { fontSize: 14, color: C.textPrimary, minHeight: 72 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: { flex: 1 },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, borderWidth: 1.5, borderColor: C.danger,
    paddingVertical: 10,
  },
  btnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 10,
  },
  btnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

// ─── Request Card ─────────────────────────────────────────────────────────────

function RequestCard({
  item,
  tab,
  isSelected,
  onPress,
  onLongPress,
  onApprove,
  onReject,
}: {
  item: Approval;
  tab: TabKey;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [grad] = useState(() => avatarGradient(item.employee_name));
  const startDate = formatDateShort(item.submitted_at);

  const statusConfig = {
    approved: { color: C.success, bg: C.successLight, label: 'Approved', icon: 'check-circle' as const },
    rejected: { color: C.danger, bg: C.dangerLight, label: 'Rejected', icon: 'close-circle' as const },
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: 'rgba(99,102,241,0.08)' }}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
    >
      <View style={[cardSty.card, isSelected && cardSty.cardSelected]}>
        {isSelected && (
          <View style={cardSty.checkBadge}>
            <MaterialCommunityIcons name="check-circle" size={20} color={C.primary} />
          </View>
        )}

        {/* Top row */}
        <View style={cardSty.topRow}>
          <LinearGradient colors={grad} style={cardSty.avatar}>
            <Text style={cardSty.initials}>{getInitials(item.employee_name)}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={cardSty.name} numberOfLines={1}>{item.employee_name}</Text>
            <Text style={cardSty.dateRange}>
              {startDate}
              <Text style={{ color: C.textMuted }}> · </Text>
              {formatDate(item.submitted_at)}
            </Text>
          </View>
          <EscalationBadge level={item.escalation_level} />
        </View>

        {/* Type badge */}
        <View style={cardSty.typeBadge}>
          <MaterialCommunityIcons name="clock-check-outline" size={12} color={C.primary} />
          <Text style={cardSty.typeText}>Manual Check-in</Text>
        </View>

        {/* Reason */}
        <Text style={cardSty.reason} numberOfLines={2}>{item.reason}</Text>

        {/* Fraud bar */}
        <FraudBar score={item.fraud_score} />

        {/* Action area */}
        {tab === 'pending' ? (
          <View style={cardSty.actionRow}>
            <Pressable
              onPress={onApprove}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, flex: 1 }]}
            >
              <LinearGradient colors={['#059669', '#10B981']} style={cardSty.approveBtn}>
                <MaterialCommunityIcons name="check" size={14} color="#fff" />
                <Text style={cardSty.approveBtnText}>Approve</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={onReject}
              style={[cardSty.rejectBtn, ({ pressed }: any) => pressed && { opacity: 0.85 }]}
            >
              <MaterialCommunityIcons name="close" size={14} color={C.danger} />
              <Text style={cardSty.rejectBtnText}>Reject</Text>
            </Pressable>
          </View>
        ) : (
          <View style={cardSty.statusRow}>
            {(() => {
              const cfg = tab === 'approved' ? statusConfig.approved : statusConfig.rejected;
              return (
                <View style={[cardSty.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
                  <MaterialCommunityIcons name={cfg.icon} size={13} color={cfg.color} />
                  <Text style={[cardSty.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              );
            })()}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const cardSty = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 10, marginBottom: 8,
  },
  cardSelected: { borderColor: C.primary, borderWidth: 1.5 },
  checkBadge: { position: 'absolute', top: 10, right: 10, zIndex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 14, fontWeight: '700', color: '#fff' },
  name: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  dateRange: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(99,102,241,0.10)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start',
  },
  typeText: { fontSize: 11, fontWeight: '600', color: C.primary },
  reason: { fontSize: 13, color: C.textMuted, lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  approveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderRadius: 10, height: 32,
  },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderRadius: 10, height: 32,
    borderWidth: 1.5, borderColor: C.danger,
  },
  rejectBtnText: { fontSize: 13, fontWeight: '700', color: C.danger },
  statusRow: { flexDirection: 'row' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function ApprovalsScreen() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [selected, setSelected] = useState<Approval | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelecting = selectedIds.size > 0;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => approvalsApi.list().then(r => r.data),
    refetchInterval: 30_000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note: string }) =>
      action === 'approve' ? approvalsApi.approve(id, note) : approvalsApi.reject(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'summary'] });
      setSelected(null);
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => approvalsApi.bulkApprove(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'summary'] });
      setSelectedIds(new Set());
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Bulk approve failed.');
    },
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const approvals = Array.isArray(data) ? data : [];
  const pendingCount = approvals.filter((a: Approval) => a.status === 'pending').length;

  const tabData = approvals.filter((a: Approval) => {
    if (tab === 'pending') return a.status === 'pending' || !a.status;
    if (tab === 'approved') return a.status === 'approved';
    if (tab === 'rejected') return a.status === 'rejected';
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(tabData.map((a: Approval) => a.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkApprove = () => {
    const ids = Array.from(selectedIds);
    Alert.alert(
      'Bulk Approve',
      `Approve ${ids.length} request${ids.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve All', onPress: () => bulkApproveMutation.mutate(ids) },
      ]
    );
  };

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <LinearGradient colors={['#1E293B', '#0F172A']} style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerContent}>
            {isSelecting ? (
              <View style={styles.selectingRow}>
                <Pressable onPress={clearSelection} style={styles.selectingCancel}>
                  <MaterialCommunityIcons name="close" size={18} color={C.textSecondary} />
                  <Text style={styles.selectingText}>{selectedIds.size} selected</Text>
                </Pressable>
                <Pressable onPress={selectAll}>
                  <Text style={styles.selectAllText}>Select All</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.titleRow}>
                <Text style={styles.headerTitle}>Approvals</Text>
                {pendingCount > 0 && (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => { setTab(t.key); clearSelection(); }}
              style={styles.tabItem}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              {active && <View style={styles.tabUnderline} />}
            </Pressable>
          );
        })}
      </View>

      {/* List */}
      <FlatList
        data={tabData}
        keyExtractor={(a: Approval) => a.id}
        contentContainerStyle={[styles.list, isSelecting && { paddingBottom: 100 }]}
        style={{ backgroundColor: C.bg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[C.primary]}
            tintColor={C.primary}
          />
        }
        renderItem={({ item }: { item: Approval }) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <RequestCard
              item={item}
              tab={tab}
              isSelected={isSelected}
              onPress={() => isSelecting ? toggleSelect(item.id) : setSelected(item)}
              onLongPress={() => toggleSelect(item.id)}
              onApprove={() => actionMutation.mutate({ id: item.id, action: 'approve', note: '' })}
              onReject={() => actionMutation.mutate({ id: item.id, action: 'reject', note: '' })}
            />
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={C.primary} size="large" />
              <Text style={styles.loadingText}>Loading approvals…</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIconBg}>
                <MaterialCommunityIcons name="check-circle-outline" size={36} color={C.success} />
              </View>
              <Text style={styles.emptyTitle}>No pending approvals</Text>
              <Text style={styles.emptySubtitle}>All caught up! Nothing to review right now.</Text>
            </View>
          )
        }
      />

      {/* Bulk approve bar */}
      {isSelecting && (
        <View style={styles.bulkBar}>
          <LinearGradient colors={['#1E293B', '#0F172A']} style={StyleSheet.absoluteFill} />
          <Pressable
            onPress={handleBulkApprove}
            disabled={bulkApproveMutation.isPending}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, flex: 1 }]}
          >
            <LinearGradient colors={[C.primary, C.primaryDark]} style={styles.bulkBtn}>
              {bulkApproveMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-all" size={18} color="#fff" />
                  <Text style={styles.bulkBtnText}>Approve Selected ({selectedIds.size})</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {selected && (
        <ApprovalDetailModal
          approval={selected}
          visible={!!selected}
          onClose={() => setSelected(null)}
          onApprove={(note) => actionMutation.mutate({ id: selected.id, action: 'approve', note })}
          onReject={(note) => actionMutation.mutate({ id: selected.id, action: 'reject', note })}
        />
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: { paddingBottom: 0 },
  headerContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5 },
  pendingBadge: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  pendingBadgeText: { fontSize: 13, fontWeight: '700', color: C.warning },
  selectingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectingCancel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectingText: { fontSize: 16, fontWeight: '600', color: C.textPrimary },
  selectAllText: { fontSize: 14, fontWeight: '700', color: C.primary },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabItem: {
    flex: 1, alignItems: 'center', paddingVertical: 13,
    position: 'relative',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: C.textMuted },
  tabTextActive: { color: C.textPrimary },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: '15%', right: '15%',
    height: 2, backgroundColor: C.primary, borderRadius: 2,
  },

  // List
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  // Loading / Empty
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  loadingText: { color: C.textSecondary, fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 72, gap: 12, paddingHorizontal: 40 },
  emptyIconBg: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  emptySubtitle: { fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20 },

  // Bulk bar
  bulkBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, overflow: 'hidden',
    borderTopWidth: 1, borderTopColor: C.border,
  },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14,
  },
  bulkBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
