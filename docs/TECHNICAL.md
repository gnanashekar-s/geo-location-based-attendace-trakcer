# Technical Guide — Geo-Location Based Attendance System

## Stack at a Glance

```
Backend   → Python 3.12 · FastAPI 0.115 · SQLAlchemy 2.0 (async)
Database  → PostgreSQL 16 + PostGIS 3.4 · Alembic migrations
Cache     → Redis 7 (cache + pub/sub + Celery broker)
Jobs      → Celery 5.4 + Beat (8 task types, 5 queues)
Storage   → MinIO (S3-compatible, self-hosted)
Mobile    → React Native 0.81 + Expo 54 (iOS + Android + Web)
State     → Zustand (client) + TanStack Query (server)
Maps      → React Native Maps (mobile) + Leaflet (web)
Auth      → JWT (access 30min + refresh 7d) · bcrypt passwords
Realtime  → WebSocket + Redis Pub/Sub
Infra     → Docker Compose (8 containers) · Nginx reverse proxy
```

---

## API Design

### Base URL
```
http://localhost:8000/api/v1
```

### Authentication
```
POST /auth/login    → { access_token, refresh_token }
POST /auth/refresh  → { access_token }
Header: Authorization: Bearer <access_token>
```

### Key Endpoints

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/attendance/checkin` | GPS check-in (geofence + fraud) |
| POST | `/attendance/checkout` | GPS check-out |
| GET | `/attendance/today` | Today's records |
| GET | `/attendance/history` | Paginated history |
| POST | `/attendance/manual` | Manual approval request |
| GET | `/analytics/summary` | KPI dashboard data |
| GET | `/analytics/anomalies` | Fraud-flagged records |
| GET | `/analytics/heatmap` | GPS density data |
| POST | `/analytics/export` | Trigger CSV/PDF report (async) |
| GET | `/approvals/` | Pending approvals list |
| POST | `/approvals/{id}/approve` | Approve request |
| POST | `/approvals/bulk-approve` | Bulk approve |
| GET | `/users/leaderboard` | Top 10 streak leaders |
| WS | `/ws/feed` | Real-time check-in events |
| WS | `/ws/approvals` | Real-time approval updates |

### Check-In Payload
```json
POST /attendance/checkin
{
  "lat": 12.9716,
  "lng": 77.5946,
  "accuracy_meters": 15.2,
  "device_fingerprint": "abc123xyz",
  "is_mock_location": false,
  "photo_url": null,
  "ip_address": null
}
```

### Check-In Response
```json
{
  "id": "uuid",
  "event_type": "checkin",
  "fraud_score": 0.18,
  "fraud_flags": { "vpn_detected": false, "mock_location": false },
  "is_valid": true,
  "lat": 12.9716,
  "lng": 77.5946,
  "created_at": "2026-04-16T09:30:00Z"
}
```

---

## Fraud Detection — Code Logic

```python
async def assess_fraud(checkin: CheckinRequest, user: User, db, redis) -> FraudResult:
    score = 0.0
    flags = []

    # 1. Mock location
    if checkin.is_mock_location:
        score += 0.5; flags.append("mock_location")

    # 2. GPS accuracy
    if checkin.accuracy_meters > 100:
        score += 0.2; flags.append("low_accuracy")

    # 3. IP reputation (IPQS → ip-api fallback)
    ip_data = await get_ip_reputation(checkin.ip_address, redis)
    if ip_data.vpn:   score += 0.3; flags.append("vpn_detected")
    if ip_data.proxy: score += 0.2; flags.append("proxy_detected")
    if ip_data.tor:   score += 0.4; flags.append("tor_detected")

    # 4. Country mismatch
    gps_country = await get_country_from_coords(checkin.lat, checkin.lng, redis)
    if ip_data.country != gps_country:
        score += 0.2; flags.append("country_mismatch")

    # 5. Impossible travel (> 900 km/h)
    last = await get_last_location(user.id, redis)
    if last:
        dist_km = haversine(last.lat, last.lng, checkin.lat, checkin.lng)
        elapsed_h = (now - last.timestamp).seconds / 3600
        if elapsed_h > 0 and (dist_km / elapsed_h) > 900:
            score += 0.4; flags.append("impossible_travel")

    # 6–10: device, replay, hour, rapid recheckin, excessive events ...

    score = min(score, 1.0)
    return FraudResult(score=score, flags=flags, block=score >= 0.75)
```

---

## Geofencing Logic

```python
def is_inside_geofence(lat, lng, site: Site) -> bool:
    # Polygon mode (complex boundaries)
    if site.polygon:
        polygon = shape(json.loads(site.polygon))  # GeoJSON → Shapely
        return polygon.contains(Point(lng, lat))   # GeoJSON is [lng, lat]!

    # Circular radius mode
    dist = haversine_km(lat, lng, site.center_lat, site.center_lng) * 1000
    return dist <= site.radius_meters

def haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi/2)**2 + cos(phi1) * cos(phi2) * sin(dlambda/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))
```

---

## WebSocket — How It Works

```python
# Server-side (FastAPI)
@router.websocket("/ws/feed")
async def feed_ws(ws: WebSocket, token: str, db, redis):
    user = verify_jwt(token)                    # Auth from query param
    await manager.connect(ws, "feed")           # Register connection
    async with redis.pubsub() as ps:
        await ps.subscribe("ws:feed")           # Subscribe to Redis channel
        async for msg in ps.listen():
            await ws.send_json(msg["data"])     # Push to this client

