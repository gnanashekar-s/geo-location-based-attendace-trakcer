import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Animated,
  TouchableOpacity,
  TextInput as RNTextInput,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { analyticsApi, attendanceApi, usersApi } from '@/services/api';
import {
  useFraudSummary,
  useBuddyPunchIncidents,
  type AnomalyRecord,
  type BuddyPunchIncident,
  type FraudSummaryResponse,
} from '@/api/analytics';

// ─── Design tokens ──────────────────────────────────────────────────────────
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

// ─── Types ───────────────────────────────────────────────────────────────────
type FlagFilter = 'all' | 'VPN_PROXY_DETECTED' | 'MOCK_GPS' | 'IMPOSSIBLE_TRAVEL' | 'NEW_DEVICE';

// ─── Flag pill colours ────────────────────────────────────────────────────────
const FLAG_PILL: Record<string, { bg: string; text: string }> = {
  VPN_PROXY_DETECTED:  { bg: 'rgba(239,68,68,0.18)',   text: '#FCA5A5' },
  MOCK_GPS:            { bg: 'rgba(245,158,11,0.18)',  text: '#FCD34D' },
  IMPOSSIBLE_TRAVEL:   { bg: 'rgba(168,85,247,0.18)',  text: '#D8B4FE' },
  NEW_DEVICE:          { bg: 'rgba(99,102,241,0.18)',  text: '#A5B4FC' },
  LOW_GPS_ACCURACY:    { bg: 'rgba(100,116,139,0.18)', text: '#94A3B8' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function riskColor(score: number) {
  if (score > 0.6) return C.danger;
  if (score > 0.3) return C.warning;
  return C.success;
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function avatarColor(name: string) {
  const palette = ['#6366F1','#8B5CF6','#EC4899','#10B981','#F59E0B','#3B82F6'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % palette.length;
  return palette[h];
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function SkeletonCard({ anim }: { anim: Animated.Value }) {
  return (
    <Animated.View style={[ss.skeletonCard, { opacity: anim }]}>
      <View style={ss.skeletonRow}>
        <View style={ss.skeletonAvatar} />
        <View style={{ flex: 1, gap: 8 }}>
          <View style={[ss.skeletonLine, { width: '60%' }]} />
          <View style={[ss.skeletonLine, { width: '40%' }]} />
        </View>
        <View style={[ss.skeletonLine, { width: 40, height: 28 }]} />
      </View>
      <View style={[ss.skeletonLine, { marginTop: 10 }]} />
      <View style={ss.skeletonRow}>
        <View style={[ss.skeletonLine, { width: 80, height: 22, borderRadius: 11 }]} />
        <View style={[ss.skeletonLine, { width: 60, height: 22, borderRadius: 11 }]} />
      </View>
    </Animated.View>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  gradientColors,
  icon,
  count,
  label,
}: {
  gradientColors: [string, string];
  icon: string;
  count: number | string | undefined;
  label: string;
}) {
  return (
    <LinearGradient colors={gradientColors} style={ss.kpiCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <MaterialCommunityIcons name={icon as any} size={20} color="rgba(255,255,255,0.9)" />
      <Text style={ss.kpiCount}>{count ?? '—'}</Text>
      <Text style={ss.kpiLabel}>{label}</Text>
    </LinearGradient>
  );
}

// ─── Animated flag bar row ────────────────────────────────────────────────────
function FlagBarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: max > 0 ? count / max : 0,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [count, max]);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={ss.flagBarRow}>
      <Text style={ss.flagBarLabel} numberOfLines={1}>
        {label.split(':')[0].replace(/_/g, ' ')}
      </Text>
      <View style={ss.flagBarTrack}>
        <Animated.View style={[ss.flagBarFill, { width }]} />
      </View>
      <View style={ss.flagCountPill}>
        <Text style={ss.flagCountText}>{count}</Text>
      </View>
    </View>
  );
}

// ─── Anomaly list card ────────────────────────────────────────────────────────
function AnomalyCard({ item, onPress }: { item: AnomalyRecord; onPress: () => void }) {
  const score = item.fraud_score;
  const rc = riskColor(score);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [ss.anomalyCard, pressed && { opacity: 0.85 }]}>
      {/* left risk bar */}
      <View style={[ss.riskBar, { backgroundColor: rc }]} />

      <View style={{ flex: 1 }}>
        {/* top row: avatar + name/email + fraud score */}
        <View style={ss.cardTopRow}>
          <View style={[ss.avatar, { backgroundColor: avatarColor(item.user_name) }]}>
            <Text style={ss.avatarText}>{initials(item.user_name)}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={ss.cardName} numberOfLines={1}>{item.user_name}</Text>
            {item.user_email ? (
              <Text style={ss.cardEmail} numberOfLines={1}>{item.user_email}</Text>
            ) : null}
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[ss.fraudScore, { color: rc }]}>{Math.round(score * 100)}</Text>
            <Text style={ss.fraudScoreLabel}>fraud score</Text>
          </View>
        </View>

        {/* flag chips */}
        {item.fraud_flags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={ss.chipsRow}>
              {item.fraud_flags.map(flag => {
                const col = FLAG_PILL[flag] ?? FLAG_PILL['LOW_GPS_ACCURACY'];
                return (
                  <View key={flag} style={[ss.flagPill, { backgroundColor: col.bg }]}>
                    <Text style={[ss.flagPillText, { color: col.text }]}>
                      {flag.replace(/_/g, ' ')}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* time + site */}
        <View style={ss.cardMeta}>
          <MaterialCommunityIcons name="clock-outline" size={12} color={C.textMuted} />
          <Text style={ss.cardMetaText}>
            {format(parseISO(item.created_at), 'dd MMM yyyy HH:mm')}
          </Text>
          {item.site_name ? (
            <>
              <Text style={ss.cardMetaDot}>·</Text>
              <MaterialCommunityIcons name="map-marker-outline" size={12} color={C.textMuted} />
              <Text style={ss.cardMetaText} numberOfLines={1}>{item.site_name}</Text>
            </>
          ) : null}
        </View>

        {/* action buttons */}
        <View style={ss.cardActions}>
          <TouchableOpacity style={ss.btnInvestigate} onPress={onPress}>
            <MaterialCommunityIcons name="magnify" size={13} color={C.warning} />
            <Text style={ss.btnInvestigateText}>Investigate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={ss.btnSafe}
            onPress={() => {
              /* handled in modal */
              onPress();
            }}
          >
            <MaterialCommunityIcons name="shield-check-outline" size={13} color={C.success} />
            <Text style={ss.btnSafeText}>Mark Safe</Text>
          </TouchableOpacity>
          {item.is_resolved && (
            <View style={ss.resolvedBadge}>
              <MaterialCommunityIcons name="check-circle" size={12} color={C.success} />
              <Text style={ss.resolvedText}>Resolved</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function AnomaliesScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FlagFilter>('all');
  const [selected, setSelected] = useState<AnomalyRecord | null>(null);
  const [note, setNote] = useState('');
  const [bpExpanded, setBpExpanded] = useState(false);

  // live pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // skeleton pulse animation
  const skelAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(skelAnim, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(skelAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ─── Data hooks (unchanged) ────────────────────────────────────────────────
  const { data, isLoading } = useQuery<AnomalyRecord[]>({
    queryKey: ['anomalies'],
    queryFn: () => analyticsApi.anomalies().then(r => r.data),
    refetchInterval: 60_000,
  });

  const markSafeMutation = useMutation({
    mutationFn: ({ id, n }: { id: string; n: string }) =>
      attendanceApi.markSafe(id, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      setSelected(null);
      setNote('');
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to mark safe.');
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (userId: string) =>
      usersApi.update(userId, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      setSelected(null);
      setNote('');
      Alert.alert('Done', 'User has been suspended.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to suspend user.');
    },
  });

  const handleMarkSafe = () => {
    if (!selected) return;
    markSafeMutation.mutate({ id: selected.attendance_id, n: note });
  };

  const handleSuspend = () => {
    if (!selected) return;
    Alert.alert(
      'Suspend User',
      `Are you sure you want to suspend ${selected.user_name}? They will not be able to log in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: () => suspendMutation.mutate(selected.user_id),
        },
      ]
    );
  };

  const { data: fraudSummary, isLoading: fraudLoading } = useFraudSummary();
  const { data: buddyPunchIncidents, isLoading: bpLoading } = useBuddyPunchIncidents();

  // ─── Filtering + derived data (unchanged) ─────────────────────────────────
  const items = (data ?? []).filter(a =>
    filter === 'all' ? true : a.fraud_flags.includes(filter)
  );

  const topFlags = (fraudSummary?.flag_breakdown ?? [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxFlagCount = topFlags[0]?.count ?? 1;

  const filterOptions: { label: string; value: FlagFilter }[] = [
    { label: 'All',        value: 'all' },
    { label: 'VPN',        value: 'VPN_PROXY_DETECTED' },
    { label: 'Mock GPS',   value: 'MOCK_GPS' },
    { label: 'Travel',     value: 'IMPOSSIBLE_TRAVEL' },
    { label: 'New Device', value: 'NEW_DEVICE' },
  ];

  // ─── List header ───────────────────────────────────────────────────────────
  const listHeader = (
    <>
      {/* Hero header */}
      <LinearGradient
        colors={['#1C0A1C', '#0F172A']}
        style={ss.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={ss.heroTitle}>Fraud Monitor</Text>
          <Text style={ss.heroSubtitle}>Real-time threat detection</Text>
        </View>
        <View style={ss.liveIndicator}>
          <Animated.View style={[ss.liveDot, { opacity: pulseAnim }]} />
          <Text style={ss.liveText}>LIVE</Text>
        </View>
      </LinearGradient>

      {/* KPI strip */}
      {fraudLoading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
      ) : (
        <View style={ss.kpiRow}>
          <KpiCard
            gradientColors={['#DC2626', '#EF4444']}
            icon="shield-alert"
            count={fraudSummary?.total_flagged_today}
            label="FLAGGED TODAY"
          />
          <KpiCard
            gradientColors={['#D97706', '#F59E0B']}
            icon="alert-octagon"
            count={fraudSummary?.high_risk_user_count}
            label="HIGH RISK"
          />
          <KpiCard
            gradientColors={['#7C3AED', '#A855F7']}
            icon="account-group"
            count={buddyPunchIncidents?.length}
            label="BUDDY PUNCH"
          />
        </View>
      )}

      {/* Flag breakdown */}
      <View style={ss.sectionCard}>
        <Text style={ss.sectionTitle}>Top Fraud Signals</Text>
        {topFlags.length === 0 ? (
          <Text style={ss.emptyHint}>No fraud flags recorded today</Text>
        ) : (
          topFlags.map(f => (
            <FlagBarRow
              key={f.flag}
              label={f.flag}
              count={f.count}
              max={maxFlagCount}
            />
          ))
        )}
      </View>

      {/* Buddy punch collapsible */}
      <View style={ss.sectionCard}>
        <Pressable style={ss.bpHeader} onPress={() => setBpExpanded(v => !v)}>
          <View style={ss.bpHeaderLeft}>
            <View style={ss.bpIconWrap}>
              <MaterialCommunityIcons name="account-group" size={16} color={C.purple} />
            </View>
            <Text style={ss.sectionTitle}>Buddy Punch Incidents</Text>
          </View>
          <View style={ss.bpHeaderRight}>
            {bpLoading ? (
              <ActivityIndicator size="small" color={C.purple} />
            ) : (
              <>
                {(buddyPunchIncidents?.length ?? 0) > 0 && (
                  <View style={ss.bpCountBadge}>
                    <Text style={ss.bpCountText}>{buddyPunchIncidents!.length}</Text>
                  </View>
                )}
                <MaterialCommunityIcons
                  name={bpExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={C.textMuted}
                />
              </>
            )}
          </View>
        </Pressable>

        {bpExpanded && (
          !buddyPunchIncidents?.length ? (
            <Text style={[ss.emptyHint, { paddingVertical: 12 }]}>
              No buddy punch incidents detected
            </Text>
          ) : (
            buddyPunchIncidents.slice(0, 5).map((inc, idx) => (
              <View key={idx} style={ss.bpIncidentCard}>
                <View style={ss.bpIncidentTop}>
                  <Text style={ss.bpSiteName} numberOfLines={1}>{inc.site_name}</Text>
                  <View style={ss.bpDistPill}>
                    <Text style={ss.bpDistText}>{Math.round(inc.distance_meters)}m apart</Text>
                  </View>
                </View>
                <Text style={ss.bpTime}>
                  {format(parseISO(inc.incident_time), 'dd MMM HH:mm')}
                </Text>
                <View style={ss.bpUserChips}>
                  {inc.users.map((u, i) => (
                    <View key={i} style={ss.bpUserChip}>
                      <Text style={ss.bpUserChipText}>{u.full_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )
        )}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={ss.filtersContent}
        style={ss.filtersScroll}
      >
        {filterOptions.map(f => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.value}
              style={[ss.filterChip, active && ss.filterChipActive]}
              onPress={() => setFilter(f.value)}
            >
              <Text style={[ss.filterChipText, active && ss.filterChipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* count label */}
      <Text style={ss.listCountLabel}>
        {items.length} {items.length === 1 ? 'anomaly' : 'anomalies'} found
      </Text>
    </>
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={ss.container} edges={['top']}>
      {isLoading ? (
        <FlatList
          data={[1, 2, 3]}
          keyExtractor={i => String(i)}
          contentContainerStyle={ss.listContent}
          ListHeaderComponent={listHeader}
          renderItem={() => <SkeletonCard anim={skelAnim} />}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={a => a.attendance_id}
          contentContainerStyle={ss.listContent}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => (
            <AnomalyCard item={item} onPress={() => setSelected(item)} />
          )}
          ListEmptyComponent={
            <View style={ss.emptyState}>
              <View style={ss.emptyIconWrap}>
                <MaterialCommunityIcons name="shield-check" size={64} color={C.success} />
              </View>
              <Text style={ss.emptyTitle}>System Clean</Text>
              <Text style={ss.emptySubtitle}>No anomalies detected</Text>
            </View>
          }
        />
      )}

      {/* ─── Detail / Action Modal ─────────────────────────────────────────── */}
      {selected && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setSelected(null)}
        >
          <SafeAreaView style={ss.modal}>
            {/* modal header */}
            <LinearGradient colors={['#1C0A1C', '#1E293B']} style={ss.modalHero}>
              <View style={{ flex: 1 }}>
                <Text style={ss.modalTitle}>Anomaly Detail</Text>
                <Text style={ss.modalSubtitle}>
                  {format(parseISO(selected.created_at), 'EEEE, dd MMM yyyy HH:mm')}
                </Text>
              </View>
              <Pressable style={ss.modalClose} onPress={() => setSelected(null)}>
                <MaterialCommunityIcons name="close" size={20} color={C.textSecondary} />
              </Pressable>
            </LinearGradient>

            <ScrollView contentContainerStyle={ss.modalBody} keyboardShouldPersistTaps="handled">
              {/* user */}
              <View style={ss.modalUserRow}>
                <View style={[ss.avatar, ss.avatarLg, { backgroundColor: avatarColor(selected.user_name) }]}>
                  <Text style={ss.avatarTextLg}>{initials(selected.user_name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ss.modalName}>{selected.user_name}</Text>
                  {selected.user_email ? (
                    <Text style={ss.modalEmail}>{selected.user_email}</Text>
                  ) : null}
                </View>
                <View>
                  <Text style={[ss.modalScore, { color: riskColor(selected.fraud_score) }]}>
                    {Math.round(selected.fraud_score * 100)}
                  </Text>
                  <Text style={ss.modalScoreLabel}>risk</Text>
                </View>
              </View>

              {/* fraud score bar */}
              <Text style={ss.modalSectionLabel}>FRAUD SCORE</Text>
              <View style={ss.modalBarBg}>
                <View
                  style={[
                    ss.modalBarFill,
                    {
                      width: `${Math.min(selected.fraud_score * 100, 100)}%`,
                      backgroundColor: riskColor(selected.fraud_score),
                    },
                  ]}
                />
              </View>

              {/* flags */}
              <Text style={ss.modalSectionLabel}>FLAGS DETECTED</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={ss.chipsRow}>
                  {selected.fraud_flags.map(flag => {
                    const col = FLAG_PILL[flag] ?? FLAG_PILL['LOW_GPS_ACCURACY'];
                    return (
                      <View key={flag} style={[ss.flagPill, { backgroundColor: col.bg }]}>
                        <Text style={[ss.flagPillText, { color: col.text }]}>
                          {flag.replace(/_/g, ' ')}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              {/* investigator note */}
              <Text style={ss.modalSectionLabel}>INVESTIGATOR NOTES</Text>
              <RNTextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a note about this investigation..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
                style={ss.noteInput}
                textAlignVertical="top"
              />

              {/* actions */}
              <View style={ss.modalActions}>
                <TouchableOpacity
                  style={[ss.modalBtn, ss.modalBtnSafe, (markSafeMutation.isPending || suspendMutation.isPending) && { opacity: 0.5 }]}
                  onPress={handleMarkSafe}
                  disabled={markSafeMutation.isPending || suspendMutation.isPending}
                >
                  {markSafeMutation.isPending ? (
                    <ActivityIndicator size="small" color={C.success} />
                  ) : (
                    <MaterialCommunityIcons name="shield-check" size={16} color={C.success} />
                  )}
                  <Text style={ss.modalBtnSafeText}>Mark Safe</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[ss.modalBtn, ss.modalBtnSuspend, (markSafeMutation.isPending || suspendMutation.isPending) && { opacity: 0.5 }]}
                  onPress={handleSuspend}
                  disabled={markSafeMutation.isPending || suspendMutation.isPending}
                >
                  {suspendMutation.isPending ? (
                    <ActivityIndicator size="small" color={C.danger} />
                  ) : (
                    <MaterialCommunityIcons name="account-cancel" size={16} color={C.danger} />
                  )}
                  <Text style={ss.modalBtnSuspendText}>Suspend User</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // ── Hero
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 22,
    minHeight: 120,
  },
  heroTitle:    { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.2 },
  heroSubtitle: { fontSize: 12, color: C.textMuted, marginTop: 3 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger },
  liveText: { fontSize: 10, fontWeight: '700', color: C.danger, letterSpacing: 1 },

  // ── KPI strip
  kpiRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginTop: 16, marginBottom: 14 },
  kpiCard: {
    flex: 1, height: 80, borderRadius: 14, alignItems: 'center',
    justifyContent: 'center', gap: 3, paddingHorizontal: 6,
  },
  kpiCount: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  kpiLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  // ── Section cards
  sectionCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: C.surface, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: C.border,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary, marginBottom: 12 },
  emptyHint: { fontSize: 12, color: C.textMuted, textAlign: 'center' },

  // ── Flag bars
  flagBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  flagBarLabel: { fontSize: 11, color: C.textSecondary, width: 108 },
  flagBarTrack: { flex: 1, height: 6, backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden' },
  flagBarFill:  { height: 6, backgroundColor: C.danger, borderRadius: 3 },
  flagCountPill: {
    minWidth: 26, paddingHorizontal: 6, height: 20, borderRadius: 10,
    backgroundColor: C.dangerLight, alignItems: 'center', justifyContent: 'center',
  },
  flagCountText: { fontSize: 10, fontWeight: '700', color: C.danger },

  // ── Buddy punch
  bpHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  bpHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bpHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bpIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.purpleLight, alignItems: 'center', justifyContent: 'center',
  },
  bpCountBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.purpleLight,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  bpCountText: { fontSize: 10, fontWeight: '700', color: C.purple },

  bpIncidentCard: {
    backgroundColor: C.surface2, borderRadius: 12, padding: 12,
    marginTop: 10, gap: 5,
  },
  bpIncidentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bpSiteName:   { fontSize: 13, fontWeight: '700', color: C.textPrimary, flex: 1, marginRight: 8 },
  bpDistPill:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: C.purpleLight },
  bpDistText:   { fontSize: 10, fontWeight: '600', color: C.purple },
  bpTime:       { fontSize: 11, color: C.textMuted },
  bpUserChips:  { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  bpUserChip:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: C.surface },
  bpUserChipText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' },

  // ── Filter bar
  filtersScroll: { marginBottom: 6 },
  filtersContent: { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingVertical: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText:       { fontSize: 12, fontWeight: '600', color: C.textSecondary },
  filterChipTextActive: { color: '#FFFFFF' },
  listCountLabel: { fontSize: 11, color: C.textMuted, paddingHorizontal: 20, paddingBottom: 10 },

  // ── List
  listContent: { paddingHorizontal: 16, gap: 10, paddingBottom: 32 },

  // ── Anomaly card
  anomalyCard: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
    marginBottom: 2,
  },
  riskBar: { width: 4 },

  // inner padding
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingBottom: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  cardName:  { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  cardEmail: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  fraudScore:      { fontSize: 22, fontWeight: '900', lineHeight: 24 },
  fraudScoreLabel: { fontSize: 9, color: C.textMuted, textTransform: 'uppercase', textAlign: 'right' },

  chipsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  flagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  flagPillText: { fontSize: 10, fontWeight: '600' },

  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, marginTop: 8 },
  cardMetaText: { fontSize: 11, color: C.textMuted },
  cardMetaDot:  { fontSize: 11, color: C.textMuted },

  cardActions: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 12,
    paddingTop: 10, paddingBottom: 12, alignItems: 'center',
  },
  btnInvestigate: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 32, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: `${C.warning}55`,
  },
  btnInvestigateText: { fontSize: 11, fontWeight: '600', color: C.warning },
  btnSafe: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 32, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: `${C.success}55`,
  },
  btnSafeText: { fontSize: 11, fontWeight: '600', color: C.success },
  resolvedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, height: 24, borderRadius: 12,
    backgroundColor: C.successLight, marginLeft: 4,
  },
  resolvedText: { fontSize: 10, fontWeight: '700', color: C.success },

  // ── Empty state
  emptyState:   { alignItems: 'center', paddingTop: 64, paddingBottom: 32, gap: 10 },
  emptyIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: C.successLight, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.success, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 20, elevation: 8,
  },
  emptyTitle:    { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  emptySubtitle: { fontSize: 13, color: C.textMuted },

  // ── Skeleton
  skeletonCard: {
    backgroundColor: C.surface, borderRadius: 16,
    padding: 16, gap: 12, marginBottom: 2,
    borderWidth: 1, borderColor: C.border,
  },
  skeletonRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2 },
  skeletonLine:  { height: 12, borderRadius: 6, backgroundColor: C.surface2, width: '100%' },

  // ── Modal
  modal: { flex: 1, backgroundColor: C.bg },
  modalHero: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
  },
  modalTitle:    { fontSize: 18, fontWeight: '800', color: C.textPrimary },
  modalSubtitle: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  modalClose: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
  },
  modalBody: { padding: 16, gap: 14 },

  modalUserRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarLg:     { width: 48, height: 48, borderRadius: 24 },
  avatarTextLg: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  modalName:  { fontSize: 18, fontWeight: '800', color: C.textPrimary },
  modalEmail: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  modalScore:      { fontSize: 32, fontWeight: '900', textAlign: 'right' },
  modalScoreLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase', textAlign: 'right' },

  modalSectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
  },
  modalBarBg:   { height: 8, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  modalBarFill: { height: 8, borderRadius: 4 },

  noteInput: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    color: C.textPrimary, fontSize: 13, borderWidth: 1, borderColor: C.border,
    minHeight: 90,
  },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 46, borderRadius: 12, borderWidth: 1.5,
  },
  modalBtnSafe:        { borderColor: `${C.success}66`, backgroundColor: C.successLight },
  modalBtnSafeText:    { fontSize: 13, fontWeight: '700', color: C.success },
  modalBtnSuspend:     { borderColor: `${C.danger}66`, backgroundColor: C.dangerLight },
  modalBtnSuspendText: { fontSize: 13, fontWeight: '700', color: C.danger },
});
