import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { authApi } from '@/services/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setEmailError('Email is required');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setEmailError('Enter a valid email address');
      return;
    }
    setEmailError('');
    setIsLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSubmitted(true);
    } catch {
      // Always show success to prevent email enumeration
      setSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#4F46E5', '#7C3AED', '#A855F7']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {/* Back button */}
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <MaterialCommunityIcons name="arrow-left" size={20} color="#4F46E5" />
              <Text style={styles.backText}>Back to Login</Text>
            </Pressable>

            <MaterialCommunityIcons
              name="lock-reset"
              size={48}
              color="#4F46E5"
              style={styles.icon}
            />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we'll send you a reset token.
            </Text>

            {submitted ? (
              <View style={styles.successBox}>
                <MaterialCommunityIcons name="email-check" size={32} color="#10B981" />
                <Text style={styles.successTitle}>Check your email</Text>
                <Text style={styles.successText}>
                  If an account with that email exists, a password reset token has been sent.
                </Text>
                <Button
                  mode="text"
                  onPress={() => router.push('/(auth)/reset-password' as any)}
                  textColor="#4F46E5"
                >
                  I have a reset token →
                </Button>
              </View>
            ) : (
              <>
                <TextInput
                  label="Email address"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setEmailError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  left={<TextInput.Icon icon="email-outline" />}
                  error={!!emailError}
                  style={styles.input}
                  mode="outlined"
                  outlineColor="#E2E8F0"
                  activeOutlineColor="#4F46E5"
                  disabled={isLoading}
                />
                <HelperText type="error" visible={!!emailError}>
                  {emailError}
                </HelperText>

                <Button
                  mode="contained"
                  onPress={handleSubmit}
                  loading={isLoading}
                  disabled={isLoading}
                  style={styles.submitBtn}
                  buttonColor="#4F46E5"
                  contentStyle={{ paddingVertical: 4 }}
                  labelStyle={{ fontSize: 15, fontWeight: '700' }}
                >
                  Send Reset Email
                </Button>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Platform.OS === 'web' ? '10%' as any : 24,
    paddingVertical: 48,
    alignItems: Platform.OS === 'web' ? 'center' : undefined,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
    width: Platform.OS === 'web' ? 480 : undefined,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  backText: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },
  icon: { alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E293B', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  input: { backgroundColor: '#FFFFFF', marginBottom: 2 },
  submitBtn: { borderRadius: 12, marginTop: 8 },
  successBox: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  successTitle: { fontSize: 18, fontWeight: '700', color: '#10B981' },
  successText: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
});
