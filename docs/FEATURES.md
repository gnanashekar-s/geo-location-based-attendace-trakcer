# Features Guide — Geo-Location Based Attendance System

## Feature Matrix

| # | Feature | Employee | Supervisor | Admin |
|---|---------|----------|------------|-------|
| 1 | GPS Check-In / Out | ✅ | ✅ | ✅ |
| 2 | Geofence Validation | auto | auto | auto |
| 3 | Fraud Score Badge | view own | — | view all |
| 4 | Streak & Leaderboard | ✅ | ✅ | ✅ |
| 5 | Manual Approval Request | ✅ | — | — |
| 6 | Approve / Reject Requests | — | ✅ | ✅ |
| 7 | Real-time Live Feed | — | — | ✅ |
| 8 | Anomaly Detection Feed | — | — | ✅ |
| 9 | Attendance History | own | team | all |
| 10 | Analytics Dashboard | — | partial | ✅ |
| 11 | Heatmap View | — | — | ✅ |
| 12 | Reports (CSV/PDF) | — | — | ✅ |
| 13 | Geofence Management | — | — | ✅ |
| 14 | Employee Management | — | — | ✅ |
| 15 | Shift Management | — | — | ✅ |
| 16 | Security Settings (IP/Device) | — | — | ✅ |
| 17 | Push Notifications | ✅ | ✅ | ✅ |

---

## Employee Features

### GPS Check-In
- Opens live map with dark theme
- Shows real-time location dot
- Draws geofence circle around registered office
- Calculates distance to office center in meters
- Disables check-in button if outside geofence
- Optional camera capture for photo proof

### Fraud Score Badge
- Every check-in gets a fraud score (0–1)
- Green (< 0.3) / Yellow (0.3–0.74) / Red (≥ 0.75)
- Employee can view their own trust history
- Flags shown: `vpn_detected`, `impossible_travel`, `coordinate_replay`, `anomalous_hour`, etc.

### Streak System
- Consecutive days with valid check-in
- Streak resets if absent
- Top 10 leaderboard visible to all employees
- Displays current streak + longest streak

### Manual Check-In Request
- Used when GPS unavailable (indoor, tunnels)
- Requires: reason code + reason text + optional photo
- Routed to supervisor for approval
- Status tracked: pending → approved/rejected/escalated

### Attendance History
- Paginated list of all check-ins / check-outs
- Shows duration per day
- Status badges: present / late / absent / pending
- Filterable by date range

### Push Notifications
- Approval status updates
- Streak milestone alerts
- Geofence breach warnings
- Late check-in reminders

---

## Admin Features

### Live Dashboard
- KPI cards: Present Today / Late / Absent / Attendance Rate
- Real-time check-in feed via WebSocket (no refresh needed)
- Daily trend bar chart (30-day rolling)
- Pending approvals count with escalation badge

### Fraud & Anomaly Management
- Full list of flagged attendance records
- Filter by fraud score threshold
- View per-flag breakdown
- Mark safe / escalate
- Buddy punch detection results

### Approvals Queue
- Tabbed: Pending / Approved / Rejected
- Escalation level badge (Low → Critical)
- Bulk approve
- Real-time updates (WebSocket)
- View photo evidence + reason

### Heatmap
- GPS density visualization on map
- Shows where employees are checking in from
- Identifies off-site clusters (potential spoofing)

### Geofence Editor
- Create circular geofences (center + radius)
- Draw polygon geofences for complex boundaries
- Edit / deactivate existing sites
- Radius shown on map preview

### Reports
- Date range selector
- Export types: CSV (raw data) / PDF (styled report)
- Background generation (Celery) → MinIO upload → presigned download URL
- 24-hour download link

### Employee Management
- Full user list with search
- Suspend / Activate accounts
- View per-employee fraud stats
- Create new employees
- Assign supervisors

### Shift Management
- Create shifts (name, start/end time, working days bitmap)
- Assign shifts to employees
- System uses shift for late detection

### Security Settings
- **IP Rules**: Block / Allow / Watch specific IPs or CIDR ranges
- **Device Whitelist**: Trust specific device fingerprints
- **Fraud Thresholds**: Configure auto-block score (default: 0.75)

---

## Real-Time Features

### WebSocket Channels
| Channel | What You See |
|---------|-------------|
| `/ws/feed` | Check-ins, geofence breaches, buddy punch alerts |
| `/ws/approvals` | New requests, status changes, escalations |

### Background Intelligence (Silent, automatic)
| Task | Frequency | What it does |
|------|-----------|-------------|
| Geofence Watch | Every 2 min | Detects employees who wandered outside |
| Buddy Punch Analysis | Every 10 min | Finds 2 users at < 10m within 5 min |
| Escalation SLA | Every 1 hour | Bumps approval priority after 24h |
| Late Warning | Every 1 hour | Notifies employees not yet checked in |
| Risk Profiler | Daily | Builds behavioral baseline per user |
| Shift Pattern Detector | Daily | Flags schedule anomalies |

---

## Security Features

### 10-Point Fraud Assessment (Every Check-In)
1. Mock location flag from device
2. GPS accuracy > 100m
3. VPN / Proxy / Tor detection (IPQualityScore)
4. IP country ≠ GPS country
5. Impossible travel (> 900 km/h)
6. Unknown/untrusted device fingerprint
7. Coordinate replay (same coords < 2h)
8. Anomalous check-in hour (> 2σ from baseline)
9. Rapid re-check-in (< 2 min after checkout)
10. Excessive daily events (≥ 6 per day)

**Automatic block threshold**: Score ≥ 0.75 → HTTP 403

### Buddy Punch Detection
- Celery task every 10 min
- Finds pairs: < 10m apart, < 5 min gap, different user IDs
- Flags both records as `BUDDY_PUNCH_CONFIRMED`
- Reduces fraud score of both
- 30-min cooldown per user+site pair

### Multi-Tenant Isolation
- Every DB query filtered by `org_id`
- Role-based endpoint access (FastAPI dependencies)
- JWT contains `user_id` + `org_id` + `role`
- No cross-org data leakage possible
