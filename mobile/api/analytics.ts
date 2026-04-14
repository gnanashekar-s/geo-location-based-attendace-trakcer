import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from './client';
import { useAuthStore } from '@/store/authStore';
import { DEMO_DEPT_LEADERBOARD, DEMO_FRAUD_SUMMARY, DEMO_BUDDY_PUNCH_INCIDENTS } from '@/services/demoData';

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const analyticsKeys = {
  all: ['analytics'] as const,
  summary: (params?: SummaryParams) =>
    [...analyticsKeys.all, 'summary', params] as const,
  heatmap: (params?: HeatmapParams) =>
    [...analyticsKeys.all, 'heatmap', params] as const,
  trends: (params?: TrendsParams) =>
    [...analyticsKeys.all, 'trends', params] as const,
  anomalies: (params?: AnomaliesParams) =>
    [...analyticsKeys.all, 'anomalies', params] as const,
};

// ─── Shared Primitive Types ───────────────────────────────────────────────────

export interface DateRange {
  start_date: string; // YYYY-MM-DD
  end_date: string;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface SummaryParams extends Partial<DateRange> {
  user_id?: string;
  department?: string;
  site_id?: string;
}

export interface AttendanceSummary {
  total_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  half_days: number;
  on_leave_days: number;
  attendance_rate: number; // 0–1
  avg_work_hours: number;
  total_work_hours: number;
  avg_break_minutes: number;
  current_streak: number;
  longest_streak: number;
  punctuality_score: number; // 0–1
  period_label: string;
}

export interface DepartmentSummary {
  department: string;
  employee_count: number;
  attendance_rate: number;
  avg_work_hours: number;
  late_rate: number;
}

export interface SummaryResponse {
  individual: AttendanceSummary;
  department?: DepartmentSummary;
  company_avg_attendance_rate?: number;
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

export interface HeatmapParams extends Partial<DateRange> {
  site_id?: string;
  resolution?: 'hour' | 'day' | 'week';
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number; // 0–1 normalised
  count: number;
  label?: string;
}

export interface HeatmapResponse {
  points: HeatmapPoint[];
  max_count: number;
  generated_at: string;
}

// ─── Trends ──────────────────────────────────────────────────────────────────

export interface TrendsParams extends Partial<DateRange> {
  metric?: 'attendance_rate' | 'work_hours' | 'punctuality' | 'fraud_score';
  granularity?: 'day' | 'week' | 'month';
  department?: string;
  site_id?: string;
}

export interface TrendDataPoint {
  date: string; // ISO
  value: number;
  employee_count?: number;
  label?: string;
}

export interface TrendsResponse {
  metric: string;
  granularity: string;
  data_points: TrendDataPoint[];
  trend_direction: 'up' | 'down' | 'stable';
  change_percent: number;
  period_label: string;
}

// ─── Anomalies ───────────────────────────────────────────────────────────────

export interface AnomaliesParams extends Partial<DateRange> {
  min_score?: number; // 0–1 fraud score threshold
  site_id?: string;
  user_id?: string;
  page?: number;
  page_size?: number;
}

export type AnomalyType =
  | 'mock_location'
  | 'outside_geofence'
  | 'rapid_movement'
  | 'unusual_hours'
  | 'vpn_detected'
  | 'device_spoofing'
  | 'duplicate_checkin'
  | 'impossible_travel';

export interface AnomalyRecord {
  id: string;
  attendance_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  site_id: string;
  site_name: string;
  event_type: string;
  created_at: string;
  fraud_score: number;
  fraud_flags: AnomalyType[];
  latitude: number;
  longitude: number;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export interface AnomaliesResponse {
  items: AnomalyRecord[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  high_risk_count: number;
  medium_risk_count: number;
}

// ─── Raw API Functions ────────────────────────────────────────────────────────

export const getSummary = (params?: SummaryParams) =>
  apiGet<SummaryResponse>('/api/v1/analytics/summary', { params });

export const getHeatmap = (params?: HeatmapParams) =>
  apiGet<HeatmapResponse>('/api/v1/analytics/heatmap', { params });

export const getTrends = (params?: TrendsParams) =>
  apiGet<TrendsResponse>('/api/v1/analytics/trends', { params });

export const getAnomalies = (params?: AnomaliesParams) =>
  apiGet<AnomaliesResponse>('/api/v1/analytics/anomalies', { params });

// ─── React Query Hooks ────────────────────────────────────────────────────────

/** GET /api/v1/analytics/summary */
export function useAnalyticsSummary(params?: SummaryParams) {
  return useQuery<SummaryResponse, Error>({
    queryKey: analyticsKeys.summary(params),
    queryFn: () => getSummary(params),
    staleTime: 5 * 60_000, // 5 min
  });
}

/** GET /api/v1/analytics/heatmap */
export function useHeatmap(params?: HeatmapParams) {
  return useQuery<HeatmapResponse, Error>({
    queryKey: analyticsKeys.heatmap(params),
    queryFn: () => getHeatmap(params),
    staleTime: 5 * 60_000,
  });
}

/** GET /api/v1/analytics/trends */
export function useTrends(params?: TrendsParams) {
  return useQuery<TrendsResponse, Error>({
    queryKey: analyticsKeys.trends(params),
    queryFn: () => getTrends(params),
    staleTime: 5 * 60_000,
  });
}

/** GET /api/v1/analytics/anomalies */
export function useAnomalies(params?: AnomaliesParams) {
  return useQuery<AnomaliesResponse, Error>({
    queryKey: analyticsKeys.anomalies(params),
    queryFn: () => getAnomalies(params),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000, // poll every 2 min for real-time fraud alerts
  });
}

// ─── Fraud Summary ─────────────────────────────────────────────────────────

export interface FraudFlagBreakdown {
  flag: string;
  count: number;
}

export interface TopRiskyUser {
  user_id: string;
  full_name: string;
  risk_level: 'low' | 'medium' | 'high';
  avg_fraud_score: number;
  flag_count: number;
}

export interface FraudSummaryResponse {
  total_flagged_today: number;
  flag_breakdown: FraudFlagBreakdown[];
  top_risky_users: TopRiskyUser[];
  high_risk_user_count: number;
  medium_risk_user_count: number;
  low_risk_user_count: number;
}

// ─── User Risk Profile ──────────────────────────────────────────────────────

export interface DailyFraudPoint {
  date: string;
  avg_score: number;
  event_count: number;
}

export interface BehavioralBaseline {
  mean_checkin_hour: number;
  std_hours: number;
  sample_size: number;
}

export interface UserRiskProfileResponse {
  user_id: string;
  full_name: string;
  risk_level: string;
  thirty_day_history: DailyFraudPoint[];
  flag_frequency: FraudFlagBreakdown[];
  behavioral_baseline: BehavioralBaseline;
}

// ─── Buddy Punch Incidents ──────────────────────────────────────────────────

export interface BuddyPunchUser {
  user_id: string;
  full_name: string;
  attendance_id: string;
  lat: number;
  lng: number;
  timestamp: string;
}

export interface BuddyPunchIncident {
  site_id: string;
  site_name: string;
  incident_time: string;
  users: BuddyPunchUser[];
  distance_meters: number;
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

export const fraudSummaryKey = () => ['analytics', 'fraud-summary'] as const;
export const userRiskProfileKey = (userId: string) =>
  ['analytics', 'risk-profile', userId] as const;
export const buddyPunchKey = () => ['analytics', 'buddy-punch'] as const;

// ─── Raw API Functions ───────────────────────────────────────────────────────

export const getFraudSummary = () =>
  apiGet<FraudSummaryResponse>('/api/v1/analytics/fraud-summary');

export const getUserRiskProfile = (userId: string) =>
  apiGet<UserRiskProfileResponse>(`/api/v1/analytics/user-risk-profile/${userId}`);

export const getBuddyPunchIncidents = () =>
  apiGet<BuddyPunchIncident[]>('/api/v1/analytics/buddy-punch-incidents');

export const whitelistDevice = (body: {
  user_id: string;
  device_fingerprint: string;
  reason: string;
}) =>
  apiPost<typeof body, { id: string; created_at: string }>(
    '/api/v1/analytics/whitelist-device',
    body,
  );

export const setInvestigationStatus = (
  attendanceId: string,
  statusVal: 'investigating' | 'resolved',
  note = '',
) =>
  apiPatch<{ status: string; note: string }, { id: string; investigation_status: string }>(
    `/api/v1/analytics/attendance/${attendanceId}/investigate`,
    { status: statusVal, note },
  );

// ─── React Query Hooks ───────────────────────────────────────────────────────

export function useFraudSummary() {
  const demoMode = useAuthStore(s => s.isDemoMode);
  return useQuery<FraudSummaryResponse, Error>({
    queryKey: fraudSummaryKey(),
    queryFn: demoMode ? () => Promise.resolve(DEMO_FRAUD_SUMMARY) : getFraudSummary,
    staleTime: 60_000,
    refetchInterval: demoMode ? false : 2 * 60_000,
  });
}

export function useUserRiskProfile(userId: string) {
  return useQuery<UserRiskProfileResponse, Error>({
    queryKey: userRiskProfileKey(userId),
    queryFn: () => getUserRiskProfile(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}

export function useBuddyPunchIncidents() {
  const demoMode = useAuthStore(s => s.isDemoMode);
  return useQuery<BuddyPunchIncident[], Error>({
    queryKey: buddyPunchKey(),
    queryFn: demoMode ? () => Promise.resolve(DEMO_BUDDY_PUNCH_INCIDENTS) : getBuddyPunchIncidents,
    staleTime: 5 * 60_000,
    refetchInterval: demoMode ? false : 5 * 60_000,
  });
}

// ─── Geofence Radius Suggestion ──────────────────────────────────────────────

export interface RadiusSuggestionResponse {
  site_id: string;
  site_name: string;
  current_radius_meters: number;
  suggested_radius_meters: number;
  sample_count: number;
  confidence: 'high' | 'medium' | 'low';
}

export const getGeofenceRadiusSuggestion = (siteId: string) =>
  apiGet<RadiusSuggestionResponse>(`/api/v1/analytics/geofence-radius-suggestion?site_id=${siteId}`);

export function useGeofenceRadiusSuggestion(siteId: string | null) {
  return useQuery<RadiusSuggestionResponse, Error>({
    queryKey: ['analytics', 'geofence-radius', siteId],
    queryFn: () => getGeofenceRadiusSuggestion(siteId!),
    enabled: !!siteId,
    staleTime: 10 * 60_000,
  });
}

// ─── Department Leaderboard ───────────────────────────────────────────────────

export interface DeptLeaderboardEntry {
  rank: number;
  department: string;
  total_employees: number;
  checked_in: number;
  attendance_rate: number;
  late_count: number;
  avg_fraud_score: number;
}

export const getDeptLeaderboard = () =>
  apiGet<DeptLeaderboardEntry[]>('/api/v1/analytics/department-leaderboard');

export function useDeptLeaderboard() {
  const demoMode = useAuthStore(s => s.isDemoMode);
  return useQuery<DeptLeaderboardEntry[], Error>({
    queryKey: ['analytics', 'dept-leaderboard'],
    queryFn: demoMode ? () => Promise.resolve(DEMO_DEPT_LEADERBOARD) : getDeptLeaderboard,
    staleTime: 5 * 60_000,
    refetchInterval: demoMode ? false : 5 * 60_000,
  });
}
