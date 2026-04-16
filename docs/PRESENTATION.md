# Presentation Guide — Geo-Location Based Attendance System

> **Duration**: 15–20 min | **Audience**: Technical/Semi-technical jury

---

## Opening Hook (1 min)

> *"Every company has this problem: people mark attendance without actually being there. Buddy punching, VPN spoofing, fake GPS. We built a system that catches all of it — in real time."*

---

## Slide Flow

### 1. Problem Statement (1 min)
- Manual attendance = 20% fraud rate in large orgs
- GPS spoofing apps are free and popular
- No real-time visibility for managers
- Manual approval processes take days

**Your line**: *"We didn't just build an attendance app. We built a fraud-resistant, real-time workforce intelligence system."*

---

### 2. Live Demo Flow (8–10 min)

> Run these steps in order. Have two devices ready: **admin on browser**, **employee on Expo Go**.

#### Step 1 — Employee Check-In (3 min)
1. Open Expo Go → login as `emp1@demo.com` / `Demo@1234`
2. Go to **Home tab** → show streak counter, today's status
3. Tap **Check In** → show live GPS map with geofence circle
4. Point out: distance to office shown in real-time
5. Tap **Check In** button
6. Show the success screen + fraud score badge

**Talking points:**
- GPS accuracy validation happening in background
- Fraud pipeline runs in < 200ms
- Streak auto-increments (gamification)

#### Step 2 — Admin Sees It Live (2 min)
1. Switch to browser → login as `admin@demo.com` / `Demo@1234`
2. Go to **Dashboard** → show the live feed panel
3. Point to the just-appeared check-in event
4. Show present/absent/late counters update

**Talking points:**
- WebSocket — no polling, true push
- Redis pub/sub broadcasts to all admin sessions instantly

#### Step 3 — Fraud Demo (2 min)
1. Go to **Admin → Anomalies tab**
2. Show fraud-flagged records with score > 0.5
3. Point out fraud flags: `vpn_detected`, `impossible_travel`, `coordinate_replay`
4. Click one → show breakdown

**Talking points:**
- 10-point fraud assessment on every check-in
- Score ≥ 0.75 → auto-blocked (HTTP 403), routed to manual approval
- IPQualityScore API for VPN/Proxy/Tor detection

#### Step 4 — Approvals Workflow (1 min)
1. Go to **Admin → Approvals**
2. Show escalation badges (Low / Medium / High / Critical)
3. Approve one → show real-time update on employee's phone

#### Step 5 — Analytics (1 min)
1. Go to **Admin → Reports**
2. Generate CSV export → show background job fires
3. Show **Map tab** → heatmap of check-in density

---

### 3. Architecture Walkthrough (3 min)

> Show `ARCHITECTURE.md` diagrams — open in VS Code Preview or GitHub.

**Walk through in this order:**
1. **Diagram 1** (High-Level Overview) — explain 8 Docker services
2. **Diagram 2** (Check-In Sequence) — walk through the request lifecycle
3. **Diagram 3** (Fraud Pipeline) — explain the 10-point scoring
4. **Diagram 5** (WebSocket) — explain real-time without polling

**Key stat to drop**: *"47+ REST endpoints, 8 background Celery tasks, 10-point fraud assessment — all running in Docker, deployable anywhere."*

---

### 4. Tech Stack Highlight (2 min)

| Layer | Tech | Why |
|-------|------|-----|
| API | FastAPI (async) | Fastest Python framework, auto Swagger docs |
| Mobile | React Native + Expo | Single codebase → iOS + Android + Web |
| Realtime | WebSocket + Redis Pub/Sub | Zero polling, instant push |
| Fraud | IPQualityScore + custom | Commercial-grade IP intelligence |
| Geofence | Shapely + PostGIS | Polygon-level precision |
| Jobs | Celery + Beat | Distributed, scheduled, fault-tolerant |
| Storage | MinIO (S3-compatible) | Self-hosted photo storage |

---

### 5. What Makes It Different (1 min)

| Feature | Basic App | Our System |
|---------|-----------|------------|
| Location check | Simple radius | Polygon + radius + PostGIS |
| Fraud detection | None | 10-point ML-style scoring |
| Real-time | Polling / manual refresh | WebSocket push |
| Buddy punching | Undetectable | Detected in 10 min via Celery |
| Approvals | Email / WhatsApp | In-app workflow with SLA escalation |
| Multi-tenant | Single org | Full org isolation, role hierarchy |

---

### 6. Closing (30 sec)

> *"This is not a prototype. It has production-grade fraud detection, real-time WebSocket feeds, background job scheduling, multi-tenant role isolation, and a complete mobile + web frontend. All containerized and running right now."*

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@demo.com | Demo@1234 |
| Employee 1 | emp1@demo.com | Demo@1234 |
| Employee 2 | emp2@demo.com | Demo@1234 |
| Employee 3 | emp3@demo.com | Demo@1234 |

## URLs During Demo

| Service | URL |
|---------|-----|
| API Docs (Swagger) | http://localhost:8000/docs |
| Web App | http://localhost:8081 |
| MailHog | http://localhost:8025 |
| MinIO Console | http://localhost:9001 |

---

## If Something Breaks

| Problem | Fix |
|---------|-----|
| API 503 | `docker ps` → restart backend container |
| Expo won't connect | Check `mobile/.env.local` has correct IP |
| Login fails | Use real login (not demo button) → `emp1@demo.com` |
| WebSocket disconnected | Refresh admin browser page |
| Map not loading | Zoom in, wait 2s for tiles |
