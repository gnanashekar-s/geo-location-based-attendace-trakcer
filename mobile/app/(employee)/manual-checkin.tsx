import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Text, Button, TextInput as PaperInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { sitesApi, manualCheckinApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

const REASON_CODES = [
  { code: 'no_gps', label: 'GPS Unavailable', icon: 'crosshairs-off', description: 'GPS signal could not be obtained' },
  { code: 'indoor', label: 'Indoor Location', icon: 'office-building', description: 'Inside building, GPS blocked' },
  { code: 'other', label: 'Other Reason', icon: 'help-circle-outline', description: 'Other exceptional circumstance' },
];

export default function ManualCheckinScreen() {
  const user = useAuthStore(s => s.user);
  const orgId = user?.org_id ?? '';

  const [selectedSite, setSelectedSite] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [reasonText, setReasonText] = useState('');

  const { data: sitesData } = useQuery({
    queryKey: ['sites', orgId],
    queryFn: () => sitesApi.list(orgId).then(r => r.data),
    enabled: !!orgId,
  });

  const sites = (sitesData ?? []).filter((s: any) => s.is_active);

  const submitMutation = useMutation({
    mutationFn: () =>
      manualCheckinApi.submit({
        site_id: selectedSite,
        reason_code: selectedReason,
        reason_text: reasonText.trim(),
      }),
    onSuccess: () => {
      Alert.alert(
        'Request Submitted',
        'Your manual attendance request has been sent to your supervisor for review. You will be notified of the decision.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to submit request. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!selectedSite) return Alert.alert('Required', 'Please select your work site.');
    if (!selectedReason) return Alert.alert('Required', 'Please select a reason.');
    if (!reasonText.trim() || reasonText.trim().length < 10) {
      return Alert.alert('Required', 'Please provide a detailed explanation (at least 10 characters).');
    }
    Alert.alert(
      'Submit Request',
      'Your supervisor will review this manual attendance request. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => submitMutation.mutate() },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Header */}
        <View style={styles.header}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E293B" onPress={() => router.back()} />
          <Text style={styles.title}>Manual Check-in</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Info banner */}
          <View style={styles.infoBanner}>
            <MaterialCommunityIcons name="information" size={20} color="#4F46E5" />
            <Text style={styles.infoText}>
              Use this when GPS check-in fails. Your supervisor will review and approve or reject your request.
            </Text>
          </View>

          {/* Site selector */}
          <Text style={styles.sectionLabel}>Select Work Site *</Text>
          {sites.length === 0 ? (
            <View style={styles.noSites}>
              <MaterialCommunityIcons name="map-marker-off-outline" size={32} color="#CBD5E1" />
              <Text style={styles.noSitesText}>No active sites available</Text>
            </View>
          ) : (
            <View style={styles.optionsGrid}>
              {sites.map((site: any) => (
                <Pressable
                  key={site.id}
                  style={[styles.siteOption, selectedSite === site.id && styles.siteOptionActive]}
                  onPress={() => setSelectedSite(site.id)}
                >
                  <MaterialCommunityIcons
                    name="office-building-marker"
                    size={20}
                    color={selectedSite === site.id ? '#4F46E5' : '#94A3B8'}
                  />
                  <Text style={[styles.siteOptionText, selectedSite === site.id && { color: '#4F46E5' }]}>
                    {site.name}
                  </Text>
                  {site.address ? (
                    <Text style={styles.siteAddress} numberOfLines={1}>{site.address}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}

          {/* Reason code selector */}
          <Text style={styles.sectionLabel}>Reason *</Text>
          <View style={styles.reasonGrid}>
            {REASON_CODES.map(rc => (
              <Pressable
                key={rc.code}
                style={[styles.reasonOption, selectedReason === rc.code && styles.reasonOptionActive]}
                onPress={() => setSelectedReason(rc.code)}
              >
                <MaterialCommunityIcons
                  name={rc.icon as any}
                  size={24}
                  color={selectedReason === rc.code ? '#4F46E5' : '#94A3B8'}
                />
                <Text style={[styles.reasonLabel, selectedReason === rc.code && { color: '#4F46E5' }]}>
                  {rc.label}
                </Text>
                <Text style={styles.reasonDesc}>{rc.description}</Text>
              </Pressable>
            ))}
          </View>

          {/* Free text */}
          <Text style={styles.sectionLabel}>Explanation *</Text>
          <PaperInput
            value={reasonText}
            onChangeText={setReasonText}
            placeholder="Describe why you could not check in via GPS..."
            mode="outlined"
            multiline
            numberOfLines={4}
            style={styles.textArea}
            outlineColor="#E2E8F0"
            activeOutlineColor="#4F46E5"
            disabled={submitMutation.isPending}
          />
          <Text style={styles.charCount}>{reasonText.length} characters (min 10)</Text>

          {/* Submit */}
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending}
            style={styles.submitBtn}
            buttonColor="#4F46E5"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 16, fontWeight: '700' }}
            icon="send"
          >
            Submit for Approval
          </Button>

          <Text style={styles.disclaimer}>
            False manual check-in requests may result in disciplinary action.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  content: { padding: 16, gap: 6, paddingBottom: 40 },
  infoBanner: {
    flexDirection: 'row', gap: 10, backgroundColor: '#EEF2FF',
    borderRadius: 12, padding: 14, alignItems: 'flex-start', marginBottom: 8,
  },
  infoText: { flex: 1, fontSize: 13, color: '#4338CA', lineHeight: 19 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 8 },
  noSites: { alignItems: 'center', padding: 24, gap: 8 },
  noSitesText: { color: '#94A3B8', fontSize: 14 },
  optionsGrid: { gap: 8 },
  siteOption: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF', padding: 14, gap: 4,
  },
  siteOptionActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  siteOptionText: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  siteAddress: { fontSize: 12, color: '#94A3B8' },
  reasonGrid: { gap: 8 },
  reasonOption: {
    borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF', padding: 14, gap: 4,
  },
  reasonOptionActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  reasonLabel: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  reasonDesc: { fontSize: 12, color: '#94A3B8' },
  textArea: { backgroundColor: '#FFFFFF', minHeight: 100 },
  charCount: { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginBottom: 4 },
  submitBtn: { borderRadius: 14, marginTop: 16 },
  disclaimer: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 12, lineHeight: 17 },
});
