import React, { useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text, Chip, Surface, FAB } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { attendanceApi } from '@/services/api';
import type { AttendanceRecord, AttendanceStatus, AttendanceStats, AttendanceToday, UpcomingShift } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getStatusColor(status: AttendanceStatus): string {
  switch (status) {
    case 'present':   return '#10B981';
    case 'late':      return '#F59E0B';
    case 'absent':    return '#EF4444';
    case 'pending':   return '#6366F1';
    case 'approved':  return '#10B981';
    case 'rejected':  return '#EF4444';
    default:          return '#94A3B8';
  }
}

function getStatusBg(status: AttendanceStatus): string {
  switch (status) {
    case 'present':   return '#D1FAE5';
    case 'late':      return '#FEF3C7';
    case 'absent':    return '#FEE2E2';
    case 'pending':   return '#EEF2FF';
    case 'approved':  return '#D1FAE5';
    case 'rejected':  return '#FEE2E2';
    default:          return '#F1F5F9';
  }
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StreakBadge({ count }: { count: number }) {
  return (
    <View style={styles.streakBadge}>
      <Text style={styles.streakEmoji}>🔥</Text>
      <View>
        <Text style={styles.streakCount}>{count}</Text>
        <Text style={styles.streakLabel}>day streak</Text>
      </View>
    </View>
  );
}

function AttendanceStatusPill({ status }: { status: AttendanceStatus }) {
  const color = getStatusColor(status);
  const bg = getStatusBg(status);
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusPillText, { color }]}>{label}</Text>
    </View>
  );
}

