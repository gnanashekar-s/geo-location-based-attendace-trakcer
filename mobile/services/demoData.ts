/**
 * Demo Mode – static mock data for offline frontend demonstration.
 *
 * Every API function in api.ts checks `useAuthStore.getState().isDemoMode`
 * and returns these fixtures instead of hitting the real backend.
 */

import { format, subDays, subHours, addHours, startOfToday } from 'date-fns';

// ─── IDs ──────────────────────────────────────────────────────────────────────

const ORG_ID = 'demo-org-001';
const ADMIN_ID = 'demo-admin-001';
const EMP_1 = 'demo-emp-001';
const EMP_2 = 'demo-emp-002';
const EMP_3 = 'demo-emp-003';
const EMP_4 = 'demo-emp-004';
const EMP_5 = 'demo-emp-005';
const EMP_6 = 'demo-emp-006';
const EMP_7 = 'demo-emp-007';
const EMP_8 = 'demo-emp-008';
const SITE_1 = 'demo-site-001';
const SITE_2 = 'demo-site-002';

// ─── Demo Users ───────────────────────────────────────────────────────────────

export const DEMO_ADMIN = {
    id: ADMIN_ID,
    email: 'admin@geoattend.demo',
    full_name: 'Sarah Johnson',
    role: 'org_admin' as const,
    org_id: ORG_ID,
    is_active: true,
    streak_count: 45,
    department: 'Management',
    avatar_url: null,
    created_at: '2025-01-15T00:00:00Z',
};

export const DEMO_EMPLOYEE = {
    id: EMP_1,
    email: 'john@geoattend.demo',
    full_name: 'John Martinez',
    role: 'employee' as const,
    org_id: ORG_ID,
    is_active: true,
    streak_count: 12,
    department: 'Engineering',
    avatar_url: null,
    created_at: '2025-03-01T00:00:00Z',
};

const ALL_EMPLOYEES = [
    { id: EMP_1, full_name: 'John Martinez', email: 'john@geoattend.demo', role: 'employee', department: 'Engineering', is_active: true, streak_count: 12 },
    { id: EMP_2, full_name: 'Emily Chen', email: 'emily@geoattend.demo', role: 'employee', department: 'Engineering', is_active: true, streak_count: 28 },
    { id: EMP_3, full_name: 'Raj Patel', email: 'raj@geoattend.demo', role: 'employee', department: 'Operations', is_active: true, streak_count: 7 },
    { id: EMP_4, full_name: 'Maria Garcia', email: 'maria@geoattend.demo', role: 'employee', department: 'Sales', is_active: true, streak_count: 34 },
    { id: EMP_5, full_name: 'Alex Kim', email: 'alex@geoattend.demo', role: 'employee', department: 'Engineering', is_active: true, streak_count: 5 },
    { id: EMP_6, full_name: 'Lisa Wang', email: 'lisa@geoattend.demo', role: 'supervisor', department: 'Operations', is_active: true, streak_count: 22 },
    { id: EMP_7, full_name: 'David Brown', email: 'david@geoattend.demo', role: 'employee', department: 'Sales', is_active: true, streak_count: 0 },
    { id: EMP_8, full_name: 'Priya Sharma', email: 'priya@geoattend.demo', role: 'employee', department: 'HR', is_active: true, streak_count: 18 },
];

// ─── Sites ────────────────────────────────────────────────────────────────────

export const DEMO_SITES = [
    {
        id: SITE_1,
        org_id: ORG_ID,
        name: 'HQ – Downtown Office',
        address: '123 Business Park, Floor 5, Downtown',
        center_lat: 28.6139,
        center_lng: 77.2090,
        radius_meters: 150,
        polygon: null,
        is_active: true,
        employee_count: 24,
        created_at: '2025-01-20T00:00:00Z',
        updated_at: '2026-03-20T00:00:00Z',
    },
    {
        id: SITE_2,
        org_id: ORG_ID,
        name: 'Warehouse – Industrial Zone',
        address: '456 Industrial Area, Block B',
        center_lat: 28.5355,
        center_lng: 77.3910,
        radius_meters: 200,
        polygon: null,
        is_active: true,
        employee_count: 12,
        created_at: '2025-02-10T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
    },
];

