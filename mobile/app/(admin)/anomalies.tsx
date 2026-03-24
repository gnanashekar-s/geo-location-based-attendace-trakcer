import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text, Surface, Chip, Button, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { analyticsApi, attendanceApi, usersApi } from '@/services/api';
import type { AnomalyRecord } from '@/types';

type FlagFilter = 'all' | 'VPN_PROXY_DETECTED' | 'MOCK_GPS' | 'IMPOSSIBLE_TRAVEL' | 'NEW_DEVICE';

const FLAG_COLORS: Record<string, { bg: string; text: string }> = {
  VPN_PROXY_DETECTED: { bg: '#FEE2E2', text: '#991B1B' },
  MOCK_GPS: { bg: '#FEF3C7', text: '#92400E' },
  IMPOSSIBLE_TRAVEL: { bg: '#EDE9FE', text: '#5B21B6' },
  NEW_DEVICE: { bg: '#DBEAFE', text: '#1E40AF' },
  LOW_GPS_ACCURACY: { bg: '#F1F5F9', text: '#475569' },
};

function FraudBar({ score }: { score: number }) {
  const color = score > 0.6 ? '#EF4444' : score > 0.3 ? '#F59E0B' : '#10B981';
  return (
    <View style={styles.barRow}>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${Math.min(score * 100, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.barScore, { color }]}>{Math.round(score * 100)}%</Text>
    </View>
  );
}

function AnomalyCard({ item, onPress }: { item: AnomalyRecord; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Surface style={styles.card} elevation={1}>
        <View style={styles.cardTop}>
          <View>
            <Text style={styles.userName}>{item.user_name}</Text>
            <Text style={styles.time}>{format(parseISO(item.created_at), 'dd MMM yyyy HH:mm')}</Text>
          </View>
          <View style={[styles.scoreBadge, { backgroundColor: item.fraud_score > 0.6 ? '#FEE2E2' : '#FEF3C7' }]}>
            <Text style={[styles.scoreText, { color: item.fraud_score > 0.6 ? '#991B1B' : '#92400E' }]}>
              {Math.round(item.fraud_score * 100)}% risk
            </Text>
          </View>
        </View>
        <FraudBar score={item.fraud_score} />
        <View style={styles.flagsRow}>
          {item.fraud_flags.map(flag => {
            const colors = FLAG_COLORS[flag] ?? { bg: '#F1F5F9', text: '#475569' };
            return (
              <Chip key={flag} compact style={[styles.flagChip, { backgroundColor: colors.bg }]} textStyle={[styles.flagText, { color: colors.text }]}>
                {flag.replace(/_/g, ' ')}
              </Chip>
            );
          })}
        </View>
      </Surface>
    </Pressable>
  );
}

export default function AnomaliesScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FlagFilter>('all');
  const [selected, setSelected] = useState<AnomalyRecord | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery<AnomalyRecord[]>({
    queryKey: ['anomalies'],
    queryFn: () => analyticsApi.anomalies().then(r => r.data),
    refetchInterval: 60_000,
  });

  const markSafeMutation = useMutation({
    mutationFn: ({ id, n }: { id: string; n: string }) =>
      attendanceApi.markSafe(id, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      setSelected(null);
      setNote('');
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to mark safe.');
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (userId: string) =>
      usersApi.update(userId, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      setSelected(null);
      setNote('');
      Alert.alert('Done', 'User has been suspended.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to suspend user.');
    },
  });

  const handleMarkSafe = () => {
    if (!selected) return;
    markSafeMutation.mutate({ id: selected.attendance_id, n: note });
  };

  const handleSuspend = () => {
    if (!selected) return;
    Alert.alert(
      'Suspend User',
      `Are you sure you want to suspend ${selected.user_name}? They will not be able to log in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: () => suspendMutation.mutate(selected.user_id),
        },
      ]
    );
  };

  const items = (data ?? []).filter(a =>
    filter === 'all' ? true : a.fraud_flags.includes(filter)
  );

  const filters: { label: string; value: FlagFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'VPN', value: 'VPN_PROXY_DETECTED' },
    { label: 'Mock GPS', value: 'MOCK_GPS' },
    { label: 'Travel', value: 'IMPOSSIBLE_TRAVEL' },
    { label: 'New Device', value: 'NEW_DEVICE' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Anomaly Review</Text>
        <Text style={styles.subtitle}>{items.length} flagged events</Text>
      </View>

      {/* Filter chips */}
      <View style={styles.filtersRow}>
        {filters.map(f => (
          <Chip
            key={f.value}
            compact
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
            style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
            textStyle={filter === f.value ? styles.filterChipActiveText : undefined}
          >
            {f.label}
          </Chip>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#4F46E5" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={a => a.attendance_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AnomalyCard item={item} onPress={() => setSelected(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="shield-check-outline" size={56} color="#10B981" />
              <Text style={styles.emptyText}>No anomalies detected</Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      {selected && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Anomaly Detail</Text>
              <Pressable onPress={() => setSelected(null)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
              </Pressable>
            </View>
            <View style={styles.modalContent}>
              <Text style={styles.modalName}>{selected.user_name}</Text>
              <Text style={styles.modalTime}>{format(parseISO(selected.created_at), 'EEEE, dd MMM yyyy HH:mm')}</Text>

              <Text style={styles.sectionLabel}>Fraud Score</Text>
              <FraudBar score={selected.fraud_score} />

              <Text style={styles.sectionLabel}>Flags Detected</Text>
              <View style={styles.flagsRow}>
                {selected.fraud_flags.map(flag => {
                  const colors = FLAG_COLORS[flag] ?? { bg: '#F1F5F9', text: '#475569' };
                  return (
                    <Chip key={flag} compact style={[styles.flagChip, { backgroundColor: colors.bg }]} textStyle={[styles.flagText, { color: colors.text }]}>
                      {flag.replace(/_/g, ' ')}
                    </Chip>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>Investigator Notes</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                mode="outlined"
                placeholder="Add a note about this investigation..."
                multiline
                numberOfLines={3}
                style={styles.noteInput}
              />

              <View style={styles.actionBtns}>
                <Button
                  mode="outlined"
                  style={styles.actionBtn}
                  icon="shield-check"
                  loading={markSafeMutation.isPending}
                  disabled={markSafeMutation.isPending || suspendMutation.isPending}
                  onPress={handleMarkSafe}
                >
                  Mark Safe
                </Button>
                <Button
                  mode="contained"
                  buttonColor="#EF4444"
                  style={styles.actionBtn}
                  icon="account-cancel"
                  loading={suspendMutation.isPending}
                  disabled={markSafeMutation.isPending || suspendMutation.isPending}
                  onPress={handleSuspend}
                >
                  Suspend User
                </Button>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  subtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  filtersRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 8, flexWrap: 'wrap' },
  filterChip: { backgroundColor: '#F1F5F9' },
  filterChipActive: { backgroundColor: '#4F46E5' },
  filterChipActiveText: { color: '#FFFFFF' },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 24 },
  card: { borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF', gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  userName: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  time: { fontSize: 12, color: '#94A3B8' },
  scoreBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  scoreText: { fontSize: 11, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBg: { flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  barScore: { fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  flagChip: {},
  flagText: { fontSize: 10, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyText: { color: '#64748B', fontSize: 14 },
  modal: { flex: 1, backgroundColor: '#F8FAFC' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  modalContent: { padding: 16, gap: 12 },
  modalName: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  modalTime: { fontSize: 13, color: '#64748B' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  noteInput: { backgroundColor: '#FFFFFF' },
  actionBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionBtn: { flex: 1, borderRadius: 10 },
});
