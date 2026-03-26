import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Platform, StyleSheet } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ─── Query Client ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10,
    },
  },
});

// ─── Theme ────────────────────────────────────────────────────────────────────

const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#6366F1',
    primaryContainer: 'rgba(99,102,241,0.15)',
    secondary: '#8B5CF6',
    secondaryContainer: 'rgba(139,92,246,0.15)',
    surface: '#18181B',
    surfaceVariant: '#27272A',
    background: '#09090B',
    error: '#EF4444',
    errorContainer: 'rgba(239,68,68,0.15)',
    onPrimary: '#FFFFFF',
    onSecondary: '#FFFFFF',
    onBackground: '#FAFAFA',
    onSurface: '#FAFAFA',
    onSurfaceVariant: '#A1A1AA',
    outline: 'rgba(255,255,255,0.12)',
    elevation: {
      level0: 'transparent',
      level1: '#18181B',
      level2: '#27272A',
      level3: '#3F3F46',
      level4: '#52525B',
      level5: '#71717A',
    },
  },
};

// ─── Permission Requests ──────────────────────────────────────────────────────

async function requestPermissions() {
  // Location permissions — skip on web (uses browser Geolocation API instead)
  if (Platform.OS === 'web') return;
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus === 'granted') {
    await Location.requestBackgroundPermissionsAsync();
  }
}

// ─── Root Layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    // Rehydrate auth from AsyncStorage on app start and refresh user profile
    initialize().catch((err) =>
      console.warn('[RootLayout] Auth initialization failed:', err)
    );
    // Request location + notification permissions
    requestPermissions().catch((err) =>
      console.warn('[RootLayout] Permission request failed:', err)
    );
  }, [initialize]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <StatusBar style="light" backgroundColor="#09090B" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#4F46E5' },
              headerTintColor: '#FFFFFF',
              headerTitleStyle: { fontWeight: '700' },
              animation: Platform.OS !== 'web' ? 'slide_from_right' : 'none',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(employee)" options={{ headerShown: false }} />
            <Stack.Screen name="(admin)" options={{ headerShown: false }} />
          </Stack>
        </PaperProvider>
      </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