// ─── Attendance Records ───────────────────────────────────────────────────────

function makeRecord(dayOffset: number, status: string, siteName: string, userId = EMP_1) {
    const day = subDays(new Date(), dayOffset);
    const checkinHour = status === 'late' ? 9 + Math.random() * 2 : 7.5 + Math.random() * 1.5;
    const checkin = new Date(day);
    checkin.setHours(Math.floor(checkinHour), Math.round((checkinHour % 1) * 60), 0, 0);
    const checkout = addHours(checkin, 8 + Math.random() * 1.5);
    const duration = Math.round((checkout.getTime() - checkin.getTime()) / 60000);

    return {
        id: `rec-${userId}-${dayOffset}`,
        user_id: userId,
        site_id: SITE_1,
        site_name: siteName,
        date: format(day, 'yyyy-MM-dd'),
        check_in_time: checkin.toISOString(),
        check_out_time: dayOffset === 0 ? null : checkout.toISOString(),
        duration_minutes: dayOffset === 0 ? null : duration,
        status,
        latitude: 28.6139 + (Math.random() - 0.5) * 0.001,
        longitude: 77.2090 + (Math.random() - 0.5) * 0.001,
        accuracy: 5 + Math.random() * 10,
        fraud_score: Math.random() * 0.15,
        is_mocked: false,
        photo_url: null,
        created_at: checkin.toISOString(),
    };
}

const DEMO_HISTORY = [
    makeRecord(0, 'present', 'HQ – Downtown Office'),
    makeRecord(1, 'present', 'HQ – Downtown Office'),
    makeRecord(2, 'late', 'HQ – Downtown Office'),
    makeRecord(3, 'present', 'HQ – Downtown Office'),
    makeRecord(4, 'present', 'Warehouse – Industrial Zone'),
    makeRecord(5, 'present', 'HQ – Downtown Office'),
    makeRecord(6, 'present', 'HQ – Downtown Office'),
    makeRecord(8, 'late', 'HQ – Downtown Office'),
    makeRecord(9, 'present', 'HQ – Downtown Office'),
    makeRecord(10, 'present', 'HQ – Downtown Office'),
];

// ─── Today's check-in (employee demo defaults to "checked in") ────────────────

const todayCheckin = DEMO_HISTORY[0];

