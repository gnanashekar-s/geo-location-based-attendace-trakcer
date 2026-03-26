import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  Pressable,
  Animated,
  StatusBar,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { format, subDays, subMonths, isValid, parseISO } from 'date-fns';
import { analyticsApi } from '@/services/api';

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

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'attendance' | 'fraud' | 'department' | 'individual';
type ExportStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

interface ReportCardConfig {
  key: ReportType;
  label: string;
  subtitle: string;
  icon: string;
  gradColors: [string, string];
}

interface RecentExport {
  id: string;
  name: string;
  date: string;
  type: 'pdf' | 'excel';
}

// ─── Report card configs ──────────────────────────────────────────────────────

const REPORT_CARDS: ReportCardConfig[] = [
  {
    key: 'attendance',
    label: 'Attendance Summary',
    subtitle: 'Daily & weekly overview',
    icon: 'calendar-check',
    gradColors: ['#0D9488', '#14B8A6'],
  },
  {
    key: 'fraud',
    label: 'Fraud Report',
    subtitle: 'Anomaly detection',
    icon: 'shield-alert',
    gradColors: ['#DC2626', '#EF4444'],
  },
  {
    key: 'department',
    label: 'Dept Analytics',
    subtitle: 'Team performance',
    icon: 'chart-bar',
    gradColors: ['#4F46E5', '#6366F1'],
  },
  {
    key: 'individual',
    label: 'Individual',
    subtitle: 'Per-employee detail',
    icon: 'account-details',
    gradColors: ['#7C3AED', '#A855F7'],
  },
];

// ─── Mock recent exports ──────────────────────────────────────────────────────

