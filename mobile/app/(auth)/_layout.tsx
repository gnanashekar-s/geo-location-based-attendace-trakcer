import React from 'react';
import { Stack } from 'expo-router';

/**
 * Auth stack layout — no header shown on any auth screen.
 * The gradient backgrounds in each screen provide the visual chrome.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
      <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
