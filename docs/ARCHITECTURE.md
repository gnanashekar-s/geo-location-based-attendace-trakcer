# System Architecture — Geo-Location Based Attendance

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph Client["📱 Client Layer"]
        EXPO[Expo Go / React Native]
        WEB[Web Browser]
    end

    subgraph Gateway["🌐 Gateway Layer"]
        NGINX[Nginx Reverse Proxy :80]
    end

    subgraph App["⚙️ Application Layer"]
        API[FastAPI + Uvicorn :8000]
        WS[WebSocket Handler /ws/feed /ws/approvals]
        WORKER[Celery Worker]
        BEAT[Celery Beat Scheduler]
    end

    subgraph Data["🗄️ Data Layer"]
        PG[(PostgreSQL 16 + PostGIS)]
        REDIS[(Redis 7)]
        MINIO[(MinIO S3)]
    end

    subgraph External["🌍 External APIs"]
        IPQS[IPQualityScore]
        IPAPI[ip-api.com]
        FCM[Firebase FCM]
        MAIL[MailHog SMTP]
    end

    EXPO -->|HTTP + WebSocket| NGINX
    WEB -->|HTTP + WebSocket| NGINX
    NGINX --> API
    NGINX --> WS
    API --> PG
    API --> REDIS
    API --> MINIO
    API --> IPQS
    API --> IPAPI
    API --> FCM
    WORKER --> PG
    WORKER --> REDIS
    WORKER --> FCM
    BEAT -->|schedules| WORKER
    WS -->|pub/sub| REDIS
```

---

## 2. Request Flow — Check-In

```mermaid
sequenceDiagram
    participant Phone as 📱 Expo Go
    participant API as ⚙️ FastAPI
    participant Fraud as 🔍 Fraud Service
    participant Geo as 📍 Geo Service
    participant IPQS as 🌍 IPQualityScore
    participant DB as 🗄️ PostgreSQL
    participant Redis as ⚡ Redis
    participant WS as 📡 WebSocket

    Phone->>API: POST /attendance/checkin {lat, lng, accuracy, fingerprint}
    API->>API: Validate JWT token
    API->>Geo: Is point inside geofence?
    Geo->>Redis: GET geofence:{site_id} (cache)
    Redis-->>Geo: Cache miss → fetch from DB
    Geo->>DB: SELECT site by org_id
    Geo-->>API: ✅ Within 200m radius

    API->>Fraud: Assess fraud score
    Fraud->>IPQS: Check IP reputation (VPN/Proxy/Tor)
    IPQS-->>Fraud: score: 0.12, vpn: false
    Fraud->>Redis: GET last checkin location (impossible travel)
    Fraud->>Redis: GET device:trusted:{fingerprint}
    Fraud-->>API: FraudResult{score: 0.18, flags: [], block: false}

    API->>DB: INSERT AttendanceRecord (fraud_score, flags, lat, lng)
    API->>DB: UPDATE User.streak_count += 1
    API->>Redis: PUBLISH ws:feed {event: checkin, user, site}
    Redis-->>WS: Push to admin subscribers
    WS-->>Phone: Real-time feed update (admin sees it live)
    API-->>Phone: 201 {attendance_record, fraud_score}
