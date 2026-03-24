import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  InfiniteData,
} from '@tanstack/react-query';
import { apiGet, apiPost, PaginatedResponse } from './client';
import { useAttendanceStore } from '@/store/attendanceStore';
import type { AttendanceRecord, Site } from '@/store/attendanceStore';

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: () => [...attendanceKeys.all, 'today'] as const,
  history: (filters?: AttendanceHistoryParams) =>
    [...attendanceKeys.all, 'history', filters] as const,
  approvals: (filters?: ApprovalsParams) =>
    ['approvals', filters] as const,
  approvalDetail: (id: string) => ['approvals', id] as const,
};

// ─── Request / Response Types ─────────────────────────────────────────────────

export interface CheckinRequest {
  site_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_mock_location: boolean;
  photo_base64?: string;
  notes?: string;
}

export interface CheckoutRequest {
  attendance_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_mock_location: boolean;
  photo_base64?: string;
  notes?: string;
}

export interface BreakRequest {
  attendance_id: string;
  /** 'break_start' | 'break_end' */
  event_type: 'break_start' | 'break_end';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_mock_location: boolean;
}

export interface TodayAttendanceResponse {
  record: AttendanceRecord | null;
  site: Site | null;
  work_duration_minutes: number;
  break_duration_minutes: number;
  streak_days: number;
  status: string;
}

export interface AttendanceHistoryParams {
  start_date?: string; // ISO date YYYY-MM-DD
  end_date?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export interface ManualApprovalRequest {
  site_id: string;
  event_type: 'checkin' | 'checkout';
  requested_time: string; // ISO datetime
  reason: string;
  latitude?: number;
  longitude?: number;
}

export interface ManualApprovalResponse {
  id: string;
  user_id: string;
  site_id: string;
  event_type: string;
  requested_time: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ApprovalsParams {
  status?: 'pending' | 'approved' | 'rejected';
  page?: number;
  page_size?: number;
}

export interface ApprovalRecord {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  site_id: string;
  site_name: string;
  event_type: string;
  requested_time: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface ApproveRejectRequest {
  notes?: string;
}

export interface ApproveRejectResponse {
  id: string;
  status: 'approved' | 'rejected';
  reviewed_at: string;
  message: string;
}

// ─── Raw API Functions ────────────────────────────────────────────────────────

export const checkinApi = (payload: CheckinRequest) =>
  apiPost<CheckinRequest, AttendanceRecord>('/api/v1/attendance/checkin', payload);

export const checkoutApi = (payload: CheckoutRequest) =>
  apiPost<CheckoutRequest, AttendanceRecord>('/api/v1/attendance/checkout', payload);

export const breakApi = (payload: BreakRequest) =>
  apiPost<BreakRequest, AttendanceRecord>('/api/v1/attendance/break', payload);

export const getTodayAttendance = () =>
  apiGet<TodayAttendanceResponse>('/api/v1/attendance/today');

export const getAttendanceHistory = (params: AttendanceHistoryParams) =>
  apiGet<PaginatedResponse<AttendanceRecord>>('/api/v1/attendance/history', {
    params,
  });

export const submitManualApproval = (payload: ManualApprovalRequest) =>
  apiPost<ManualApprovalRequest, ManualApprovalResponse>(
    '/api/v1/attendance/manual',
    payload,
  );

export const getApprovals = (params: ApprovalsParams) =>
  apiGet<PaginatedResponse<ApprovalRecord>>('/api/v1/approvals', { params });

export const approveRequest = (id: string, payload: ApproveRejectRequest) =>
  apiPost<ApproveRejectRequest, ApproveRejectResponse>(
    `/api/v1/approvals/${id}/approve`,
    payload,
  );

export const rejectRequest = (id: string, payload: ApproveRejectRequest) =>
  apiPost<ApproveRejectRequest, ApproveRejectResponse>(
    `/api/v1/approvals/${id}/reject`,
    payload,
  );

// ─── React Query Hooks ────────────────────────────────────────────────────────

/** POST /api/v1/attendance/checkin */
export function useCheckin() {
  const { applyEvent } = useAttendanceStore();
  const queryClient = useQueryClient();

  return useMutation<AttendanceRecord, Error, CheckinRequest>({
    mutationFn: checkinApi,
    onSuccess: (data) => {
      applyEvent(data);
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
    },
  });
}

/** POST /api/v1/attendance/checkout */
export function useCheckout() {
  const { applyEvent } = useAttendanceStore();
  const queryClient = useQueryClient();

  return useMutation<AttendanceRecord, Error, CheckoutRequest>({
    mutationFn: checkoutApi,
    onSuccess: (data) => {
      applyEvent(data);
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
      queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

/** POST /api/v1/attendance/break */
export function useBreak() {
  const { applyEvent } = useAttendanceStore();
  const queryClient = useQueryClient();

  return useMutation<AttendanceRecord, Error, BreakRequest>({
    mutationFn: breakApi,
    onSuccess: (data) => {
      applyEvent(data);
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
    },
  });
}

/** GET /api/v1/attendance/today */
export function useTodayAttendance() {
  const { setTodayRecord, setCurrentSite } = useAttendanceStore();

  return useQuery<TodayAttendanceResponse, Error>({
    queryKey: attendanceKeys.today(),
    queryFn: async () => {
      const data = await getTodayAttendance();
      setTodayRecord(data.record);
      if (data.site) setCurrentSite(data.site);
      return data;
    },
    staleTime: 30_000, // 30 s
    refetchInterval: 60_000, // poll every 60 s
  });
}

/** GET /api/v1/attendance/history — infinite scroll */
export function useAttendanceHistory(
  filters?: Omit<AttendanceHistoryParams, 'page'>,
) {
  return useInfiniteQuery<
    PaginatedResponse<AttendanceRecord>,
    Error,
    InfiniteData<PaginatedResponse<AttendanceRecord>>,
    ReturnType<typeof attendanceKeys.history>,
    number
  >({
    queryKey: attendanceKeys.history(filters),
    queryFn: ({ pageParam }) =>
      getAttendanceHistory({ ...filters, page: pageParam, page_size: 20 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.has_next ? lastPage.page + 1 : undefined,
    staleTime: 60_000,
  });
}

/** POST /api/v1/attendance/manual */
export function useManualApproval() {
  const queryClient = useQueryClient();

  return useMutation<ManualApprovalResponse, Error, ManualApprovalRequest>({
    mutationFn: submitManualApproval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.approvals() });
    },
  });
}

/** GET /api/v1/approvals — admin */
export function useApprovals(params?: ApprovalsParams) {
  return useQuery<PaginatedResponse<ApprovalRecord>, Error>({
    queryKey: attendanceKeys.approvals(params),
    queryFn: () => getApprovals(params ?? {}),
    staleTime: 30_000,
  });
}

/** POST /api/v1/approvals/{id}/approve */
export function useApproveRequest() {
  const queryClient = useQueryClient();

  return useMutation<
    ApproveRejectResponse,
    Error,
    { id: string; notes?: string }
  >({
    mutationFn: ({ id, notes }) => approveRequest(id, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

/** POST /api/v1/approvals/{id}/reject */
export function useRejectRequest() {
  const queryClient = useQueryClient();

  return useMutation<
    ApproveRejectResponse,
    Error,
    { id: string; notes?: string }
  >({
    mutationFn: ({ id, notes }) => rejectRequest(id, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}
