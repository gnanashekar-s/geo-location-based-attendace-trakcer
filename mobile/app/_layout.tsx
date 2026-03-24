import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as PaperProvider, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Platform, StyleSheet } from 'react-native';
import { useAuthStore } from '@/store/authStore';

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
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4F46E5',         // Indigo-600
    primaryContainer: '#EEF2FF',
    secondary: '#7C3AED',       // Violet-600
    secondaryContainer: '#F5F3FF',
    tertiary: '#0EA5E9',        // Sky-500
    surface: '#FFFFFF',
    surfaceVariant: '#F8FAFC',
    background: '#F1F5F9',
    error: '#EF4444',
    errorContainer: '#FEE2E2',
    onPrimary: '#FFFFFF',
    onSecondary: '#FFFFFF',
    onBackground: '#1E293B',
    onSurface: '#1E293B',
    onSurfaceVariant: '#64748B',
    outline: '#CBD5E1',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#F8FAFC',
      level3: '#F1F5F9',
      level4: '#E2E8F0',
      level5: '#CBD5E1',
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
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <StatusBar style="auto" />
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
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
