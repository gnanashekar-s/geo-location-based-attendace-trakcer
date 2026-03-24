import React, { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { notificationsApi } from '@/services/api';
import { useNotificationStore } from '@/store/notificationStore';
import type { NotificationItem } from '@/types';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface TabIconProps {
  name: IconName;
  outlineName: IconName;
  focused: boolean;
  label: string;
}

function TabIcon({ name, outlineName, focused, label }: TabIconProps) {
  return (
    <View style={[styles.tabItem, focused && styles.tabItemActive]}>
      <MaterialCommunityIcons
        name={focused ? name : outlineName}
        size={26}
        color={focused ? '#4F46E5' : '#94A3B8'}
      />
      <Text
        style={[styles.tabLabel, focused && styles.tabLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
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
        id: n.id,
        title: n.title,
        body: n.body,
        category: (n.type ?? 'system') as any,
        is_read: n.is_read,
        data: (n.data as Record<string, unknown>) ?? {},
        received_at: n.created_at,
      })));
    } catch {
      // Silently ignore — backend may not be reachable
    }
  };

  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#94A3B8',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home" outlineName="home-outline" focused={focused} label="Home" />
          ),
        }}
      />
      <Tabs.Screen
        name="checkin"
        options={{
          title: 'Check-In',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name="map-marker-check"
              outlineName="map-marker-check-outline"
              focused={focused}
              label="Check-In"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name="calendar-month"
              outlineName="calendar-month-outline"
              focused={focused}
              label="History"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="streaks"
        options={{
          title: 'Streaks',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name="trophy"
              outlineName="trophy-outline"
              focused={focused}
              label="Streaks"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name="account-circle"
              outlineName="account-circle-outline"
              focused={focused}
              label="Profile"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="manual-checkin"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="privacy"
        options={{ href: null }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: Platform.OS === 'web' ? 64 : 70,
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 2,
    minWidth: 60,
  },
  tabItemActive: {
    backgroundColor: '#EEF2FF',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
  },
  tabLabelActive: {
    color: '#4F46E5',
    fontWeight: '700',
  },
});
