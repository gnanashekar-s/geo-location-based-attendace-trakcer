# Geo-Location Based Attendance System

A production-grade attendance system with GPS-based check-in/out, geofence management, anti-fraud detection, manual approval workflows, and real-time analytics.

## Stack

| Layer | Technology |
|---|---|
| Mobile + Web | React Native Expo 51 (managed) |
| API | FastAPI (Python 3.12) + Uvicorn |
| Background tasks | Celery + Celery Beat |
| Database | PostgreSQL 16 + PostGIS |
| Cache / Pub-Sub | Redis 7 |
| Object Storage | MinIO |
| Reverse Proxy | Nginx |
| Email (dev) | MailHog |

## Quick Start

```bash
# 1. Copy and fill environment variables
cp .env.example .env

# 2. Start all services
docker compose up -d --build

# 3. Access
#   API docs:       http://localhost/api/v1/docs
#   MinIO console:  http://localhost:9001  (minioadmin / minioadmin)
#   MailHog UI:     http://localhost:8025
```

## Mobile App

```bash
cd mobile
npm install
npx expo start
# Press 'a' for Android, 'i' for iOS, 'w' for web
```

Requires:
- `MAPBOX_ACCESS_TOKEN` in `.env` for map features
- `EXPO_PUBLIC_API_URL=http://localhost:8000` in `mobile/.env` (or update `app.json` extra.apiUrl)

## Environment Variables

See `.env.example` for all required variables.

Key ones to configure:
- `IPQS_API_KEY` — IPQualityScore API key for VPN/proxy detection
- `MAPBOX_ACCESS_TOKEN` — Mapbox token for maps
- `JWT_SECRET` — Change in production
- `POSTGRES_PASSWORD` / `MINIO_SECRET_KEY` — Change in production

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/register` | Register |
| POST | `/api/v1/attendance/checkin` | GPS check-in |
| POST | `/api/v1/attendance/checkout` | GPS check-out |
| GET | `/api/v1/attendance/today` | Today's records |
| GET | `/api/v1/analytics/summary` | KPI stats (admin) |
| WS | `/ws/feed` | Real-time check-in feed |
| WS | `/ws/approvals` | Live approval queue |

Full docs at `http://localhost/api/v1/docs` (when running).

## Features

### Core Attendance
- GPS check-in/out with configurable radius per site
- Polygon geofence support (irregular boundaries)
- Multi-site / multi-org support
- Break tracking within shifts
- Streak counting and gamification

### Anti-Fraud
- VPN/Proxy/Tor detection (IPQualityScore API)
- Mock GPS detection (client-side flag)
- Impossible travel detection (haversine + speed check)
- Device fingerprinting
- Velocity anomaly scoring (0–1 per event)

### Manual Approval
- Employee submits request with reason + photo evidence
- Real-time push to supervisor via WebSocket + FCM
- Configurable SLA escalation via Celery Beat
- Approve/reject with audit trail

### Analytics
- Live heatmap of employee presences
- Daily/weekly/monthly attendance rate charts
- Anomaly feed for admin review
- CSV/PDF export (background job)

## Architecture

```
nginx:80 → FastAPI:8000
                ↓
         PostgreSQL + PostGIS
                ↓
         Redis (cache + pub/sub)
                ↓
         Celery (worker + beat)
                ↓
         MinIO (photos + reports)
```
