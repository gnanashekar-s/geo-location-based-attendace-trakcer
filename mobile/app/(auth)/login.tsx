import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { Colors, Radius, Spacing, Shadow } from '@/constants/theme';

const C = Colors;

export default function LoginScreen() {
  const router = useRouter();
  const { login, enterDemoMode } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const passRef = useRef<TextInput>(null);

  const validate = () => {
    const e: typeof fieldErrors = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Invalid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 6) e.password = 'At least 6 characters';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      const user = useAuthStore.getState().user;
      const isAdmin = user?.role === 'org_admin' || user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'supervisor';
      router.replace(isAdmin ? '/(admin)/dashboard' : '/(employee)');
    } catch (err: any) {
      const s = err?.response?.status;
      if (s === 401 || s === 403) setError('Incorrect email or password.');
      else if (s === 422) setError('Please check your input and try again.');
      else if (!err?.response) setError('Cannot connect to server. Check your connection.');
      else setError(err?.response?.data?.detail ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = (role: 'employee' | 'admin') => {
    enterDemoMode(role);
    router.replace(role === 'admin' ? '/(admin)/dashboard' : '/(employee)');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <SafeAreaView edges={['top', 'bottom']}>

            {/* ── Brand ── */}
            <View style={s.brand}>
              <View style={s.logoWrap}>
                <LinearGradient colors={['#6366F1', '#8B5CF6']} style={s.logoGrad}>
                  <MaterialCommunityIcons name="shield-check" size={28} color="#fff" />
                </LinearGradient>
              </View>
              <Text style={s.appName}>GeoAttend</Text>
              <Text style={s.appSub}>Attendance & location tracking</Text>
            </View>

            {/* ── Card ── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Sign in</Text>
              <Text style={s.cardSub}>Enter your credentials to continue</Text>

              {/* Error banner */}
              {error ? (
                <View style={s.errorBanner}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={15} color={C.danger} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Email */}
              <View style={s.fieldWrap}>
                <Text style={s.label}>Email</Text>
                <View style={[s.inputRow, fieldErrors.email && s.inputError]}>
                  <MaterialCommunityIcons name="email-outline" size={17} color={fieldErrors.email ? C.danger : C.textMuted} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="you@company.com"
                    placeholderTextColor={C.textMuted}
                    value={email}
                    onChangeText={t => { setEmail(t); setFieldErrors(e => ({ ...e, email: undefined })); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => passRef.current?.focus()}
                    editable={!loading}
                    selectionColor={C.primary}
                  />
                </View>
                {fieldErrors.email ? <Text style={s.fieldErr}>{fieldErrors.email}</Text> : null}
              </View>

              {/* Password */}
              <View style={s.fieldWrap}>
                <Text style={s.label}>Password</Text>
                <View style={[s.inputRow, fieldErrors.password && s.inputError]}>
                  <MaterialCommunityIcons name="lock-outline" size={17} color={fieldErrors.password ? C.danger : C.textMuted} style={s.inputIcon} />
                  <TextInput
                    ref={passRef}
                    style={s.input}
                    placeholder="Enter your password"
                    placeholderTextColor={C.textMuted}
                    value={password}
                    onChangeText={t => { setPassword(t); setFieldErrors(e => ({ ...e, password: undefined })); }}
                    secureTextEntry={!showPass}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    editable={!loading}
                    selectionColor={C.primary}
                  />
                  <Pressable onPress={() => setShowPass(v => !v)} hitSlop={10}>
                    <MaterialCommunityIcons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                  </Pressable>
                </View>
                {fieldErrors.password ? <Text style={s.fieldErr}>{fieldErrors.password}</Text> : null}
              </View>

              {/* Forgot */}
              <Pressable style={s.forgotRow} onPress={() => router.push('/(auth)/forgot-password' as any)}>
                <Text style={s.forgotText}>Forgot password?</Text>
              </Pressable>

              {/* CTA */}
              <Pressable
                onPress={handleLogin}
                disabled={loading}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 4 })}
              >
                <LinearGradient colors={['#6366F1', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
                  {loading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.btnText}>Sign In</Text>
                  }
                </LinearGradient>
              </Pressable>

              {/* Divider */}
              <View style={s.divRow}>
                <View style={s.divLine} />
                <Text style={s.divText}>or</Text>
                <View style={s.divLine} />
              </View>

              {/* Register link */}
              <View style={s.footer}>
                <Text style={s.footerText}>Don't have an account? </Text>
                <Pressable onPress={() => router.push('/(auth)/register')}>
                  <Text style={s.footerLink}>Register</Text>
                </Pressable>
              </View>
            </View>

            {/* ── Demo Mode ── */}
            <View style={s.demoSection}>
              <View style={s.demoDivRow}>
                <View style={s.divLine} />
                <View style={s.demoBadge}>
                  <MaterialCommunityIcons name="play-circle-outline" size={14} color="#F59E0B" />
                  <Text style={s.demoBadgeText}>DEMO MODE</Text>
                </View>
                <View style={s.divLine} />
              </View>
              <Text style={s.demoHint}>Explore the app with sample data — no account needed</Text>
              <View style={s.demoBtnRow}>
                <Pressable
                  style={({ pressed }) => [s.demoBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => handleDemo('employee')}
                >
                  <MaterialCommunityIcons name="account-outline" size={18} color="#6366F1" />
                  <Text style={s.demoBtnText}>Employee View</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.demoBtn, s.demoBtnAdmin, pressed && { opacity: 0.8 }]}
                  onPress={() => handleDemo('admin')}
                >
                  <MaterialCommunityIcons name="shield-crown-outline" size={18} color="#F59E0B" />
                  <Text style={[s.demoBtnText, { color: '#F59E0B' }]}>Admin View</Text>
                </Pressable>
              </View>
            </View>

          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 40 },

  brand: { alignItems: 'center', marginBottom: 36 },
  logoWrap: {
    marginBottom: 14,
    ...Shadow.glow('#6366F1'),
  },
  logoGrad: {
    width: 60, height: 60, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  appName: { fontSize: 24, fontWeight: '700', color: C.text, letterSpacing: -0.3, marginBottom: 4 },
  appSub: { fontSize: 13, color: C.textMuted, fontWeight: '400' },

  card: {
    backgroundColor: C.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: C.borderStrong,
    padding: 24,
    ...Shadow.md,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardSub: { fontSize: 13, color: C.textMuted, marginBottom: 20 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.dangerBg,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: { color: C.danger, fontSize: 13, flex: 1 },

  fieldWrap: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', color: C.textSub, marginBottom: 6, letterSpacing: 0.2 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card2, borderRadius: Radius.md,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, height: 46,
  },
  inputError: { borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.04)' },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },
  fieldErr: { fontSize: 11, color: C.danger, marginTop: 4, marginLeft: 2 },

  forgotRow: { alignSelf: 'flex-end', marginBottom: 20, marginTop: 4 },
  forgotText: { fontSize: 13, color: C.primary, fontWeight: '600' },

  btn: {
    height: 48, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.glow('#6366F1'),
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  divRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: C.border },
  divText: { fontSize: 12, color: C.textMuted, fontWeight: '500' },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 13, color: C.textSub },
  footerLink: { fontSize: 13, color: C.primary, fontWeight: '700' },

  // Demo
  demoSection: { marginTop: 24, gap: 10 },
  demoDivRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  demoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(245,158,11,0.10)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  demoBadgeText: { fontSize: 10, fontWeight: '800', color: '#F59E0B', letterSpacing: 0.8 },
  demoHint: { fontSize: 12, color: C.textMuted, textAlign: 'center', fontWeight: '400' },
  demoBtnRow: { flexDirection: 'row', gap: 10 },
  demoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 44, borderRadius: Radius.md,
    backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)',
  },
  demoBtnAdmin: { borderColor: 'rgba(245,158,11,0.25)' },
  demoBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
});
