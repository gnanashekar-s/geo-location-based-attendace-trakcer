import React, { useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, RefreshControl,
  Pressable, ActivityIndicator, Platform, StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { attendanceApi } from '@/services/api';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import type { AttendanceRecord, AttendanceStatus, AttendanceStats, AttendanceToday, UpcomingShift } from '@/types';

const C = Colors;

// ── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(name?: string | null) {
  if (!name) return 'U';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function fmtDuration(min: number | null) {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusColor(s: AttendanceStatus) {
  return s === 'present' ? C.success : s === 'late' ? C.warning : s === 'absent' ? C.danger : C.primary;
}
function statusBg(s: AttendanceStatus) {
  return s === 'present' ? C.successBg : s === 'late' ? C.warningBg : s === 'absent' ? C.dangerBg : C.primaryBg;
}

// ── Record Row ────────────────────────────────────────────────────────────────

function RecordRow({ record }: { record: AttendanceRecord }) {
  const cin = record.check_in_time ? format(new Date(record.check_in_time), 'h:mm a') : '—';
  const cout = record.check_out_time ? format(new Date(record.check_out_time), 'h:mm a') : '—';
  const dateLabel = record.date ? format(new Date(record.date), 'EEE, d MMM') : '—';
  const sc = statusColor(record.status);
  const sb = statusBg(record.status);

  return (
    <View style={styles.recordRow}>
      <View style={[styles.recordAccent, { backgroundColor: sc }]} />
      <View style={styles.recordBody}>
        <View style={styles.recordHeaderRow}>
          <Text style={styles.recordDate}>{dateLabel}</Text>
          <View style={[styles.statusPill, { backgroundColor: sb }]}>
            <View style={[styles.statusDot, { backgroundColor: sc }]} />
            <Text style={[styles.statusPillText, { color: sc }]}>
              {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
            </Text>
          </View>
        </View>
        <View style={styles.recordMeta}>
          <MaterialCommunityIcons name="clock-in" size={12} color={C.textMuted} />
          <Text style={styles.metaText}>{cin}</Text>
          <Text style={styles.metaDivider}>·</Text>
          <MaterialCommunityIcons name="clock-out" size={12} color={C.textMuted} />
          <Text style={styles.metaText}>{cout}</Text>
          {record.duration_minutes ? (
            <>
              <Text style={styles.metaDivider}>·</Text>
              <MaterialCommunityIcons name="timer-outline" size={12} color={C.textMuted} />
              <Text style={styles.metaText}>{fmtDuration(record.duration_minutes)}</Text>
            </>
          ) : null}
        </View>
        {record.site_name ? (
          <View style={styles.recordLoc}>
            <MaterialCommunityIcons name="map-marker-outline" size={11} color={C.textMuted} />
            <Text style={styles.locText} numberOfLines={1}>{record.site_name}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ── Stat Chip ─────────────────────────────────────────────────────────────────

function StatChip({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  return (
    <View style={styles.statChip}>
      <MaterialCommunityIcons name={icon as any} size={16} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EmployeeHomeScreen() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);

  const { data: todayData, isLoading: todayLoading, refetch: refetchToday } =
    useQuery<AttendanceToday>({
      queryKey: ['attendance', 'today'],
      queryFn: () => attendanceApi.today().then(r => r.data),
      refetchInterval: 60_000,
    });

  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } =
    useQuery({
      queryKey: ['attendance', 'history', 1],
      queryFn: () => attendanceApi.history(1, 5).then(r => r.data),
    });

  const { data: statsData, refetch: refetchStats } =
    useQuery<AttendanceStats>({
      queryKey: ['attendance', 'stats'],
      queryFn: () => attendanceApi.stats().then(r => r.data),
      staleTime: 5 * 60_000,
    });

  const { data: upcomingShift } = useQuery<UpcomingShift | null>({
    queryKey: ['upcoming-shift'],
    queryFn: () => attendanceApi.upcomingShift().then(r => r.status === 204 ? null : r.data),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchToday(), refetchHistory(), refetchStats()]);
    setRefreshing(false);
  }, [refetchToday, refetchHistory, refetchStats]);

  const isCheckedIn  = !!(todayData?.check_in_time && !todayData?.check_out_time);
  const isCheckedOut = !!(todayData?.check_in_time && todayData?.check_out_time);
  const status: AttendanceStatus = todayData?.status ?? 'absent';
  const streak = todayData?.streak_count ?? 0;
  const recent = historyData?.items?.slice(0, 3) ?? [];
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';
  const avatarInit = initials(user?.full_name);
  const attendancePct = statsData ? `${Math.round(statsData.attendance_rate ?? statsData.punctuality_percentage ?? 0)}%` : '—';
  const hoursToday = fmtDuration(todayData?.record?.duration_minutes ?? null);
  const onTimePct = statsData ? `${Math.round(statsData.punctuality_percentage ?? 0)}%` : '—';

  const onCheckIn = async () => {
    if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(employee)/checkin');
  };

  // Status card derived values
  const scColor = isCheckedIn ? C.success : isCheckedOut ? C.info : C.textMuted;
  const scBg = isCheckedIn ? C.successBg : isCheckedOut ? C.infoBg : C.card2;
  const scIcon = isCheckedIn ? 'map-marker-check' : isCheckedOut ? 'check-circle-outline' : 'clock-outline';
  const scTitle = isCheckedIn ? 'Checked In' : isCheckedOut ? 'Checked Out' : 'Not Checked In';
  const scSub = isCheckedIn && todayData?.check_in_time
    ? `Since ${format(new Date(todayData.check_in_time), 'h:mm a')}`
    : isCheckedOut && todayData?.check_in_time
    ? `${format(new Date(todayData.check_in_time), 'h:mm a')} – ${todayData.check_out_time ? format(new Date(todayData.check_out_time), 'h:mm a') : '—'}`
    : 'Tap below to check in';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greetText}>{greeting()},</Text>
            <Text style={styles.nameText}>{firstName}</Text>
            <Text style={styles.dateText}>{format(new Date(), 'EEEE, MMMM d')}</Text>
          </View>
          <Pressable onPress={() => router.push('/(employee)/profile')} style={styles.avatar}>
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={styles.avatarGrad}>
              <Text style={styles.avatarText}>{avatarInit}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── Status Card ── */}
        <View style={[styles.statusCard, { borderColor: isCheckedIn ? 'rgba(34,197,94,0.2)' : isCheckedOut ? 'rgba(59,130,246,0.2)' : C.border }]}>
          {todayLoading ? (
            <ActivityIndicator color={C.primary} size="small" />
          ) : (
            <View style={styles.statusCardInner}>
              <View style={[styles.statusIconBg, { backgroundColor: scBg }]}>
                <MaterialCommunityIcons name={scIcon as any} size={22} color={scColor} />
              </View>
              <View style={styles.statusCardInfo}>
                <Text style={styles.statusTitle}>{scTitle}</Text>
                <Text style={styles.statusSub}>{scSub}</Text>
              </View>
              <View>
                <View style={[styles.statusBadge, { backgroundColor: statusBg(status) }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(status) }]} />
                  <Text style={[styles.statusBadgeText, { color: statusColor(status) }]}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Text>
                </View>
                {streak > 0 && (
                  <View style={styles.streakRow}>
                    <Text style={styles.streakFire}>🔥</Text>
                    <Text style={styles.streakText}>{streak}d streak</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* ── Stats Row ── */}
        <View style={styles.statsRow}>
          <StatChip icon="calendar-check" value={attendancePct} label="Attendance" color={C.success} />
          <View style={styles.statDivider} />
          <StatChip icon="clock-outline" value={hoursToday} label="Today" color={C.primary} />
          <View style={styles.statDivider} />
          <StatChip icon="trophy-outline" value={onTimePct} label="On Time" color={C.warning} />
        </View>

        {/* ── Upcoming Shift ── */}
        {upcomingShift && (
          <View style={styles.shiftCard}>
            <View style={styles.shiftHeader}>
              <MaterialCommunityIcons name="calendar-clock" size={14} color={C.primary} />
              <Text style={styles.shiftLabel}>Next Shift</Text>
            </View>
            <Text style={styles.shiftTime}>{upcomingShift.start_time} – {upcomingShift.end_time}</Text>
            <View style={styles.shiftLocRow}>
              <MaterialCommunityIcons name="map-marker" size={12} color={C.textMuted} />
              <Text style={styles.shiftLoc}>{upcomingShift.site_name}</Text>
            </View>
          </View>
        )}

        {/* ── Check In / Out Button ── */}
        {!isCheckedOut && (
          <Pressable onPress={onCheckIn} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
            {isCheckedIn ? (
              <View style={styles.checkOutBtn}>
                <MaterialCommunityIcons name="fingerprint" size={20} color={C.success} />
                <Text style={[styles.checkBtnText, { color: C.success }]}>Check Out</Text>
              </View>
            ) : (
              <LinearGradient colors={['#6366F1', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.checkInBtn}>
                <MaterialCommunityIcons name="fingerprint" size={20} color="#fff" />
                <Text style={styles.checkInText}>Check In Now</Text>
              </LinearGradient>
            )}
          </Pressable>
        )}

        {/* ── Recent Activity ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <Pressable onPress={() => router.push('/(employee)/history' as any)}>
            <Text style={styles.viewAll}>View All</Text>
          </Pressable>
        </View>

        {historyLoading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : recent.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No attendance records yet</Text>
          </View>
        ) : (
          <View style={styles.recordsList}>
            {recent.map((rec, i) => (
              <React.Fragment key={rec.id}>
                <RecordRow record={rec} />
                {i < recent.length - 1 && <View style={styles.recordDivider} />}
              </React.Fragment>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  scroll:  { flex: 1 },
  content: { paddingBottom: 100 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.lg,
  },
  headerLeft: { flex: 1, gap: 2 },
  greetText: { fontSize: 13, color: C.textMuted, fontWeight: '500' },
  nameText:  { fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: -0.4, lineHeight: 28 },
  dateText:  { fontSize: 12, color: C.textMuted, marginTop: 2 },
  avatar:    { marginLeft: Spacing.sm },
  avatarGrad: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Status Card
  statusCard: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: C.card, borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  statusCardInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIconBg: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusCardInfo: { flex: 1, gap: 2 },
  statusTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  statusSub:   { fontSize: 12, color: C.textMuted, fontWeight: '400' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
  },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  streakFire: { fontSize: 12 },
  streakText: { fontSize: 11, color: C.textMuted, fontWeight: '500' },

  // Stats
  statsRow: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: C.card, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 8,
  },
  statChip: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 10, color: C.textMuted, fontWeight: '500' },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },

  // Shift
  shiftCard: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: C.card, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.border, padding: Spacing.md, gap: 4,
  },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  shiftLabel:  { fontSize: 11, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  shiftTime:   { fontSize: 18, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  shiftLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shiftLoc:    { fontSize: 12, color: C.textMuted },

  // Buttons
  checkInBtn: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.lg,
    height: 52, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...Shadow.glow('#6366F1'),
  },
  checkInText:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  checkOutBtn: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.lg,
    height: 52, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.3)',
    backgroundColor: C.successBg,
  },
  checkBtnText: { fontSize: 15, fontWeight: '700' },

  // Section
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  viewAll:      { fontSize: 13, color: C.primary, fontWeight: '600' },

  // Loading / empty
  center:     { paddingVertical: 28, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyText:  { color: C.textMuted, fontSize: 13, fontWeight: '500' },

  // Records list
  recordsList: {
    marginHorizontal: Spacing.md, backgroundColor: C.card,
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  recordRow:     { flexDirection: 'row', paddingVertical: 14, paddingRight: Spacing.md },
  recordAccent:  { width: 3, borderRadius: 2, marginLeft: 14, marginRight: 12 },
  recordBody:    { flex: 1, gap: 4 },
  recordHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recordDate:    { fontSize: 13, fontWeight: '600', color: C.text },
  recordMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:      { fontSize: 12, color: C.textSub, fontWeight: '500' },
  metaDivider:   { fontSize: 12, color: C.textMuted, marginHorizontal: 2 },
  recordLoc:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locText:       { fontSize: 11, color: C.textMuted, flex: 1 },
  recordDivider: { height: 1, backgroundColor: C.border, marginLeft: 29 },
});
