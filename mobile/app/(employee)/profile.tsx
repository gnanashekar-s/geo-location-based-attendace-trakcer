import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Switch, ActivityIndicator, Pressable } from 'react-native';
import { Text, Surface, Button, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/authStore';
import { attendanceApi } from '@/services/api';
import type { AttendanceStats } from '@/types';

const NOTIF_KEY = 'notif_enabled';
const DARK_KEY = 'dark_mode_enabled';

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#16A34A', '#0891B2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function roleBadgeColor(role: string) {
  if (role.includes('admin')) return { bg: '#EDE9FE', text: '#5B21B6' };
  if (role === 'supervisor') return { bg: '#FEF3C7', text: '#92400E' };
  return { bg: '#DCFCE7', text: '#166534' };
}

function RoleLabel({ role }: { role: string }) {
  const { bg, text } = roleBadgeColor(role);
  const label = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <View style={[styles.rolePill, { backgroundColor: bg }]}>
      <Text style={[styles.roleText, { color: text }]}>{label}</Text>
    </View>
  );
}

function SettingRow({ icon, label, right }: { icon: string; label: string; right: React.ReactNode }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIconWrap}>
        <MaterialCommunityIcons name={icon as any} size={20} color="#4F46E5" />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {right}
    </View>
  );
}

interface StatCardProps {
  icon: string;
  iconColor: string;
  value: string;
  label: string;
  isLoading?: boolean;
}

function StatCard({ icon, iconColor, value, label, isLoading }: StatCardProps) {
  return (
    <Surface style={styles.statCard} elevation={0}>
      <View style={[styles.statIconWrap, { backgroundColor: `${iconColor}18` }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={iconColor} />
      </View>
      {isLoading ? (
        <ActivityIndicator size="small" color={iconColor} style={{ marginVertical: 4 }} />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
      <Text style={styles.statLabel}>{label}</Text>
    </Surface>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Load persisted preferences
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_KEY).then((v) => {
      if (v !== null) setNotificationsEnabled(v === 'true');
    });
    AsyncStorage.getItem(DARK_KEY).then((v) => {
      if (v !== null) setDarkMode(v === 'true');
    });
  }, []);

  const handleNotifToggle = (value: boolean) => {
    setNotificationsEnabled(value);
    AsyncStorage.setItem(NOTIF_KEY, String(value));
  };

  const handleDarkModeToggle = (value: boolean) => {
    setDarkMode(value);
    AsyncStorage.setItem(DARK_KEY, String(value));
  };

  const { data: stats, isLoading: statsLoading } = useQuery<AttendanceStats>({
    queryKey: ['attendance', 'stats'],
    queryFn: () => attendanceApi.stats().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  if (!user) return null;

  const initials = getInitials(user.full_name);
  const avatarColor = getAvatarColor(user.full_name);

  const handleLogout = () => {
    logout();
    router.replace('/(auth)/login');
  };

  const totalCheckins = stats?.total_check_ins ?? null;
  const streakCount = stats?.current_streak ?? 0;
  const punctuality = stats?.punctuality_percentage ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Avatar + Name Card */}
        <Surface style={styles.profileCard} elevation={2}>
          <View style={[styles.avatarOuter, { borderColor: `${avatarColor}40` }]}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.fullName}>{user.full_name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <RoleLabel role={user.role} />

          {user.org_id && (
            <View style={styles.orgRow}>
              <MaterialCommunityIcons name="office-building-outline" size={13} color="#94A3B8" />
              <Text style={styles.orgText}>Organisation ID: {user.org_id.slice(0, 8)}…</Text>
            </View>
          )}
        </Surface>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatCard
            icon="calendar-check-outline"
            iconColor="#4F46E5"
            value={totalCheckins !== null ? String(totalCheckins) : '—'}
            label="Check-ins"
            isLoading={statsLoading}
          />
          <StatCard
            icon="fire"
            iconColor="#EA580C"
            value={String(streakCount)}
            label="Streak"
            isLoading={statsLoading}
          />
          <StatCard
            icon="clock-check-outline"
            iconColor="#10B981"
            value={punctuality !== null ? `${Math.round(punctuality)}%` : '—'}
            label="On-time"
            isLoading={statsLoading}
          />
        </View>

        {/* Monthly Summary */}
        {stats && (
          <Surface style={styles.summaryCard} elevation={1}>
            <Text style={styles.sectionTitle}>Attendance Summary</Text>
            <View style={styles.summaryGrid}>
              {[
                { label: 'Total Days', value: stats.total_check_ins, color: '#4F46E5' },
                { label: 'Late', value: stats.late_count, color: '#F59E0B' },
                { label: 'Absent', value: stats.absent_count, color: '#EF4444' },
              ].map(item => (
                <View key={item.label} style={styles.summaryItem}>
                  <View style={[styles.summaryDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.summaryValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </Surface>
        )}

        {/* Settings */}
        <Surface style={styles.settingsCard} elevation={1}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <Divider style={styles.divider} />
          <SettingRow
            icon="bell-outline"
            label="Push Notifications"
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotifToggle}
                trackColor={{ false: '#E2E8F0', true: '#C7D2FE' }}
                thumbColor={notificationsEnabled ? '#4F46E5' : '#94A3B8'}
              />
            }
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="weather-night"
            label="Dark Mode"
            right={
              <Switch
                value={darkMode}
                onValueChange={handleDarkModeToggle}
                trackColor={{ false: '#E2E8F0', true: '#C7D2FE' }}
                thumbColor={darkMode ? '#4F46E5' : '#94A3B8'}
              />
            }
          />
          <Divider style={styles.divider} />
          <Pressable onPress={() => router.push('/(employee)/privacy' as any)}>
            <SettingRow
              icon="shield-check-outline"
              label="Privacy & Security"
              right={<MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />}
            />
          </Pressable>
          <Divider style={styles.divider} />
          <SettingRow
            icon="information-outline"
            label="App Version"
            right={<Text style={styles.versionText}>1.0.0</Text>}
          />
        </Surface>

        {/* Logout */}
        <Button
          mode="contained"
          buttonColor="#FEE2E2"
          textColor="#DC2626"
          style={styles.logoutBtn}
          icon="logout-variant"
          onPress={handleLogout}
          contentStyle={{ paddingVertical: 4 }}
          labelStyle={{ fontSize: 15, fontWeight: '700' }}
        >
          Sign Out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  profileCard: {
    borderRadius: 20,
    padding: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    gap: 6,
  },
  avatarOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  fullName: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginTop: 2 },
  email: { fontSize: 13, color: '#64748B' },
  rolePill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, marginTop: 2 },
  roleText: { fontSize: 12, fontWeight: '700' },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  orgText: { fontSize: 11, color: '#94A3B8' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  statLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600', textAlign: 'center' },
  summaryCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  summaryItem: { alignItems: 'center', gap: 4 },
  summaryDot: { width: 10, height: 10, borderRadius: 5 },
  summaryValue: { fontSize: 22, fontWeight: '800' },
  summaryLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
  settingsCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  divider: { backgroundColor: '#F8FAFC', marginVertical: 2 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 12,
  },
  settingIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: { flex: 1, fontSize: 15, color: '#1E293B', fontWeight: '500' },
  versionText: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
  logoutBtn: { borderRadius: 14, marginTop: 4 },
});
