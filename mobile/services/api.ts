import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import * as Demo from '@/services/demoData';

// API URL is set via EXPO_PUBLIC_API_URL in mobile/.env.local (written by start-frontend.ps1).
// Web always hits localhost directly. Mobile uses the env var (tunnel or local IP).
const BASE_URL =
  Platform.OS === 'web'
    ? 'http://localhost:8000/api/v1'
    : (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.51:8000/api/v1');

// ─── Axios instance ───────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    // Bypass localtunnel's "click to confirm" landing page
    'bypass-tunnel-logic': 'true',
  },
});

// ─── Request interceptor: inject Bearer token ─────────────────────────────────

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor: handle 401 ────────────────────────────────────────

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as any;
    // Only auto-logout on 401 for authenticated requests (not login/register itself)
    if (
      error.response?.status === 401 &&
      !config?.url?.includes('/auth/login') &&
      !config?.url?.includes('/auth/register') &&
      !config?.url?.includes('/auth/refresh')
    ) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;

// ─── Demo-mode helper: wraps data in an Axios-like response shape ─────────────

function demoRes<T>(data: T, status = 200) {
  return Promise.resolve({ data, status, statusText: 'OK', headers: {}, config: {} } as any);
}
function isDemoMode() {
  return useAuthStore.getState().isDemoMode;
}

// ─── Typed API helpers ────────────────────────────────────────────────────────

import type {
  AuthResponse,
  LoginCredentials,
  AttendanceRecord,
  AttendanceToday,
  CheckInPayload,
  CheckInResponse,
  Site,
  SiteCreatePayload,
  SiteUpdatePayload,
  Approval,
  ApprovalActionPayload,
  ManualCheckinPayload,
  AnalyticsSummary,
  AttendanceStats,
  PaginatedResponse,
  User,
  LeaderboardEntry,
  UpcomingShift,
  NotificationListResponse,
} from '@/types';

export const authApi = {
  login: (credentials: LoginCredentials) => {
    if (isDemoMode()) return demoRes({ access_token: 'demo-token', token_type: 'bearer', user: Demo.DEMO_EMPLOYEE });
    return api.post<AuthResponse>('/auth/login', credentials);
  },
  logout: (refreshToken?: string | null) => {
    if (isDemoMode()) return demoRes({});
    return api.post('/auth/logout', refreshToken ? { refresh_token: refreshToken } : {});
  },
  me: () => {
    if (isDemoMode()) {
      const user = useAuthStore.getState().user;
      return demoRes(user ?? Demo.DEMO_EMPLOYEE);
    }
    return api.get<import('@/types').User>('/users/me');
  },
  register: (payload: { full_name: string; email: string; password: string; role: string }) => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_EMPLOYEE, ...payload });
    return api.post('/auth/register', payload);
  },
  forgotPassword: (email: string) => {
    if (isDemoMode()) return demoRes({ message: 'Demo: Reset link sent (not really)' });
    return api.post<{ message: string }>('/auth/forgot-password', { email });
  },
  resetPassword: (token: string, new_password: string) => {
    if (isDemoMode()) return demoRes({ message: 'Demo: Password reset (not really)' });
    return api.post<{ message: string }>('/auth/reset-password', { token, new_password });
  },
};

// ─── Field-mapping helpers ────────────────────────────────────────────────────

// Maps a raw backend event record to the frontend AttendanceRecord shape
function mapEventToRecord(rec: any): AttendanceRecord {
  const isCheckin = rec.event_type === 'checkin';
  return {
    id: rec.id,
    user_id: rec.user_id,
    site_id: rec.site_id,
    site_name: rec.site_name ?? 'Office',
    date: rec.created_at ? rec.created_at.split('T')[0] : '',
    check_in_time: isCheckin ? rec.created_at : null,
    check_out_time: rec.event_type === 'checkout' ? rec.created_at : null,
    duration_minutes: null,
    status: rec.is_valid === false ? 'pending' : isCheckin ? 'present' : 'present',
    latitude: rec.lat ?? 0,
    longitude: rec.lng ?? 0,
    accuracy: rec.accuracy_meters ?? 0,
    fraud_score: rec.fraud_score ?? 0,
    is_mocked: false,
    photo_url: rec.photo_url,
    created_at: rec.created_at,
  };
}

