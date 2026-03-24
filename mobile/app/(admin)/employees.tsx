import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Text, Surface, Searchbar, Button, Chip, TextInput as PaperInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}
function avatarColor(name: string) {
  const c = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#16A34A'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return c[Math.abs(h) % c.length];
}
function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Employee Row ─────────────────────────────────────────────────────────────

function EmployeeRow({ user, onPress }: { user: User; onPress: () => void }) {
  const isActive = user.is_active !== false;
  return (
    <Pressable onPress={onPress}>
      <Surface style={styles.card} elevation={1}>
        <View style={[styles.avatar, { backgroundColor: avatarColor(user.full_name) }]}>
          <Text style={styles.initials}>{getInitials(user.full_name)}</Text>
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{user.full_name}</Text>
            {!isActive && (
              <View style={styles.suspendedBadge}>
                <Text style={styles.suspendedText}>Suspended</Text>
              </View>
            )}
          </View>
          <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
          <Text style={styles.role}>{formatRole(user.role)}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: isActive ? '#10B981' : '#EF4444' }]} />
      </Surface>
    </Pressable>
  );
}

// ─── Add Employee Modal ───────────────────────────────────────────────────────

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

  React.useEffect(() => {
    if (visible) {
      setFullName(''); setEmail(''); setPassword(''); setRole('employee');
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
      <SafeAreaView style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Add Employee</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <MaterialCommunityIcons name="close" size={22} color="#64748B" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent}>
          <Text style={styles.fieldLabel}>Full Name *</Text>
          <PaperInput
            value={fullName} onChangeText={setFullName} placeholder="e.g. Sarah Connor"
            mode="outlined" style={styles.input} outlineColor="#E2E8F0" activeOutlineColor="#4F46E5"
            left={<PaperInput.Icon icon="account-outline" />} disabled={createMutation.isPending}
          />

          <Text style={styles.fieldLabel}>Email *</Text>
          <PaperInput
            value={email} onChangeText={setEmail} placeholder="employee@company.com"
            mode="outlined" style={styles.input} outlineColor="#E2E8F0" activeOutlineColor="#4F46E5"
            keyboardType="email-address" autoCapitalize="none"
            left={<PaperInput.Icon icon="email-outline" />} disabled={createMutation.isPending}
          />

          <Text style={styles.fieldLabel}>Password *</Text>
          <PaperInput
            value={password} onChangeText={setPassword} placeholder="Min. 8 characters"
            mode="outlined" style={styles.input} outlineColor="#E2E8F0" activeOutlineColor="#4F46E5"
            secureTextEntry left={<PaperInput.Icon icon="lock-outline" />} disabled={createMutation.isPending}
          />

          <Text style={styles.fieldLabel}>Role</Text>
          <View style={styles.roleRow}>
            {(['employee', 'supervisor'] as const).map(r => (
              <Pressable
                key={r}
                style={[styles.roleOption, role === r && styles.roleOptionActive]}
                onPress={() => setRole(r)}
              >
                <MaterialCommunityIcons
                  name={r === 'employee' ? 'account' : 'shield-account'}
                  size={16} color={role === r ? '#4F46E5' : '#94A3B8'}
                />
                <Text style={[styles.roleOptionText, role === r && { color: '#4F46E5' }]}>
                  {formatRole(r)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Button
            mode="contained" onPress={handleSubmit}
            loading={createMutation.isPending} disabled={createMutation.isPending}
            style={styles.submitBtn} buttonColor="#4F46E5"
            contentStyle={{ paddingVertical: 4 }}
            labelStyle={{ fontSize: 15, fontWeight: '700' }}
          >
            Create Employee
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeModal({ user, visible, onClose }: { user: User; visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isActive = user.is_active !== false;

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
    const action = isActive ? 'suspend' : 'activate';
    Alert.alert(
      isActive ? 'Suspend Account' : 'Activate Account',
      isActive
        ? `This will prevent ${user.full_name} from logging in. Continue?`
        : `Re-activate ${user.full_name}'s account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isActive ? 'Suspend' : 'Activate', style: isActive ? 'destructive' : 'default', onPress: () => toggleMutation.mutate() },
      ]
    );
  };

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Employee Profile</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <MaterialCommunityIcons name="close" size={22} color="#64748B" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.modalContent, { alignItems: 'center' }]}>
          {/* Avatar */}
          <View style={[styles.avatarLg, { backgroundColor: avatarColor(user.full_name) }]}>
            <Text style={styles.initialsLg}>{getInitials(user.full_name)}</Text>
          </View>

          <Text style={styles.modalName}>{user.full_name}</Text>
          <Text style={styles.modalEmail}>{user.email}</Text>

          <View style={styles.chipRow}>
            <Chip compact style={[styles.roleChip, { backgroundColor: '#EEF2FF' }]} textStyle={{ color: '#4F46E5', fontSize: 12 }}>
              {formatRole(user.role)}
            </Chip>
            <Chip compact style={[styles.roleChip, { backgroundColor: isActive ? '#D1FAE5' : '#FEE2E2' }]} textStyle={{ color: isActive ? '#059669' : '#DC2626', fontSize: 12 }}>
              {isActive ? 'Active' : 'Suspended'}
            </Chip>
          </View>

          {/* Info rows */}
          <Surface style={styles.infoCard} elevation={1}>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="calendar-outline" size={16} color="#94A3B8" />
              <Text style={styles.infoLabel}>Member since</Text>
              <Text style={styles.infoValue}>{joined}</Text>
            </View>
            {user.department && (
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="office-building-outline" size={16} color="#94A3B8" />
                <Text style={styles.infoLabel}>Department</Text>
                <Text style={styles.infoValue}>{user.department}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="fire" size={16} color="#F97316" />
              <Text style={styles.infoLabel}>Current streak</Text>
              <Text style={styles.infoValue}>{user.streak_count ?? 0} days</Text>
            </View>
          </Surface>

          {/* Actions */}
          <View style={{ width: '100%', gap: 10, marginTop: 8 }}>
            <Button
              mode="contained"
              buttonColor={isActive ? '#EF4444' : '#10B981'}
              onPress={confirmToggle}
              loading={toggleMutation.isPending}
              disabled={toggleMutation.isPending}
              icon={isActive ? 'account-cancel' : 'account-check'}
              style={{ borderRadius: 12 }}
              contentStyle={{ paddingVertical: 4 }}
              labelStyle={{ fontWeight: '700' }}
            >
              {isActive ? 'Suspend Account' : 'Activate Account'}
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function EmployeesScreen() {
  const user = useAuthStore(s => s.user);
  const orgId = user?.org_id ?? '';
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filterRole, setFilterRole] = useState<string | null>(null);

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

  const filtered = allUsers.filter(u => {
    const matchSearch = !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !filterRole || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const activeCount = allUsers.filter(u => u.is_active !== false).length;
  const suspendedCount = allUsers.length - activeCount;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Employees</Text>
          <Text style={styles.subtitle}>
            {allUsers.length} total · {activeCount} active{suspendedCount > 0 ? ` · ${suspendedCount} suspended` : ''}
          </Text>
        </View>
      </View>

      <Searchbar
        placeholder="Search by name or email"
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
        inputStyle={{ fontSize: 14 }}
      />

      {/* Role filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {[null, 'employee', 'supervisor', 'org_admin'].map(r => (
          <Chip
            key={r ?? 'all'}
            selected={filterRole === r}
            onPress={() => setFilterRole(r)}
            style={[styles.filterChip, filterRole === r && styles.filterChipActive]}
            textStyle={filterRole === r ? { color: '#4F46E5', fontWeight: '700' } : { color: '#64748B' }}
            compact
          >
            {r ? formatRole(r) : 'All'}
          </Chip>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color="#4F46E5" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} />}
          renderItem={({ item }) => (
            <EmployeeRow user={item} onPress={() => setSelectedUser(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-off-outline" size={56} color="#CBD5E1" />
              <Text style={styles.emptyText}>
                {search || filterRole ? 'No employees match your filter' : 'No employees yet'}
              </Text>
            </View>
          }
        />
      )}

      <Pressable style={styles.fab} onPress={() => setShowAdd(true)}>
        <MaterialCommunityIcons name="account-plus" size={20} color="#FFFFFF" />
        <Text style={styles.fabLabel}>Add Employee</Text>
      </Pressable>

      {selectedUser && (
        <EmployeeModal
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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  subtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  searchbar: { marginHorizontal: 16, marginBottom: 6, borderRadius: 12, backgroundColor: '#FFFFFF' },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterChip: { backgroundColor: '#F1F5F9' },
  filterChipActive: { backgroundColor: '#EEF2FF' },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  card: { borderRadius: 14, padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 },
  suspendedBadge: { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  suspendedText: { fontSize: 10, color: '#DC2626', fontWeight: '700' },
  email: { fontSize: 12, color: '#64748B' },
  role: { fontSize: 11, color: '#4F46E5', fontWeight: '600' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  empty: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: '#4F46E5', borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, gap: 8, shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  // Modal
  modal: { flex: 1, backgroundColor: '#F8FAFC' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 20, gap: 4, paddingBottom: 40 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#FFFFFF', marginBottom: 2 },
  roleRow: { flexDirection: 'row', gap: 10 },
  roleOption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', padding: 12, backgroundColor: '#FFFFFF' },
  roleOptionActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  roleOptionText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  submitBtn: { borderRadius: 12, marginTop: 16 },
  // Detail modal
  avatarLg: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  initialsLg: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  modalName: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginTop: 8 },
  modalEmail: { fontSize: 14, color: '#64748B' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roleChip: { borderRadius: 20 },
  infoCard: { width: '100%', borderRadius: 14, backgroundColor: '#FFFFFF', padding: 4, marginTop: 16, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  infoLabel: { flex: 1, fontSize: 13, color: '#64748B' },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#1E293B' },
});
