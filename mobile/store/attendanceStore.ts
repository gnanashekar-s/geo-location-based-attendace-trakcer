import { create } from 'zustand';

// ─── Domain Types ────────────────────────────────────────────────────────────

export type EventType = 'checkin' | 'checkout' | 'break_start' | 'break_end';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'half_day'
  | 'on_leave'
  | 'pending';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  site_id: string;
  event_type: EventType;
  status: AttendanceStatus;
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_mock_location: boolean;
  fraud_score: number;
  fraud_flags: string[];
  photo_url: string | null;
  notes: string | null;
  work_duration_minutes: number | null;
  break_duration_minutes: number | null;
  created_at: string;
}

export interface Site {
  id: string;
  name: string;
  address: string;
  center_lat: number;
  center_lng: number;
  radius_meters: number;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

interface AttendanceState {
  todayRecord: AttendanceRecord | null;
  isCheckedIn: boolean;
  currentSite: Site | null;

  // Actions
  setTodayRecord: (record: AttendanceRecord | null) => void;
  setCheckedIn: (status: boolean) => void;
  setCurrentSite: (site: Site | null) => void;
  /** Append / overwrite an event to today's summary without a full refetch. */
  applyEvent: (event: AttendanceRecord) => void;
  reset: () => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

const initialState = {
  todayRecord: null,
  isCheckedIn: false,
  currentSite: null,
};

export const useAttendanceStore = create<AttendanceState>()((set) => ({
  ...initialState,

  setTodayRecord: (record: AttendanceRecord | null) => {
    set({
      todayRecord: record,
      // Derive check-in status from the latest event type
      isCheckedIn:
        record !== null &&
        (record.event_type === 'checkin' ||
          record.event_type === 'break_start' ||
          record.event_type === 'break_end'),
    });
  },

  setCheckedIn: (status: boolean) => {
    set({ isCheckedIn: status });
  },

  setCurrentSite: (site: Site | null) => {
    set({ currentSite: site });
  },

  applyEvent: (event: AttendanceRecord) => {
    set({
      todayRecord: event,
      isCheckedIn:
        event.event_type === 'checkin' ||
        event.event_type === 'break_start' ||
        event.event_type === 'break_end',
    });
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectTodayRecord = (s: AttendanceState) => s.todayRecord;
export const selectIsCheckedIn = (s: AttendanceState) => s.isCheckedIn;
export const selectCurrentSite = (s: AttendanceState) => s.currentSite;
