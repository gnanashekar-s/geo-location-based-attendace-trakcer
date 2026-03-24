import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  Pressable,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';

const { width } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

// ─── Validators ───────────────────────────────────────────────────────────────

function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) return 'Enter a valid email address';
  return undefined;
}

function validatePassword(password: string): string | undefined {
  if (!password) return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  return undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const router = useRouter();
  const { login, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const passwordRef = useRef<RNTextInput>(null);

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const newErrors: FormErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(newErrors);
    return !newErrors.email && !newErrors.password;
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!validate()) return;
    setIsLoading(true);
    setErrors({});

    try {
      // login() calls POST /auth/login with JSON {email, password} and persists
      // tokens + user in Zustand (and AsyncStorage via the persist middleware).
      await login(email, password);

      // Re-read role from updated store state after login resolves.
      const updatedUser = useAuthStore.getState().user;
      const isAdmin =
        updatedUser?.role === 'org_admin' || updatedUser?.role === 'admin' || updatedUser?.role === 'super_admin';

      // Navigate to role-appropriate root; AuthGuard in _layout also enforces this.
      if (isAdmin) {
        router.replace('/(admin)/dashboard');
      } else {
        router.replace('/(employee)');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      if (status === 401 || status === 403) {
        setErrors({ general: 'Invalid email or password. Please try again.' });
      } else if (status === 422) {
        setErrors({ general: 'Please check your input and try again.' });
      } else if (!err?.response) {
        setErrors({
          general: 'Cannot connect to server. Check your internet connection.',
        });
      } else {
        setErrors({
          general: detail ?? 'An unexpected error occurred. Please try again.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

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
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo Section ── */}
          <View style={styles.logoSection}>
            <View style={styles.logoCircle}>
              <MaterialCommunityIcons
                name="map-marker-check"
                size={52}
                color="#4F46E5"
              />
            </View>
            <Text variant="headlineMedium" style={styles.appName}>
              GeoAttendance
            </Text>
            <Text variant="bodyMedium" style={styles.tagline}>
              Smart location-based attendance
            </Text>
          </View>

          {/* ── Card ── */}
          <View style={styles.card}>
            <Text variant="headlineSmall" style={styles.cardTitle}>
              Welcome back
            </Text>
            <Text variant="bodyMedium" style={styles.cardSubtitle}>
              Sign in to your account
            </Text>

            {/* General Error Banner */}
            {errors.general ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={18}
                  color="#DC2626"
                />
                <Text style={styles.errorBannerText}>{errors.general}</Text>
              </View>
            ) : null}

            {/* Email Input */}
            <TextInput
              label="Email address"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
              }}
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
              accessibilityLabel="Email address"
            />
            <HelperText type="error" visible={!!errors.email}>
              {errors.email}
            </HelperText>

            {/* Password Input */}
            <TextInput
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password)
                  setErrors((e) => ({ ...e, password: undefined }));
              }}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setShowPassword((v) => !v)}
                />
              }
              error={!!errors.password}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
              accessibilityLabel="Password"
            />
            <HelperText type="error" visible={!!errors.password}>
              {errors.password}
            </HelperText>

            {/* Forgot Password link */}
            <Pressable
              style={styles.forgotPassword}
              onPress={() => router.push('/(auth)/forgot-password' as any)}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>

            {/* Sign In Button */}
            <Button
              mode="contained"
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              style={styles.signInButton}
              contentStyle={styles.signInButtonContent}
              labelStyle={styles.signInButtonLabel}
              buttonColor="#4F46E5"
              accessibilityLabel="Sign in"
            >
              {isLoading ? 'Signing in…' : 'Sign In'}
            </Button>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>secured by TLS</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Security badges */}
            <View style={styles.securityRow}>
              <MaterialCommunityIcons
                name="shield-check"
                size={16}
                color="#10B981"
              />
              <Text style={styles.securityText}>
                256-bit encrypted connection
              </Text>
            </View>

            {/* Sign Up link */}
            <View style={styles.signUpRow}>
              <Text style={styles.signUpText}>Don't have an account? </Text>
              <Pressable onPress={() => router.push('/(auth)/register')}>
                <Text style={styles.signUpLink}>Sign Up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Platform.OS === 'web' ? '10%' as any : 24,
    paddingVertical: 48,
    alignItems: Platform.OS === 'web' ? 'center' : undefined,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tagline: {
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
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
    width: Platform.OS === 'web' ? Math.min(width * 0.9, 480) : undefined,
  },
  cardTitle: {
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: '#64748B',
    marginBottom: 20,
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
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#FFFFFF',
    marginBottom: 2,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 20,
    marginTop: 4,
    cursor: 'pointer' as any,
  },
  forgotPasswordText: {
    color: '#4F46E5',
    fontSize: 13,
    fontWeight: '600',
  },
  signInButton: {
    borderRadius: 12,
    marginBottom: 20,
  },
  signInButtonContent: {
    paddingVertical: 6,
  },
  signInButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    color: '#94A3B8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  securityText: {
    color: '#64748B',
    fontSize: 12,
  },
  signUpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  signUpText: {
    fontSize: 14,
    color: '#64748B',
  },
  signUpLink: {
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '700',
  },
});
