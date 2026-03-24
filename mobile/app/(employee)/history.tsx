import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text, Chip, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { attendanceApi } from '@/services/api';
import type { AttendanceRecord, AttendanceStatus } from '@/types';

function statusColor(s: AttendanceStatus) {
  if (s === 'present' || s === 'approved') return '#10B981';
  if (s === 'late') return '#F59E0B';
  if (s === 'absent') return '#EF4444';
  if (s === 'pending') return '#6366F1';
  return '#94A3B8';
}

function statusBg(s: AttendanceStatus) {
  if (s === 'present' || s === 'approved') return '#D1FAE5';
  if (s === 'late') return '#FEF3C7';
  if (s === 'absent') return '#FEE2E2';
  if (s === 'pending') return '#EEF2FF';
  return '#F1F5F9';
}

function fmt(iso: string | null, f = 'HH:mm') {
  if (!iso) return '—';
  try { return format(parseISO(iso), f); } catch { return '—'; }
}

function duration(mins: number | null) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RecordItem({ record }: { record: AttendanceRecord }) {
  return (
    <Surface style={styles.card} elevation={1}>
      <View style={[styles.colorBar, { backgroundColor: statusColor(record.status) }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.dateText}>{fmt(record.created_at, 'EEE, dd MMM yyyy')}</Text>
          <Chip
            compact
            style={[styles.chip, { backgroundColor: statusBg(record.status) }]}
            textStyle={[styles.chipText, { color: statusColor(record.status) }]}
          >
            {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
          </Chip>
        </View>
        <View style={styles.row}>
          <MaterialCommunityIcons name="clock-in" size={14} color="#64748B" />
          <Text style={styles.metaText}>In: {fmt(record.check_in_time)}</Text>
          <MaterialCommunityIcons name="clock-out" size={14} color="#64748B" style={styles.ml8} />
          <Text style={styles.metaText}>Out: {fmt(record.check_out_time)}</Text>
          <MaterialCommunityIcons name="timer-outline" size={14} color="#64748B" style={styles.ml8} />
          <Text style={styles.metaText}>{duration(record.duration_minutes)}</Text>
        </View>
        <View style={styles.row}>
          <MaterialCommunityIcons name="map-marker-outline" size={13} color="#94A3B8" />
          <Text style={styles.locationText} numberOfLines={1}>{record.site_name || 'Unknown site'}</Text>
          {record.fraud_score > 0.3 && (
            <View style={styles.fraudDot}>
              <Text style={styles.fraudText}>⚠ {Math.round(record.fraud_score * 100)}%</Text>
            </View>
          )}
        </View>
      </View>
    </Surface>
  );
}

export default function HistoryScreen() {
  const [page, setPage] = useState(1);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { isLoading, refetch } = useQuery({
    queryKey: ['attendance', 'history', page],
    queryFn: async () => {
      const res = await attendanceApi.history(page, 20);
      const data = res.data;
      const items = data?.items ?? (Array.isArray(data) ? data : []);
      if (page === 1) {
        setAllRecords(items);
      } else {
        setAllRecords(prev => [...prev, ...items]);
      }
      setHasMore(page < (data?.pages ?? 1));
      return data;
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const loadMore = () => {
    if (hasMore && !isLoading) setPage(p => p + 1);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Attendance History</Text>
      </View>
      <FlatList
        data={allRecords}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecordItem record={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color="#4F46E5" style={{ marginTop: 48 }} />
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={56} color="#CBD5E1" />
              <Text style={styles.emptyText}>No attendance records yet</Text>
            </View>
          )
        }
        ListFooterComponent={hasMore && !isLoading ? <ActivityIndicator color="#4F46E5" style={{ marginVertical: 16 }} /> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', overflow: 'hidden' },
  colorBar: { width: 4 },
  cardBody: { flex: 1, padding: 12, gap: 5 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  chip: { height: 22 },
  chipText: { fontSize: 10, fontWeight: '700', lineHeight: 14, marginVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#64748B' },
  ml8: { marginLeft: 8 },
  locationText: { fontSize: 11, color: '#94A3B8', flex: 1 },
  fraudDot: { backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  fraudText: { fontSize: 10, color: '#92400E', fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyText: { color: '#94A3B8', fontSize: 14 },
});
