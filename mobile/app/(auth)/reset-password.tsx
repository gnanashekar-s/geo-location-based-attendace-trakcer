import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { authApi } from '@/services/api';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleReset = async () => {
    let valid = true;
    if (!token.trim()) {
      setTokenError('Reset token is required');
      valid = false;
    } else {
      setTokenError('');
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      valid = false;
    } else {
      setPasswordError('');
    }
    if (!valid) return;

    setIsLoading(true);
    try {
      await authApi.resetPassword(token.trim(), newPassword);
      Alert.alert(
        'Password Reset',
        'Your password has been reset successfully. Please log in.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? 'Invalid or expired reset token.';
      Alert.alert('Reset Failed', detail);
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
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            <MaterialCommunityIcons
              name="lock-check"
              size={48}
              color="#4F46E5"
              style={styles.icon}
            />
            <Text style={styles.title}>New Password</Text>
            <Text style={styles.subtitle}>
              Enter the reset token from your email and your new password.
            </Text>

            <TextInput
              label="Reset token (from email)"
              value={token}
              onChangeText={(t) => {
                setToken(t);
                setTokenError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              left={<TextInput.Icon icon="key-outline" />}
              error={!!tokenError}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
              multiline
              numberOfLines={3}
            />
            <HelperText type="error" visible={!!tokenError}>
              {tokenError}
            </HelperText>

            <TextInput
              label="New password"
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPasswordError('');
              }}
              secureTextEntry={!showPassword}
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setShowPassword((v) => !v)}
                />
              }
              error={!!passwordError}
              style={styles.input}
              mode="outlined"
              outlineColor="#E2E8F0"
              activeOutlineColor="#4F46E5"
              disabled={isLoading}
            />
            <HelperText type="error" visible={!!passwordError}>
              {passwordError}
            </HelperText>

            <Button
              mode="contained"
              onPress={handleReset}
              loading={isLoading}
              disabled={isLoading}
              style={styles.submitBtn}
              buttonColor="#4F46E5"
              contentStyle={{ paddingVertical: 4 }}
              labelStyle={{ fontSize: 15, fontWeight: '700' }}
            >
              Reset Password
            </Button>
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
});
