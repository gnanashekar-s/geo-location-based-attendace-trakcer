import { create } from 'zustand';

// ─── Domain Types ────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'attendance'
  | 'approval'
  | 'fraud_alert'
  | 'streak'
  | 'system';

export interface Notification {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  is_read: boolean;
  data: Record<string, unknown>;
  received_at: string;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

interface NotificationState {
  unreadCount: number;
  notifications: Notification[];

  // Actions
  addNotification: (n: Notification) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  setUnreadCount: (count: number) => void;
  setNotifications: (notifications: Notification[]) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

const MAX_NOTIFICATIONS = 100;

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  unreadCount: 0,
  notifications: [],

  addNotification: (n: Notification) => {
    const existing = get().notifications;
    // Deduplicate by id
    const isDuplicate = existing.some((notif) => notif.id === n.id);
    if (isDuplicate) return;

    const updated = [n, ...existing].slice(0, MAX_NOTIFICATIONS);
    const unreadCount = updated.filter((notif) => !notif.is_read).length;
    set({ notifications: updated, unreadCount });
  },

  markAllRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({
        ...n,
        is_read: true,
      })),
      unreadCount: 0,
    }));
  },

  markRead: (id: string) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n,
      );
      const unreadCount = notifications.filter((n) => !n.is_read).length;
      return { notifications, unreadCount };
    });
  },

  setUnreadCount: (count: number) => {
    set({ unreadCount: count });
  },

  setNotifications: (notifications: Notification[]) => {
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    set({ notifications, unreadCount });
  },

  removeNotification: (id: string) => {
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      const unreadCount = notifications.filter((n) => !n.is_read).length;
      return { notifications, unreadCount };
    });
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 });
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectUnreadCount = (s: NotificationState) => s.unreadCount;
export const selectNotifications = (s: NotificationState) => s.notifications;
export const selectUnread = (s: NotificationState) =>
  s.notifications.filter((n) => !n.is_read);
