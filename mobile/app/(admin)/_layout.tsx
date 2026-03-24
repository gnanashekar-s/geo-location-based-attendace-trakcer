import { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useNotificationStore } from '@/store/notificationStore';
import { notificationsApi } from '@/services/api';
import type { NotificationItem } from '@/types';

export default function AdminLayout() {
  const unreadCount = useNotificationStore(s => s.unreadCount);
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
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E2E8F0',
          height: Platform.OS === 'web' ? 60 : 64,
          paddingBottom: Platform.OS === 'ios' ? 12 : 6,
          paddingTop: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIconStyle: { marginBottom: -2 },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'view-dashboard' : 'view-dashboard-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="geofences"
        options={{
          title: 'Geofences',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'map-marker-radius' : 'map-marker-radius-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'check-circle' : 'check-circle-outline'}
              color={color}
              size={24}
            />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="employees"
        options={{
          title: 'Staff',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'account-group' : 'account-group-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'chart-bar' : 'chart-bar'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="anomalies"
        options={{
          title: 'Fraud',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'shield-alert' : 'shield-alert-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
