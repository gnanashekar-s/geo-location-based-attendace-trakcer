import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi, usersApi } from '@/services/api';
import type { AttendanceStats, LeaderboardEntry } from '@/types';

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function FlameAnimation({ streakCount }: { streakCount: number }) {
  const isLegendary = streakCount >= 30;
  const bgColor = streakCount > 0
    ? (isLegendary ? '#FFF7ED' : '#FFFBEB')
    : '#F8FAFC';

  return (
    <View style={[styles.flameContainer, { backgroundColor: bgColor }]}>
      <Text style={styles.flameEmoji}>{streakCount > 0 ? '🔥' : '💤'}</Text>
      <Text style={[styles.streakNumber, { color: streakCount > 0 ? '#EA580C' : '#CBD5E1' }]}>
        {streakCount}
      </Text>
      <Text style={styles.streakLabel}>day streak</Text>
      {isLegendary && <Text style={styles.legendaryBadge}>🏆 Legendary!</Text>}
    </View>
  );
}

function getMotivation(streak: number): string {
  if (streak === 0) return 'Start your streak today! Check in on time to begin.';
  if (streak < 5) return "Great start! Keep going — you're building momentum.";
  if (streak < 15) return "Impressive consistency! You're in the zone. 🔥";
  if (streak < 30) return "Amazing dedication! Almost legendary status!";
  return "You're a punctuality legend! 🏆 Inspiring the whole team.";
}

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

  const streakCount = stats?.current_streak ?? 0;
  const bestStreak = stats?.longest_streak ?? 0;
  const punctuality = stats?.punctuality_percentage ?? null;

  const achievements = [
    { icon: '🔥', label: '7-Day Streak', desc: 'Check in 7 days in a row', unlocked: streakCount >= 7 },
    { icon: '⚡', label: '14-Day Streak', desc: 'Two weeks strong', unlocked: streakCount >= 14 },
    { icon: '🌟', label: '30-Day Streak', desc: 'A full month of dedication', unlocked: streakCount >= 30 },
    { icon: '💎', label: '100% Punctual Month', desc: 'Never late in a month', unlocked: (punctuality ?? 0) >= 100 },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Title */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Streaks & Achievements</Text>
          <View style={styles.titleBadge}>
            <MaterialCommunityIcons name="trophy-outline" size={16} color="#F59E0B" />
          </View>
        </View>

        {/* Flame + Streak Count */}
        <Surface style={styles.card} elevation={1}>
          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#EA580C" size="large" />
            </View>
          ) : (
            <FlameAnimation streakCount={streakCount} />
          )}
          <Text style={styles.motivation}>{getMotivation(streakCount)}</Text>
        </Surface>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          {[
            {
              label: 'This Month',
              value: punctuality !== null ? `${Math.round(punctuality)}%` : '—',
              color: '#10B981',
              icon: 'calendar-month-outline',
            },
            {
              label: 'Current',
              value: String(streakCount),
              color: '#EA580C',
              icon: 'fire',
            },
            {
              label: 'Best Ever',
              value: String(bestStreak),
              color: '#4F46E5',
              icon: 'medal-outline',
            },
          ].map(item => (
            <Surface key={item.label} style={styles.statCard} elevation={0}>
              <View style={[styles.statIcon, { backgroundColor: `${item.color}18` }]}>
                <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={item.color} />
              ) : (
                <Text style={[styles.statValue, { color: item.color }]}>{item.value}</Text>
              )}
              <Text style={styles.statLabel}>{item.label}</Text>
            </Surface>
          ))}
        </View>

        {/* Achievements */}
        <Text style={styles.sectionTitle}>Achievements</Text>
        <Surface style={styles.card} elevation={1}>
          {achievements.map((a, idx) => (
            <View key={a.label} style={[styles.achievement, idx < achievements.length - 1 && styles.achievementBorder]}>
              <View style={[styles.achieveBadge, a.unlocked ? styles.achieveBadgeUnlocked : styles.achieveBadgeLocked]}>
                <Text style={styles.achIcon}>{a.icon}</Text>
              </View>
              <View style={styles.achieveInfo}>
                <Text style={[styles.achLabel, !a.unlocked && styles.lockedText]}>{a.label}</Text>
                <Text style={styles.achDesc}>{a.desc}</Text>
              </View>
              {a.unlocked ? (
                <View style={styles.unlockedBadge}>
                  <MaterialCommunityIcons name="check-circle" size={22} color="#10B981" />
                </View>
              ) : (
                <MaterialCommunityIcons name="lock-outline" size={20} color="#CBD5E1" />
              )}
            </View>
          ))}
        </Surface>

        {/* Leaderboard */}
        <Text style={styles.sectionTitle}>Top Performers</Text>
        <Surface style={styles.card} elevation={1}>
          {leaderboardLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#4F46E5" />
            </View>
          ) : !leaderboardData?.length ? (
            <Text style={[styles.motivation, { padding: 8 }]}>No leaderboard data yet.</Text>
          ) : (
            leaderboardData.map((entry, i) => (
              <View key={entry.id} style={[styles.leaderRow, i < leaderboardData.length - 1 && styles.leaderBorder]}>
                <Text style={styles.medal}>{MEDALS[i] ?? String(i + 1)}</Text>
                <View style={styles.leaderInfo}>
                  <Text style={styles.leaderName}>{entry.full_name}</Text>
                  <Text style={styles.leaderStreak}>🔥 {entry.streak_count} days</Text>
                </View>
                <View style={styles.pctPill}>
                  <Text style={styles.leaderPunctuality}>{Math.round(entry.punctuality_percentage)}%</Text>
                </View>
              </View>
            ))
          )}
        </Surface>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  titleBadge: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    borderRadius: 16, padding: 16, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#F1F5F9',
  },
  loadingBox: { alignItems: 'center', paddingVertical: 32 },
  flameContainer: { alignItems: 'center', paddingVertical: 20, borderRadius: 12 },
  flameEmoji: { fontSize: 72, lineHeight: 80 },
  streakNumber: { fontSize: 52, fontWeight: '900', lineHeight: 60 },
  streakLabel: { fontSize: 15, color: '#9A3412', fontWeight: '600' },
  legendaryBadge: { fontSize: 16, marginTop: 8 },
  motivation: {
    textAlign: 'center', fontSize: 14, color: '#64748B',
    marginTop: 12, paddingHorizontal: 8, lineHeight: 20,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderRadius: 14, padding: 12,
    alignItems: 'center', backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#F1F5F9', gap: 4,
  },
  statIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600', textAlign: 'center' },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: '#94A3B8',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
  },
  achievement: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  achievementBorder: { borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  achieveBadge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  achieveBadgeUnlocked: { backgroundColor: '#F0FDF4' },
  achieveBadgeLocked: { backgroundColor: '#F8FAFC' },
  achIcon: { fontSize: 24 },
  achieveInfo: { flex: 1 },
  achLabel: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  achDesc: { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  lockedText: { color: '#CBD5E1' },
  unlockedBadge: {},
  leaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  leaderBorder: { borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  medal: { fontSize: 22, width: 32, textAlign: 'center' },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  leaderStreak: { fontSize: 12, color: '#EA580C', marginTop: 1 },
  pctPill: {
    backgroundColor: '#D1FAE5', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  leaderPunctuality: { fontSize: 13, fontWeight: '800', color: '#059669' },
});
