"""
Rich demo data seeder — run once after migrations.

Pre-seeds a full realistic Bangalore-based dataset:
  • 1 Organisation  (InnovateTech Bangalore Pvt Ltd)
  • 3 Sites         (Manyata Tech Park HQ · Electronic City Branch · Whitefield ITPL Hub)
  • 10 Users        (1 admin, 1 supervisor, 8 employees across 3 departments)
  • Legacy accounts (admin@demo.com, emp1–4@demo.com) — WITH full attendance history
  • 30 days of attendance with realistic IST patterns, occasional fraud scores
  • 5 manual approval requests  (mix of statuses)
  • Notifications per employee

Usage:
    python seed.py
    or run automatically via docker-compose (already configured).

Re-running is SAFE — all inserts use ON CONFLICT DO UPDATE so data stays fresh.
"""

from __future__ import annotations

import json
import os
import sys
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone

import psycopg2
from psycopg2.extras import execute_values

# ── DB connection ─────────────────────────────────────────────────────────────
_url = os.getenv("SYNC_DATABASE_URL") or os.getenv("DATABASE_URL", "")
if "+asyncpg" in _url:
    _url = _url.replace("+asyncpg", "+psycopg2")
if _url.startswith("postgresql+psycopg2://"):
    _url = _url.replace("postgresql+psycopg2://", "postgresql://", 1)

# ── Password hashing ──────────────────────────────────────────────────────────
try:
    import bcrypt as _bcrypt_lib
    def _hash(pw: str) -> str:
        return _bcrypt_lib.hashpw(pw.encode()[:72], _bcrypt_lib.gensalt(rounds=10)).decode()
except Exception:
    from passlib.context import CryptContext as _CC
    _pwd = _CC(schemes=["bcrypt"], deprecated="auto")
    def _hash(pw: str) -> str:  # type: ignore[misc]
        return _pwd.hash(pw[:72])

PASSWORD = "Demo@1234"

# ── IST offset (UTC+5:30) ──────────────────────────────────────────────────────
IST = timezone(timedelta(hours=5, minutes=30))

def _ist(day: date, hour: int, minute: int) -> datetime:
    """Return a UTC-aware datetime for a given IST wall-clock time."""
    return datetime.combine(day, time(hour, minute), tzinfo=IST).astimezone(timezone.utc)

# ── Fixed UUIDs ───────────────────────────────────────────────────────────────
ORG_ID = "aaaaaaaa-0000-0000-0000-000000000001"

# ── Bangalore office sites ────────────────────────────────────────────────────
#   Real tech-park coordinates — radius sized for typical campus gate-to-desk
SITES = [
    {
        "id":      "bbbbbbbb-0001-0000-0000-000000000001",
        "name":    "Manyata Tech Park — HQ",
        "address": "Manyata Embassy Business Park, Nagawara, Bengaluru — 560045",
        "lat": 13.0434, "lng": 77.6201, "radius": 300,
    },
    {
        "id":      "bbbbbbbb-0002-0000-0000-000000000002",
        "name":    "Electronic City — Phase I Branch",
        "address": "Electronics City Phase 1, Hosur Road, Bengaluru — 560100",
        "lat": 12.8445, "lng": 77.6609, "radius": 200,
    },
    {
        "id":      "bbbbbbbb-0003-0000-0000-000000000003",
        "name":    "Whitefield ITPL Hub",
        "address": "International Tech Park Bangalore, Whitefield Main Road, Bengaluru — 560066",
        "lat": 12.9804, "lng": 77.7247, "radius": 250,
    },
]

