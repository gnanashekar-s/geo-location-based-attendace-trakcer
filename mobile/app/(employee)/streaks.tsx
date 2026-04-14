import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi, usersApi } from '@/services/api';
import type { AttendanceStats, LeaderboardEntry } from '@/types';

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

function getMotivation(streak: number): string {
  if (streak === 0)  return 'Start your streak today!';
  if (streak < 7)    return 'Keep going!';
  if (streak < 30)   return 'One week strong!';
  return 'Monthly champion!';
}

function getDayLetters(): string[] {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

// ─── Build this-month calendar ────────────────────────────────────────────────
// Returns an array of { date, status } for every cell in the 7-col calendar
// starting from the Monday of the week containing the 1st of the current month.

type DayStatus = 'present' | 'absent' | 'today' | 'empty';

interface CalendarDay {
  day: number | null;   // null = padding cell
  status: DayStatus;
}

function buildCalendar(presentDays: Set<number>, absentDays: Set<number>): CalendarDay[] {
  const now      = new Date();
  const year     = now.getFullYear();
  const month    = now.getMonth();
  const today    = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // day-of-week of the 1st (0=Sun…6=Sat) → convert to Mon-based (0=Mon…6=Sun)
  const firstDow = new Date(year, month, 1).getDay();
  const startOffset = (firstDow + 6) % 7; // Monday-based offset

  const cells: CalendarDay[] = [];

  // Leading empty cells
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: null, status: 'empty' });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    let status: DayStatus = 'empty';
    if (d === today)         status = 'today';
    else if (d > today)      status = 'empty';
    else if (presentDays.has(d)) status = 'present';
    else if (absentDays.has(d))  status = 'absent';
    else                         status = 'empty';

    cells.push({ day: d, status });
  }

  return cells;
}

// ─── Calendar component ───────────────────────────────────────────────────────

