import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Pressable, TextInput, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { authApi } from '@/services/api';
import { Colors, Radius, Shadow } from '@/constants/theme';

const C = Colors;

function validate(fullName: string, email: string, password: string, confirm: string) {
  const e: Record<string, string> = {};
  if (!fullName.trim() || fullName.trim().length < 2) e.fullName = 'At least 2 characters required';
  if (!email.trim()) e.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Invalid email address';
  if (!password) e.password = 'Password is required';
  else if (password.length < 8) e.password = 'At least 8 characters';
  else if (!/[A-Z]/.test(password)) e.password = 'Add an uppercase letter';
  else if (!/[0-9]/.test(password)) e.password = 'Add a number';
  if (!confirm) e.confirm = 'Please confirm your password';
  else if (password !== confirm) e.confirm = 'Passwords do not match';
  return e;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<'employee' | 'supervisor' | 'org_admin'>('employee');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleRegister = async () => {
    const e = validate(fullName, email, password, confirm);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setErrors({});
    setLoading(true);
    try {
      await authApi.register({ full_name: fullName.trim(), email: email.trim().toLowerCase(), password, role });
      setSuccess(true);
    } catch (err: any) {
      const st = err?.response?.status;
      if (st === 409) setErrors({ email: 'This email is already registered.' });
      else if (!err?.response) setErrors({ general: 'Cannot connect to server.' });
      else setErrors({ general: err?.response?.data?.detail ?? 'Registration failed.' });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={[s.card, { alignItems: 'center', paddingVertical: 40 }]}>
            <View style={[s.logoGrad, { backgroundColor: C.successBg, marginBottom: 20 }]}>
              <MaterialCommunityIcons name="check-circle" size={44} color={C.success} />
            </View>
            <Text style={[s.cardTitle, { textAlign: 'center', marginBottom: 8 }]}>Account created!</Text>
            <Text style={[s.cardSub, { textAlign: 'center', marginBottom: 28 }]}>
              Your account has been created.{'\n'}Sign in to get started.
            </Text>
            <Pressable onPress={() => router.replace('/(auth)/login')} style={{ width: '100%' }}>
              <LinearGradient colors={['#6366F1', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
                <Text style={s.btnText}>Sign In Now</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const pwReqs = [
    { label: '8+ characters', met: password.length >= 8 },
    { label: 'Uppercase', met: /[A-Z]/.test(password) },
    { label: 'Number', met: /[0-9]/.test(password) },
  ];

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <SafeAreaView edges={['top', 'bottom']}>
            {/* Brand header */}
            <View style={s.header}>
              <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
                <MaterialCommunityIcons name="arrow-left" size={22} color={C.textSub} />
              </Pressable>
              <View style={s.logoGrad}>
                <LinearGradient colors={['#6366F1', '#8B5CF6']} style={s.logoGradInner}>
                  <MaterialCommunityIcons name="account-plus" size={26} color="#fff" />
                </LinearGradient>
              </View>
              <Text style={s.appName}>Create Account</Text>
              <Text style={s.appSub}>Join your organization on GeoAttend</Text>
            </View>

            {/* Form card */}
            <View style={s.card}>
              {errors.general ? (
                <View style={s.errorBanner}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={15} color={C.danger} />
                  <Text style={s.errorText}>{errors.general}</Text>
                </View>
              ) : null}

              {/* Full Name */}
              <Field label="Full Name" error={errors.fullName}>
                <FieldInput icon="account-outline" placeholder="Your full name" value={fullName}
                  onChangeText={t => { setFullName(t); setErrors(e => ({ ...e, fullName: '' })); }}
                  hasError={!!errors.fullName} autoCapitalize="words" returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()} editable={!loading} />
              </Field>

              {/* Email */}
              <Field label="Email" error={errors.email}>
                <FieldInput icon="email-outline" placeholder="you@company.com" value={email}
                  onChangeText={t => { setEmail(t); setErrors(e => ({ ...e, email: '' })); }}
                  hasError={!!errors.email} keyboardType="email-address" autoCapitalize="none"
                  returnKeyType="next" onSubmitEditing={() => passRef.current?.focus()}
                  editable={!loading} inputRef={emailRef} />
              </Field>

              {/* Password */}
              <Field label="Password" error={errors.password}>
                <FieldInput icon="lock-outline" placeholder="Create a password" value={password}
                  onChangeText={t => { setPassword(t); setErrors(e => ({ ...e, password: '' })); }}
                  hasError={!!errors.password} secureTextEntry={!showPass}
                  returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()}
                  editable={!loading} inputRef={passRef}
                  right={<Pressable onPress={() => setShowPass(v => !v)} hitSlop={10}>
                    <MaterialCommunityIcons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                  </Pressable>} />
                {/* Password strength chips */}
                {password.length > 0 && (
                  <View style={s.pwReqs}>
                    {pwReqs.map(r => (
                      <View key={r.label} style={[s.pwChip, r.met && s.pwChipMet]}>
                        <MaterialCommunityIcons name={r.met ? 'check-circle' : 'circle-outline'} size={11} color={r.met ? C.success : C.textMuted} />
                        <Text style={[s.pwChipText, r.met && { color: C.success }]}>{r.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Field>

              {/* Role */}
              <View style={s.fieldWrap}>
                <Text style={s.label}>Account Type</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([
                    { value: 'employee' as const, label: 'Employee' },
                    { value: 'supervisor' as const, label: 'Supervisor' },
                    { value: 'org_admin' as const, label: 'Admin' },
                  ]).map(r => (
                    <Pressable key={r.value} onPress={() => setRole(r.value)}
                      style={[s.inputRow, { flex: 1, justifyContent: 'center', height: 38,
                        borderColor: role === r.value ? C.primary : C.border,
                        backgroundColor: role === r.value ? C.primaryBg : C.card2,
                      }]}>
                      <Text style={{ fontSize: 12, fontWeight: '600',
                        color: role === r.value ? C.primary : C.textMuted }}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Confirm Password */}
              <Field label="Confirm Password" error={errors.confirm}>
                <FieldInput icon="lock-check-outline" placeholder="Repeat password" value={confirm}
                  onChangeText={t => { setConfirm(t); setErrors(e => ({ ...e, confirm: '' })); }}
                  hasError={!!errors.confirm} secureTextEntry={!showConfirm}
                  returnKeyType="done" onSubmitEditing={handleRegister}
                  editable={!loading} inputRef={confirmRef}
                  right={<Pressable onPress={() => setShowConfirm(v => !v)} hitSlop={10}>
                    <MaterialCommunityIcons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                  </Pressable>} />
              </Field>

              <Pressable onPress={handleRegister} disabled={loading}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 8 })}>
                <LinearGradient colors={['#6366F1', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Create Account</Text>}
                </LinearGradient>
              </Pressable>

              <View style={s.footer}>
                <Text style={s.footerText}>Already have an account? </Text>
                <Pressable onPress={() => router.back()}>
                  <Text style={s.footerLink}>Sign In</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      {children}
      {error ? <Text style={s.fieldErr}>{error}</Text> : null}
    </View>
  );
}

function FieldInput({ icon, placeholder, value, onChangeText, hasError, secureTextEntry, keyboardType, autoCapitalize, returnKeyType, onSubmitEditing, editable, inputRef, right }: any) {
  return (
    <View style={[s.inputRow, hasError && s.inputError]}>
      <MaterialCommunityIcons name={icon} size={17} color={hasError ? C.danger : C.textMuted} style={{ marginRight: 8 }} />
      <TextInput
        ref={inputRef}
        style={s.input}
        placeholder={placeholder} placeholderTextColor={C.textMuted}
        value={value} onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        returnKeyType={returnKeyType ?? 'next'}
        onSubmitEditing={onSubmitEditing}
        editable={editable !== false}
        selectionColor={C.primary}
      />
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 32 },

  header: { alignItems: 'center', marginBottom: 28 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 20, padding: 4 },
  logoGrad: { marginBottom: 14 },
  logoGradInner: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: -0.3, marginBottom: 4 },
  appSub: { fontSize: 13, color: C.textMuted },

  card: {
    backgroundColor: C.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: C.borderStrong,
    padding: 24, ...Shadow.md,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 13, color: C.textMuted },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.dangerBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
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
  input: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },
  fieldErr: { fontSize: 11, color: C.danger, marginTop: 4, marginLeft: 2 },

  pwReqs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pwChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.card2, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  pwChipMet: { backgroundColor: C.successBg },
  pwChipText: { fontSize: 11, color: C.textMuted, fontWeight: '500' },

  btn: {
    height: 48, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.glow('#6366F1'),
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  footerText: { fontSize: 13, color: C.textSub },
  footerLink: { fontSize: 13, color: C.primary, fontWeight: '700' },
});
