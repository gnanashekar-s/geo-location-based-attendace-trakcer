import React, { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { notificationsApi } from '@/services/api';
import { useNotificationStore } from '@/store/notificationStore';
import type { NotificationItem } from '@/types';
import { Colors } from '@/constants/theme';

const C = Colors;

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function TabIcon({ name, outlineName, focused, label }: {
  name: IconName; outlineName: IconName; focused: boolean; label: string;
}) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <MaterialCommunityIcons name={focused ? name : outlineName} size={22} color={focused ? C.primary : C.textMuted} />
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function EmployeeTabLayout() {
  const setNotifications = useNotificationStore(s => s.setNotifications);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = async () => {
    try {
      const res = await notificationsApi.list();
      const items = (res.data?.items ?? []) as NotificationItem[];
      setNotifications(items.map(n => ({
        id: n.id, title: n.title, body: n.body,
        category: (n.type ?? 'system') as any,
        is_read: n.is_read, data: (n.data as any) ?? {},
        received_at: n.created_at,
      })));
    } catch { /* silently ignore */ }
  };

  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
      }}
    >
      <Tabs.Screen name="index"
        options={{ title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon name="home" outlineName="home-outline" focused={focused} label="Home" /> }}
      />
      <Tabs.Screen name="checkin"
        options={{
          tabBarIcon: ({ focused }) => (
            <View style={styles.fabWrap}>
              <LinearGradient colors={['#6366F1', '#8B5CF6']} style={styles.fab}>
                <MaterialCommunityIcons name="map-marker-check" size={24} color="#fff" />
              </LinearGradient>
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen name="history"
        options={{ title: 'History',
          tabBarIcon: ({ focused }) => <TabIcon name="calendar-month" outlineName="calendar-month-outline" focused={focused} label="History" /> }}
      />
      <Tabs.Screen name="streaks"
        options={{ title: 'Streaks',
          tabBarIcon: ({ focused }) => <TabIcon name="trophy" outlineName="trophy-outline" focused={focused} label="Streaks" /> }}
      />
      <Tabs.Screen name="profile"
        options={{ title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name="account-circle" outlineName="account-circle-outline" focused={focused} label="Profile" /> }}
      />
      <Tabs.Screen name="manual-checkin" options={{ href: null }} />
      <Tabs.Screen name="privacy" options={{ href: null }} />
      <Tabs.Screen name="trust-score" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: C.card,
    borderTopColor: C.border,
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 10,
    paddingTop: 4,
  },
  tabIcon: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10, gap: 3, minWidth: 52,
  },
  tabIconActive: { backgroundColor: C.primaryBg },
  tabLabel:      { fontSize: 10, color: C.textMuted, fontWeight: '500' },
  tabLabelActive: { color: C.primary, fontWeight: '700' },
  fabWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  fab: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6366F1', shadowOpacity: 0.5, shadowRadius: 10, elevation: 8,
  },
});
