import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  FlatList,
} from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { analyticsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { LiveFeed } from '@/components/LiveFeed';
import type { AnalyticsSummary, TrendPoint } from '@/types';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(name: string) {
  return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
}
function avatarColor(name: string) {
  const c = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#16A34A'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return c[Math.abs(h) % c.length];
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color, bgColor, sub, onPress }: {
  label: string; value: number | string; icon: string;
  color: string; bgColor: string; sub?: string; onPress?: () => void;
}) {
  return (
    <Pressable style={[styles.kpiCard, { borderTopColor: color, borderTopWidth: 3 }]} onPress={onPress}>
      <View style={[styles.kpiIconWrap, { backgroundColor: bgColor }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
      {sub ? <Text style={[styles.kpiSub, { color }]}>{sub}</Text> : null}
    </Pressable>
  );
}

// ─── Trend Bar Chart ──────────────────────────────────────────────────────────

function TrendChart({ trends }: { trends: TrendPoint[] }) {
  const last7 = trends.slice(-7);
  const maxVal = Math.max(...last7.map(t => t.present_count + t.late_count), 1);
  return (
    <Surface style={styles.trendCard} elevation={1}>
      <Text style={styles.cardTitle}>7-Day Attendance Trend</Text>
      <View style={styles.chartArea}>
        {last7.map((t, i) => {
          const total = t.present_count + t.late_count;
          const pct = (total / maxVal) * 100;
          const day = t.date ? format(parseISO(t.date), 'EEE') : `D${i}`;
          return (
            <View key={t.date ?? i} style={styles.barCol}>
              <Text style={styles.barVal}>{total}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${Math.max(pct, 4)}%` as any }]} />
              </View>
              <Text style={styles.barDay}>{day}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.trendLegend}>
        <View style={styles.legendDot}><View style={[styles.dot, { backgroundColor: '#4F46E5' }]} /><Text style={styles.legendTxt}>Present + Late</Text></View>
      </View>
    </Surface>
  );
}

// ─── Attendance Overview Bar ──────────────────────────────────────────────────

function AttendanceBar({ summary }: { summary: AnalyticsSummary }) {
  const total = summary.total_employees || 1;
  const presentPct = (summary.present_today / total) * 100;
  const latePct = (summary.late_today / total) * 100;
  const absentPct = Math.max(0, 100 - presentPct - latePct);
  const rate = summary.attendance_rate ?? Math.round(((summary.present_today + summary.late_today) / total) * 100);
  return (
    <Surface style={styles.overviewCard} elevation={1}>
      <View style={styles.overviewHeader}>
        <Text style={styles.cardTitle}>Today's Overview</Text>
        <View style={styles.ratePill}>
          <Text style={styles.rateNum}>{rate}%</Text>
          <Text style={styles.rateSub}>attendance</Text>
        </View>
      </View>
      <View style={styles.bar}>
        {presentPct > 0 && <View style={[styles.barSeg, { width: `${presentPct}%` as any, backgroundColor: '#10B981' }]} />}
        {latePct > 0 && <View style={[styles.barSeg, { width: `${latePct}%` as any, backgroundColor: '#F59E0B' }]} />}
        {absentPct > 0 && <View style={[styles.barSeg, { width: `${absentPct}%` as any, backgroundColor: '#EF4444' }]} />}
      </View>
      <View style={styles.legend}>
        {[
          { label: 'Present', value: summary.present_today, color: '#10B981', bg: '#D1FAE5' },
          { label: 'Late', value: summary.late_today, color: '#F59E0B', bg: '#FEF3C7' },
          { label: 'Absent', value: summary.absent_today, color: '#EF4444', bg: '#FEE2E2' },
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendBadge, { backgroundColor: item.bg }]}>
              <Text style={[styles.legendVal, { color: item.color }]}>{item.value}</Text>
            </View>
            <Text style={styles.legendLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

// ─── Employee Roster Row ──────────────────────────────────────────────────────

function RosterRow({ emp }: { emp: any }) {
  const isPresent = emp.status === 'present';
  const isLate = emp.is_late && isPresent;
  return (
    <View style={styles.rosterRow}>
      <View style={[styles.rosterAvatar, { backgroundColor: avatarColor(emp.full_name) }]}>
        <Text style={styles.rosterInitials}>{getInitials(emp.full_name)}</Text>
      </View>
      <View style={styles.rosterInfo}>
        <Text style={styles.rosterName} numberOfLines={1}>{emp.full_name}</Text>
        <Text style={styles.rosterTime}>
          {isPresent
            ? `In: ${format(parseISO(emp.check_in_time), 'HH:mm')}${emp.check_out_time ? `  ·  Out: ${format(parseISO(emp.check_out_time), 'HH:mm')}` : ''}`
            : 'Not checked in'}
        </Text>
      </View>
      <View style={[styles.statusPill, {
        backgroundColor: isLate ? '#FEF3C7' : isPresent ? '#D1FAE5' : '#FEE2E2',
      }]}>
        <MaterialCommunityIcons
          name={isLate ? 'clock-alert' : isPresent ? 'check-circle' : 'account-off'}
          size={12}
          color={isLate ? '#D97706' : isPresent ? '#059669' : '#DC2626'}
        />
        <Text style={[styles.statusTxt, { color: isLate ? '#D97706' : isPresent ? '#059669' : '#DC2626' }]}>
          {isLate ? 'Late' : isPresent ? 'In' : 'Absent'}
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const [refreshing, setRefreshing] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);

  const { data: summary, isLoading: loadingSummary, refetch: refetchSummary } = useQuery<AnalyticsSummary>({
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchTrends(), refetchRoster()]);
    setRefreshing(false);
  }, [refetchSummary, refetchTrends, refetchRoster]);

  const displayedRoster = rosterExpanded ? (roster ?? []) : (roster ?? []).slice(0, 5);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} tintColor="#4F46E5" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.adminName}>{user?.full_name?.split(' ')[0] ?? 'Admin'}</Text>
            <Text style={styles.dateText}>{format(new Date(), 'EEEE, MMMM d')}</Text>
          </View>
          <Pressable style={styles.alertBtn} onPress={() => router.push('/(admin)/anomalies')}>
            <MaterialCommunityIcons name="shield-alert-outline" size={22} color="#EF4444" />
            {summary && (summary.anomaly_count ?? 0) > 0 && (
              <View style={styles.alertDot}>
                <Text style={styles.alertDotText}>{(summary.anomaly_count ?? 0) > 9 ? '9+' : summary.anomaly_count}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {loadingSummary ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#4F46E5" size="large" />
            <Text style={styles.loadingText}>Loading dashboard…</Text>
          </View>
        ) : summary ? (
          <>
            {/* ── KPI Grid ── */}
            <View style={styles.kpiGrid}>
              <KpiCard label="Present" value={summary.present_today} icon="account-check-outline" color="#10B981" bgColor="#D1FAE5"
                sub={`of ${summary.total_employees}`} />
              <KpiCard label="Late" value={summary.late_today} icon="clock-alert-outline" color="#F59E0B" bgColor="#FEF3C7" />
              <KpiCard label="Absent" value={summary.absent_today} icon="account-off-outline" color="#EF4444" bgColor="#FEE2E2" />
              <KpiCard label="Pending" value={summary.pending_approvals} icon="clock-check-outline" color="#6366F1" bgColor="#EEF2FF"
                onPress={() => router.push('/(admin)/approvals')} />
            </View>

            {/* ── Attendance Bar ── */}
            <AttendanceBar summary={summary} />

            {/* ── Quick Actions ── */}
            <View style={styles.actionsRow}>
              {[
                { label: 'Approvals', icon: 'check-all', route: '/(admin)/approvals', primary: true, badge: summary.pending_approvals },
                { label: 'Staff', icon: 'account-group-outline', route: '/(admin)/employees', primary: false },
                { label: 'Geofences', icon: 'map-marker-radius-outline', route: '/(admin)/geofences', primary: false },
                { label: 'Reports', icon: 'file-chart-outline', route: '/(admin)/reports', primary: false },
              ].map(a => (
                <Pressable
                  key={a.label}
                  style={[styles.actionCard, a.primary
                    ? { backgroundColor: '#4F46E5' }
                    : { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' }]}
                  onPress={() => router.push(a.route as any)}
                >
                  <MaterialCommunityIcons name={a.icon as any} size={20} color={a.primary ? '#FFFFFF' : '#4F46E5'} />
                  <Text style={[styles.actionLabel, { color: a.primary ? '#FFFFFF' : '#4F46E5' }]}>{a.label}</Text>
                  {a.badge && a.badge > 0 ? (
                    <View style={styles.actionBadge}><Text style={styles.actionBadgeText}>{a.badge}</Text></View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="wifi-off" size={40} color="#CBD5E1" />
            <Text style={styles.errorText}>Could not load data. Pull to refresh.</Text>
          </View>
        )}

        {/* ── 7-Day Trend ── */}
        {trends && trends.length > 0 && <TrendChart trends={trends} />}

        {/* ── Employee Roster ── */}
        <Surface style={styles.rosterCard} elevation={1}>
          <View style={styles.rosterHeader}>
            <Text style={styles.cardTitle}>Today's Roster</Text>
            <View style={styles.rosterBadgeRow}>
              {roster && (
                <>
                  <View style={[styles.rosterBadge, { backgroundColor: '#D1FAE5' }]}>
                    <Text style={[styles.rosterBadgeText, { color: '#059669' }]}>
                      {roster.filter(e => e.status === 'present').length} in
                    </Text>
                  </View>
                  <View style={[styles.rosterBadge, { backgroundColor: '#FEE2E2' }]}>
                    <Text style={[styles.rosterBadgeText, { color: '#DC2626' }]}>
                      {roster.filter(e => e.status === 'absent').length} out
                    </Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {!roster ? (
            <ActivityIndicator color="#4F46E5" style={{ padding: 24 }} />
          ) : roster.length === 0 ? (
            <Text style={styles.emptyRoster}>No employees found.</Text>
          ) : (
            <>
              {displayedRoster.map(emp => <RosterRow key={emp.user_id} emp={emp} />)}
              {roster.length > 5 && (
                <Pressable style={styles.showMore} onPress={() => setRosterExpanded(!rosterExpanded)}>
                  <Text style={styles.showMoreText}>
                    {rosterExpanded ? 'Show less' : `Show all ${roster.length} employees`}
                  </Text>
                  <MaterialCommunityIcons name={rosterExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#4F46E5" />
                </Pressable>
              )}
            </>
          )}
        </Surface>

        {/* ── Live Feed ── */}
        <Surface style={styles.feedCard} elevation={1}>
          <LiveFeed maxItems={8} />
        </Surface>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  greeting: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  adminName: { fontSize: 24, fontWeight: '800', color: '#1E293B', lineHeight: 30 },
  dateText: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  alertBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  alertDot: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 2, borderColor: '#F8FAFC' },
  alertDotText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  loadingBox: { paddingVertical: 48, alignItems: 'center', gap: 12 },
  loadingText: { color: '#94A3B8', fontSize: 14 },
  errorBox: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  errorText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { width: '47.5%', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, gap: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  kpiIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  kpiValue: { fontSize: 28, fontWeight: '900', color: '#1E293B', lineHeight: 32 },
  kpiLabel: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  kpiSub: { fontSize: 11, fontWeight: '600', marginTop: 1 },

  overviewCard: { borderRadius: 16, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1F5F9', gap: 12 },
  overviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  ratePill: { alignItems: 'flex-end' },
  rateNum: { fontSize: 22, fontWeight: '900', color: '#4F46E5' },
  rateSub: { fontSize: 11, color: '#94A3B8', marginTop: -2 },
  bar: { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#F1F5F9' },
  barSeg: { height: '100%' },
  legend: { flexDirection: 'row', justifyContent: 'space-around' },
  legendItem: { alignItems: 'center', gap: 4 },
  legendBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  legendVal: { fontSize: 18, fontWeight: '800' },
  legendLabel: { fontSize: 11, color: '#64748B', fontWeight: '500' },

  actionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionCard: { flex: 1, minWidth: '22%', borderRadius: 14, padding: 12, alignItems: 'center', gap: 5, position: 'relative', minHeight: 72, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  actionLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  actionBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: '#EF4444', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  actionBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  // Trend chart
  trendCard: { borderRadius: 16, padding: 16, backgroundColor: '#FFFFFF', gap: 12 },
  chartArea: { flexDirection: 'row', height: 100, alignItems: 'flex-end', gap: 6, paddingTop: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barVal: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  barFill: { width: '100%', backgroundColor: '#4F46E5', borderRadius: 4, minHeight: 4 },
  barDay: { fontSize: 10, color: '#64748B', fontWeight: '600' },
  trendLegend: { flexDirection: 'row', gap: 12 },
  legendDot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 11, color: '#64748B' },

  // Roster
  rosterCard: { borderRadius: 16, backgroundColor: '#FFFFFF', overflow: 'hidden', borderWidth: 1, borderColor: '#F1F5F9' },
  rosterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 12 },
  rosterBadgeRow: { flexDirection: 'row', gap: 6 },
  rosterBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  rosterBadgeText: { fontSize: 11, fontWeight: '700' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F8FAFC' },
  rosterAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rosterInitials: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  rosterInfo: { flex: 1 },
  rosterName: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  rosterTime: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  emptyRoster: { color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 24 },
  showMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  showMoreText: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },

  feedCard: { borderRadius: 16, backgroundColor: '#FFFFFF', minHeight: 120, borderWidth: 1, borderColor: '#F1F5F9', overflow: 'hidden' },
});