export const attendanceApi = {
  checkIn: (payload: CheckInPayload) => {
    if (isDemoMode()) {
      const isCheckout = !!payload.is_checkout;
      return demoRes(Demo.getDemoCheckinResponse(isCheckout));
    }
    // Map frontend payload fields to backend schema
    const body = {
      lat: payload.latitude,
      lng: payload.longitude,
      accuracy_meters: Math.max(payload.accuracy ?? 1, 1),
      device_fingerprint: 'mobile-expo-app-device-001',
      is_mock_location: false,
      photo_url: null as string | null,
      ip_address: null as string | null,
    };
    // Route to the correct endpoint
    const endpoint = payload.is_checkout ? '/attendance/checkout' : '/attendance/checkin';
    return api.post<any>(endpoint, body).then(r => ({
      ...r,
      data: {
        fraud_score: r.data?.fraud_score ?? 0,
        fraud_flags: r.data?.fraud_flags ? Object.keys(r.data.fraud_flags) : [],
        requires_approval: r.data?.is_manual ?? false,
        attendance: mapEventToRecord(r.data),
        distance_meters: 0,
        within_geofence: true,
      } as CheckInResponse,
    }));
  },

  today: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_TODAY);
    return api.get<any[]>('/attendance/today').then(r => {
      const records: any[] = Array.isArray(r.data) ? r.data : [];
      const checkin = records.find((rec: any) => rec.event_type === 'checkin');
      const checkout = records.find((rec: any) => rec.event_type === 'checkout');
      const hasCheckin = !!checkin;
      // Get streak from auth store (updated after check-in by backend)
      const streak = useAuthStore.getState().user?.streak_count ?? 0;
      return {
        ...r,
        data: {
          record: checkin ? mapEventToRecord(checkin) : null,
          status: hasCheckin ? 'present' : 'absent',
          streak_count: streak,
          check_in_time: checkin?.created_at,
          check_out_time: checkout?.created_at,
        } as AttendanceToday,
      };
    });
  },

  history: (page = 1, perPage = 20) => {
    if (isDemoMode()) return demoRes(Demo.getDemoHistory(page, perPage));
    const skip = (page - 1) * perPage;
    return api.get<any[]>(`/attendance/history?skip=${skip}&limit=${perPage}`).then(r => {
      const raw: any[] = Array.isArray(r.data) ? r.data : [];
      const items = raw.map(mapEventToRecord);
      return {
        ...r,
        data: {
          items,
          total: items.length,
          page,
          per_page: perPage,
          pages: items.length >= perPage ? page + 1 : page,
        } as PaginatedResponse<AttendanceRecord>,
      };
    });
  },

  stats: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_STATS);
    return api.get<AttendanceStats>('/attendance/stats');
  },
  upcomingShift: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_UPCOMING_SHIFT);
    return api.get<UpcomingShift | null>('/attendance/upcoming-shift');
  },
  markSafe: (recordId: string, note: string = '') => {
    if (isDemoMode()) return demoRes({});
    return api.post<AttendanceRecord>(`/attendance/${recordId}/mark-safe`, { note });
  },
};

export const sitesApi = {
  list: (orgId: string) => {
    if (isDemoMode()) return demoRes(Demo.DEMO_SITES);
    return api.get<Site[]>(`/organisations/${orgId}/sites`);
  },
  get: (orgId: string, siteId: string) => {
    if (isDemoMode()) return demoRes(Demo.DEMO_SITES.find(s => s.id === siteId) ?? Demo.DEMO_SITES[0]);
    return api.get<Site>(`/organisations/${orgId}/sites/${siteId}`);
  },
  create: (orgId: string, payload: SiteCreatePayload) => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_SITES[0], ...payload, id: `demo-site-${Date.now()}` });
    return api.post<Site>(`/organisations/${orgId}/sites`, payload);
  },
  update: (orgId: string, siteId: string, payload: SiteUpdatePayload) => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_SITES[0], ...payload });
    return api.patch<Site>(`/organisations/${orgId}/sites/${siteId}`, payload);
  },
  deactivate: (orgId: string, siteId: string) => {
    if (isDemoMode()) return demoRes({});
    return api.delete(`/organisations/${orgId}/sites/${siteId}`);
  },
};

export const approvalsApi = {
  list: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_APPROVALS);
    return api.get<Approval[]>('/approvals/');
  },
  get: (id: string) => {
    if (isDemoMode()) return demoRes(Demo.DEMO_APPROVALS.find(a => a.id === id) ?? Demo.DEMO_APPROVALS[0]);
    return api.get<Approval>(`/approvals/${id}`);
  },
  approve: (approvalId: string, note = '') => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_APPROVALS[0], status: 'approved' });
    return api.post(`/approvals/${approvalId}/approve`, { note });
  },
  reject: (approvalId: string, note = '') => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_APPROVALS[0], status: 'rejected' });
    return api.post(`/approvals/${approvalId}/reject`, { note });
  },
  bulkApprove: (approval_ids: string[], note = 'Bulk approved') => {
    if (isDemoMode()) return demoRes({});
    return api.post('/approvals/bulk-approve', { approval_ids, note });
  },
};