const RECENT_EXPORTS: RecentExport[] = [
  { id: '1', name: 'Attendance_Mar2026.pdf', date: 'Mar 25, 2026', type: 'pdf' },
  { id: '2', name: 'Fraud_Report_Q1.xlsx', date: 'Mar 20, 2026', type: 'excel' },
  { id: '3', name: 'Dept_Analytics_Feb.pdf', date: 'Mar 1, 2026', type: 'pdf' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapReportTypeToApi(rt: ReportType): 'daily' | 'weekly' | 'monthly' | 'anomalies' {
  if (rt === 'fraud') return 'anomalies';
  if (rt === 'department') return 'monthly';
  if (rt === 'individual') return 'weekly';
  return 'daily';
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const [reportType, setReportType] = useState<ReportType>('attendance');
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showRangePicker, setShowRangePicker] = useState(false);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animated progress bar
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (exportStatus === 'pending') {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 0.85,
        duration: 15000,
        useNativeDriver: false,
      }).start();
    } else if (exportStatus === 'ready') {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }).start();
    } else {
      progressAnim.setValue(0);
    }
  }, [exportStatus]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const startPolling = (id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await analyticsApi.exportStatus(id);
        const { status, download_url } = res.data as any;
        if (status === 'ready') {
          setExportStatus('ready');
          setDownloadUrl(download_url ?? null);
          stopPolling();
        } else if (status === 'failed') {
          setExportStatus('failed');
          stopPolling();
        }
      } catch {
        setExportStatus('failed');
        stopPolling();
      }
    }, 5000);
  };

  const exportMutation = useMutation({
    mutationFn: () => {
      const from = format(startDate, 'yyyy-MM-dd');
      const to = format(endDate, 'yyyy-MM-dd');
      return analyticsApi.export(from, to, mapReportTypeToApi(reportType));
    },
    onSuccess: (res: any) => {
      const id = res?.data?.task_id;
      if (id) {
        setTaskId(id);
        setExportStatus('pending');
        setDownloadUrl(null);
        startPolling(id);
      } else {
        setExportStatus('queued');
      }
    },
    onError: (err: any) => {
      Alert.alert('Export Failed', err?.response?.data?.detail ?? err?.message ?? 'Failed to start export.');
    },
  });

  const handleGenerate = () => {
    setExportStatus('idle');
    setDownloadUrl(null);
    setTaskId(null);
    stopPolling();
    exportMutation.mutate();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <LinearGradient colors={['#1E293B', '#0F172A']} style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Reports</Text>
            <Text style={styles.headerSubtitle}>Export & Analytics</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Report type grid */}
        <Text style={styles.sectionLabel}>Report Type</Text>
        <View style={styles.grid}>
          {REPORT_CARDS.map(card => {
            const active = reportType === card.key;
            return (
              <Pressable
                key={card.key}
                onPress={() => setReportType(card.key)}
                style={({ pressed }) => [styles.gridCardWrapper, pressed && { opacity: 0.88 }]}
              >
                <View style={[styles.gridCard, active && styles.gridCardActive]}>
                  <LinearGradient colors={card.gradColors} style={styles.gridIconBg}>
                    <MaterialCommunityIcons name={card.icon as any} size={26} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.gridCardLabel} numberOfLines={2}>{card.label}</Text>
                  <Text style={styles.gridCardSub} numberOfLines={1}>{card.subtitle}</Text>
                  {active && (
                    <View style={styles.gridCheckBadge}>
                      <MaterialCommunityIcons name="check-circle" size={16} color={C.primary} />
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Date range */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Date Range</Text>
        <View style={styles.dateRow}>
          <Pressable
            style={({ pressed }) => [styles.datePill, pressed && { opacity: 0.85 }]}
            onPress={() => setShowRangePicker(true)}
          >
            <MaterialCommunityIcons name="calendar-outline" size={15} color={C.primary} />
            <Text style={styles.datePillText}>{format(startDate, 'MMM d')}</Text>
          </Pressable>

          <MaterialCommunityIcons name="arrow-right" size={16} color={C.textMuted} />

          <Pressable
            style={({ pressed }) => [styles.datePill, pressed && { opacity: 0.85 }]}
            onPress={() => setShowRangePicker(true)}
          >
            <MaterialCommunityIcons name="calendar-outline" size={15} color={C.primary} />
            <Text style={styles.datePillText}>{format(endDate, 'MMM d, yyyy')}</Text>
          </Pressable>
        </View>

        <Modal visible={showRangePicker} transparent animationType="fade" onRequestClose={() => setShowRangePicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowRangePicker(false)}>
            <View style={styles.rangeModal}>
              <Text style={styles.rangeModalTitle}>Select Date Range</Text>
              {[
                { label: 'Last 7 days', days: 7 },
                { label: 'Last 14 days', days: 14 },
                { label: 'Last 30 days', days: 30 },
                { label: 'Last 3 months', days: 90 },
                { label: 'Last 6 months', days: 180 },
              ].map(({ label, days }) => (
                <TouchableOpacity
                  key={days}
                  style={styles.rangeOption}
                  onPress={() => {
                    setStartDate(subDays(new Date(), days));
                    setEndDate(new Date());
                    setShowRangePicker(false);
                  }}
                >
                  <Text style={styles.rangeOptionText}>{label}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={C.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Generate button */}
        <Pressable
          onPress={handleGenerate}
          disabled={exportMutation.isPending || exportStatus === 'pending'}
          style={({ pressed }) => [styles.generateWrapper, pressed && { opacity: 0.85 }]}
        >
          <LinearGradient
            colors={exportMutation.isPending || exportStatus === 'pending'
              ? [C.surface2, C.surface2]
              : ['#6366F1', '#8B5CF6']}
            style={styles.generateBtn}
          >
            <MaterialCommunityIcons name="download-outline" size={20} color="#fff" />
            <Text style={styles.generateBtnText}>
              {exportMutation.isPending ? 'Starting…' : exportStatus === 'pending' ? 'Generating…' : 'Generate Report'}
            </Text>
          </LinearGradient>
        </Pressable>

        {/* Loading state: animated progress bar */}
        {(exportStatus === 'pending' || exportMutation.isPending) && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <MaterialCommunityIcons name="clock-fast" size={20} color={C.warning} />
              <Text style={styles.progressTitle}>Generating Report…</Text>
            </View>
            <Text style={styles.progressSub}>
              {taskId ? `Task: ${taskId.slice(0, 12)}…` : 'Starting export job…'}
            </Text>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth as any }]} />
            </View>
            <Text style={styles.progressNote}>Checking every 5 seconds for your download link.</Text>
          </View>
        )}

        {/* Success state */}
        {exportStatus === 'ready' && downloadUrl && (
          <View style={styles.successCard}>
            <View style={styles.successRow}>
              <View style={styles.successIconBg}>
                <MaterialCommunityIcons name="file-download-outline" size={22} color={C.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.successTitle}>Report Ready</Text>
                <Text style={styles.successSub}>Your export is complete and ready to download.</Text>
              </View>
            </View>
            <Pressable
              onPress={() => Linking.openURL(downloadUrl)}
              style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]}
            >
              <LinearGradient colors={[C.success, '#059669']} style={styles.shareBtnGrad}>
                <MaterialCommunityIcons name="share-variant" size={16} color="#fff" />
                <Text style={styles.shareBtnText}>Download & Share</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {/* Queued state */}
        {exportStatus === 'queued' && (
          <View style={[styles.progressCard, { borderColor: 'rgba(16,185,129,0.2)' }]}>
            <View style={styles.progressHeader}>
              <MaterialCommunityIcons name="check-circle-outline" size={20} color={C.success} />
              <Text style={[styles.progressTitle, { color: C.success }]}>Report Queued</Text>
            </View>
            <Text style={styles.progressNote}>You'll receive a notification when the report is ready for download.</Text>
          </View>
        )}

        {/* Failed state */}
        {exportStatus === 'failed' && (
          <View style={[styles.progressCard, { borderColor: 'rgba(239,68,68,0.2)' }]}>
            <View style={styles.progressHeader}>
              <MaterialCommunityIcons name="alert-circle-outline" size={20} color={C.danger} />
              <Text style={[styles.progressTitle, { color: C.danger }]}>Export Failed</Text>
            </View>
            <Text style={styles.progressNote}>Something went wrong. Please try again.</Text>
          </View>
        )}

        {/* Info banner */}
        <View style={styles.infoBanner}>
          <MaterialCommunityIcons name="information-outline" size={16} color={C.primary} />
          <Text style={styles.infoText}>
            Reports are generated as CSV files. Large date ranges may take a few minutes.
          </Text>
        </View>

        {/* Recent exports */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Recent Exports</Text>
        <View style={styles.recentList}>
          {RECENT_EXPORTS.map((exp, idx) => (
            <View
              key={exp.id}
              style={[styles.recentItem, idx < RECENT_EXPORTS.length - 1 && styles.recentItemBorder]}
            >
              <View style={[
                styles.recentIconBg,
                { backgroundColor: exp.type === 'pdf' ? C.dangerLight : C.successLight },
              ]}>
                <MaterialCommunityIcons
                  name={exp.type === 'pdf' ? 'file-pdf-box' : 'file-excel'}
                  size={20}
                  color={exp.type === 'pdf' ? C.danger : C.success}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentName} numberOfLines={1}>{exp.name}</Text>
                <Text style={styles.recentDate}>{exp.date}</Text>
              </View>
              <Pressable hitSlop={8}>
                <MaterialCommunityIcons name="download-outline" size={18} color={C.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: { paddingBottom: 16 },
  headerContent: { paddingHorizontal: 20, paddingTop: 10, gap: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: C.textSecondary },

  // Content
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48, gap: 10 },

  // Section label
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },

  // Report type grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCardWrapper: { width: '48%' },
  gridCard: {
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    aspectRatio: 1, padding: 14,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    overflow: 'hidden',
  },
  gridCardActive: { borderColor: C.primary, borderWidth: 2 },
  gridIconBg: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  gridCardLabel: {
    fontSize: 13, fontWeight: '700', color: C.textPrimary,
    textAlign: 'center', lineHeight: 17,
  },
  gridCardSub: { fontSize: 11, color: C.textMuted, textAlign: 'center' },
  gridCheckBadge: { position: 'absolute', top: 10, right: 10 },

  // Date range
  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  datePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  datePillText: { fontSize: 13, fontWeight: '600', color: C.textPrimary },

  // Generate button
  generateWrapper: { marginTop: 4 },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, height: 52,
  },
  generateBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Progress card
  progressCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 16, gap: 10,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTitle: { fontSize: 14, fontWeight: '700', color: C.warning },
  progressSub: { fontSize: 12, color: C.textMuted },
  progressTrack: {
    height: 6, backgroundColor: 'rgba(148,163,184,0.1)',
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: {
    height: 6, borderRadius: 3,
    backgroundColor: C.primary,
  },
  progressNote: { fontSize: 12, color: C.textMuted, lineHeight: 16 },

  // Success card
  successCard: {
    backgroundColor: C.successLight, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)',
    padding: 16, gap: 12,
  },
  successRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  successIconBg: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(16,185,129,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: 15, fontWeight: '700', color: C.success },
  successSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  shareBtn: {},
  shareBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 10, paddingVertical: 10,
  },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Info banner
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.15)',
    padding: 12, marginTop: 4,
  },
  infoText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 18 },

  // Recent exports
  recentList: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  recentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
  },
  recentItemBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  recentIconBg: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  recentName: { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  recentDate: { fontSize: 11, color: C.textMuted, marginTop: 2 },

  // Range picker modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  rangeModal: {
    backgroundColor: C.surface, borderRadius: 20,
    borderWidth: 1, borderColor: C.border,
    width: '80%', padding: 8,
  },
  rangeModalTitle: {
    fontSize: 14, fontWeight: '700', color: C.textSecondary,
    textAlign: 'center', paddingVertical: 12,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  rangeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  rangeOptionText: { fontSize: 15, color: C.textPrimary, fontWeight: '500' },
});
