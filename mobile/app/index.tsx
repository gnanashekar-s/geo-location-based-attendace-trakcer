import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

/**
 * Initial route — acts as an auth gate.
 *
 * This runs INSIDE the Stack navigator (after it mounts), so it is safe
 * to use <Redirect> here without the "navigate before mounting" error.
 *
 * Flow:
 *   1. While auth is being rehydrated from AsyncStorage → show spinner
 *   2. Not authenticated → /  (auth)/login
 *   3. Admin / super_admin → /(admin)/dashboard
 *   4. Employee → /(employee)
 */
export default function Index() {
  const { isAuthenticated, isInitialized, user } = useAuthStore();

  if (!isInitialized) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  if (user?.role === 'org_admin' || user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'supervisor') {
    return <Redirect href="/(admin)/dashboard" />;
  }

  return <Redirect href="/(employee)" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#09090B',
  },
});