function StreakCalendar({ presentDays, absentDays }: { presentDays: Set<number>; absentDays: Set<number> }) {
  const cells = buildCalendar(presentDays, absentDays);
  const headers = getDayLetters();

  function dotStyle(status: DayStatus) {
    switch (status) {
      case 'present': return { backgroundColor: C.success,  width: 32, height: 32, borderRadius: 16 };
      case 'absent':  return { backgroundColor: C.danger,   width: 26, height: 26, borderRadius: 13 };
      case 'today':   return { backgroundColor: C.primary,  width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#FFFFFF' };
      default:        return { backgroundColor: C.surface2, width: 32, height: 32, borderRadius: 16 };
    }
  }

  function textStyle(status: DayStatus) {
    if (status === 'empty') return { color: C.textMuted };
    return { color: '#FFFFFF', fontWeight: '600' as const };
  }

  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>This Month</Text>

      {/* Day headers */}
      <View style={s.calRow}>
        {headers.map(h => (
          <View key={h} style={s.calCell}>
            <Text style={s.calHeader}>{h}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid — chunk into rows of 7 */}
      {Array.from({ length: Math.ceil(cells.length / 7) }).map((_, rowIdx) => {
        const row = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
        // Pad last row to 7
        while (row.length < 7) row.push({ day: null, status: 'empty' });
        return (
          <View key={rowIdx} style={s.calRow}>
            {row.map((cell, colIdx) => (
              <View key={colIdx} style={s.calCell}>
                {cell.day !== null ? (
                  <View style={[s.calDot, dotStyle(cell.status)]}>
                    <Text style={[s.calDayNum, textStyle(cell.status)]}>
                      {cell.day}
                    </Text>
                  </View>
                ) : (
                  <View style={[s.calDot, { backgroundColor: 'transparent' }]} />
                )}
              </View>
            ))}
          </View>
        );
      })}

      {/* Legend */}
      <View style={s.calLegend}>
        {[
          { color: C.success, label: 'Present' },
          { color: C.danger,  label: 'Absent'  },
          { color: C.primary, label: 'Today'   },
        ].map(item => (
          <View key={item.label} style={s.legendRow}>
            <View style={[s.legendDot, { backgroundColor: item.color }]} />
            <Text style={s.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Milestone badges ─────────────────────────────────────────────────────────

interface Milestone {
  days: number;
  label: string;
  tier: 'bronze' | 'silver' | 'gold';
  emoji: string;
  gradient: [string, string];
  lockedGradient: [string, string];
}

const MILESTONES: Milestone[] = [
  {
    days: 7,
    label: '7-Day Streak',
    tier: 'bronze',
    emoji: '🥉',
    gradient:       ['#92400E', '#D97706'],
    lockedGradient: ['#1E293B', '#334155'],
  },
  {
    days: 30,
    label: '30-Day Streak',
    tier: 'silver',
    emoji: '🥈',
    gradient:       ['#334155', '#64748B'],
    lockedGradient: ['#1E293B', '#334155'],
  },
  {
    days: 100,
    label: '100-Day Streak',
    tier: 'gold',
    emoji: '🥇',
    gradient:       ['#78350F', '#F59E0B'],
    lockedGradient: ['#1E293B', '#334155'],
  },
];

function MilestoneBadges({ streakCount }: { streakCount: number }) {
  return (
    <View style={s.sectionCardNoPad}>
      <Text style={[s.sectionTitle, { paddingHorizontal: 16, paddingTop: 16 }]}>Milestones</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.badgesRow}
      >
        {MILESTONES.map(m => {
          const unlocked = streakCount >= m.days;
          const grad = unlocked ? m.gradient : m.lockedGradient;
          return (
            <LinearGradient
              key={m.days}
              colors={grad}
              style={s.badgeCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {unlocked ? (
                <Text style={s.badgeEmoji}>{m.emoji}</Text>
              ) : (
                <View style={s.badgeLockWrap}>
                  <MaterialCommunityIcons name="lock" size={22} color={C.textMuted} />
                </View>
              )}
              <Text style={[s.badgeLabel, !unlocked && { color: C.textMuted }]}>
                {m.label}
              </Text>
              <Text style={[s.badgeTier, !unlocked && { color: C.textMuted }]}>
                {m.tier.charAt(0).toUpperCase() + m.tier.slice(1)}
              </Text>
            </LinearGradient>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function Leaderboard({ data, isLoading }: { data?: LeaderboardEntry[]; isLoading: boolean }) {
  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>Top Performers</Text>
      {isLoading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : !data?.length ? (
        <Text style={s.emptyText}>No leaderboard data yet.</Text>
      ) : (
        data.map((entry, i) => {
          const maxStreak = data[0]?.streak_count ?? 1;
          const pct = maxStreak > 0 ? Math.round(((entry.streak_count ?? 0) / maxStreak) * 100) : 0;
          return (
            <React.Fragment key={entry.user_id ?? entry.id ?? i}>
              {i > 0 && <View style={s.leaderSep} />}
              <View style={s.leaderRow}>
                <Text style={s.medal}>{MEDALS[i] ?? String(i + 1)}</Text>
                <View style={s.leaderInfo}>
                  <Text style={s.leaderName}>{entry.full_name}</Text>
                  <Text style={s.leaderStreak}>🔥 {entry.streak_count} days</Text>
                </View>
                <View style={s.pctPill}>
                  <Text style={s.leaderPct}>{pct}%</Text>
                </View>
              </View>
            </React.Fragment>
          );
        })
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StreaksScreen() {
  const { data: stats, isLoading } = useQuery<AttendanceStats>({
    queryKey: ['attendance', 'stats'],
    queryFn: () => attendanceApi.stats().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard'],
    queryFn: () => usersApi.leaderboard().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: historyItems } = useQuery({
    queryKey: ['attendance', 'history', 'all'],
    queryFn: () => attendanceApi.history(1, 100).then(r => r.data.items),
    staleTime: 5 * 60_000,
  });

  const streakCount = stats?.current_streak  ?? 0;
  const bestStreak  = stats?.longest_streak  ?? 0;
  const punctuality = stats?.punctuality_percentage ?? null;

  // Build present-day set for the current month from real history data
  const presentDays = React.useMemo(() => {
    const set = new Set<number>();
    if (!historyItems) return set;
    const now = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth(); // 0-based
    for (const record of historyItems) {
      if (!record.date) continue;
      const d = new Date(record.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        set.add(d.getDate());
      }
    }
    return set;
  }, [historyItems]);

  const absentDays  = new Set<number>();

  const motivation = getMotivation(streakCount);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={['#1C1917', '#0F172A']}
          style={s.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          <Text style={s.heroFlame}>🔥</Text>

          {isLoading ? (
            <ActivityIndicator size="large" color={C.warning} style={{ marginVertical: 8 }} />
          ) : (
            <Text style={s.heroNumber}>{streakCount}</Text>
          )}

          <Text style={s.heroStreakLabel}>day streak</Text>
          <Text style={s.heroMotivation}>{motivation}</Text>
        </LinearGradient>

        {/* ── Stats row ── */}
        <View style={s.statsRow}>
          {[
            {
              label: 'On-time',
              value: punctuality !== null ? `${Math.round(punctuality)}%` : '—',
              color: C.success,
              icon:  'clock-check-outline',
            },
            {
              label: 'Current',
              value: String(streakCount),
              color: '#F97316',
              icon:  'fire',
            },
            {
              label: 'Best',
              value: String(bestStreak),
              color: C.primary,
              icon:  'medal-outline',
            },
          ].map(item => (
            <View key={item.label} style={s.statCard}>
              <View style={[s.statIconWrap, { backgroundColor: `${item.color}18` }]}>
                <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={item.color} />
              ) : (
                <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
              )}
              <Text style={s.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Streak calendar ── */}
        <StreakCalendar presentDays={presentDays} absentDays={absentDays} />

        {/* ── Milestone badges ── */}
        <MilestoneBadges streakCount={streakCount} />

        {/* ── Leaderboard ── */}
        <Leaderboard data={leaderboardData} isLoading={leaderboardLoading} />

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { gap: 12 },

  // ── Hero
  hero: {
    alignItems: 'center',
    paddingTop: 36,
    paddingBottom: 32,
    paddingHorizontal: 24,
    gap: 4,
  },
  heroFlame: {
    fontSize: 48,
    lineHeight: 56,
  },
  heroNumber: {
    fontSize: 64,
    fontWeight: '900',
    color: C.textPrimary,
    lineHeight: 72,
    letterSpacing: -2,
  },
  heroStreakLabel: {
    fontSize: 16,
    color: C.textMuted,
    fontWeight: '500',
  },
  heroMotivation: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },

  // ── Stats row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Section card
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  sectionCardNoPad: {
    backgroundColor: C.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    paddingBottom: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
  },
  emptyText: {
    fontSize: 13,
    color: C.textMuted,
    paddingVertical: 8,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },

  // ── Calendar
  calRow: {
    flexDirection: 'row',
    gap: 6,
  },
  calCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  calHeader: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  calDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayNum: {
    fontSize: 11,
    fontWeight: '500',
    color: C.textMuted,
  },
  calLegend: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    marginTop: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.textSecondary },

  // ── Milestone badges
  badgesRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  badgeCard: {
    width: 110,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  badgeEmoji: {
    fontSize: 32,
    lineHeight: 38,
  },
  badgeLockWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
  },
  badgeTier: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Leaderboard
  leaderSep:  { height: 1, backgroundColor: C.border },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 12,
  },
  medal:      { fontSize: 22, width: 32, textAlign: 'center' },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  leaderStreak: { fontSize: 12, color: '#F97316', marginTop: 1 },
  pctPill: {
    backgroundColor: C.successLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  leaderPct: {
    fontSize: 13,
    fontWeight: '800',
    color: C.success,
  },
});