# ── Primary users (techcorp.demo) ─────────────────────────────────────────────
USERS = [
    {"id": "cccccccc-0001-0000-0000-000000000001", "email": "admin@techcorp.demo",
     "name": "Vikram Sharma",       "role": "org_admin",  "dept": "Management",  "site": 0, "streak": 22},
    {"id": "cccccccc-0002-0000-0000-000000000002", "email": "supervisor@techcorp.demo",
     "name": "Deepa Krishnamurthy", "role": "supervisor", "dept": "Engineering", "site": 0, "streak": 18},
    {"id": "cccccccc-0003-0000-0000-000000000003", "email": "arjun@techcorp.demo",
     "name": "Arjun Reddy",         "role": "employee",   "dept": "Engineering", "site": 0, "streak": 15},
    {"id": "cccccccc-0004-0000-0000-000000000004", "email": "sneha@techcorp.demo",
     "name": "Sneha Iyer",          "role": "employee",   "dept": "Engineering", "site": 0, "streak": 8},
    {"id": "cccccccc-0005-0000-0000-000000000005", "email": "priya@techcorp.demo",
     "name": "Priya Menon",         "role": "employee",   "dept": "Marketing",   "site": 1, "streak": 21},
    {"id": "cccccccc-0006-0000-0000-000000000006", "email": "rohan@techcorp.demo",
     "name": "Rohan Nair",          "role": "employee",   "dept": "Marketing",   "site": 1, "streak": 5},
    {"id": "cccccccc-0007-0000-0000-000000000007", "email": "kavya@techcorp.demo",
     "name": "Kavya Patel",         "role": "employee",   "dept": "Operations",  "site": 2, "streak": 12},
    {"id": "cccccccc-0008-0000-0000-000000000008", "email": "rahul@techcorp.demo",
     "name": "Rahul Verma",         "role": "employee",   "dept": "Operations",  "site": 0, "streak": 3},
    {"id": "cccccccc-0009-0000-0000-000000000009", "email": "ananya@techcorp.demo",
     "name": "Ananya Bhat",         "role": "employee",   "dept": "HR",          "site": 0, "streak": 19},
    {"id": "cccccccc-0010-0000-0000-000000000010", "email": "karthik@techcorp.demo",
     "name": "Karthik Subramaniam", "role": "employee",   "dept": "HR",          "site": 1, "streak": 7},
]

# ── Legacy accounts kept for backward compatibility — NOW with real data ──────
LEGACY_USERS = [
    {"id": "11111111-1111-1111-1111-111111111111", "email": "admin@demo.com",
     "name": "Admin User",          "role": "org_admin",  "dept": "Management",  "site": 0, "streak": 10},
    {"id": "22222222-2222-2222-2222-222222222222", "email": "emp1@demo.com",
     "name": "Aditya Kulkarni",     "role": "employee",   "dept": "Engineering", "site": 0, "streak": 14},
    {"id": "33333333-3333-3333-3333-333333333333", "email": "emp2@demo.com",
     "name": "Meera Pillai",        "role": "employee",   "dept": "Marketing",   "site": 1, "streak": 9},
    {"id": "44444444-4444-4444-4444-444444444444", "email": "emp3@demo.com",
     "name": "Suresh Gowda",        "role": "employee",   "dept": "Operations",  "site": 2, "streak": 6},
    {"id": "55555555-5555-5555-5555-555555555555", "email": "emp4@demo.com",
     "name": "Nisha Desai",         "role": "employee",   "dept": "HR",          "site": 0, "streak": 4},
]

ALL_USERS = USERS + LEGACY_USERS


