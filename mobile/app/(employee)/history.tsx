import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, getMonth, getYear } from 'date-fns';
import { attendanceApi } from '@/services/api';
import type { AttendanceRecord, AttendanceStatus } from '@/types';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: AttendanceStatus): string {
  if (s === 'present' || s === 'approved') return C.success;
  if (s === 'late') return C.warning;
  if (s === 'absent') return C.danger;
  if (s === 'pending') return C.primary;
  return C.textSecondary;
}

function statusBgColor(s: AttendanceStatus): string {
  if (s === 'present' || s === 'approved') return 'rgba(16,185,129,0.15)';
  if (s === 'late') return 'rgba(245,158,11,0.15)';
  if (s === 'absent') return 'rgba(239,68,68,0.15)';
  if (s === 'pending') return 'rgba(99,102,241,0.15)';
  return 'rgba(148,163,184,0.12)';
}

function statusLabel(s: AttendanceStatus): string {
  if (s === 'present') return 'Present';
  if (s === 'approved') return 'Present';
  if (s === 'late') return 'Late';
  if (s === 'absent') return 'Absent';
  if (s === 'pending') return 'Leave';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmt(iso: string | null, f = 'HH:mm'): string {
  if (!iso) return '—';
  try { return format(parseISO(iso), f); } catch { return '—'; }
}

function duration(mins: number | null): string {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function totalHours(records: AttendanceRecord[]): string {
  const total = records.reduce((acc, r) => acc + (r.duration_minutes ?? 0), 0);
  if (!total) return '0h';
  const h = Math.floor(total / 60), m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Month selector data ──────────────────────────────────────────────────────

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Record card ──────────────────────────────────────────────────────────────

function RecordItem({ record }: { record: AttendanceRecord }) {
  const date = record.created_at ? parseISO(record.created_at) : null;
  const dayNum = date ? format(date, 'd') : '—';
  const dayName = date ? format(date, 'EEE') : '—';
  const monthAbbr = date ? format(date, 'MMM').toUpperCase() : '—';

  return (
    <View style={styles.card}>
      {/* Left: date column */}
      <View style={styles.dateCol}>
        <Text style={styles.dayNum}>{dayNum}</Text>
        <Text style={styles.dayName}>{dayName}</Text>
        <Text style={styles.monthLabel}>{monthAbbr}</Text>
      </View>

      {/* Divider */}
      <View style={styles.cardDivider} />

      {/* Center: times */}
      <View style={styles.timesCol}>
        <View style={styles.timesRow}>
          <Text style={styles.timeValue}>{fmt(record.check_in_time)}</Text>
          <Text style={styles.timeArrow}>→</Text>
          <Text style={styles.timeValue}>{fmt(record.check_out_time)}</Text>
        </View>
        <View style={styles.siteRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={12} color={C.textMuted} />
          <Text style={styles.siteText} numberOfLines={1}>{record.site_name || 'Unknown site'}</Text>
        </View>
      </View>

      {/* Right: status + hours */}
      <View style={styles.rightCol}>
        <View style={[styles.statusBadge, { backgroundColor: statusBgColor(record.status) }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor(record.status) }]}>
            {statusLabel(record.status)}
          </Text>
        </View>
        <Text style={styles.hoursText}>{duration(record.duration_minutes)}</Text>
        {record.fraud_score > 0.3 && (
          <MaterialCommunityIcons
            name="alert-circle"
            size={15}
            color={C.danger}
            style={{ marginTop: 2 }}
          />
        )}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(getMonth(now)); // 0-indexed
  const [selectedYear, setSelectedYear] = useState(getYear(now));
  const [page, setPage] = useState(1);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { isLoading, refetch } = useQuery({
    queryKey: ['attendance', 'history', 'full', page],
    queryFn: async () => {
      const res = await attendanceApi.history(page, 100);
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

  // Filter records to the selected month and year
  const filteredRecords = useMemo(() => {
    return allRecords.filter(r => {
      const d = r.date || r.created_at;
      if (!d) return false;
      try {
        const parsed = parseISO(d);
        return getMonth(parsed) === selectedMonth && getYear(parsed) === selectedYear;
      } catch { return false; }
    });
  }, [allRecords, selectedMonth, selectedYear]);

  // Summary counts
  const presentCount = filteredRecords.filter(r => r.status === 'present' || r.status === 'approved').length;
  const lateCount = filteredRecords.filter(r => r.status === 'late').length;
  const absentCount = filteredRecords.filter(r => r.status === 'absent').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <LinearGradient colors={['#1E293B', '#0F172A']} style={styles.header}>
        <View>
          <Text style={styles.title}>Attendance History</Text>
          {filteredRecords.length > 0 && (
            <View style={styles.headerBadgeRow}>
              <View style={styles.totalHoursBadge}>
                <MaterialCommunityIcons name="clock-outline" size={12} color={C.teal} />
                <Text style={styles.totalHoursText}>{totalHours(filteredRecords)}</Text>
              </View>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Year navigator */}
      <View style={styles.yearRow}>
        <Pressable onPress={() => setSelectedYear(y => y - 1)} style={styles.yearArrow}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={styles.yearLabel}>{selectedYear}</Text>
        <Pressable
          onPress={() => setSelectedYear(y => y + 1)}
          style={[styles.yearArrow, selectedYear >= getYear(now) && { opacity: 0.3 }]}
          disabled={selectedYear >= getYear(now)}
        >
          <MaterialCommunityIcons name="chevron-right" size={20} color={C.textSecondary} />
        </Pressable>
      </View>

      {/* Month selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.monthSelector}
      >
        {MONTHS.map((m, idx) => {
          const isSelected = idx === selectedMonth;
          return (
            <Pressable
              key={m}
              onPress={() => setSelectedMonth(idx)}
              style={[styles.monthPill, !isSelected && { backgroundColor: C.surface2 }]}
            >
              {isSelected ? (
                <LinearGradient
                  colors={['#6366F1', '#8B5CF6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.monthPillGradient}
                >
                  <Text style={styles.monthPillTextActive}>{m}</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.monthPillText}>{m}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Summary stats row */}
      {filteredRecords.length > 0 && (
        <View style={styles.statsRow}>
          <View style={[styles.statPill, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
            <View style={[styles.statDot, { backgroundColor: C.success }]} />
            <Text style={[styles.statText, { color: C.success }]}>{presentCount} Present</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
            <View style={[styles.statDot, { backgroundColor: C.warning }]} />
            <Text style={[styles.statText, { color: C.warning }]}>{lateCount} Late</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
            <View style={[styles.statDot, { backgroundColor: C.danger }]} />
            <Text style={[styles.statText, { color: C.danger }]}>{absentCount} Absent</Text>
          </View>
        </View>
      )}

      {/* Records list */}
      <FlatList
        data={filteredRecords}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecordItem record={item} />}
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
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={C.primary} size="large" />
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIconBox}>
                <MaterialCommunityIcons name="calendar-blank" size={40} color={C.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No records for this period</Text>
              <Text style={styles.emptySubtitle}>
                No attendance records found for {MONTHS[selectedMonth]}.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          hasMore && !isLoading
            ? <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
            : null
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 24, fontWeight: '800', color: C.textPrimary },
  headerBadgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  totalHoursBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(20,184,166,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  totalHoursText: { fontSize: 12, fontWeight: '700', color: C.teal },

  // Year navigator
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    gap: 12,
  },
  yearArrow: { padding: 4 },
  yearLabel: { fontSize: 15, fontWeight: '700', color: C.textPrimary, minWidth: 48, textAlign: 'center' },

  // Month selector
  monthSelector: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthPill: {
    borderRadius: 20,
    overflow: 'hidden',
    minWidth: 44,
  },
  monthPillGradient: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    alignItems: 'center',
  },
  monthPillTextActive: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  monthPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statText: { fontSize: 11, fontWeight: '700' },

  // List
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 8 },

  // Record card
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
    marginBottom: 0,
  },
  dateCol: {
    alignItems: 'center',
    width: 36,
    flexShrink: 0,
  },
  dayNum: { fontSize: 20, fontWeight: '800', color: C.textPrimary, lineHeight: 24 },
  dayName: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  monthLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.teal,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: C.border,
    marginHorizontal: 2,
  },
  timesCol: { flex: 1, gap: 4 },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeValue: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  timeArrow: { fontSize: 13, fontWeight: '700', color: C.teal },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  siteText: { fontSize: 11, color: C.textMuted, flex: 1 },
  rightCol: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  hoursText: { fontSize: 11, fontWeight: '600', color: C.textSecondary },

  // Loading
  loadingBox: { paddingTop: 64, alignItems: 'center' },

  // Empty
  empty: { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 32 },
  emptyIconBox: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  emptySubtitle: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
});