function RecordRow({ record }: { record: AttendanceRecord }) {
  const checkIn = record.check_in_time
    ? format(new Date(record.check_in_time), 'HH:mm')
    : '—';
  const checkOut = record.check_out_time
    ? format(new Date(record.check_out_time), 'HH:mm')
    : '—';
  const dateLabel = record.date
    ? format(new Date(record.date), 'EEE, dd MMM')
    : '—';

  return (
    <View style={styles.recordRow}>
      <View style={[styles.recordColorBar, { backgroundColor: getStatusColor(record.status) }]} />
      <View style={styles.recordContent}>
        <View style={styles.recordHeader}>
          <Text style={styles.recordDate}>{dateLabel}</Text>
          <Chip
            compact
            style={[styles.recordChip, { backgroundColor: getStatusBg(record.status) }]}
            textStyle={[styles.recordChipText, { color: getStatusColor(record.status) }]}
          >
            {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
          </Chip>
        </View>
        <View style={styles.recordMeta}>
          <MaterialCommunityIcons name="clock-in" size={13} color="#94A3B8" />
          <Text style={styles.recordMetaText}>{checkIn}</Text>
          <MaterialCommunityIcons name="clock-out" size={13} color="#94A3B8" style={{ marginLeft: 8 }} />
          <Text style={styles.recordMetaText}>{checkOut}</Text>
          <MaterialCommunityIcons name="timer-outline" size={13} color="#94A3B8" style={{ marginLeft: 8 }} />
          <Text style={styles.recordMetaText}>{formatDuration(record.duration_minutes)}</Text>
        </View>
        <Text style={styles.recordLocation} numberOfLines={1}>
          <MaterialCommunityIcons name="map-marker-outline" size={12} color="#94A3B8" />
          {'  '}{record.site_name}
        </Text>
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EmployeeHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const {
    data: todayData,
    isLoading: todayLoading,
    refetch: refetchToday,
  } = useQuery<AttendanceToday>({
    queryKey: ['attendance', 'today'],
    queryFn: () => attendanceApi.today().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const {
    data: historyData,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['attendance', 'history', 1],
    queryFn: () => attendanceApi.history(1, 5).then((r) => r.data),
  });

  const { data: statsData, refetch: refetchStats } = useQuery<AttendanceStats>({
    queryKey: ['attendance', 'stats'],
    queryFn: () => attendanceApi.stats().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: upcomingShift } = useQuery<UpcomingShift | null>({
    queryKey: ['upcoming-shift'],
    queryFn: () =>
      attendanceApi.upcomingShift().then((r) => (r.status === 204 ? null : r.data)),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchToday(), refetchHistory(), refetchStats()]);
    setRefreshing(false);
  }, [refetchToday, refetchHistory, refetchStats]);

  const status: AttendanceStatus = todayData?.status ?? 'absent';
  const streakCount = todayData?.streak_count ?? 0;
  const recentRecords = historyData?.items?.slice(0, 5) ?? [];
  const isLoading = todayLoading || historyLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#4F46E5']}
            tintColor="#4F46E5"
          />
        }
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName}>
              {user?.full_name?.split(' ')[0] ?? 'there'} 👋
            </Text>
          </View>
          <Pressable
            style={styles.avatarCircle}
            onPress={() => router.push('/(employee)/profile')}
          >
            <Text style={styles.avatarInitials}>
              {(user?.full_name ?? 'U')
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </Text>
          </Pressable>
        </View>

        {/* ── Today's Status Card ── */}
        <Surface style={styles.statusCard} elevation={2}>
          <View style={styles.statusCardRow}>
            <View>
              <Text style={styles.statusCardLabel}>Today's Status</Text>
              <Text style={styles.statusCardDate}>
                {format(new Date(), 'EEEE, MMMM d')}
              </Text>
            </View>
            {todayLoading ? (
              <ActivityIndicator color="#4F46E5" />
            ) : (
              <AttendanceStatusPill status={status} />
            )}
          </View>

          {todayData?.check_in_time && (
            <View style={styles.statusCardTimes}>
              <View style={styles.timeItem}>
                <MaterialCommunityIcons name="clock-in" size={16} color="#4F46E5" />
                <Text style={styles.timeLabel}>Check-in</Text>
                <Text style={styles.timeValue}>
                  {format(new Date(todayData.check_in_time), 'HH:mm')}
                </Text>
              </View>
              {todayData.check_out_time && (
                <View style={styles.timeItem}>
                  <MaterialCommunityIcons name="clock-out" size={16} color="#7C3AED" />
                  <Text style={styles.timeLabel}>Check-out</Text>
                  <Text style={styles.timeValue}>
                    {format(new Date(todayData.check_out_time), 'HH:mm')}
                  </Text>
                </View>
              )}
            </View>
          )}
        </Surface>

        {/* ── Streak Badge ── */}
        {streakCount > 0 && <StreakBadge count={streakCount} />}

        {/* ── Quick Stats ── */}
        {statsData && (
          <View style={styles.quickStats}>
            {[
              { label: 'Check-ins', value: statsData.total_check_ins, color: '#4F46E5', icon: 'calendar-check-outline' },
              { label: 'On-time', value: `${Math.round(statsData.punctuality_percentage)}%`, color: '#10B981', icon: 'clock-check-outline' },
              { label: 'Best Streak', value: statsData.longest_streak, color: '#EA580C', icon: 'fire' },
            ].map(item => (
              <View key={item.label} style={styles.quickStat}>
                <MaterialCommunityIcons name={item.icon as any} size={16} color={item.color} />
                <Text style={[styles.quickStatValue, { color: item.color }]}>{item.value}</Text>
                <Text style={styles.quickStatLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Next Shift Card — only shown when a shift is assigned ── */}
        {upcomingShift && (
          <Surface style={styles.shiftCard} elevation={1}>
            <View style={styles.shiftCardHeader}>
              <MaterialCommunityIcons name="calendar-clock" size={20} color="#4F46E5" />
              <Text style={styles.shiftCardTitle}>Next Shift</Text>
            </View>
            <Text style={styles.shiftCardTime}>
              {upcomingShift.start_time} – {upcomingShift.end_time}
            </Text>
            <Text style={styles.shiftCardLocation}>
              <MaterialCommunityIcons name="map-marker" size={13} color="#94A3B8" />
              {'  '}{upcomingShift.site_name}
            </Text>
          </Surface>
        )}

        {/* ── Recent Attendance ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Attendance</Text>
          <Pressable onPress={() => router.push('/(employee)/history')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {historyLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#4F46E5" />
          </View>
        ) : recentRecords.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="calendar-blank-outline"
              size={48}
              color="#CBD5E1"
            />
            <Text style={styles.emptyStateText}>No attendance records yet</Text>
          </View>
        ) : (
          <Surface style={styles.recordsList} elevation={1}>
            {recentRecords.map((record, index) => (
              <React.Fragment key={record.id}>
                <RecordRow record={record} />
                {index < recentRecords.length - 1 && (
                  <View style={styles.recordDivider} />
                )}
              </React.Fragment>
            ))}
          </Surface>
        )}

        {/* Bottom spacer for FAB */}
        <View style={{ height: 88 }} />
      </ScrollView>

      {/* ── Floating Action Button ── */}
      {Platform.OS === 'web' ? (
        <Pressable
          style={({ pressed }) => [styles.webFab, pressed && { opacity: 0.85 }]}
          onPress={() => router.push('/(employee)/checkin')}
        >
          <MaterialCommunityIcons name="map-marker-check" size={22} color="#FFFFFF" />
          <Text style={styles.webFabLabel}>
            {todayData?.check_in_time && !todayData?.check_out_time ? 'Check Out' : 'Check In'}
          </Text>
        </Pressable>
      ) : (
        <FAB
          icon="map-marker-check"
          label={todayData?.check_in_time && !todayData?.check_out_time ? 'Check Out' : 'Check In'}
          style={styles.fab}
          color="#FFFFFF"
          onPress={() => router.push('/(employee)/checkin')}
          customSize={56}
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 8,
  },
  greeting: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1E293B',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  statusCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  statusCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusCardLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statusCardDate: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusCardTimes: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 24,
  },
  timeItem: {
    alignItems: 'center',
    gap: 2,
  },
  timeLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  streakEmoji: {
    fontSize: 32,
  },
  streakCount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#EA580C',
  },
  streakLabel: {
    fontSize: 12,
    color: '#9A3412',
    fontWeight: '500',
  },
  quickStats: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  quickStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 2,
    borderRightWidth: 1,
    borderRightColor: '#F1F5F9',
  },
  quickStatValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  quickStatLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '500',
  },
  shiftCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  shiftCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  shiftCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shiftCardTime: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
  },
  shiftCardLocation: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  seeAll: {
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '600',
  },
  loadingContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyStateText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  recordsList: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  recordRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingRight: 16,
  },
  recordColorBar: {
    width: 4,
    borderRadius: 2,
    marginLeft: 12,
    marginRight: 12,
  },
  recordContent: {
    flex: 1,
    gap: 3,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  recordChip: {
    height: 22,
  },
  recordChipText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    marginVertical: 0,
  },
  recordMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordMetaText: {
    fontSize: 12,
    color: '#64748B',
  },
  recordLocation: {
    fontSize: 11,
    color: '#94A3B8',
  },
  recordDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 28,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: '#10B981',
    borderRadius: 28,
  },
  webFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    backgroundColor: '#10B981',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    cursor: 'pointer' as any,
  },
  webFabLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
