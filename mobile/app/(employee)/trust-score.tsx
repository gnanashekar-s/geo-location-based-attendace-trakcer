import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiGet } from '@/api/client';
import type { UserRiskProfileResponse } from '@/api/analytics';
import { useAuthStore } from '@/store/authStore';

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

// ─── Risk configuration ───────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

const RISK_GRADIENT: Record<RiskLevel, [string, string]> = {
  low:    ['#064E3B', '#059669'],
  medium: ['#78350F', '#D97706'],
  high:   ['#7F1D1D', '#DC2626'],
};

const RISK_CONFIG: Record<
  RiskLevel,
  {
    label: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    tagBg: string;
    tagColor: string;
  }
> = {
  low:    { label: 'Low Risk',    icon: 'shield-check',  tagBg: C.successLight, tagColor: C.success },
  medium: { label: 'Medium Risk', icon: 'shield-alert',  tagBg: C.warningLight, tagColor: C.warning },
  high:   { label: 'High Risk',   icon: 'shield-off',    tagBg: C.dangerLight,  tagColor: C.danger  },
};

function normaliseRisk(raw: string): RiskLevel {
  if (raw === 'high')   return 'high';
  if (raw === 'medium') return 'medium';
  return 'low';
}

// ─── Flag icon map ────────────────────────────────────────────────────────────

const FLAG_ICON_MAP: Partial<Record<string, React.ComponentProps<typeof MaterialCommunityIcons>['name']>> = {
  BUDDY_PUNCH_SUSPECTED:    'account-multiple-check',
  BUDDY_PUNCH_CONFIRMED:    'account-multiple-check',
  COORDINATE_REPLAY:        'map-marker-off',
  IP_GPS_MISMATCH:          'earth-off',
  TIME_ANOMALY:             'clock-alert-outline',
  RAPID_RECHECKIN:          'refresh-circle',
  EXCESSIVE_DAILY_CHECKINS: 'counter',
  MOCK_LOCATION:            'crosshairs-off',
  VPN_DETECTED:             'vpn',
  PROXY_DETECTED:           'shield-lock-outline',
  TOR_EXIT_NODE:            'incognito',
  IMPOSSIBLE_TRAVEL:        'airplane-alert',
  UNKNOWN_DEVICE:           'devices',
  LOW_GPS_ACCURACY:         'crosshairs-question',
};

