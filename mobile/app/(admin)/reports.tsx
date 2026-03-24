import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { Text, Surface, Button, RadioButton, SegmentedButtons, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { format, subDays, subMonths, isValid, parseISO } from 'date-fns';
import { analyticsApi } from '@/services/api';

type ReportType = 'daily' | 'weekly' | 'monthly' | 'anomalies';
type PresetRange = 'last7' | 'last30' | 'last90' | 'custom';

function getPresetDateRange(preset: Exclude<PresetRange, 'custom'>): { from: string; to: string } {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(
    preset === 'last7' ? subDays(new Date(), 7)
    : preset === 'last30' ? subDays(new Date(), 30)
    : subMonths(new Date(), 3),
    'yyyy-MM-dd'
  );
  return { from, to };
}

type ExportStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

export default function ReportsScreen() {
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [datePreset, setDatePreset] = useState<PresetRange>('last30');
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customFromError, setCustomFromError] = useState('');
  const [customToError, setCustomToError] = useState('');

  const [taskId, setTaskId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        // else still pending — keep polling
      } catch {
        setExportStatus('failed');
        stopPolling();
      }
    }, 5000);
  };

  const getDateRange = (): { from: string; to: string } | null => {
    if (datePreset !== 'custom') return getPresetDateRange(datePreset);
    const fromDate = parseISO(customFrom);
    const toDate = parseISO(customTo);
    let valid = true;
    if (!isValid(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(customFrom)) {
      setCustomFromError('Use format YYYY-MM-DD');
      valid = false;
    } else {
      setCustomFromError('');
    }
    if (!isValid(toDate) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      setCustomToError('Use format YYYY-MM-DD');
      valid = false;
    } else {
      setCustomToError('');
    }
    if (!valid) return null;
    if (fromDate > toDate) {
      setCustomFromError('"From" must be before "To"');
      return null;
    }
    return { from: customFrom, to: customTo };
  };

  const exportMutation = useMutation({
    mutationFn: () => {
      const range = getDateRange();
      if (!range) return Promise.reject(new Error('Invalid date range'));
      return analyticsApi.export(range.from, range.to, reportType);
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
    // Reset state
    setExportStatus('idle');
    setDownloadUrl(null);
    setTaskId(null);
    stopPolling();
    exportMutation.mutate();
  };

  const dateRangeLabel = datePreset !== 'custom'
    ? (() => { const { from, to } = getPresetDateRange(datePreset); return `${from} → ${to}`; })()
    : `${customFrom} → ${customTo}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Reports & Export</Text>

        {/* Report Type */}
        <Surface style={styles.card} elevation={1}>
          <Text style={styles.sectionLabel}>Report Type</Text>
          <RadioButton.Group value={reportType} onValueChange={v => setReportType(v as ReportType)}>
            {[
              { value: 'daily', label: 'Daily Summary' },
              { value: 'weekly', label: 'Weekly Report' },
              { value: 'monthly', label: 'Monthly Report' },
              { value: 'anomalies', label: 'Anomaly Report' },
            ].map(opt => (
              <RadioButton.Item
                key={opt.value}
                value={opt.value}
                label={opt.label}
                labelStyle={styles.radioLabel}
                style={styles.radioItem}
              />
            ))}
          </RadioButton.Group>
        </Surface>

        {/* Date Range */}
        <Surface style={styles.card} elevation={1}>
          <Text style={styles.sectionLabel}>Date Range</Text>
          <SegmentedButtons
            value={datePreset}
            onValueChange={v => setDatePreset(v as PresetRange)}
            buttons={[
              { value: 'last7', label: 'Last 7d' },
              { value: 'last30', label: 'Last 30d' },
              { value: 'last90', label: 'Last 3m' },
              { value: 'custom', label: 'Custom' },
            ]}
            style={styles.segments}
          />

          {datePreset === 'custom' ? (
            <View style={styles.customDateRow}>
              <View style={styles.customDateField}>
                <TextInput
                  label="From (YYYY-MM-DD)"
                  value={customFrom}
                  onChangeText={t => { setCustomFrom(t); setCustomFromError(''); }}
                  mode="outlined"
                  dense
                  style={styles.dateInput}
                  outlineColor="#E2E8F0"
                  activeOutlineColor="#4F46E5"
                  error={!!customFromError}
                />
                {!!customFromError && <Text style={styles.dateError}>{customFromError}</Text>}
              </View>
              <View style={styles.customDateField}>
                <TextInput
                  label="To (YYYY-MM-DD)"
                  value={customTo}
                  onChangeText={t => { setCustomTo(t); setCustomToError(''); }}
                  mode="outlined"
                  dense
                  style={styles.dateInput}
                  outlineColor="#E2E8F0"
                  activeOutlineColor="#4F46E5"
                  error={!!customToError}
                />
                {!!customToError && <Text style={styles.dateError}>{customToError}</Text>}
              </View>
            </View>
          ) : (
            <Text style={styles.dateRangeText}>{dateRangeLabel}</Text>
          )}
        </Surface>

        {/* Generate Button */}
        <Button
          mode="contained"
          buttonColor="#4F46E5"
          style={styles.generateBtn}
          icon="export"
          onPress={handleGenerate}
          loading={exportMutation.isPending}
          disabled={exportMutation.isPending || exportStatus === 'pending'}
          contentStyle={{ paddingVertical: 4 }}
          labelStyle={{ fontSize: 15, fontWeight: '700' }}
        >
          Generate Report
        </Button>

        {/* Status result */}
        {exportStatus === 'pending' && (
          <Surface style={styles.resultCard} elevation={1}>
            <MaterialCommunityIcons name="clock-outline" size={32} color="#F59E0B" />
            <Text style={[styles.resultTitle, { color: '#F59E0B' }]}>Generating…</Text>
            <Text style={styles.resultText}>
              Task ID: {taskId}
            </Text>
            <Text style={styles.resultNote}>Checking every 5 seconds for your download link.</Text>
          </Surface>
        )}

        {exportStatus === 'ready' && downloadUrl && (
          <Surface style={styles.resultCard} elevation={1}>
            <MaterialCommunityIcons name="check-circle" size={32} color="#10B981" />
            <Text style={[styles.resultTitle, { color: '#10B981' }]}>Report Ready</Text>
            <Button
              mode="contained"
              buttonColor="#10B981"
              style={styles.downloadBtn}
              icon="download"
              onPress={() => Linking.openURL(downloadUrl)}
            >
              Download
            </Button>
          </Surface>
        )}

        {(exportStatus === 'queued') && (
          <Surface style={styles.resultCard} elevation={1}>
            <MaterialCommunityIcons name="check-circle" size={32} color="#10B981" />
            <Text style={[styles.resultTitle, { color: '#10B981' }]}>Report Queued</Text>
            <Text style={styles.resultNote}>
              You'll receive a notification when the report is ready for download.
            </Text>
          </Surface>
        )}

        {exportStatus === 'failed' && (
          <Surface style={[styles.resultCard, { borderWidth: 1, borderColor: '#FEE2E2' }]} elevation={1}>
            <MaterialCommunityIcons name="alert-circle-outline" size={32} color="#EF4444" />
            <Text style={[styles.resultTitle, { color: '#EF4444' }]}>Export Failed</Text>
            <Text style={styles.resultNote}>Please try again.</Text>
          </Surface>
        )}

        {/* Info */}
        <Surface style={styles.infoCard} elevation={0}>
          <MaterialCommunityIcons name="information-outline" size={18} color="#4F46E5" />
          <Text style={styles.infoText}>
            Reports are generated as CSV files and stored securely. Large date ranges may take a few minutes.
          </Text>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  card: { borderRadius: 16, padding: 16, backgroundColor: '#FFFFFF' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  radioItem: { paddingVertical: 2 },
  radioLabel: { fontSize: 14, color: '#1E293B' },
  segments: { marginBottom: 8 },
  dateRangeText: { fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 4 },
  customDateRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  customDateField: { flex: 1 },
  dateInput: { backgroundColor: '#FFFFFF' },
  dateError: { fontSize: 11, color: '#EF4444', marginTop: 2 },
  generateBtn: { borderRadius: 12 },
  resultCard: { borderRadius: 16, padding: 20, backgroundColor: '#FFFFFF', alignItems: 'center', gap: 10 },
  resultTitle: { fontSize: 16, fontWeight: '700' },
  resultText: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  resultNote: { fontSize: 12, color: '#94A3B8', textAlign: 'center' },
  downloadBtn: { borderRadius: 10, marginTop: 4 },
  infoCard: { borderRadius: 12, padding: 14, backgroundColor: '#EEF2FF', flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 13, color: '#4338CA', lineHeight: 18 },
});
