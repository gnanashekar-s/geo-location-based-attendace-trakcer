import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Pressable,
  StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/authStore';
import { attendanceApi } from '@/services/api';
import type { AttendanceStats } from '@/types';

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

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTIF_KEY = 'notif_enabled';
const DARK_KEY  = 'dark_mode_enabled';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#16A34A', '#0891B2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getRiskBadge(risk?: string): { label: string; bg: string; color: string } | null {
  if (!risk) return null;
  if (risk === 'high')   return { label: 'High Risk', bg: C.dangerLight,  color: C.danger  };
  if (risk === 'medium') return { label: 'Med Risk',  bg: C.warningLight, color: C.warning };
  return { label: 'Low Risk', bg: C.successLight, color: C.success };
}

function roleBadgeColors(role: string): { bg: string; text: string } {
  if (role.includes('admin'))   return { bg: 'rgba(99,102,241,0.2)',  text: C.primary };
  if (role === 'supervisor')    return { bg: C.warningLight, text: C.warning };
  return { bg: 'rgba(99,102,241,0.2)', text: C.primary };
}

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Stats column ─────────────────────────────────────────────────────────────

interface StatColProps {
  value: string;
  label: string;
  color: string;
  isLoading?: boolean;
}

function StatCol({ value, label, color, isLoading }: StatColProps) {
  return (
    <View style={s.statCol}>
      {isLoading ? (
        <ActivityIndicator size="small" color={color} style={{ marginVertical: 4 }} />
      ) : (
        <Text style={[s.statValue, { color }]}>{value}</Text>
      )}
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Menu row ─────────────────────────────────────────────────────────────────

interface MenuRowProps {
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  onPress?: () => void;
  rightSlot?: React.ReactNode;
  danger?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function MenuRow({
  icon, iconBg, iconColor, label, onPress,
  rightSlot, danger, isFirst, isLast,
}: MenuRowProps) {
  return (
    <>
      {!isFirst && <View style={s.rowSeparator} />}
      <Pressable
        onPress={onPress}
        android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
        style={({ pressed }) => [
          s.menuRow,
          isFirst  && s.menuRowFirst,
          isLast   && s.menuRowLast,
          pressed  && { opacity: 0.72 },
        ]}
      >
        <View style={[s.menuRowIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
        </View>
        <Text style={[s.menuRowLabel, danger && { color: C.danger }]}>{label}</Text>
        {rightSlot ?? (
          onPress && (
            <MaterialCommunityIcons name="chevron-right" size={20} color={C.textMuted} />
          )
        )}
      </Pressable>
    </>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.sectionBlock}>
      {title.length > 0 && <Text style={s.sectionHeading}>{title}</Text>}
      <View style={s.sectionCard}>{children}</View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkMode, setDarkMode]                         = useState(false);

  // Load persisted preferences
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_KEY).then(v => { if (v !== null) setNotificationsEnabled(v === 'true'); });
    AsyncStorage.getItem(DARK_KEY).then(v  => { if (v !== null) setDarkMode(v === 'true'); });
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

  const initials    = getInitials(user.full_name);
  const avatarColor = getAvatarColor(user.full_name);
  const roleBadge   = roleBadgeColors(user.role);

  const handleLogout = () => {
    logout();
    router.replace('/(auth)/login');
  };

  const streakCount  = stats?.current_streak ?? 0;
  const punctuality  = stats?.punctuality_percentage ?? null;
  const totalCheckins = stats?.total_check_ins ?? null;

  const attendancePct =
    (stats as any)?.attendance_percentage != null
      ? `${Math.round((stats as any).attendance_percentage)}%`
      : totalCheckins !== null
      ? `${totalCheckins} days`
      : '—';

  const riskLevel: string | undefined = (stats as any)?.risk_level;
  const riskBadge = getRiskBadge(riskLevel);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={['#1E1B4B', '#0F172A']}
          style={s.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* Avatar */}
          <LinearGradient
            colors={['#6366F1', '#8B5CF6']}
            style={s.avatarRing}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={s.initials}>{initials}</Text>
          </LinearGradient>

          {/* Name */}
          <Text style={s.heroName}>{user.full_name}</Text>

          {/* Role chip */}
          <View style={[s.rolePill, { backgroundColor: roleBadge.bg }]}>
            <Text style={[s.roleText, { color: roleBadge.text }]}>
              {formatRole(user.role)}
            </Text>
          </View>

          {/* Email */}
          <Text style={s.heroEmail}>{user.email}</Text>

          {/* Stats strip */}
          <View style={s.statsStrip}>
            <StatCol
              value={attendancePct}
              label="ATTENDANCE"
              color={C.primary}
              isLoading={statsLoading}
            />
            <View style={s.statsDivider} />
            <StatCol
              value={String(streakCount)}
              label="STREAK"
              color="#F97316"
              isLoading={statsLoading}
            />
            <View style={s.statsDivider} />
            <StatCol
              value={punctuality !== null ? `${Math.round(punctuality)}%` : '—'}
              label="ON-TIME"
              color={C.success}
              isLoading={statsLoading}
            />
          </View>
        </LinearGradient>

        {/* ── Account section ── */}
        <SectionCard title="Account">
          <MenuRow
            icon="shield-account"
            iconBg="rgba(99,102,241,0.15)"
            iconColor={C.primary}
            label="My Trust Score"
            onPress={() => router.push('/(employee)/trust-score' as any)}
            isFirst
            rightSlot={
              <View style={s.trustRowRight}>
                {riskBadge && (
                  <View style={[s.riskBadge, { backgroundColor: riskBadge.bg }]}>
                    <Text style={[s.riskBadgeText, { color: riskBadge.color }]}>
                      {riskBadge.label}
                    </Text>
                  </View>
                )}
                <MaterialCommunityIcons name="chevron-right" size={20} color={C.textMuted} />
              </View>
            }
          />
          <MenuRow
            icon="calendar-check"
            iconBg={C.tealLight}
            iconColor={C.teal}
            label="Attendance History"
            onPress={() => router.push('/(employee)/history' as any)}
          />
          <MenuRow
            icon="pencil"
            iconBg={C.surface2}
            iconColor={C.textSecondary}
            label="Edit Profile"
            onPress={() => router.push('/(employee)/edit-profile' as any)}
            isLast
          />
        </SectionCard>

        {/* ── Preferences section ── */}
        <SectionCard title="Preferences">
          <MenuRow
            icon="bell-outline"
            iconBg="rgba(245,158,11,0.14)"
            iconColor={C.warning}
            label="Notifications"
            isFirst
            rightSlot={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotifToggle}
                trackColor={{ false: C.surface2, true: `${C.primary}80` }}
                thumbColor={notificationsEnabled ? C.primary : C.textMuted}
                ios_backgroundColor={C.surface2}
              />
            }
          />
          <MenuRow
            icon="eye-off-outline"
            iconBg={C.surface2}
            iconColor={C.textSecondary}
            label="Privacy"
            onPress={() => router.push('/(employee)/privacy' as any)}
            isLast
          />
        </SectionCard>

        {/* ── Sign out section ── */}
        <SectionCard title="">
          <MenuRow
            icon="logout"
            iconBg={C.dangerLight}
            iconColor={C.danger}
            label="Sign Out"
            onPress={handleLogout}
            danger
            isFirst
            isLast
            rightSlot={<View />}
          />
        </SectionCard>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { gap: 0 },

  // ── Hero
  hero: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    gap: 6,
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  initials: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 2,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  heroEmail: {
    fontSize: 13,
    color: C.textMuted,
    marginTop: 2,
  },

  // ── Stats strip
  statsStrip: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 16,
    marginTop: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  statLabel: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statsDivider: {
    width: 1,
    backgroundColor: C.surface2,
    marginVertical: 12,
  },

  // ── Sections
  sectionBlock: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },

  // ── Menu rows
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    gap: 14,
  },
  menuRowFirst: {},
  menuRowLast:  {},
  menuRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: C.textPrimary,
  },
  rowSeparator: {
    height: 1,
    backgroundColor: C.border,
    marginLeft: 68,
  },

  // ── Trust row right slot
  trustRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  riskBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  riskBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