function formatFlagLabel(flag: string): string {
  return flag
    .split(':')[0]
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatHour(h: number): string {
  const hours = Math.floor(h);
  const mins  = Math.round((h - hours) * 60);
  const ampm  = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${mins.toString().padStart(2, '0')} ${ampm}`;
}

function flagSeverityColor(flag: string): string {
  if (
    flag.includes('BUDDY')      ||
    flag.includes('MOCK')       ||
    flag.includes('IMPOSSIBLE') ||
    flag.includes('TOR')
  ) return C.danger;
  if (
    flag.includes('VPN')      ||
    flag.includes('PROXY')    ||
    flag.includes('MISMATCH') ||
    flag.includes('REPLAY')
  ) return C.warning;
  return C.primary;
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard({ profile, topInset }: { profile: UserRiskProfileResponse; topInset: number }) {
  const risk = normaliseRisk(profile.risk_level);
  const cfg  = RISK_CONFIG[risk];
  const grad = RISK_GRADIENT[risk];

  const history      = profile.thirty_day_history ?? [];
  const recent       = history.slice(-7);
  const avgScore     = recent.length > 0
    ? recent.reduce((sum, p) => sum + p.avg_score, 0) / recent.length
    : 0;
  const scorePercent = Math.round(avgScore * 100);

  const baseline    = profile.behavioral_baseline;
  const checkinHint = baseline?.mean_checkin_hour !== undefined
    ? `Usual check-in: ${formatHour(baseline.mean_checkin_hour)}`
    : null;

  return (
    <LinearGradient
      colors={grad}
      style={[s.heroCard, { paddingTop: topInset + 16 }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Diagonal-stripe texture overlay */}
      <View style={s.heroPattern} pointerEvents="none">
        {Array.from({ length: 8 }).map((_, i) => (
          <View
            key={i}
            style={[s.heroStripe, { left: i * 52 - 24, transform: [{ rotate: '30deg' }] }]}
          />
        ))}
      </View>

      {/* Shield icon */}
      <View style={s.heroIconWrap}>
        <MaterialCommunityIcons name={cfg.icon} size={56} color="rgba(255,255,255,0.95)" />
      </View>

      <Text style={s.heroSubLabel}>TRUST SCORE</Text>
      <Text style={s.heroRiskLabel}>{cfg.label}</Text>

      <View style={s.heroScorePill}>
        <Text style={s.heroScoreText}>Fraud Index: {scorePercent}%</Text>
      </View>

      {checkinHint && (
        <View style={s.heroBaselineRow}>
          <MaterialCommunityIcons name="clock-outline" size={13} color="rgba(255,255,255,0.7)" />
          <Text style={s.heroBaseline}>{checkinHint}</Text>
        </View>
      )}

      <Text style={s.heroName}>{profile.full_name}</Text>
    </LinearGradient>
  );
}

// ─── 30-day history chart ─────────────────────────────────────────────────────

function HistoryChart({ history }: { history: UserRiskProfileResponse['thirty_day_history'] }) {
  if (!history || history.length === 0) {
    return (
      <View style={s.sectionCard}>
        <Text style={s.sectionTitle}>30-Day History</Text>
        <View style={s.emptyFlagRow}>
          <MaterialCommunityIcons name="chart-bar" size={28} color={C.textMuted} />
          <Text style={s.emptyText}>No history available yet</Text>
        </View>
      </View>
    );
  }

  const maxScore  = Math.max(...history.map(p => p.avg_score), 0.01);
  const MAX_BAR_H = 60;

  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>30-Day History</Text>

      <View style={s.chartArea}>
        {history.map((point, i) => {
          const pct      = point.avg_score / maxScore;
          const barH     = Math.max(pct * MAX_BAR_H, 3);
          const score    = point.avg_score;
          const barColor =
            score >= 0.6  ? C.danger
            : score >= 0.3 ? C.warning
            : C.success;

          const showLabel = i % 7 === 0;
          const dayLabel  = point.date
            ? format(parseISO(point.date), 'dd')
            : `${i + 1}`;

          return (
            <View key={point.date ?? i} style={s.barCol}>
              <View style={{ flex: 1 }} />
              <View style={[s.barFill, { height: barH, backgroundColor: barColor }]} />
              <Text style={s.barLabel} numberOfLines={1}>
                {showLabel ? dayLabel : ''}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={s.chartLegend}>
        {[
          { color: C.success, label: 'Low'    },
          { color: C.warning, label: 'Medium' },
          { color: C.danger,  label: 'High'   },
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

// ─── Flag frequency list ──────────────────────────────────────────────────────

function FlagFrequencyList({ flags }: { flags: UserRiskProfileResponse['flag_frequency'] }) {
  if (!flags || flags.length === 0) {
    return (
      <View style={s.sectionCard}>
        <Text style={s.sectionTitle}>Flag Activity</Text>
        <View style={s.emptyFlagRow}>
          <MaterialCommunityIcons name="shield-check-outline" size={28} color={C.success} />
          <Text style={s.emptyFlagText}>No flags recorded — great work!</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>Flag Activity</Text>
      {flags.map((item, index) => {
        const iconName = FLAG_ICON_MAP[item.flag] ?? 'alert-circle-outline';
        const color    = flagSeverityColor(item.flag);

        return (
          <React.Fragment key={`${item.flag}-${index}`}>
            {index > 0 && <View style={s.flagSeparator} />}
            <View style={s.flagRow}>
              <View style={[s.flagIconWrap, { backgroundColor: `${color}1E` }]}>
                <MaterialCommunityIcons name={iconName} size={18} color={color} />
              </View>
              <Text style={s.flagLabel}>{formatFlagLabel(item.flag)}</Text>
              <View style={[s.flagCountBadge, { backgroundColor: `${color}1E` }]}>
                <Text style={[s.flagCount, { color }]}>{item.count}</Text>
              </View>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ─── Info accordion ───────────────────────────────────────────────────────────

function InfoSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={s.sectionCard}>
      <Pressable
        style={s.infoHeader}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={s.infoHeaderLeft}>
          <View style={[s.infoIconWrap, { backgroundColor: C.purpleLight }]}>
            <MaterialCommunityIcons name="information-outline" size={16} color={C.accent} />
          </View>
          <Text style={s.infoHeaderTitle}>How is this calculated?</Text>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={C.primary}
        />
      </Pressable>
      {expanded && (
        <View style={s.infoBodyWrap}>
          <Text style={s.infoBody}>
            This score reflects how trustworthy your check-in data appears based on GPS
            accuracy, network signals, and behavioral patterns. A low score means your
            check-ins look normal. A higher score indicates signals that may warrant review,
            such as VPN usage, unusual timing, or GPS inconsistencies. Scores are updated
            each time you check in.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TrustScoreScreen() {
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore(s => s.isDemoMode);

  const { data, isLoading, isError, refetch } = useQuery<UserRiskProfileResponse>({
    queryKey: ['analytics', 'my-risk-profile'],
    queryFn: () => {
      if (isDemoMode) {
        return Promise.resolve({
          user_id: 'demo',
          full_name: 'Demo User',
          risk_level: 'low',
          thirty_day_history: [],
          flag_frequency: [],
          behavioral_baseline: { mean_checkin_hour: 8.5, std_hours: 0.5, sample_size: 20 },
        } as UserRiskProfileResponse);
      }
      return apiGet<UserRiskProfileResponse>('/api/v1/analytics/my-risk-profile');
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const handleRequestReview = () => {
    Alert.alert(
      'Request Review',
      'Contact your administrator to dispute this score.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Email Support',
          onPress: () => Linking.openURL('mailto:support@company.com'),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Loading */}
      {isLoading && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.loadingText}>Loading your trust score…</Text>
        </View>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <View style={s.centered}>
          <View style={[s.errorIconWrap, { backgroundColor: C.dangerLight }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={36} color={C.danger} />
          </View>
          <Text style={s.errorText}>Failed to load trust score</Text>
          <Pressable onPress={refetch} style={s.retryBtn}>
            <Text style={s.retryText}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {/* Content */}
      {data && !isLoading && (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero — edge to edge, no horizontal margin */}
          <HeroCard profile={data} topInset={insets.top} />

          <View style={s.contentPad}>
            <HistoryChart history={data.thirty_day_history} />
            <FlagFrequencyList flags={data.flag_frequency} />
            <InfoSection />

            {/* Request Review */}
            <Pressable
              onPress={handleRequestReview}
              style={({ pressed }) => [s.reviewBtn, pressed && { opacity: 0.72 }]}
            >
              <MaterialCommunityIcons name="flag-outline" size={18} color={C.primary} />
              <Text style={s.reviewBtnText}>Request Review</Text>
            </Pressable>

            <View style={{ height: 32 }} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { gap: 0 },

  contentPad: {
    padding: 16,
    paddingTop: 16,
    gap: 12,
  },

  // ── States
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  loadingText: { fontSize: 14, color: C.textSecondary },
  errorIconWrap: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { fontSize: 15, color: C.danger, textAlign: 'center', fontWeight: '600' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.primaryDark,
  },
  retryText: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },

  // ── Hero card (edge to edge)
  heroCard: {
    borderRadius: 0,
    paddingBottom: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    overflow: 'hidden',
    gap: 6,
  },
  heroPattern: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  heroStripe: {
    position: 'absolute',
    width: 2,
    top: -40,
    bottom: -40,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroSubLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  heroRiskLabel: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  heroScorePill: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 2,
  },
  heroScoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
  },
  heroBaselineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  heroBaseline: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  heroName: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },

  // ── Section cards
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 2,
  },
  emptyText: {
    fontSize: 13,
    color: C.textMuted,
    paddingVertical: 6,
  },

  // ── Chart
  chartArea: {
    flexDirection: 'row',
    height: 80,
    alignItems: 'flex-end',
    gap: 2,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: 80,
    gap: 2,
  },
  barFill: {
    flex: 1,
    maxWidth: 8,
    borderRadius: 4,
    minHeight: 3,
    alignSelf: 'center',
  },
  barLabel: {
    fontSize: 7,
    color: C.textMuted,
    fontWeight: '600',
    textAlign: 'center',
    height: 10,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    marginTop: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.textSecondary },

  // ── Flag list
  emptyFlagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  emptyFlagText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  flagSeparator: { height: 1, backgroundColor: C.border },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  flagIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagLabel: {
    flex: 1,
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: '500',
  },
  flagCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 28,
    alignItems: 'center',
  },
  flagCount: {
    fontSize: 13,
    fontWeight: '800',
  },

  // ── Info accordion
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoHeaderTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  infoBodyWrap: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
    marginTop: 2,
  },
  infoBody: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 21,
  },

  // ── Review button
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.primary,
    height: 48,
    marginTop: 4,
  },
  reviewBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.primary,
  },
});
