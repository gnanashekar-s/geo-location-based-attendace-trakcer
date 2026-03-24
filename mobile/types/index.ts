// ─── User & Auth Types ────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'employee' | 'admin' | 'org_admin' | 'super_admin';
  org_id: string;
  department?: string;
  avatar_url?: string;
  streak_count?: number;
  is_active?: boolean;
  created_at: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ─── Attendance Types ─────────────────────────────────────────────────────────

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'pending' | 'approved' | 'rejected';

export interface AttendanceRecord {
  id: string;
  user_id: string;
  site_id: string;
  site_name: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  duration_minutes: number | null;
  status: AttendanceStatus;
  latitude: number;
  longitude: number;
  accuracy: number;
  fraud_score: number;
  is_mocked: boolean;
  photo_url?: string;
  notes?: string;
  approved_by?: string;
  created_at: string;
}

export interface CheckInPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  photo_base64?: string;
  device_id?: string;
  is_checkout?: boolean;
}

export interface CheckInResponse {
  attendance: AttendanceRecord;
  fraud_score: number;
  fraud_flags: string[];
  distance_meters: number;
  within_geofence: boolean;
  requires_approval: boolean;
}

export interface AttendanceToday {
  record: AttendanceRecord | null;
  status: AttendanceStatus;
  streak_count: number;
  check_in_time?: string;
  check_out_time?: string;
}

// ─── Site / Geofence Types ────────────────────────────────────────────────────

export interface Site {
  id: string;
  org_id: string;
  name: string;
  address: string;
  center_lat: number;
  center_lng: number;
  radius_meters: number;
  polygon?: any;
  is_active: boolean;
  employee_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SiteCreatePayload {
  name: string;
  address: string;
  center_lat: number;
  center_lng: number;
  radius_meters: number;
}

export interface SiteUpdatePayload {
  name?: string;
  address?: string;
  center_lat?: number;
  center_lng?: number;
  radius_meters?: number;
  is_active?: boolean;
}

// ─── Approval Types ───────────────────────────────────────────────────────────

export type EscalationLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Approval {
  id: string;
  attendance_id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  reason: string;
  submitted_at: string;
  escalation_level: EscalationLevel;
  fraud_score: number;
  fraud_flags: string[];
  photo_url?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  notes?: string;
}

export interface ApprovalActionPayload {
  note?: string;
}

export interface ManualCheckinPayload {
  site_id: string;
  reason_code: string;
  reason_text: string;
  photo_url?: string;
}

// ─── Analytics Types ──────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  present_today: number;
  late_today: number;
  absent_today: number;
  pending_approvals: number;
  total_employees: number;
  attendance_rate: number;
  anomaly_count?: number;
  date: string;
}

export interface AttendanceStats {
  total_check_ins: number;
  current_streak: number;
  longest_streak: number;
  punctuality_percentage: number;
  late_count: number;
  absent_count: number;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

// ─── WebSocket Types ──────────────────────────────────────────────────────────

export interface LiveCheckInEvent {
  event: 'check_in' | 'check_out' | 'fraud_alert';
  employee_name: string;
  site_name: string;
  timestamp: string;
  fraud_score?: number;
  is_late?: boolean;
}

// ─── Anomaly Types ────────────────────────────────────────────────────────────

export interface AnomalyRecord {
  attendance_id: string;
  user_id: string;
  user_name: string;
  fraud_score: number;
  fraud_flags: string[];
  created_at: string;
}

// ─── Trend Types ──────────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  present_count: number;
  late_count: number;
  absent_count: number;
}

// ─── Leaderboard Types ────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string;
  full_name: string;
  streak_count: number;
  punctuality_percentage: number;
}

// ─── Shift Types ──────────────────────────────────────────────────────────────

export interface UpcomingShift {
  shift_name: string;
  site_name: string;
  start_time: string;
  end_time: string;
  date: string;
}

// ─── Notification API Types ───────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread_count: number;
}

// ─── Navigation Types ─────────────────────────────────────────────────────────

export type RootStackParamList = {
  '(auth)/login': undefined;
  '(employee)': undefined;
  '(admin)': undefined;
};
