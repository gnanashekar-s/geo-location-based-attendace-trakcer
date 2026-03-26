import { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import { useNotificationStore } from '@/store/notificationStore';
import { notificationsApi } from '@/services/api';
import type { NotificationItem } from '@/types';
import { Colors } from '@/constants/theme';

const C = Colors;

export default function AdminLayout() {
  const unreadCount = useNotificationStore(s => s.unreadCount);
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
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen name="dashboard"
        options={{ title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name={focused ? 'view-dashboard' : 'view-dashboard-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen name="geofences"
        options={{ title: 'Geofences',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name={focused ? 'map-marker-radius' : 'map-marker-radius-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen name="approvals"
        options={{ title: 'Approvals',
          tabBarIcon: ({ color, focused }) => (
            <View>
              <MaterialCommunityIcons name={focused ? 'check-decagram' : 'check-decagram-outline'} color={color} size={22} />
            </View>
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.badge,
        }}
      />
      <Tabs.Screen name="employees"
        options={{ title: 'Staff',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name={focused ? 'account-group' : 'account-group-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen name="reports"
        options={{ title: 'Reports',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name="file-chart-outline" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen name="anomalies"
        options={{ title: 'Fraud',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name={focused ? 'shield-alert' : 'shield-alert-outline'} color={color} size={22} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: C.card,
    borderTopColor: C.border,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  badge: {
    backgroundColor: C.danger,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});