export const DEMO_TODAY = {
    record: todayCheckin,
    status: 'present' as const,
    streak_count: 12,
    check_in_time: todayCheckin.check_in_time,
    check_out_time: null as string | null,
    duration_minutes: null as number | null,
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export const DEMO_STATS = {
    total_check_ins: 85,
    current_streak: 12,
    longest_streak: 28,
    punctuality_percentage: 92,
    attendance_rate: 95,
    late_count: 4,
    absent_count: 2,
};

// ─── Upcoming Shift ───────────────────────────────────────────────────────────

export const DEMO_UPCOMING_SHIFT = {
    shift_name: 'Morning Shift',
    site_name: 'HQ – Downtown Office',
    start_time: '09:00 AM',
    end_time: '06:00 PM',
    date: format(new Date(), 'yyyy-MM-dd'),
};

// ─── Analytics Summary (Admin) ────────────────────────────────────────────────

export const DEMO_ANALYTICS_SUMMARY = {
    present_today: 18,
    late_today: 3,
    absent_today: 3,
    pending_approvals: 5,
    total_employees: 24,
    attendance_rate: 88,
    anomaly_count: 2,
    date: format(new Date(), 'yyyy-MM-dd'),
};

// ─── Trends ───────────────────────────────────────────────────────────────────

export const DEMO_TRENDS = Array.from({ length: 7 }, (_, i) => {
    const day = subDays(new Date(), 6 - i);
    return {
        date: format(day, 'yyyy-MM-dd'),
        present_count: 16 + Math.floor(Math.random() * 6),
        late_count: 1 + Math.floor(Math.random() * 4),
        absent_count: 1 + Math.floor(Math.random() * 3),
    };
});

// ─── Attendance Today (Roster) ────────────────────────────────────────────────

export const DEMO_ROSTER = [
    { user_id: EMP_1, id: EMP_1, full_name: 'John Martinez', status: 'present', is_late: false, check_in_time: subHours(new Date(), 3).toISOString(), check_out_time: null },
    { user_id: EMP_2, id: EMP_2, full_name: 'Emily Chen', status: 'present', is_late: false, check_in_time: subHours(new Date(), 4).toISOString(), check_out_time: null },
    { user_id: EMP_3, id: EMP_3, full_name: 'Raj Patel', status: 'present', is_late: true, check_in_time: subHours(new Date(), 1).toISOString(), check_out_time: null },
    { user_id: EMP_4, id: EMP_4, full_name: 'Maria Garcia', status: 'present', is_late: false, check_in_time: subHours(new Date(), 5).toISOString(), check_out_time: null },
    { user_id: EMP_5, id: EMP_5, full_name: 'Alex Kim', status: 'absent', is_late: false, check_in_time: null, check_out_time: null },
    { user_id: EMP_6, id: EMP_6, full_name: 'Lisa Wang', status: 'present', is_late: false, check_in_time: subHours(new Date(), 4).toISOString(), check_out_time: subHours(new Date(), 0.5).toISOString() },
    { user_id: EMP_7, id: EMP_7, full_name: 'David Brown', status: 'absent', is_late: false, check_in_time: null, check_out_time: null },
    { user_id: EMP_8, id: EMP_8, full_name: 'Priya Sharma', status: 'present', is_late: true, check_in_time: subHours(new Date(), 2).toISOString(), check_out_time: null },
];

// ─── Approvals ────────────────────────────────────────────────────────────────

export const DEMO_APPROVALS = [
    {
        id: 'appr-001',
        attendance_id: 'att-demo-001',
        employee_id: EMP_5,
        employee_name: 'Alex Kim',
        employee_email: 'alex@geoattend.demo',
        reason: 'Indoor location — GPS unavailable due to basement office',
        submitted_at: subHours(new Date(), 2).toISOString(),
        escalation_level: 'low' as const,
        fraud_score: 0.08,
        fraud_flags: [],
        photo_url: null,
        latitude: 28.6140,
        longitude: 77.2092,
        accuracy: 50,
        status: 'pending' as const,
        reviewed_by: null,
        reviewed_at: null,
        notes: null,
    },
    {
        id: 'appr-002',
        attendance_id: 'att-demo-002',
        employee_id: EMP_7,
        employee_name: 'David Brown',
        employee_email: 'david@geoattend.demo',
        reason: 'Client site visit — outside normal geofence',
        submitted_at: subHours(new Date(), 5).toISOString(),
        escalation_level: 'medium' as const,
        fraud_score: 0.35,
        fraud_flags: ['outside_geofence'],
        photo_url: null,
        latitude: 28.5800,
        longitude: 77.3200,
        accuracy: 15,
        status: 'pending' as const,
        reviewed_by: null,
        reviewed_at: null,
        notes: null,
    },
    {
        id: 'appr-003',
        attendance_id: 'att-demo-003',
        employee_id: EMP_3,
        employee_name: 'Raj Patel',
        employee_email: 'raj@geoattend.demo',
        reason: 'GPS not working on device — restarted phone',
        submitted_at: subDays(new Date(), 1).toISOString(),
        escalation_level: 'low' as const,
        fraud_score: 0.12,
        fraud_flags: [],
        photo_url: null,
        latitude: 28.6138,
        longitude: 77.2088,
        accuracy: 30,
        status: 'pending' as const,
        reviewed_by: null,
        reviewed_at: null,
        notes: null,
    },
];

// ─── Anomalies  ───────────────────────────────────────────────────────────────

export const DEMO_ANOMALIES = [
    {
        attendance_id: 'anom-001',
        user_id: EMP_7,
        user_name: 'David Brown',
        user_email: 'david.brown@geoattend.demo',
        site_id: 'site-001',
        site_name: 'HQ – Downtown Office',
        fraud_score: 0.72,
        fraud_flags: ['VPN_PROXY_DETECTED', 'MOCK_GPS'],
        created_at: subHours(new Date(), 6).toISOString(),
        is_resolved: false,
        resolved_by: null,
        resolved_at: null,
        resolution_notes: null,
    },
    {
        attendance_id: 'anom-002',
        user_id: EMP_3,
        user_name: 'Raj Patel',
        user_email: 'raj@geoattend.demo',
        site_id: 'site-001',
        site_name: 'HQ – Downtown Office',
        fraud_score: 0.45,
        fraud_flags: ['IMPOSSIBLE_TRAVEL'],
        created_at: subDays(new Date(), 1).toISOString(),
        is_resolved: false,
        resolved_by: null,
        resolved_at: null,
        resolution_notes: null,
    },
    {
        attendance_id: 'anom-003',
        user_id: EMP_5,
        user_name: 'Alex Kim',
        user_email: 'alex.kim@geoattend.demo',
        site_id: 'site-002',
        site_name: 'Branch – North Campus',
        fraud_score: 0.81,
        fraud_flags: ['NEW_DEVICE', 'VPN_PROXY_DETECTED'],
        created_at: subHours(new Date(), 2).toISOString(),
        is_resolved: false,
        resolved_by: null,
        resolved_at: null,
        resolution_notes: null,
    },
];

// ─── Fraud Summary ────────────────────────────────────────────────────────────

export const DEMO_FRAUD_SUMMARY = {
    total_flagged_today: 3,
    flag_breakdown: [
        { flag: 'VPN_PROXY_DETECTED', count: 2 },
        { flag: 'MOCK_GPS', count: 1 },
        { flag: 'IMPOSSIBLE_TRAVEL', count: 1 },
        { flag: 'NEW_DEVICE', count: 1 },
    ],
    top_risky_users: [
        { user_id: EMP_5, full_name: 'Alex Kim', risk_level: 'high' as const, avg_fraud_score: 0.81, flag_count: 2 },
        { user_id: EMP_7, full_name: 'David Brown', risk_level: 'high' as const, avg_fraud_score: 0.72, flag_count: 2 },
        { user_id: EMP_3, full_name: 'Raj Patel', risk_level: 'medium' as const, avg_fraud_score: 0.45, flag_count: 1 },
    ],
    high_risk_user_count: 2,
    medium_risk_user_count: 1,
    low_risk_user_count: 0,
};

// ─── Buddy Punch Incidents ────────────────────────────────────────────────────

export const DEMO_BUDDY_PUNCH_INCIDENTS = [
    {
        site_id: 'site-001',
        site_name: 'HQ – Downtown Office',
        incident_time: subHours(new Date(), 3).toISOString(),
        users: [
            { user_id: EMP_1, full_name: 'John Martinez', attendance_id: 'att-bp-001', lat: 28.6139, lng: 77.2090, timestamp: subHours(new Date(), 3).toISOString() },
            { user_id: EMP_2, full_name: 'Emily Chen', attendance_id: 'att-bp-002', lat: 28.6140, lng: 77.2091, timestamp: subHours(new Date(), 3).toISOString() },
        ],
        distance_meters: 12,
    },
];

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export const DEMO_LEADERBOARD = [
    { id: EMP_4, full_name: 'Maria Garcia', streak_count: 34, punctuality_percentage: 98 },
    { id: EMP_2, full_name: 'Emily Chen', streak_count: 28, punctuality_percentage: 96 },
    { id: EMP_6, full_name: 'Lisa Wang', streak_count: 22, punctuality_percentage: 94 },
    { id: EMP_8, full_name: 'Priya Sharma', streak_count: 18, punctuality_percentage: 89 },
    { id: EMP_1, full_name: 'John Martinez', streak_count: 12, punctuality_percentage: 92 },
];

// ─── Dept Leaderboard ─────────────────────────────────────────────────────────

export const DEMO_DEPT_LEADERBOARD = [
    { rank: 1, department: 'Engineering', total_employees: 8, checked_in: 7, attendance_rate: 0.94, late_count: 1, avg_fraud_score: 0.05 },
    { rank: 2, department: 'Operations', total_employees: 6, checked_in: 5, attendance_rate: 0.88, late_count: 1, avg_fraud_score: 0.08 },
    { rank: 3, department: 'Sales', total_employees: 5, checked_in: 4, attendance_rate: 0.82, late_count: 0, avg_fraud_score: 0.03 },
    { rank: 4, department: 'HR', total_employees: 3, checked_in: 2, attendance_rate: 0.78, late_count: 1, avg_fraud_score: 0.12 },
    { rank: 5, department: 'Management', total_employees: 2, checked_in: 2, attendance_rate: 1.0, late_count: 0, avg_fraud_score: 0.01 },
];

// ─── Notifications ────────────────────────────────────────────────────────────

export const DEMO_NOTIFICATIONS = {
    items: [
        { id: 'n-001', title: 'Check-in confirmed', body: 'You checked in at HQ – Downtown Office at 8:45 AM', type: 'attendance.checkin', is_read: false, created_at: subHours(new Date(), 3).toISOString() },
        { id: 'n-002', title: 'Approval pending', body: 'Alex Kim submitted a manual attendance request', type: 'approval.pending', is_read: false, created_at: subHours(new Date(), 2).toISOString() },
        { id: 'n-003', title: 'Streak milestone! 🔥', body: 'Congratulations! You reached a 12-day streak', type: 'streak.achieved', is_read: true, created_at: subDays(new Date(), 1).toISOString() },
        { id: 'n-004', title: 'Anomaly detected', body: 'Unusual login location detected for David Brown', type: 'fraud.alert', is_read: true, created_at: subDays(new Date(), 1).toISOString() },
        { id: 'n-005', title: 'Weekly report available', body: 'Your weekly attendance report is ready for download', type: 'report.ready', is_read: true, created_at: subDays(new Date(), 3).toISOString() },
    ],
    total: 5,
    unread_count: 2,
};

// ─── History helper ───────────────────────────────────────────────────────────

export function getDemoHistory(page = 1, perPage = 20) {
    const start = (page - 1) * perPage;
    const items = DEMO_HISTORY.slice(start, start + perPage);
    return {
        items,
        total: DEMO_HISTORY.length,
        page,
        per_page: perPage,
        pages: Math.ceil(DEMO_HISTORY.length / perPage),
    };
}

// ─── Users list (admin) ───────────────────────────────────────────────────────

export function getDemoUsers() {
    return {
        items: ALL_EMPLOYEES.map(e => ({
            ...e,
            org_id: ORG_ID,
            avatar_url: null,
            created_at: '2025-06-01T00:00:00Z',
        })),
        total: ALL_EMPLOYEES.length,
    };
}

// ─── Check-in / Check-out response ───────────────────────────────────────────

export function getDemoCheckinResponse(isCheckout = false) {
    const now = new Date();
    return {
        fraud_score: 0.02,
        fraud_flags: [] as string[],
        requires_approval: false,
        attendance: {
            id: `demo-checkin-${Date.now()}`,
            user_id: EMP_1,
            site_id: SITE_1,
            site_name: 'HQ – Downtown Office',
            date: format(now, 'yyyy-MM-dd'),
            check_in_time: isCheckout ? DEMO_TODAY.check_in_time : now.toISOString(),
            check_out_time: isCheckout ? now.toISOString() : null,
            duration_minutes: isCheckout ? 480 : null,
            status: 'present',
            latitude: 28.6139,
            longitude: 77.2090,
            accuracy: 8,
            fraud_score: 0.02,
            is_mocked: false,
            photo_url: null,
            created_at: now.toISOString(),
        },
        distance_meters: 12,
        within_geofence: true,
    };
}

// ─── Security screen demo data ────────────────────────────────────────────────

export const DEMO_WHITELIST = [
    {
        id: 'demo-wl-001',
        user_id: EMP_1,
        user_name: 'John Martinez',
        user_email: 'john@geoattend.demo',
        device_fingerprint: 'fp-abc123-mobile-001',
        reason: 'Remote worker — VPN is mandatory for this role',
        admin_id: ADMIN_ID,
        created_at: '2026-03-10T09:00:00Z',
    },
    {
        id: 'demo-wl-002',
        user_id: EMP_5,
        user_name: 'Alex Kim',
        user_email: 'alex@geoattend.demo',
        device_fingerprint: 'fp-xyz789-mobile-002',
        reason: 'Field device — GPS accuracy known to be poor at Site B',
        admin_id: ADMIN_ID,
        created_at: '2026-03-22T14:30:00Z',
    },
];

export const DEMO_DEVICES = [
    {
        id: 'demo-dev-001',
        user_id: EMP_1,
        user_name: 'John Martinez',
        user_email: 'john@geoattend.demo',
        platform: 'android',
        device_fingerprint: 'fp-abc123-mobile-001',
        is_trusted: true,
        last_seen_at: '2026-04-12T08:15:00Z',
        created_at: '2026-01-15T00:00:00Z',
    },
    {
        id: 'demo-dev-002',
        user_id: EMP_2,
        user_name: 'Emily Chen',
        user_email: 'emily@geoattend.demo',
        platform: 'ios',
        device_fingerprint: 'fp-def456-ios-001',
        is_trusted: false,
        last_seen_at: '2026-04-11T17:45:00Z',
        created_at: '2026-02-01T00:00:00Z',
    },
    {
        id: 'demo-dev-003',
        user_id: EMP_3,
        user_name: 'Raj Patel',
        user_email: 'raj@geoattend.demo',
        platform: 'android',
        device_fingerprint: 'fp-ghi789-android-002',
        is_trusted: true,
        last_seen_at: '2026-04-10T12:00:00Z',
        created_at: '2026-02-15T00:00:00Z',
    },
    {
        id: 'demo-dev-004',
        user_id: EMP_4,
        user_name: 'Maria Garcia',
        user_email: 'maria@geoattend.demo',
        platform: 'web',
        device_fingerprint: 'fp-jkl012-web-001',
        is_trusted: false,
        last_seen_at: '2026-04-09T09:30:00Z',
        created_at: '2026-03-01T00:00:00Z',
    },
];

export const DEMO_IP_RULES = [
    {
        id: 'demo-rule-001',
        org_id: ORG_ID,
        rule_type: 'block',
        ip_cidr: '185.220.101.0/24',
        reason: 'Known Tor exit node range',
        created_by_id: ADMIN_ID,
        created_at: '2026-03-01T00:00:00Z',
    },
    {
        id: 'demo-rule-002',
        org_id: ORG_ID,
        rule_type: 'allow',
        ip_cidr: '10.10.0.0/16',
        reason: 'Corporate VPN subnet — bypass IP reputation check',
        created_by_id: ADMIN_ID,
        created_at: '2026-03-05T00:00:00Z',
    },
    {
        id: 'demo-rule-003',
        org_id: ORG_ID,
        rule_type: 'block',
        ip_cidr: '45.33.32.156',
        reason: 'Flagged IP from anomaly investigation on 2026-04-01',
        created_by_id: ADMIN_ID,
        created_at: '2026-04-01T00:00:00Z',
    },
];