def seed(conn) -> None:
    cur = conn.cursor()
    hashed_pw = _hash(PASSWORD)

    # ── Organisation ──────────────────────────────────────────────────────────
    cur.execute("""
        INSERT INTO organisations (id, name, slug, timezone, fraud_sensitivity, approval_sla_minutes)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE
          SET name                = EXCLUDED.name,
              slug                = EXCLUDED.slug,
              timezone            = EXCLUDED.timezone,
              fraud_sensitivity   = EXCLUDED.fraud_sensitivity,
              approval_sla_minutes= EXCLUDED.approval_sla_minutes
    """, (ORG_ID, "InnovateTech Bangalore Pvt Ltd", "innovatetech-blr",
          "Asia/Kolkata", "medium", 30))
    print("  ✓ Organisation: InnovateTech Bangalore Pvt Ltd")

    # ── Sites ─────────────────────────────────────────────────────────────────
    for site in SITES:
        cur.execute("""
            INSERT INTO sites (id, org_id, name, address, center_lat, center_lng, radius_meters, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, true)
            ON CONFLICT (id) DO UPDATE
              SET name           = EXCLUDED.name,
                  address        = EXCLUDED.address,
                  center_lat     = EXCLUDED.center_lat,
                  center_lng     = EXCLUDED.center_lng,
                  radius_meters  = EXCLUDED.radius_meters
        """, (site["id"], ORG_ID, site["name"], site["address"],
              site["lat"], site["lng"], site["radius"]))
        print(f"  ✓ Site: {site['name']}")

    # ── Users ─────────────────────────────────────────────────────────────────
    for u in ALL_USERS:
        cur.execute("""
            INSERT INTO users
              (id, org_id, email, hashed_password, full_name, role, is_active,
               streak_count, department, expected_checkin_hour, expected_checkout_hour,
               schedule_confidence, risk_level)
            VALUES (%s, %s, %s, %s, %s, %s, true, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
              SET full_name              = EXCLUDED.full_name,
                  email                  = EXCLUDED.email,
                  hashed_password        = EXCLUDED.hashed_password,
                  streak_count           = EXCLUDED.streak_count,
                  department             = EXCLUDED.department,
                  expected_checkin_hour  = EXCLUDED.expected_checkin_hour,
                  expected_checkout_hour = EXCLUDED.expected_checkout_hour,
                  schedule_confidence    = EXCLUDED.schedule_confidence,
                  risk_level             = EXCLUDED.risk_level
        """, (
            u["id"], ORG_ID, u["email"], hashed_pw, u["name"], u["role"],
            u["streak"], u["dept"],
            9.0,   # expected check-in  (IST 09:00)
            18.0,  # expected check-out (IST 18:00)
            0.87,
            "low",
        ))
        print(f"  ✓ User: {u['email']}  ({u['name']})")

    # ── Attendance — 30 days for ALL employees (including legacy emp1/emp2) ────
    #
    # IST working hours:
    #   Typical check-in  : 09:00–10:00 IST  (late: 10:00–11:00)
    #   Typical check-out : 18:00–20:00 IST
    #
    employees = [u for u in ALL_USERS if u["role"] in ("employee", "supervisor")]
    site_ids  = [s["id"] for s in SITES]

    random.seed(42)  # deterministic reruns
    records_added = 0
    records_skipped = 0

    for emp in employees:
        site_idx = emp["site"]
        site_id  = site_ids[site_idx]
        base_lat = SITES[site_idx]["lat"]
        base_lng = SITES[site_idx]["lng"]

        for days_ago in range(30):
            day = date.today() - timedelta(days=days_ago)
            if day.weekday() >= 5:   # skip Sat/Sun
                continue

            roll = random.random()
            if roll < 0.07:          # ~7 % absent
                continue
            late = roll < 0.17       # ~10 % of present are late

            # IST times
            ci_hour = random.randint(10, 10) if late else random.randint(9, 9)
            ci_min  = random.randint(5, 55)
            co_hour = random.randint(18, 20)
            co_min  = random.randint(0, 59)

            checkin_dt  = _ist(day, ci_hour, ci_min)
            checkout_dt = _ist(day, co_hour, co_min)

            # GPS jitter within ~50 m of the campus gate
            lat = base_lat + random.uniform(-0.0004, 0.0004)
            lng = base_lng + random.uniform(-0.0004, 0.0004)

            # Fraud score — mostly clean, occasional spikes
            fraud_score = round(random.uniform(0.0, 0.12), 3)
            if random.random() < 0.06:     # 6 % suspicious
                fraud_score = round(random.uniform(0.55, 0.92), 3)

            # Skip if already exists (idempotent)
            cur.execute(
                "SELECT 1 FROM attendance_records "
                "WHERE user_id=%s AND created_at::date=%s AND event_type='checkin'",
                (emp["id"], day),
            )
            if cur.fetchone():
                records_skipped += 1
                continue

            for ev_type, ts in [("checkin", checkin_dt), ("checkout", checkout_dt)]:
                fraud_flags: dict = {}
                if fraud_score > 0.5 and ev_type == "checkin":
                    fraud_flags = {
                        "unusual_time": random.random() > 0.4,
                        "location_jump": random.random() > 0.5,
                    }
                cur.execute("""
                    INSERT INTO attendance_records
                      (id, user_id, site_id, event_type, lat, lng, accuracy_meters,
                       fraud_score, fraud_flags, is_valid, investigation_status, is_manual, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                            true, 'none', false, %s)
                """, (
                    str(uuid.uuid4()), emp["id"], site_id, ev_type,
                    lat, lng,
                    round(random.uniform(3.0, 12.0), 1),
                    fraud_score, json.dumps(fraud_flags), ts,
                ))
                records_added += 1

    print(f"  ✓ {records_added} attendance records added  ({records_skipped} already existed)")

    # ── Manual approval requests ──────────────────────────────────────────────
    approvals = [
        {
            "id": "dddddddd-0001-0000-0000-000000000001",
            "user_id":     USERS[2]["id"],   # Arjun Reddy
            "site_id":     SITES[0]["id"],   # Manyata
            "reason_code": "indoor",
            "reason_text": "GPS unavailable inside B-block server room — thick concrete walls",
            "status":      "pending",
            "days_ago":    1,
        },
        {
            "id": "dddddddd-0002-0000-0000-000000000002",
            "user_id":     USERS[3]["id"],   # Sneha Iyer
            "site_id":     SITES[0]["id"],   # Manyata
            "reason_code": "no_gps",
            "reason_text": "Phone GPS not locking — tried reboot, issue persists in Manyata basement parking",
            "status":      "pending",
            "days_ago":    0,
        },
        {
            "id": "dddddddd-0003-0000-0000-000000000003",
            "user_id":     USERS[6]["id"],   # Kavya Patel
            "site_id":     SITES[2]["id"],   # Whitefield
            "reason_code": "other",
            "reason_text": "Offsite client meeting at RMZ Ecospace Bellandur — returning to ITPL post-lunch",
            "status":      "approved",
            "days_ago":    3,
        },
        {
            "id": "dddddddd-0004-0000-0000-000000000004",
            "user_id":     USERS[5]["id"],   # Rohan Nair
            "site_id":     SITES[1]["id"],   # Electronic City
            "reason_code": "indoor",
            "reason_text": "No signal in ECity Phase-1 cafeteria basement — check-in delayed",
            "status":      "rejected",
            "days_ago":    5,
        },
        {
            "id": "dddddddd-0005-0000-0000-000000000005",
            "user_id":     USERS[4]["id"],   # Priya Menon
            "site_id":     SITES[1]["id"],   # Electronic City
            "reason_code": "no_gps",
            "reason_text": "GPS drift showing location near Silk Board flyover instead of ECity office",
            "status":      "pending",
            "days_ago":    0,
        },
    ]
    for ap in approvals:
        created    = datetime.now(timezone.utc) - timedelta(days=ap["days_ago"], hours=2)
        reviewed_by = USERS[0]["id"] if ap["status"] != "pending" else None
        reviewed_at = (created + timedelta(hours=1)) if ap["status"] != "pending" else None
        note = (
            "Verified via office CCTV footage" if ap["status"] == "approved"
            else ("Evidence insufficient — GPS logs show different location" if ap["status"] == "rejected"
                  else None)
        )
        cur.execute("""
            INSERT INTO manual_approval_requests
              (id, user_id, site_id, reason_code, reason_text, status,
               reviewed_by, reviewed_at, review_note, escalation_level, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s)
            ON CONFLICT (id) DO UPDATE
              SET reason_text  = EXCLUDED.reason_text,
                  status       = EXCLUDED.status,
                  reviewed_by  = EXCLUDED.reviewed_by,
                  reviewed_at  = EXCLUDED.reviewed_at,
                  review_note  = EXCLUDED.review_note,
                  updated_at   = EXCLUDED.updated_at
        """, (
            ap["id"], ap["user_id"], ap["site_id"],
            ap["reason_code"], ap["reason_text"], ap["status"],
            reviewed_by, reviewed_at, note, created, created,
        ))
    print(f"  ✓ {len(approvals)} approval requests upserted")

    # ── Notifications ─────────────────────────────────────────────────────────
    notif_templates = [
        ("check_in_reminder",  "Check-in Reminder",
         "Don't forget to check in — your shift started 10 minutes ago at Manyata Tech Park."),
        ("approval_approved",  "Request Approved ✓",
         "Your manual check-in request for Manyata Tech Park HQ has been approved."),
        ("approval_rejected",  "Request Rejected",
         "Your check-in request was rejected. Please review the admin note."),
        ("streak_milestone",   "Streak Milestone! 🔥",
         "You've hit a 15-day attendance streak. Keep it going — you're on fire!"),
        ("fraud_alert",        "Unusual Activity Detected",
         "An unusual check-in pattern was flagged on your account. Contact HR if this wasn't you."),
        ("shift_reminder",     "Upcoming Shift",
         "Reminder: Your shift begins at 09:00 IST tomorrow at Manyata Tech Park."),
        ("weekly_summary",     "Weekly Attendance Summary",
         "You were present 4 out of 5 days this week. Attendance rate: 80%."),
        ("check_out_reminder", "Check-out Reminder",
         "You haven't checked out yet. Please check out before leaving the campus."),
        ("system_notice",      "Platform Maintenance",
         "Scheduled maintenance Sunday 02:00–04:00 IST. No check-ins during this window."),
    ]
    notif_added = 0
    notif_employees = [u for u in USERS if u["role"] == "employee"][:6]
    for emp in notif_employees:
        for i, (ntype, title, body) in enumerate(notif_templates[:7]):
            notif_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{emp['id']}-notif-{i}"))
            created_at = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 96))
            is_read = random.random() > 0.4
            cur.execute("""
                INSERT INTO notifications (id, user_id, type, title, body, is_read, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET title      = EXCLUDED.title,
                      body       = EXCLUDED.body,
                      is_read    = EXCLUDED.is_read
            """, (notif_id, emp["id"], ntype, title, body, is_read, created_at))
            notif_added += 1
    print(f"  ✓ {notif_added} notifications upserted")

    conn.commit()
    cur.close()