# Publisher (anywhere in app)
await redis.publish("ws:feed", json.dumps({
    "type": "checkin",
    "user_id": str(user.id),
    "site": site.name,
    "fraud_score": result.score,
    "timestamp": datetime.utcnow().isoformat()
}))
```

---

## Background Jobs

```python
# Celery Beat Schedule (auto-configured)
CELERY_BEAT_SCHEDULE = {
    "geofence-watch":      {"task": "geofence_watch",       "schedule": 120},   # 2 min
    "buddy-punch":         {"task": "buddy_punch_analysis",  "schedule": 600},   # 10 min
    "escalation":          {"task": "escalate_approvals",    "schedule": 3600},  # 1 hr
    "late-warnings":       {"task": "dispatch_late_warnings","schedule": 3600},  # 1 hr
    "cleanup":             {"task": "cleanup_redis",         "schedule": 86400}, # daily
    "risk-profiler":       {"task": "profile_user_velocity", "schedule": 86400}, # daily
    "shift-detector":      {"task": "detect_shift_changes",  "schedule": 86400}, # daily
}

# Celery Queues
QUEUES = ["default", "reports", "escalation", "geofence", "fraud"]
```

---

## Redis Caching Strategy

| Key Pattern | TTL | Content |
|-------------|-----|---------|
| `geofence:{site_id}` | 10 min | Site geofence data |
| `ip:reputation:{ip}` | 1 hour | IPQS fraud result |
| `geo:country:{lat}:{lng}` | 24 hours | Country from GPS |
| `device:trusted:{fingerprint}` | 30 days | Trusted device flag |
| `cooldown:geofence:{uid}:{sid}` | 1 hour | Breach alert cooldown |
| `cooldown:buddy:{uid}:{sid}` | 30 min | Buddy punch cooldown |
| `ws:feed` | — | Pub/Sub channel |
| `ws:approvals` | — | Pub/Sub channel |

---

## Database Models — Quick Reference

```
User             → id, email, role, org_id, streak_count, supervisor_id
AttendanceRecord → id, user_id, site_id, event_type, lat, lng, fraud_score, fraud_flags
Site             → id, org_id, name, center_lat, center_lng, radius_meters, polygon
ManualApproval   → id, user_id, status, escalation_level, reviewed_by
Device           → id, user_id, fingerprint, fcm_token
Shift            → id, org_id, start_time, end_time, working_days (bitmask)
Notification     → id, user_id, title, body, is_read
AuditLog         → id, user_id, action, entity_type, changes (JSONB)
Organisation     → id, name, domain
```

---

## Frontend Architecture

```
mobile/
├── app/
│   ├── (auth)/          Login · Register · ForgotPassword
│   ├── (employee)/      Home · CheckIn · History · Streaks · TrustScore · Profile
│   └── (admin)/         Dashboard · Approvals · Employees · Anomalies
│                        Map · Geofences · Reports · Security
├── services/
│   └── api.ts           Typed Axios wrappers (47+ endpoints)
├── hooks/
│   ├── useLocation.ts   Expo Location with background tracking
│   ├── useGeofence.ts   Client-side distance calculation
│   └── useWebSocket.ts  Auto-reconnect WebSocket hook
├── store/
│   ├── authStore.ts     Zustand + AsyncStorage persist (JWT, user, isDemoMode)
│   └── notificationStore.ts
└── constants/
    └── theme.ts         Design tokens (colors, spacing, typography)
```

### State Management
- **Zustand** — auth state, persisted to AsyncStorage (survives app kill)
- **TanStack Query** — server data (attendance, analytics, approvals) with auto-refetch

### Platform Handling
```typescript
const BASE_URL =
  Platform.OS === 'web'
    ? 'http://localhost:8000/api/v1'          // Web always local
    : process.env.EXPO_PUBLIC_API_URL         // Mobile → env var (local IP or tunnel)
```

---

## Deployment Notes

### Docker Services
```
nginx    :80    → Reverse proxy (routes to api)
api      :8000  → FastAPI (uvicorn, hot reload in dev)
worker          → Celery worker (5 queues, concurrency 2)
beat            → Celery Beat (periodic task scheduler)
db       :5433  → PostgreSQL 16 + PostGIS
redis    :6379  → Cache + broker + pub/sub
minio    :9000  → Object storage (photos, reports)
mailhog  :8025  → Dev SMTP (email preview)
```

### Health Checks
```
GET /health        → API alive
GET /health/ready  → DB + Redis reachable
GET /metrics       → Prometheus scrape endpoint
```

### Environment Variables (Key)
```env
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://redis:6379
MINIO_ENDPOINT=minio:9000
IPQS_API_KEY=...
FIREBASE_CREDENTIALS=...
JWT_SECRET_KEY=...
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
FRAUD_AUTO_BLOCK_THRESHOLD=0.75
```

---

## Numbers That Impress

| Metric | Value |
|--------|-------|
| REST Endpoints | 47+ |
| WebSocket Channels | 2 |
| Background Task Types | 8 |
| Celery Queues | 5 |
| Fraud Check Points | 10 |
| Docker Services | 8 |
| DB Models | 9 |
| Frontend Screens | 20+ |
| Auto-block Threshold | Score ≥ 0.75 |
| Geofence Cache TTL | 10 min |
| WebSocket Auth | JWT via query param |
| Password Hashing | bcrypt (12 rounds) |
| Access Token TTL | 30 min |
| Refresh Token TTL | 7 days |
