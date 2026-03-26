import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '@/services/api';
import { DEMO_ADMIN, DEMO_EMPLOYEE } from '@/services/demoData';

// ─── Domain Types ────────────────────────────────────────────────────────────

export type UserRole = 'employee' | 'admin' | 'supervisor' | 'org_admin' | 'super_admin';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  org_id: string;
  is_active?: boolean;
  streak_count?: number;
  department?: string;
  avatar_url?: string;
  created_at?: string;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isDemoMode: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  initialize: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  /** Optimistically update a subset of user fields (e.g. after profile edit). */
  patchUser: (partial: Partial<User>) => void;
  /** Enter demo mode with mock data (employee or admin). */
  enterDemoMode: (role: 'employee' | 'admin') => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────────────────────
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isInitialized: false,
      isDemoMode: false,

      // ── Actions ────────────────────────────────────────────────────────────

      /**
       * Login with email + password. Calls POST /auth/login with JSON body,
       * stores tokens and user in state (AsyncStorage via persist middleware).
       */
      login: async (email: string, password: string) => {
        const response = await authApi.login({ email: email.trim().toLowerCase(), password });
        const data = response.data;

        set({
          token: data.access_token,
          refreshToken: (data as any).refresh_token ?? null,
          isAuthenticated: true,
        });

        // Fetch user profile so role-based routing works immediately
        const meResponse = await authApi.me();
        set({ user: meResponse.data as User });
      },

      setTokens: (access: string, refresh: string) => {
        set({
          token: access,
          refreshToken: refresh,
          isAuthenticated: true,
        });
      },

      setUser: (user: User) => {
        set({ user });
      },

      patchUser: (partial: Partial<User>) => {
        const current = get().user;
        if (!current) return;
        set({ user: { ...current, ...partial } });
      },

      logout: () => {
        const { refreshToken, isDemoMode } = get();
        // Fire-and-forget — server-side revocation (non-blocking)
        if (refreshToken && !isDemoMode) {
          authApi.logout(refreshToken).catch(() => { });
        }
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isDemoMode: false,
        });
      },

      enterDemoMode: (role: 'employee' | 'admin') => {
        const demoUser = role === 'admin' ? DEMO_ADMIN : DEMO_EMPLOYEE;
        const user: User = { ...demoUser, avatar_url: demoUser.avatar_url ?? undefined };
        set({
          token: 'demo-token',
          refreshToken: 'demo-refresh-token',
          user: user,
          isAuthenticated: true,
          isInitialized: true,
          isDemoMode: true,
        });
      },

      /**
       * initialize() / loadFromStorage() — called on app start.
       * With Zustand's persist middleware, state is already rehydrated from
       * AsyncStorage automatically. This method refreshes isAuthenticated based
       * on whether a token is present, and optionally re-fetches the user
       * profile to ensure it is up-to-date.
       */
      initialize: async () => {
        const { token, isDemoMode } = get();
        if (token) {
          set({ isAuthenticated: true });
        } else {
          set({ isAuthenticated: false });
        }
        // Mark initialized immediately so the UI never spins on load
        set({ isInitialized: true });

        // In demo mode, skip refreshing user profile from backend
        if (isDemoMode) return;

        // Refresh user profile in background (non-blocking)
        if (token) {
          authApi.me().then(response => {
            const freshUser = response.data;
            if (freshUser) {
              set({ user: freshUser as User });
            }
          }).catch(() => {
            // 401 will trigger logout via response interceptor
          });
        }
      },

      // Alias so existing callers using loadFromStorage() still work.
      loadFromStorage: async () => {
        await get().initialize();
      },
    }),
    {
      name: 'geo-attendance-auth',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the token values and user; derived flag is rehydrated.
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isDemoMode: state.isDemoMode,
      }),
    },
  ),
);

// ─── Selectors (memoisation-friendly) ────────────────────────────────────────

export const selectToken = (s: AuthState) => s.token;
export const selectRefreshToken = (s: AuthState) => s.refreshToken;
export const selectUser = (s: AuthState) => s.user;
export const selectIsAuthenticated = (s: AuthState) => s.isAuthenticated;
export const selectUserRole = (s: AuthState) => s.user?.role ?? null;