```

---

## 3. Fraud Detection Pipeline

```mermaid
flowchart TD
    START([Check-In Request]) --> M1

    M1{Mock Location\nFlag?} -->|+0.0 if false| M2
    M1 -->|+0.5 if true| AGG

    M2{GPS Accuracy\n> 100m?} -->|+0.2| M3
    M2 -->|pass| M3

    M3{IP Reputation\nIPQS / ip-api} -->|VPN +0.3\nProxy +0.2\nTor +0.4| M4
    M3 -->|clean| M4

    M4{IP Country ≠\nGPS Country?} -->|+0.2| M5
    M4 -->|match| M5

    M5{Impossible\nTravel?\nspeed > 900km/h} -->|+0.4| M6
    M5 -->|plausible| M6

    M6{Unknown\nDevice?} -->|+0.15| M7
    M6 -->|trusted| M7

    M7{Coordinate\nReplay < 2h?} -->|+0.25| M8
    M7 -->|unique| M8

    M8{Anomalous\nHour? 2σ} -->|+0.15| M9
    M8 -->|normal| M9

    M9{Rapid\nRe-checkin\n< 2 min?} -->|+0.2| M10
    M9 -->|ok| M10

    M10{Excessive\nDaily Events\n≥ 6?} -->|+0.15| AGG
    M10 -->|normal| AGG

    AGG[Aggregate Score\ncapped at 1.0]

    AGG --> T1{Score ≥ 0.75?}
    T1 -->|YES| BLOCK[🚫 HTTP 403\nAuto-Rejected\nManual Review Required]
    T1 -->|NO| ALLOW[✅ Attendance Recorded\nScore stored for audit]

    style BLOCK fill:#ff4444,color:#fff
    style ALLOW fill:#22c55e,color:#fff