export const usersApi = {
  list: (orgId?: string) => {
    if (isDemoMode()) return demoRes(Demo.getDemoUsers());
    return api.get<{ items: User[]; total: number }>(`/users/?limit=100${orgId ? `&org_id=${orgId}` : ''}`);
  },
  update: (userId: string, payload: Partial<{ full_name: string; is_active: boolean; role: string }>) => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_EMPLOYEE, ...payload });
    return api.patch<User>(`/users/${userId}`, payload);
  },
  create: (payload: { email: string; password: string; full_name: string; org_id: string; role: string }) => {
    if (isDemoMode()) return demoRes({ ...Demo.DEMO_EMPLOYEE, ...payload, id: `demo-user-${Date.now()}` });
    return api.post<User>('/users/', payload);
  },
  leaderboard: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_LEADERBOARD);
    return api.get<LeaderboardEntry[]>('/users/leaderboard');
  },
};

export const manualCheckinApi = {
  submit: (payload: ManualCheckinPayload) => {
    if (isDemoMode()) return demoRes(Demo.getDemoCheckinResponse());
    return api.post('/attendance/manual', payload);
  },
};

export const analyticsApi = {
  summary: () => {
    if (isDemoMode()) {
      const d = Demo.DEMO_ANALYTICS_SUMMARY;
      return demoRes({
        present_today: d.present_today,
        late_today: d.late_today,
        absent_today: d.absent_today,
        pending_approvals: d.pending_approvals,
        total_employees: d.total_employees,
        attendance_rate: d.attendance_rate,
        anomaly_count: d.anomaly_count,
        date: d.date,
      } as AnalyticsSummary);
    }
    return api.get<any>('/analytics/summary').then(r => {
      const d = r.data ?? {};
      const total = d.total_employees || 1;
      const present = d.total_present ?? 0;
      const late = d.total_late ?? 0;
      const absent = d.total_absent ?? 0;
      return {
        ...r,
        data: {
          present_today: present,
          late_today: late,
          absent_today: absent,
          pending_approvals: d.pending_approvals ?? 0,
          total_employees: d.total_employees ?? 0,
          attendance_rate: Math.round(((present + late) / total) * 100),
          anomaly_count: d.anomaly_count ?? d.total_anomalies ?? 0,
          date: d.date ?? new Date().toISOString().split('T')[0],
        } as AnalyticsSummary,
      };
    });
  },
  employeeStats: (userId: string) => {
    if (isDemoMode()) return demoRes(Demo.DEMO_STATS);
    return api.get<AttendanceStats>(`/analytics/employee/${userId}`);
  },
  heatmap: () => {
    if (isDemoMode()) return demoRes({ points: [], max_count: 0, generated_at: new Date().toISOString() });
    return api.get('/analytics/heatmap');
  },
  trends: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_TRENDS);
    return api.get('/analytics/trends');
  },
  anomalies: (minScore = 0.3) => {
    if (isDemoMode()) return demoRes(Demo.DEMO_ANOMALIES);
    return api.get(`/analytics/anomalies?min_score=${minScore}`);
  },
  attendanceToday: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_ROSTER);
    return api.get<any[]>('/analytics/attendance-today');
  },
  export: (startDate: string, endDate: string, reportType = 'daily') => {
    if (isDemoMode()) return demoRes({ task_id: 'demo-task-001', status: 'completed' });
    return api.post(`/analytics/export?start_date=${startDate}&end_date=${endDate}&report_type=${reportType}`);
  },
  exportStatus: (taskId: string) => {
    if (isDemoMode()) return demoRes({ status: 'completed', download_url: undefined });
    return api.get<{ status: string; download_url?: string }>(`/analytics/export/${taskId}`);
  },
};

export const notificationsApi = {
  list: () => {
    if (isDemoMode()) return demoRes(Demo.DEMO_NOTIFICATIONS);
    return api.get<NotificationListResponse>('/notifications/');
  },
  markRead: (id: string) => {
    if (isDemoMode()) return demoRes({});
    return api.post(`/notifications/${id}/read`);
  },
  markAllRead: () => {
    if (isDemoMode()) return demoRes({});
    return api.post('/notifications/read-all');
  },
};
