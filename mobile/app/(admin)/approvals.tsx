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
} from 'react-native';
import { Text, Surface, Button, Chip, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { approvalsApi } from '@/services/api';
import type { Approval } from '@/types';

function EscalationBadge({ level }: { level: string }) {
  const color = level === 'critical' ? '#EF4444' : level === 'high' ? '#F59E0B' : '#6366F1';
  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{level.toUpperCase()}</Text>
    </View>
  );
}

function FraudBar({ score }: { score: number }) {
  const color = score > 0.6 ? '#EF4444' : score > 0.3 ? '#F59E0B' : '#10B981';
  return (
    <View style={styles.fraudBarContainer}>
      <View style={styles.fraudBarBg}>
        <View style={[styles.fraudBarFill, { width: `${score * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.fraudScore, { color }]}>{Math.round(score * 100)}%</Text>
    </View>
  );
}

function ApprovalDetailModal({
  approval,
  visible,
  onClose,
  onApprove,
  onReject,
}: {
  approval: Approval;
  visible: boolean;
  onClose: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Approval Request</Text>
          <Pressable onPress={onClose}>
            <MaterialCommunityIcons name="close" size={24} color="#64748B" />
          </Pressable>
        </View>

        <FlatList
          data={[approval]}
          keyExtractor={() => 'detail'}
          renderItem={() => (
            <View style={styles.modalContent}>
              <Text style={styles.employeeName}>{approval.employee_name}</Text>
              <Text style={styles.employeeEmail}>{approval.employee_email}</Text>

              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="clock-outline" size={16} color="#64748B" />
                <Text style={styles.detailText}>
                  {format(parseISO(approval.submitted_at), 'dd MMM yyyy HH:mm')}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="text-box-outline" size={16} color="#64748B" />
                <Text style={styles.detailText}>{approval.reason}</Text>
              </View>

              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="map-marker-outline" size={16} color="#64748B" />
                <Text style={styles.detailText}>
                  {approval.latitude?.toFixed(5) ?? '—'}, {approval.longitude?.toFixed(5) ?? '—'} (±{approval.accuracy ?? 0}m)
                </Text>
              </View>

              <Text style={styles.sectionLabel}>Fraud Score</Text>
              <FraudBar score={approval.fraud_score} />

              {approval.fraud_flags.length > 0 && (
                <View style={styles.flagsRow}>
                  {approval.fraud_flags.map(flag => (
                    <Chip key={flag} compact style={styles.flagChip} textStyle={styles.flagChipText}>
                      {flag.replace(/_/g, ' ')}
                    </Chip>
                  ))}
                </View>
              )}

              {approval.photo_url && (
                <Image source={{ uri: approval.photo_url }} style={styles.photo} resizeMode="cover" />
              )}

              <TextInput
                label="Review note (optional)"
                value={note}
                onChangeText={setNote}
                mode="outlined"
                style={styles.noteInput}
                multiline
                numberOfLines={3}
              />

              <View style={styles.actionBtns}>
                <Button
                  mode="contained"
                  buttonColor="#10B981"
                  style={styles.approveBtn}
                  onPress={() => onApprove(note)}
                  icon="check"
                >
                  Approve
                </Button>
                <Button
                  mode="contained"
                  buttonColor="#EF4444"
                  style={styles.rejectBtn}
                  onPress={() => onReject(note)}
                  icon="close"
                >
                  Reject
                </Button>
              </View>
            </View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

export default function ApprovalsScreen() {
  const queryClient = useQueryClient();
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(approvals.map(a => a.id)));
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {isSelecting ? (
          <>
            <Pressable onPress={clearSelection} style={styles.cancelSelect}>
              <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              <Text style={styles.cancelSelectText}>{selectedIds.size} selected</Text>
            </Pressable>
            <Pressable onPress={selectAll}>
              <Text style={styles.selectAllText}>Select All</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Approval Queue</Text>
            <View style={[styles.badge, { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' }]}>
              <Text style={[styles.badgeText, { color: '#4F46E5' }]}>{approvals.length} PENDING</Text>
            </View>
          </>
        )}
      </View>

      <FlatList
        data={approvals}
        keyExtractor={a => a.id}
        contentContainerStyle={[styles.list, isSelecting && { paddingBottom: 96 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} />}
        renderItem={({ item }) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <Pressable
              onPress={() => isSelecting ? toggleSelect(item.id) : setSelected(item)}
              onLongPress={() => toggleSelect(item.id)}
            >
              <Surface style={[styles.card, isSelected && styles.cardSelected]} elevation={1}>
                {isSelected && (
                  <View style={styles.checkOverlay}>
                    <MaterialCommunityIcons name="check-circle" size={22} color="#4F46E5" />
                  </View>
                )}
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.name}>{item.employee_name}</Text>
                    <Text style={styles.time}>{format(parseISO(item.submitted_at), 'dd MMM, HH:mm')}</Text>
                  </View>
                  <EscalationBadge level={item.escalation_level} />
                </View>
                <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>
                <FraudBar score={item.fraud_score} />
                {item.fraud_flags.length > 0 && (
                  <View style={styles.flagsRow}>
                    {item.fraud_flags.slice(0, 2).map(f => (
                      <Chip key={f} compact style={styles.flagChip} textStyle={styles.flagChipText}>
                        {f.replace(/_/g, ' ')}
                      </Chip>
                    ))}
                  </View>
                )}
              </Surface>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color="#4F46E5" style={{ marginTop: 48 }} />
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-all" size={56} color="#10B981" />
              <Text style={styles.emptyText}>All caught up! No pending approvals.</Text>
            </View>
          )
        }
      />

      {/* Bulk approve floating bar */}
      {isSelecting && (
        <View style={styles.bulkBar}>
          <Button
            mode="contained"
            buttonColor="#4F46E5"
            style={styles.bulkBtn}
            icon="check-all"
            loading={bulkApproveMutation.isPending}
            disabled={bulkApproveMutation.isPending}
            onPress={handleBulkApprove}
            labelStyle={{ fontSize: 15, fontWeight: '700' }}
          >
            Approve Selected ({selectedIds.size})
          </Button>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  cancelSelect: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelSelectText: { fontSize: 16, fontWeight: '600', color: '#1E293B' },
  selectAllText: { fontSize: 14, fontWeight: '700', color: '#4F46E5' },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 24 },
  card: { borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF', gap: 8 },
  cardSelected: { borderWidth: 2, borderColor: '#4F46E5' },
  checkOverlay: { position: 'absolute', top: 10, right: 10, zIndex: 1 },
  bulkBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  bulkBtn: { borderRadius: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft: { gap: 2 },
  name: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  time: { fontSize: 12, color: '#94A3B8' },
  reason: { fontSize: 13, color: '#64748B' },
  fraudBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fraudBarBg: { flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  fraudBarFill: { height: 6, borderRadius: 3 },
  fraudScore: { fontSize: 12, fontWeight: '700', width: 32, textAlign: 'right' },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  flagChip: { backgroundColor: '#FEF3C7' },
  flagChipText: { fontSize: 9, color: '#92400E' },
  empty: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyText: { color: '#64748B', fontSize: 14, textAlign: 'center' },
  modalContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  modalContent: { padding: 16, gap: 12 },
  employeeName: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  employeeEmail: { fontSize: 14, color: '#64748B' },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailText: { fontSize: 14, color: '#475569', flex: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  photo: { width: '100%', height: 200, borderRadius: 12 },
  noteInput: { backgroundColor: '#FFFFFF' },
  actionBtns: { flexDirection: 'row', gap: 12 },
  approveBtn: { flex: 1, borderRadius: 10 },
  rejectBtn: { flex: 1, borderRadius: 10 },
});