def main() -> None:
    if not _url:
        print("ERROR: Set SYNC_DATABASE_URL or DATABASE_URL")
        sys.exit(1)

    print(f"\nConnecting to {_url.split('@')[-1]} …")
    try:
        conn = psycopg2.connect(_url)
    except Exception as exc:
        print(f"ERROR: Cannot connect — {exc}")
        sys.exit(1)

    print("Seeding Bangalore demo data …\n")
    try:
        seed(conn)
    except Exception as exc:
        conn.rollback()
        print(f"\nERROR during seed: {exc}")
        import traceback; traceback.print_exc()
        raise
    finally:
        conn.close()

    print("""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Bangalore demo data seeded!

  OFFICES
  ───────────────────────────────────────────────────
  Manyata Tech Park HQ        (13.0434°N  77.6201°E)
  Electronic City Phase-I     (12.8445°N  77.6609°E)
  Whitefield ITPL Hub         (12.9804°N  77.7247°E)

  LOGIN CREDENTIALS  (password: Demo@1234)
  ───────────────────────────────────────────────────
  admin@techcorp.demo        Vikram Sharma    (Admin)
  supervisor@techcorp.demo   Deepa Krishnamurthy
  arjun@techcorp.demo        Arjun Reddy      (Engineering)
  sneha@techcorp.demo        Sneha Iyer       (Engineering)
  priya@techcorp.demo        Priya Menon      (Marketing)
  rohan@techcorp.demo        Rohan Nair       (Marketing)
  kavya@techcorp.demo        Kavya Patel      (Operations)
  rahul@techcorp.demo        Rahul Verma      (Operations)
  ananya@techcorp.demo       Ananya Bhat      (HR)
  karthik@techcorp.demo      Karthik Subramaniam (HR)

  Legacy accounts (also have full attendance history):
  admin@demo.com             Admin User
  emp1@demo.com              Aditya Kulkarni  (Engineering @ Manyata)
  emp2@demo.com              Meera Pillai     (Marketing  @ ECity)
  emp3@demo.com              Suresh Gowda     (Operations @ Whitefield)
  emp4@demo.com              Nisha Desai      (HR @ Manyata)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")


if __name__ == "__main__":
    main()
