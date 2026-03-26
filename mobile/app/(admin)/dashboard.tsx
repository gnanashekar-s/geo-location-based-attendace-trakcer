import React, { useCallback, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, Pressable, Animated, StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { analyticsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { LiveFeed } from '@/components/LiveFeed';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import type { AnalyticsSummary, TrendPoint } from '@/types';
import { useDeptLeaderboard, type DeptLeaderboardEntry } from '@/api/analytics';

const C = Colors;

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function initials(name: string) {
  return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
}

function avatarBg(name: string) {
  const palette = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#16A34A'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color, sub, onPress }: {
  label: string; value: number | string; icon: string;
  color: string; sub?: string; onPress?: () => void;
}) {
  const bg = color + '14'; // 8% opacity
  return (
    <Pressable style={kpi.card} onPress={onPress}>
      <View style={[kpi.iconBg, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[kpi.value, { color }]}>{value}</Text>
      <Text style={kpi.label}>{label}</Text>
      {sub ? <Text style={kpi.sub}>{sub}</Text> : null}
    </Pressable>
  );
}

const kpi = StyleSheet.create({
  card: {
    width: '48.5%', backgroundColor: C.card,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border,
    padding: Spacing.md, gap: 6, minHeight: 108,
  },
  iconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  value:  { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, lineHeight: 38 },
  label:  { fontSize: 11, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  sub:    { fontSize: 11, color: C.textMuted, fontWeight: '500', marginTop: 2 },
});

// ── Attendance Bar ────────────────────────────────────────────────────────────

function AttendanceBar({ summary }: { summary: AnalyticsSummary }) {
  const total = Math.max(summary.total_employees, 1);
  const presentPct = (summary.present_today / total) * 100;
  const latePct    = (summary.late_today / total) * 100;
  const absentPct  = Math.max(0, 100 - presentPct - latePct);
  const rate = summary.attendance_rate ?? Math.round(((summary.present_today + summary.late_today) / total) * 100);

  return (
    <View style={ab.card}>
      <View style={ab.header}>
        <View>
          <Text style={ab.eyebrow}>TODAY'S OVERVIEW</Text>
          <Text style={ab.title}>Attendance Rate</Text>
        </View>
        <Text style={ab.rate}>{rate}%</Text>
      </View>
      {/* Progress bar */}
      <View style={ab.track}>
        {presentPct > 0 && <View style={[ab.seg, { width: `${presentPct}%` as any, backgroundColor: C.success }]} />}
        {latePct    > 0 && <View style={[ab.seg, { width: `${latePct}%` as any, backgroundColor: C.warning }]} />}
        {absentPct  > 0 && <View style={[ab.seg, { width: `${absentPct}%` as any, backgroundColor: C.card2 }]} />}
      </View>
      {/* Legend */}
      <View style={ab.legend}>
        {([
          { label: 'Present', val: summary.present_today, color: C.success, bg: C.successBg },
          { label: 'Late',    val: summary.late_today,    color: C.warning, bg: C.warningBg },
          { label: 'Absent',  val: summary.absent_today,  color: C.danger,  bg: C.dangerBg  },
        ] as const).map(item => (
          <View key={item.label} style={ab.legendItem}>
            <View style={[ab.pill, { backgroundColor: item.bg }]}>
              <Text style={[ab.pillVal, { color: item.color }]}>{item.val}</Text>
            </View>
            <Text style={ab.legendLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const ab = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: C.border, padding: Spacing.md, gap: 14, marginBottom: Spacing.md,
  },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow:      { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, marginBottom: 2 },
  title:        { fontSize: 16, fontWeight: '700', color: C.text },
  rate:         { fontSize: 30, fontWeight: '900', color: C.primary, letterSpacing: -0.5 },
  track:        { height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: C.card2 },
  seg:          { height: '100%' },
  legend:       { flexDirection: 'row', justifyContent: 'space-around' },
  legendItem:   { alignItems: 'center', gap: 5 },
  pill:         { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, minWidth: 48, alignItems: 'center' },
  pillVal:      { fontSize: 18, fontWeight: '800' },
  legendLabel:  { fontSize: 10, color: C.textSub, fontWeight: '600' },
});

// ── Quick Actions ─────────────────────────────────────────────────────────────

function QuickActions({ pending, onRoute }: { pending: number; onRoute: (r: string) => void }) {
  const actions = [
    { label: 'Approvals', icon: 'check-decagram-outline', route: '/(admin)/approvals', color: C.primary, badge: pending },
    { label: 'Staff',     icon: 'account-group-outline',  route: '/(admin)/employees', color: '#14B8A6' },
    { label: 'Geofences', icon: 'map-marker-radius-outline', route: '/(admin)/geofences', color: '#A855F7' },
    { label: 'Reports',   icon: 'file-chart-outline',     route: '/(admin)/reports',   color: '#3B82F6' },
  ];
  return (
    <View style={qa.row}>
      {actions.map(a => (
        <Pressable key={a.label} style={qa.card} onPress={() => onRoute(a.route)}>
          <View style={[qa.iconBg, { backgroundColor: a.color + '14' }]}>
            <MaterialCommunityIcons name={a.icon as any} size={20} color={a.color} />
          </View>
          <Text style={qa.label}>{a.label}</Text>
          {a.badge && a.badge > 0 ? (
            <View style={qa.badge}><Text style={qa.badgeTxt}>{a.badge > 99 ? '99+' : a.badge}</Text></View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const qa = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  card: {
    flex: 1, backgroundColor: C.card, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.border,
    padding: 10, alignItems: 'center', gap: 7, minHeight: 74, position: 'relative',
  },
  iconBg: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label:  { fontSize: 10, fontWeight: '700', color: C.textSub, textAlign: 'center' },
  badge:  {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: C.danger, borderRadius: 10,
    minWidth: 17, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },
});

// ── Trend Chart ───────────────────────────────────────────────────────────────

type TrendMetric = 'combined' | 'present' | 'late';

function TrendChart({ trends }: { trends: TrendPoint[] }) {
  const [metric, setMetric] = useState<TrendMetric>('combined');
  const last7 = trends.slice(-7);
  const getValue = (t: TrendPoint) =>
    metric === 'present' ? t.present_count : metric === 'late' ? t.late_count : t.present_count + t.late_count;
  const maxVal = Math.max(...last7.map(getValue), 1);
  const barColor = metric === 'late' ? C.warning : metric === 'present' ? C.success : C.primary;

  return (
    <View style={tc.wrap}>
      <View style={tc.header}>
        <View>
          <Text style={tc.eyebrow}>ANALYTICS</Text>
          <Text style={tc.title}>7-Day Trend</Text>
        </View>
        <View style={tc.pills}>
          {(['combined', 'present', 'late'] as TrendMetric[]).map(m => (
            <Pressable key={m} onPress={() => setMetric(m)} style={[tc.pill, metric === m && tc.pillActive]}>
              <Text style={[tc.pillTxt, metric === m && tc.pillTxtA]}>
                {m === 'combined' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={tc.chartArea}>
        {last7.map((t, i) => {
          const val = getValue(t);
          const pct = (val / maxVal) * 100;
          const day = t.date ? format(parseISO(t.date), 'EEE') : `D${i}`;
          return (
            <View key={t.date ?? i} style={tc.barCol}>
              <Text style={tc.barVal}>{val}</Text>
              <View style={tc.barTrack}>
                <View style={[tc.barFill, { height: `${Math.max(pct, 4)}%` as any, backgroundColor: barColor }]} />
              </View>
              <Text style={tc.barDay}>{day}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const tc = StyleSheet.create({
  wrap: { backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  pills:    { flexDirection: 'row', gap: 4 },
  pill:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: C.card2 },
  pillActive: { backgroundColor: C.primaryBg },
  pillTxt:  { fontSize: 11, fontWeight: '600', color: C.textMuted },
  pillTxtA: { color: C.primary },
  chartArea: { flexDirection: 'row', height: 110, alignItems: 'flex-end', gap: 5, marginBottom: 4 },
  barCol:   { flex: 1, alignItems: 'center', gap: 3 },
  barVal:   { fontSize: 9, color: C.textSub, fontWeight: '600' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 3, backgroundColor: C.card2 },
  barFill:  { width: '100%', borderRadius: 3 },
  barDay:   { fontSize: 9, color: C.textMuted, fontWeight: '600' },
});

// ── Live Feed Section ─────────────────────────────────────────────────────────

function LiveFeedSection() {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.2, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={lf.wrap}>
      <View style={lf.header}>
        <View>
          <Text style={lf.eyebrow}>REAL-TIME</Text>
          <Text style={lf.title}>Live Feed</Text>
        </View>
        <View style={lf.badge}>
          <Animated.View style={[lf.dot, { opacity: pulseAnim }]} />
          <Text style={lf.badgeTxt}>LIVE</Text>
        </View>
      </View>
      <View style={lf.feedWrap}>
        <LiveFeed maxItems={8} />
      </View>
    </View>
  );
}

const lf = StyleSheet.create({
  wrap: { backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: Spacing.md, paddingBottom: 12 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: C.success, letterSpacing: 0.6 },
  feedWrap: { borderTopWidth: 1, borderTopColor: C.border },
});

// ── Roster Row ────────────────────────────────────────────────────────────────

function RosterRow({ emp }: { emp: any }) {
  const isPresent = emp.status === 'present';
  const isLate = emp.is_late && isPresent;
  const color = isLate ? C.warning : isPresent ? C.success : C.danger;
  const bg = isLate ? C.warningBg : isPresent ? C.successBg : C.dangerBg;
  const label = isLate ? 'Late' : isPresent ? 'In' : 'Absent';

  return (
    <View style={rr.row}>
      <View style={[rr.avatar, { backgroundColor: avatarBg(emp.full_name) }]}>
        <Text style={rr.avatarTxt}>{initials(emp.full_name)}</Text>
      </View>
      <View style={rr.info}>
        <Text style={rr.name} numberOfLines={1}>{emp.full_name}</Text>
        <Text style={rr.time}>
          {isPresent
            ? `In: ${format(parseISO(emp.check_in_time), 'HH:mm')}${emp.check_out_time ? `  ·  Out: ${format(parseISO(emp.check_out_time), 'HH:mm')}` : ''}`
            : 'Not checked in'}
        </Text>
      </View>
      <View style={[rr.pill, { backgroundColor: bg }]}>
        <Text style={[rr.pillTxt, { color }]}>{label}</Text>
      </View>
    </View>
  );
}

const rr = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 12, fontWeight: '800', color: '#fff' },
  info: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600', color: C.text },
  time: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  pillTxt: { fontSize: 11, fontWeight: '700' },
});

// ── Dept Leaderboard ──────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];

function DeptLeaderboardCard({ entries, isLoading, isError }: { entries: DeptLeaderboardEntry[]; isLoading?: boolean; isError?: boolean }) {
  return (
    <View style={dep.wrap}>
      <View style={dep.header}>
        <Text style={dep.eyebrow}>PERFORMANCE</Text>
        <Text style={dep.title}>Department Rankings</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} />
      ) : isError || !entries?.length ? (
        <Text style={dep.empty}>{isError ? 'Failed to load' : 'No department data yet'}</Text>
      ) : (
        <View style={dep.rows}>
          {entries.slice(0, 5).map(e => {
            const pct = Math.round(e.attendance_rate * 100);
            const color = e.attendance_rate >= 0.9 ? C.success : e.attendance_rate >= 0.7 ? C.warning : C.danger;
            const medal = e.rank <= 3 ? MEDALS[e.rank - 1] : `${e.rank}.`;
            return (
              <View key={e.department} style={dep.row}>
                <Text style={dep.medal}>{medal}</Text>
                <View style={{ flex: 1, gap: 5 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={dep.dept} numberOfLines={1}>{e.department}</Text>
                    <Text style={[dep.pct, { color }]}>{pct}%</Text>
                  </View>
                  <View style={dep.bar}>
                    <View style={[dep.barFill, { width: `${Math.max(pct, 2)}%` as any, backgroundColor: color }]} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const dep = StyleSheet.create({
  wrap: { backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.md },
  header: { marginBottom: 16 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, marginBottom: 2 },
  title:   { fontSize: 16, fontWeight: '700', color: C.text },
  rows:    { gap: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  medal:   { fontSize: 16, width: 26 },
  dept:    { fontSize: 13, fontWeight: '600', color: C.text, flex: 1 },
  pct:     { fontSize: 13, fontWeight: '800' },
  bar:     { height: 5, borderRadius: 3, backgroundColor: C.card2, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
  empty:   { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 16 },
});

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>{eyebrow}</Text>
        <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{title}</Text>
      </View>
      {action && <Pressable onPress={onAction} hitSlop={8}><Text style={{ fontSize: 13, fontWeight: '600', color: C.primary }}>{action}</Text></Pressable>}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const [refreshing, setRefreshing] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);

  const { data: summary, isLoading, refetch: refetchSummary } = useQuery<AnalyticsSummary>({
    queryKey: ['analytics', 'summary'],
    queryFn: () => analyticsApi.summary().then(r => r.data),
    refetchInterval: 30_000,
  });
  const { data: trends, refetch: refetchTrends } = useQuery<TrendPoint[]>({
    queryKey: ['analytics', 'trends'],
    queryFn: () => analyticsApi.trends().then(r => r.data as TrendPoint[]),
    staleTime: 5 * 60_000,
  });
  const { data: roster, refetch: refetchRoster } = useQuery<any[]>({
    queryKey: ['analytics', 'attendance-today'],
    queryFn: () => analyticsApi.attendanceToday().then(r => r.data),
    refetchInterval: 60_000,
  });
  const { data: deptLeaderboard, isLoading: deptLoading, isError: deptError } = useDeptLeaderboard();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchTrends(), refetchRoster()]);
    setRefreshing(false);
  }, [refetchSummary, refetchTrends, refetchRoster]);

  const adminName = user?.full_name ?? 'Admin';
  const displayRoster = rosterExpanded ? (roster ?? []) : (roster ?? []).slice(0, 5);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View>
            <Text style={s.greeting}>{greeting()}, Admin</Text>
            <Text style={s.dateStr}>{format(new Date(), 'EEEE, d MMM yyyy')}</Text>
          </View>
          <View style={s.headerActions}>
            <Pressable style={s.iconBtn} onPress={() => router.push('/(admin)/anomalies' as any)}>
              <MaterialCommunityIcons name="bell-outline" size={20} color={C.textSub} />
              {summary && (summary.anomaly_count ?? 0) > 0 && (
                <View style={s.iconBadge}>
                  <Text style={s.iconBadgeTxt}>{summary.anomaly_count}</Text>
                </View>
              )}
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => { logout(); router.replace('/(auth)/login' as any); }}>
              <MaterialCommunityIcons name="logout-variant" size={20} color={C.danger} />
            </Pressable>
            <View style={[s.avatar, { backgroundColor: avatarBg(adminName) }]}>
              <Text style={s.avatarTxt}>{initials(adminName)}</Text>
            </View>
          </View>
        </View>

        {/* ── Body ── */}
        <View style={s.body}>
          {isLoading ? (
            <View style={s.loadBox}>
              <ActivityIndicator color={C.primary} size="large" />
              <Text style={s.loadTxt}>Loading dashboard…</Text>
            </View>
          ) : summary ? (
            <>
              {/* Attendance Overview */}
              <AttendanceBar summary={summary} />

              {/* KPI Grid */}
              <View style={s.kpiGrid}>
                <KpiCard label="Present"   value={summary.present_today}    icon="account-check-outline" color={C.success}
                  sub={`of ${summary.total_employees} total`} />
                <KpiCard label="Late"      value={summary.late_today}       icon="clock-alert-outline"   color={C.warning} />
                <KpiCard label="Absent"    value={summary.absent_today}     icon="account-off-outline"   color={C.danger} />
                <KpiCard label="Approvals" value={summary.pending_approvals} icon="check-decagram-outline" color={C.primary}
                  onPress={() => router.push('/(admin)/approvals' as any)} sub="pending" />
              </View>

              {/* Quick Actions */}
              <SectionTitle eyebrow="Navigate" title="Quick Actions" />
              <QuickActions pending={summary.pending_approvals} onRoute={r => router.push(r as any)} />

              {/* Trends */}
              {trends && trends.length > 0 && <TrendChart trends={trends} />}

              {/* Live Feed */}
              <LiveFeedSection />

              {/* Today's Roster */}
              {roster && roster.length > 0 && (
                <View style={s.rosterWrap}>
                  <SectionTitle eyebrow="TODAY" title="Staff Status"
                    action={rosterExpanded ? 'Show Less' : `See All (${roster.length})`}
                    onAction={() => setRosterExpanded(v => !v)} />
                  <View style={s.rosterCard}>
                    {displayRoster.map((emp: any) => <RosterRow key={emp.user_id ?? emp.id} emp={emp} />)}
                  </View>
                </View>
              )}

              {/* Department Leaderboard */}
              <DeptLeaderboardCard entries={deptLeaderboard ?? []} isLoading={deptLoading} isError={deptError} />
            </>
          ) : (
            <View style={s.loadBox}>
              <MaterialCommunityIcons name="cloud-off-outline" size={44} color={C.textMuted} />
              <Text style={s.loadTxt}>Could not load dashboard</Text>
              <Pressable onPress={() => refetchSummary()} style={s.retryBtn}>
                <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Retry</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: {},
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
  },
  greeting: { fontSize: 20, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  dateStr:  { fontSize: 12, color: C.textMuted, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  iconBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: C.danger, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  iconBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },

  body: { paddingHorizontal: Spacing.md },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },

  rosterWrap: { marginBottom: Spacing.md },
  rosterCard: { backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },

  loadBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  loadTxt: { fontSize: 14, color: C.textMuted, fontWeight: '500' },
  retryBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.primary },
});
