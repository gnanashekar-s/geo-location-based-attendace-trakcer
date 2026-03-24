import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { authApi } from '@/services/api';

interface FormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

function validate(fullName: string, email: string, password: string, confirmPassword: string): FormErrors {
  const errors: FormErrors = {};
  if (!fullName.trim() || fullName.trim().length < 2) errors.fullName = 'Full name must be at least 2 characters';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.trim()) errors.email = 'Email is required';
  else if (!emailRegex.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  else if (!/[A-Z]/.test(password)) errors.password = 'Password must contain an uppercase letter';
  else if (!/[0-9]/.test(password)) errors.password = 'Password must contain a number';
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your password';
  else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
  return errors;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [success, setSuccess] = useState(false);

  const emailRef = useRef<RNTextInput>(null);
  const passwordRef = useRef<RNTextInput>(null);
  const confirmRef = useRef<RNTextInput>(null);

  const handleRegister = async () => {
    const newErrors = validate(fullName, email, password, confirmPassword);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setIsLoading(true);
    try {
      await authApi.register({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: 'employee',
      });
      setSuccess(true);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 409) {
        setErrors({ email: 'An account with this email already exists.' });
      } else if (!err?.response) {
        setErrors({ general: 'Cannot connect to server. Check your connection.' });
      } else {
        setErrors({ general: detail ?? 'Registration failed. Please try again.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <LinearGradient colors={['#4F46E5', '#7C3AED', '#A855F7']} style={styles.gradient}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <MaterialCommunityIcons name="check-circle" size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Account Created!</Text>
          <Text style={styles.successSubtitle}>
            Your employee account has been created successfully. You can now sign in.
          </Text>
          <Button
            mode="contained"
            onPress={() => router.replace('/(auth)/login')}
            style={styles.successBtn}
            buttonColor="#4F46E5"
            contentStyle={{ paddingVertical: 6 }}
            labelStyle={{ fontSize: 16, fontWeight: '700' }}
          >
            Sign In Now
          </Button>
        </View>
      </LinearGradient>
    );
  }

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
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </Pressable>
            <View style={styles.logoCircle}>
              <MaterialCommunityIcons name="account-plus" size={40} color="#4F46E5" />
            </View>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Join your organisation's attendance system</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {errors.general ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#DC2626" />
                <Text style={styles.errorBannerText}>{errors.general}</Text>
              </View>
            ) : null}

            {/* Full Name */}
            <TextInput
              label="Full Name"
              value={fullName}
              onChangeText={(t) => { setFullName(t); if (errors.fullName) setErrors(e => ({ ...e, fullName: undefined })); }}
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              left={<TextInput.Icon icon="account-outline" />}
              error={!!errors.fullName}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
            />
            <HelperText type="error" visible={!!errors.fullName}>{errors.fullName}</HelperText>

            {/* Email */}
            <TextInput
              ref={emailRef}
              label="Email Address"
              value={email}
              onChangeText={(t) => { setEmail(t); if (errors.email) setErrors(e => ({ ...e, email: undefined })); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              left={<TextInput.Icon icon="email-outline" />}
              error={!!errors.email}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
            />
            <HelperText type="error" visible={!!errors.email}>{errors.email}</HelperText>

            {/* Password */}
            <TextInput
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={(t) => { setPassword(t); if (errors.password) setErrors(e => ({ ...e, password: undefined })); }}
              secureTextEntry={!showPassword}
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              left={<TextInput.Icon icon="lock-outline" />}
              right={<TextInput.Icon icon={showPassword ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShowPassword(v => !v)} />}
              error={!!errors.password}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
            />
            <HelperText type="error" visible={!!errors.password}>{errors.password}</HelperText>

            {/* Confirm Password */}
            <TextInput
              ref={confirmRef}
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); if (errors.confirmPassword) setErrors(e => ({ ...e, confirmPassword: undefined })); }}
              secureTextEntry={!showConfirm}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
              left={<TextInput.Icon icon="lock-check-outline" />}
              right={<TextInput.Icon icon={showConfirm ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShowConfirm(v => !v)} />}
              error={!!errors.confirmPassword}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
            />
            <HelperText type="error" visible={!!errors.confirmPassword}>{errors.confirmPassword}</HelperText>

            {/* Password requirements hint */}
            <View style={styles.requirementsBox}>
              <Text style={styles.requirementsTitle}>Password requirements:</Text>
              {[
                { text: 'At least 8 characters', met: password.length >= 8 },
                { text: 'One uppercase letter', met: /[A-Z]/.test(password) },
                { text: 'One number', met: /[0-9]/.test(password) },
              ].map(r => (
                <View key={r.text} style={styles.requirementRow}>
                  <MaterialCommunityIcons
                    name={r.met ? 'check-circle' : 'circle-outline'}
                    size={14}
                    color={r.met ? '#10B981' : '#94A3B8'}
                  />
                  <Text style={[styles.requirementText, r.met && styles.requirementMet]}>{r.text}</Text>
                </View>
              ))}
            </View>

            {/* Submit */}
            <Button
              mode="contained"
              onPress={handleRegister}
              loading={isLoading}
              disabled={isLoading}
              style={styles.submitBtn}
              contentStyle={styles.submitBtnContent}
              labelStyle={styles.submitBtnLabel}
              buttonColor="#4F46E5"
            >
              {isLoading ? 'Creating Account…' : 'Create Account'}
            </Button>

            {/* Sign In link */}
            <View style={styles.signInRow}>
              <Text style={styles.signInText}>Already have an account? </Text>
              <Pressable onPress={() => router.replace('/(auth)/login')}>
                <Text style={styles.signInLink}>Sign In</Text>
              </Pressable>
            </View>
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
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
    position: 'relative',
  },
  backBtn: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 8,
  },
  errorBannerText: {
    color: '#DC2626',
    fontSize: 13,
    flex: 1,
  },
  input: {
    backgroundColor: '#FFFFFF',
    marginBottom: 2,
  },
  requirementsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  requirementsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  requirementText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  requirementMet: {
    color: '#10B981',
  },
  submitBtn: {
    borderRadius: 12,
    marginBottom: 16,
  },
  submitBtnContent: {
    paddingVertical: 6,
  },
  submitBtnLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  signInText: {
    fontSize: 14,
    color: '#64748B',
  },
  signInLink: {
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '700',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  successSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 22,
  },
  successBtn: {
    marginTop: 8,
    borderRadius: 12,
    width: '100%',
  },
});
