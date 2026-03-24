import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '@/store/authStore';

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
    if (error.response?.status === 401) {
      // Clear auth and let the root layout redirect to login
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;

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
  login: (credentials: LoginCredentials) =>
    api.post<AuthResponse>('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<import('@/types').User>('/users/me'),
  register: (payload: { full_name: string; email: string; password: string; role: string }) =>
    api.post('/auth/register', payload),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, new_password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, new_password }),
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

  today: () =>
    api.get<any[]>('/attendance/today').then(r => {
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
    }),

  history: (page = 1, perPage = 20) => {
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

  stats: () => api.get<AttendanceStats>('/attendance/stats'),
  upcomingShift: () => api.get<UpcomingShift | null>('/attendance/upcoming-shift'),
  markSafe: (recordId: string, note: string = '') =>
    api.post<AttendanceRecord>(`/attendance/${recordId}/mark-safe`, { note }),
};

export const sitesApi = {
  list: (orgId: string) =>
    api.get<Site[]>(`/organisations/${orgId}/sites`),
  get: (orgId: string, siteId: string) =>
    api.get<Site>(`/organisations/${orgId}/sites/${siteId}`),
  create: (orgId: string, payload: SiteCreatePayload) =>
    api.post<Site>(`/organisations/${orgId}/sites`, payload),
  update: (orgId: string, siteId: string, payload: SiteUpdatePayload) =>
    api.patch<Site>(`/organisations/${orgId}/sites/${siteId}`, payload),
  deactivate: (orgId: string, siteId: string) =>
    api.delete(`/organisations/${orgId}/sites/${siteId}`),
};

export const approvalsApi = {
  list: () =>
    api.get<Approval[]>('/approvals/'),
  get: (id: string) =>
    api.get<Approval>(`/approvals/${id}`),
  approve: (approvalId: string, note = '') =>
    api.post(`/approvals/${approvalId}/approve`, { note }),
  reject: (approvalId: string, note = '') =>
    api.post(`/approvals/${approvalId}/reject`, { note }),
  bulkApprove: (approval_ids: string[], note = 'Bulk approved') =>
    api.post('/approvals/bulk-approve', { approval_ids, note }),
};

export const usersApi = {
  list: (orgId?: string) =>
    api.get<{ items: User[]; total: number }>(`/users/?limit=100${orgId ? `&org_id=${orgId}` : ''}`),
  update: (userId: string, payload: Partial<{ full_name: string; is_active: boolean; role: string }>) =>
    api.patch<User>(`/users/${userId}`, payload),
  create: (payload: { email: string; password: string; full_name: string; org_id: string; role: string }) =>
    api.post<User>('/users/', payload),
  leaderboard: () => api.get<LeaderboardEntry[]>('/users/leaderboard'),
};

export const manualCheckinApi = {
  submit: (payload: ManualCheckinPayload) =>
    api.post('/attendance/manual', payload),
};

export const analyticsApi = {
  summary: () =>
    api.get<any>('/analytics/summary').then(r => {
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
    }),
  employeeStats: (userId: string) =>
    api.get<AttendanceStats>(`/analytics/employee/${userId}`),
  heatmap: () => api.get('/analytics/heatmap'),
  trends: () => api.get('/analytics/trends'),
  anomalies: (minScore = 0.3) => api.get(`/analytics/anomalies?min_score=${minScore}`),
  attendanceToday: () => api.get<any[]>('/analytics/attendance-today'),
  export: (startDate: string, endDate: string, reportType = 'daily') =>
    api.post(`/analytics/export?start_date=${startDate}&end_date=${endDate}&report_type=${reportType}`),
  exportStatus: (taskId: string) =>
    api.get<{ status: string; download_url?: string }>(`/analytics/export/${taskId}`),
};

export const notificationsApi = {
  list: () => api.get<NotificationListResponse>('/notifications/'),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};