```

---

## 4. Database Schema (ERD)

```mermaid
erDiagram
    ORGANISATION {
        uuid id PK
        string name
        string domain
        timestamp created_at
    }

    USER {
        uuid id PK
        uuid org_id FK
        uuid supervisor_id FK
        string email
        string hashed_password
        string full_name
        enum role
        int streak_count
        date last_checkin_date
        bool is_active
    }

    SITE {
        uuid id PK
        uuid org_id FK
        string name
        float center_lat
        float center_lng
        float radius_meters
        text polygon_geojson
        bool is_active
    }

    ATTENDANCE_RECORD {
        uuid id PK
        uuid user_id FK
        uuid site_id FK
        uuid device_id FK
        enum event_type
        float lat
        float lng
        float accuracy_meters
        float fraud_score
        json fraud_flags
        bool is_valid
        bool is_manual
        timestamp created_at
    }

    MANUAL_APPROVAL {
        uuid id PK
        uuid user_id FK
        uuid site_id FK
        string reason_code
        text reason_text
        enum status
        int escalation_level
        uuid reviewed_by FK
        string review_note
    }

    DEVICE {
        uuid id PK
        uuid user_id FK
        string fingerprint
        string device_model
        string fcm_token
    }

    SHIFT {
        uuid id PK
        uuid org_id FK
        string name
        time start_time
        time end_time
        int working_days
    }

    NOTIFICATION {
        uuid id PK
        uuid user_id FK
        string title
        string body
        bool is_read
    }

    AUDIT_LOG {
        uuid id PK
        uuid user_id FK
        string action
        string entity_type
        json changes
        timestamp created_at
    }

    ORGANISATION ||--o{ USER : "has"
    ORGANISATION ||--o{ SITE : "owns"
    USER ||--o{ ATTENDANCE_RECORD : "creates"
    USER ||--o{ DEVICE : "registers"
    USER ||--o{ MANUAL_APPROVAL : "submits"
    USER ||--o{ NOTIFICATION : "receives"
    SITE ||--o{ ATTENDANCE_RECORD : "at"
    ATTENDANCE_RECORD }o--|| DEVICE : "from"
```

---

## 5. Real-Time WebSocket Architecture

```mermaid
graph LR
    subgraph Triggers["Event Triggers"]
        CI[Check-In API]
        BPA[Buddy Punch\nAnalysis Task]
        GW[Geofence Watch\nTask]
        ESC[Escalation Task]
    end

    subgraph Redis["⚡ Redis Pub/Sub"]
        FEED[Channel: ws:feed]
        APPR[Channel: ws:approvals]
    end

    subgraph WSServer["📡 WebSocket Server"]
        CM[Connection Manager\nper-channel registry]
        WF[/ws/feed]
        WA[/ws/approvals]
    end

    subgraph Clients["Clients"]
        ADMIN[Admin Dashboard\nLive Feed]
        APANEL[Admin Approvals\nPanel]
    end

    CI -->|PUBLISH| FEED
    BPA -->|PUBLISH| FEED
    GW -->|PUBLISH| FEED
    ESC -->|PUBLISH| APPR
    FEED --> WF
    APPR --> WA
    CM --> WF
    CM --> WA
    WF -->|broadcast| ADMIN
    WA -->|broadcast| APANEL
```

---

## 6. Celery Task Schedule

```mermaid
gantt
    title Background Task Schedule (repeating)
    dateFormat HH:mm
    axisFormat %H:%M

    section Every 2 min
    Geofence Breach Watch     :active, 00:00, 2m

    section Every 10 min
    Buddy Punch Analysis      :active, 00:00, 10m

    section Every Hour
    Escalation SLA Check      :active, 00:00, 60m
    Late Warning Dispatcher   :active, 00:00, 60m

    section Daily
    Redis Cache Cleanup       :active, 00:00, 1440m
    User Risk Profiler        :active, 00:00, 1440m
    Shift Pattern Detector    :active, 00:00, 1440m
```

---

## 7. Multi-Tenant Role Hierarchy

```mermaid
graph TD
    SA[👑 super_admin\nAll orgs, all data]
    OA[🏢 org_admin\nOwn org: users, sites,\nshifts, reports, security]
    SV[👔 supervisor\nApprovals, analytics,\nteam visibility]
    EMP[👤 employee\nOwn records only\nCheck-in / out]

    SA --> OA
    OA --> SV
    SV --> EMP

    style SA fill:#7c3aed,color:#fff
    style OA fill:#2563eb,color:#fff
    style SV fill:#0891b2,color:#fff
    style EMP fill:#059669,color:#fff
```

---

## 8. Geofencing Logic

```mermaid
flowchart LR
    GPS[📍 GPS Point\nlat, lng]
    CACHE{Redis Cache\ngeofence:site_id\nTTL 10 min}
    DB[(PostgreSQL\nSite record)]
    POLY{Has Polygon\nGeoJSON?}
    SHAPELY[Shapely\npoint-in-polygon]
    HAVERSINE[Haversine\nDistance Formula\nd = 2R × arcsin...]
    RESULT{Inside\nGeofence?}
    ALLOW[✅ Proceed to\nFraud Check]
    DENY[🚫 403 Outside\nGeofence]

    GPS --> CACHE
    CACHE -->|miss| DB
    DB --> CACHE
    CACHE -->|hit| POLY
    POLY -->|yes| SHAPELY
    POLY -->|no → radius| HAVERSINE
    SHAPELY --> RESULT
    HAVERSINE --> RESULT
    RESULT -->|yes| ALLOW
    RESULT -->|no| DENY

    style ALLOW fill:#22c55e,color:#fff
    style DENY fill:#ef4444,color:#fff
```

---

## 9. Docker Infrastructure

```mermaid
graph TB
    subgraph External
        PHONE[📱 Phone / Browser]
    end

    subgraph Docker["Docker Compose Network: backend"]
        NGINX[nginx :80]
        API[fastapi :8000]
        WORKER[celery worker]
        BEAT[celery beat]
        PG[postgres:5433\nPostGIS enabled]
        REDIS[redis:6379\nAOF persistence\n256MB max]
        MINIO[minio:9000\nS3-compatible\nPhoto storage]
        MAILHOG[mailhog:8025\nDev SMTP]
    end

    PHONE --> NGINX
    NGINX --> API
    API --> PG
    API --> REDIS
    API --> MINIO
    API --> MAILHOG
    WORKER --> PG
    WORKER --> REDIS
    BEAT --> WORKER

    style NGINX fill:#f97316,color:#fff
    style API fill:#3b82f6,color:#fff
    style PG fill:#1e40af,color:#fff
    style REDIS fill:#dc2626,color:#fff
    style MINIO fill:#7c3aed,color:#fff
```
