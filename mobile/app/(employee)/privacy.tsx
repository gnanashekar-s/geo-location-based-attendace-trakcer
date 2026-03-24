import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const SECTIONS = [
  {
    title: 'Data We Collect',
    icon: 'database-outline',
    body:
      'We collect GPS coordinates at check-in and check-out, device identifiers for fraud prevention, and optionally a selfie photo for identity verification.',
  },
  {
    title: 'How We Use Your Data',
    icon: 'cog-outline',
    body:
      'Your location and attendance data is used solely to record and verify work hours. It is never sold or shared with third parties outside your organisation.',
  },
  {
    title: 'Data Retention',
    icon: 'clock-outline',
    body:
      'Attendance records are retained for up to 7 years as required by employment regulations. Device data is retained for 90 days after your last login.',
  },
  {
    title: 'Your Rights',
    icon: 'shield-account-outline',
    body:
      'You have the right to access, correct, or request deletion of your personal data. Contact your organisation administrator to exercise these rights.',
  },
  {
    title: 'Security',
    icon: 'lock-outline',
    body:
      'All data is transmitted over TLS 1.3. Location data is stored encrypted at rest. Access is restricted to authorised administrators within your organisation.',
  },
  {
    title: 'Contact',
    icon: 'email-outline',
    body:
      'For privacy questions or data requests, please contact your organisation administrator or email privacy@geoattendance.local.',
  },
];

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E293B" />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy & Security</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lastUpdated}>Last updated: March 2026</Text>

        {SECTIONS.map((section) => (
          <Surface key={section.title} style={styles.card} elevation={1}>
            <View style={styles.cardHeader}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name={section.icon as any} size={20} color="#4F46E5" />
              </View>
              <Text style={styles.cardTitle}>{section.title}</Text>
            </View>
            <Text style={styles.cardBody}>{section.body}</Text>
          </Surface>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  content: { padding: 16, gap: 12 },
  lastUpdated: { fontSize: 12, color: '#94A3B8', marginBottom: 4 },
  card: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#FFFFFF',
    gap: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', flex: 1 },
  cardBody: { fontSize: 14, color: '#475569', lineHeight: 20 },
});
