import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

// ─── Design Tokens ────────────────────────────────────────────────────────────

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

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function avatarGradient(name: string): [string, string] {
  const gradients: [string, string][] = [
    ['#4F46E5', '#7C3AED'],
    ['#7C3AED', '#A855F7'],
    ['#DB2777', '#EC4899'],
    ['#DC2626', '#EF4444'],
    ['#059669', '#10B981'],
    ['#0284C7', '#0EA5E9'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return gradients[Math.abs(h) % gradients.length];
}

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getRiskLevel(user: User): 'low' | 'medium' | 'high' {
  if (user.is_active === false) return 'high';
  if ((user.streak_count ?? 0) === 0) return 'medium';
  return 'low';
}

// ─── Employee Card ─────────────────────────────────────────────────────────────

function EmployeeCard({ user, onPress }: { user: User; onPress: () => void }) {
  const isActive = user.is_active !== false;
  const risk = getRiskLevel(user);
  const [grad] = useState(() => avatarGradient(user.full_name));

  const riskConfig = {
    low: { color: C.success, bg: C.successLight, label: 'Low Risk' },
    medium: { color: C.warning, bg: C.warningLight, label: 'Med Risk' },
    high: { color: C.danger, bg: C.dangerLight, label: 'High Risk' },
  }[risk];

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(99,102,241,0.08)', borderless: false }}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
    >
      <View style={[
        styles.card,
        risk === 'high' && styles.cardHighRisk,
      ]}>
        {risk === 'high' && <View style={styles.riskBar} />}
        <View style={styles.cardInner}>
          {/* Avatar */}
          <LinearGradient colors={grad} style={styles.avatar}>
            <Text style={styles.initials}>{getInitials(user.full_name)}</Text>
          </LinearGradient>

          {/* Info */}
          <View style={styles.cardInfo}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName} numberOfLines={1}>{user.full_name}</Text>
              {!isActive && (
                <View style={[styles.statusPill, { backgroundColor: C.dangerLight, borderColor: C.danger }]}>
                  <Text style={[styles.statusPillText, { color: C.danger }]}>Suspended</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardEmail} numberOfLines={1}>{user.email}</Text>
            <View style={styles.cardMeta}>
              <View style={styles.deptBadge}>
                <Text style={styles.deptText}>
                  {user.department ?? formatRole(user.role)}
                </Text>
              </View>
            </View>
          </View>

          {/* Right */}
          <View style={styles.cardRight}>
            <View style={[styles.riskPill, { backgroundColor: riskConfig.bg, borderColor: riskConfig.color }]}>
              <Text style={[styles.riskPillText, { color: riskConfig.color }]}>{riskConfig.label}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={C.textMuted} style={{ marginTop: 6 }} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Add Employee Modal ────────────────────────────────────────────────────────

interface AddEmployeeModalProps {
  visible: boolean;
  onClose: () => void;
  orgId: string;
}

function AddEmployeeModal({ visible, onClose, orgId }: AddEmployeeModalProps) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'employee' | 'supervisor'>('employee');
  const [showPw, setShowPw] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setFullName(''); setEmail(''); setPassword(''); setRole('employee'); setShowPw(false);
    }
  }, [visible]);

  const createMutation = useMutation({
    mutationFn: () =>
      usersApi.create({ full_name: fullName.trim(), email: email.trim(), password, org_id: orgId, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to create employee.');
    },
  });

  const handleSubmit = () => {
    if (!fullName.trim()) return Alert.alert('Validation', 'Full name is required.');
    if (!email.trim() || !email.includes('@')) return Alert.alert('Validation', 'Valid email is required.');
    if (password.length < 8) return Alert.alert('Validation', 'Password must be at least 8 characters.');
    createMutation.mutate();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        {/* Modal Header */}
        <View style={styles.modalHeader}>
          <LinearGradient colors={['#1E293B', '#0F172A']} style={StyleSheet.absoluteFill} />
          <View style={styles.modalHeaderContent}>
            <View>
              <Text style={styles.modalTitle}>Add Employee</Text>
              <Text style={styles.modalSubtitle}>Create a new team member account</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalCloseBtn}>
              <MaterialCommunityIcons name="close" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Full Name */}
          <Text style={styles.fieldLabel}>Full Name</Text>
          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="account-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Sarah Connor"
              placeholderTextColor={C.textMuted}
              editable={!createMutation.isPending}
            />
          </View>

          {/* Email */}
          <Text style={styles.fieldLabel}>Email Address</Text>
          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="email-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="employee@company.com"
              placeholderTextColor={C.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!createMutation.isPending}
            />
          </View>

          {/* Password */}
          <Text style={styles.fieldLabel}>Password</Text>
          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="lock-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 8 characters"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showPw}
              editable={!createMutation.isPending}
            />
            <Pressable onPress={() => setShowPw(v => !v)} style={styles.inputIconRight}>
              <MaterialCommunityIcons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
            </Pressable>
          </View>

          {/* Role */}
          <Text style={styles.fieldLabel}>Role</Text>
          <View style={styles.roleRow}>
            {(['employee', 'supervisor'] as const).map(r => {
              const active = role === r;
              return (
                <Pressable
                  key={r}
                  style={[styles.roleOption, active && styles.roleOptionActive]}
                  onPress={() => setRole(r)}
                >
                  <LinearGradient
                    colors={active ? [C.primary, C.primaryDark] : ['transparent', 'transparent']}
                    style={styles.roleIconBg}
                  >
                    <MaterialCommunityIcons
                      name={r === 'employee' ? 'account' : 'shield-account'}
                      size={18}
                      color={active ? '#fff' : C.textMuted}
                    />
                  </LinearGradient>
                  <Text style={[styles.roleOptionText, active && { color: C.textPrimary }]}>
                    {formatRole(r)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={createMutation.isPending}
            style={({ pressed }) => [styles.submitPressable, pressed && { opacity: 0.85 }]}
          >
            <LinearGradient colors={[C.primary, C.primaryDark]} style={styles.submitBtn}>
              {createMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="account-plus" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Create Employee</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Employee Detail Modal ─────────────────────────────────────────────────────

function EmployeeDetailModal({ user, visible, onClose }: { user: User; visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isActive = user.is_active !== false;
  const [grad] = useState(() => avatarGradient(user.full_name));

  const toggleMutation = useMutation({
    mutationFn: () => usersApi.update(user.id, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Action failed.');
    },
  });

  const confirmToggle = () => {
    Alert.alert(
      isActive ? 'Suspend Account' : 'Activate Account',
      isActive
        ? `This will prevent ${user.full_name} from logging in. Continue?`
        : `Re-activate ${user.full_name}'s account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isActive ? 'Suspend' : 'Activate',
          style: isActive ? 'destructive' : 'default',
          onPress: () => toggleMutation.mutate(),
        },
      ]
    );
  };

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  const risk = getRiskLevel(user);
  const riskConfig = {
    low: { color: C.success, bg: C.successLight, label: 'Low Risk', icon: 'shield-check' as const },
    medium: { color: C.warning, bg: C.warningLight, label: 'Medium Risk', icon: 'shield-alert' as const },
    high: { color: C.danger, bg: C.dangerLight, label: 'High Risk', icon: 'shield-off' as const },
  }[risk];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        {/* Modal Header */}
        <View style={styles.modalHeader}>
          <LinearGradient colors={['#1E293B', '#0F172A']} style={StyleSheet.absoluteFill} />
          <View style={styles.modalHeaderContent}>
            <View>
              <Text style={styles.modalTitle}>Employee Profile</Text>
              <Text style={styles.modalSubtitle}>Account details & actions</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalCloseBtn}>
              <MaterialCommunityIcons name="close" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={[styles.modalContent, { alignItems: 'center' }]} showsVerticalScrollIndicator={false}>
          {/* Avatar */}
          <LinearGradient colors={grad} style={styles.detailAvatar}>
            <Text style={styles.detailInitials}>{getInitials(user.full_name)}</Text>
          </LinearGradient>

          <Text style={styles.detailName}>{user.full_name}</Text>
          <Text style={styles.detailEmail}>{user.email}</Text>

          {/* Badges */}
          <View style={styles.badgeRow}>
            <View style={[styles.pill, { backgroundColor: C.purpleLight, borderColor: C.purple }]}>
              <Text style={[styles.pillText, { color: C.purple }]}>{formatRole(user.role)}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: isActive ? C.successLight : C.dangerLight, borderColor: isActive ? C.success : C.danger }]}>
              <Text style={[styles.pillText, { color: isActive ? C.success : C.danger }]}>
                {isActive ? 'Active' : 'Suspended'}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: riskConfig.bg, borderColor: riskConfig.color }]}>
              <MaterialCommunityIcons name={riskConfig.icon} size={11} color={riskConfig.color} />
              <Text style={[styles.pillText, { color: riskConfig.color }]}>{riskConfig.label}</Text>
            </View>
          </View>

          {/* Info rows */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={[styles.infoIconBg, { backgroundColor: C.tealLight }]}>
                <MaterialCommunityIcons name="calendar-outline" size={15} color={C.teal} />
              </View>
              <Text style={styles.infoLabel}>Member since</Text>
              <Text style={styles.infoValue}>{joined}</Text>
            </View>
            {user.department ? (
              <View style={[styles.infoRow, styles.infoRowBorder]}>
                <View style={[styles.infoIconBg, { backgroundColor: C.purpleLight }]}>
                  <MaterialCommunityIcons name="office-building-outline" size={15} color={C.purple} />
                </View>
                <Text style={styles.infoLabel}>Department</Text>
                <Text style={styles.infoValue}>{user.department}</Text>
              </View>
            ) : null}
            <View style={[styles.infoRow, styles.infoRowBorder]}>
              <View style={[styles.infoIconBg, { backgroundColor: 'rgba(249,115,22,0.12)' }]}>
                <MaterialCommunityIcons name="fire" size={15} color="#F97316" />
              </View>
              <Text style={styles.infoLabel}>Current streak</Text>
              <Text style={styles.infoValue}>{user.streak_count ?? 0} days</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={{ width: '100%', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={confirmToggle}
              disabled={toggleMutation.isPending}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <LinearGradient
                colors={isActive ? [C.danger, '#DC2626'] : [C.success, '#059669']}
                style={styles.actionBtn}
              >
                {toggleMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={isActive ? 'account-cancel' : 'account-check'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.actionBtnText}>
                      {isActive ? 'Suspend Account' : 'Activate Account'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'active' | 'inactive' | 'high_risk';

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'high_risk', label: 'High Risk' },
];

export default function EmployeesScreen() {
  const user = useAuthStore(s => s.user);
  const orgId = user?.org_id ?? '';
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data, isLoading, refetch } = useQuery<{ items: User[]; total: number }>({
    queryKey: ['employees', orgId],
    queryFn: () => usersApi.list(orgId).then(r => r.data),
    enabled: !!orgId,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const allUsers = data?.items ?? [];
  const activeCount = allUsers.filter(u => u.is_active !== false).length;
  const suspendedCount = allUsers.length - activeCount;
  const highRiskCount = allUsers.filter(u => getRiskLevel(u) === 'high').length;

  const countMap: Record<FilterKey, number> = {
    all: allUsers.length,
    active: activeCount,
    inactive: suspendedCount,
    high_risk: highRiskCount,
  };

  const filtered = allUsers
    .filter(u => {
      const matchSearch = !search ||
        u.full_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase());
      let matchFilter = true;
      if (filter === 'active') matchFilter = u.is_active !== false;
      else if (filter === 'inactive') matchFilter = u.is_active === false;
      else if (filter === 'high_risk') matchFilter = getRiskLevel(u) === 'high';
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      return riskOrder[getRiskLevel(a)] - riskOrder[getRiskLevel(b)];
    });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <LinearGradient colors={['#1E293B', '#0F172A']} style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerContent}>
            {/* Title row */}
            <View style={styles.headerTop}>
              <Text style={styles.headerTitle}>Employees</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{allUsers.length}</Text>
              </View>
            </View>

            {/* Search bar */}
            <View style={styles.searchBar}>
              <MaterialCommunityIcons name="magnify" size={18} color={C.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search by name or email…"
                placeholderTextColor={C.textMuted}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <MaterialCommunityIcons name="close-circle" size={16} color={C.textMuted} />
                </Pressable>
              )}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Filter chips */}
      <View style={styles.filterWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTER_CHIPS.map(chip => {
            const active = filter === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setFilter(chip.key)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {chip.label}
                  {countMap[chip.key] > 0 ? ` (${countMap[chip.key]})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.loadingText}>Loading employees…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id}
          contentContainerStyle={styles.list}
          style={{ backgroundColor: C.bg }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[C.primary]}
              tintColor={C.primary}
            />
          }
          renderItem={({ item }) => (
            <EmployeeCard user={item} onPress={() => setSelectedUser(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconBg}>
                <MaterialCommunityIcons name="account-group-outline" size={36} color={C.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No employees found</Text>
              <Text style={styles.emptySubtitle}>
                {search || filter !== 'all'
                  ? 'Try adjusting your search or filter'
                  : 'Add your first team member to get started'}
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <Pressable
        style={({ pressed }) => [styles.fabWrapper, pressed && { opacity: 0.9 }]}
        onPress={() => setShowAdd(true)}
      >
        <LinearGradient colors={['#6366F1', '#8B5CF6']} style={styles.fab}>
          <MaterialCommunityIcons name="account-plus" size={22} color="#fff" />
        </LinearGradient>
      </Pressable>

      {selectedUser && (
        <EmployeeDetailModal
          user={selectedUser}
          visible
          onClose={() => setSelectedUser(null)}
        />
      )}

      <AddEmployeeModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        orgId={orgId}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: { paddingBottom: 16 },
  headerContent: { paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5 },
  countBadge: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countBadgeText: { fontSize: 13, fontWeight: '700', color: C.warning },

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.textPrimary, padding: 0 },

  // Filters
  filterWrapper: { backgroundColor: C.bg },
  filterRow: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  filterChip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2,
  },
  filterChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  filterChipText: { fontSize: 13, fontWeight: '600', color: C.textMuted },
  filterChipTextActive: { color: '#fff' },

  // List
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 110, gap: 8 },

  // Card
  card: {
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
    marginBottom: 0,
  },
  cardHighRisk: {
    borderColor: 'rgba(239,68,68,0.25)',
    borderLeftWidth: 3,
    borderLeftColor: C.danger,
  },
  riskBar: { width: 3, position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.danger },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingLeft: 16, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardInfo: { flex: 1, gap: 3 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 15, fontWeight: '700', color: C.textPrimary, flex: 1 },
  cardEmail: { fontSize: 12, color: C.textMuted },
  cardMeta: { flexDirection: 'row', marginTop: 2 },
  deptBadge: {
    backgroundColor: C.tealLight, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  deptText: { fontSize: 11, fontWeight: '600', color: C.teal },
  cardRight: { alignItems: 'flex-end', gap: 2 },

  // Pills
  statusPill: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  riskPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1,
  },
  riskPillText: { fontSize: 11, fontWeight: '700' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '700' },

  // Loading / Empty
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  loadingText: { color: C.textSecondary, fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 72, gap: 12, paddingHorizontal: 40 },
  emptyIconBg: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  emptySubtitle: { fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20 },

  // FAB
  fabWrapper: { position: 'absolute', right: 20, bottom: 28 },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
  },

  // Modal
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHeader: { overflow: 'hidden' },
  modalHeaderContent: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  modalSubtitle: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  modalCloseBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
  },
  modalContent: { padding: 20, paddingBottom: 48, gap: 6 },

  // Form
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border,
  },
  inputIcon: {},
  inputIconRight: { paddingLeft: 4 },
  input: { flex: 1, fontSize: 14, color: C.textPrimary, paddingVertical: 13 },

  // Role selector
  roleRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  roleOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    padding: 12, backgroundColor: C.surface,
  },
  roleOptionActive: { borderColor: C.primary },
  roleIconBg: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  roleOptionText: { fontSize: 13, fontWeight: '600', color: C.textMuted },

  // Submit
  submitPressable: { marginTop: 20 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15,
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Action btn
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14,
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Detail modal
  detailAvatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  detailInitials: { fontSize: 30, fontWeight: '800', color: '#fff' },
  detailName: { fontSize: 22, fontWeight: '800', color: C.textPrimary, marginTop: 10, textAlign: 'center' },
  detailEmail: { fontSize: 14, color: C.textMuted, textAlign: 'center' },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },

  // Info card
  infoCard: {
    width: '100%', backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, marginTop: 20, overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  infoIconBg: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { flex: 1, fontSize: 13, color: C.textMuted },
  infoValue: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
});
