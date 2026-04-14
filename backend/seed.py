
"""
Rich demo data seeder — run once after migrations.

Pre-seeds a full realistic dataset so the UI looks meaningful out of the box:
  • 1 Organisation (TechCorp Sdn Bhd)
  • 3 Sites (HQ, Branch, Remote Hub)
  • 10 Users (1 admin, 1 supervisor, 8 employees across 3 departments)
  • 30 days of attendance records with realistic patterns
  • 5 manual approval requests (mix of statuses)
  • 10 notifications per user
  • 3 fraud/anomaly records

Usage:
    python seed.py
    or run automatically via docker-compose (already configured).

Re-running is SAFE — all inserts are skipped if data already exists.
"""

from __future__ import annotations

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

# ── Password hashing ─────────────────────────────────────────────────────────
# Use bcrypt directly to avoid passlib/bcrypt 4.x compatibility issues
try:
    import bcrypt as _bcrypt_lib
    def _hash(pw: str) -> str:
        return _bcrypt_lib.hashpw(pw.encode()[:72], _bcrypt_lib.gensalt(rounds=10)).decode()
except Exception:
    # fallback to passlib
    from passlib.context import CryptContext as _CC
    _pwd = _CC(schemes=["bcrypt"], deprecated="auto")
    def _hash(pw: str) -> str:  # type: ignore[misc]
        return _pwd.hash(pw[:72])

PASSWORD = "Demo@1234"

# ── Fixed UUIDs ───────────────────────────────────────────────────────────────
ORG_ID = "aaaaaaaa-0000-0000-0000-000000000001"

SITES = [
    {
        "id": "bbbbbbbb-0001-0000-0000-000000000001",
        "name": "HQ — Kuala Lumpur",
        "address": "Menara TechCorp, Jalan Ampang, 50450 Kuala Lumpur",
        "lat": 3.1579, "lng": 101.7123, "radius": 150,
    },
    {
        "id": "bbbbbbbb-0002-0000-0000-000000000002",
        "name": "Petaling Jaya Branch",
        "address": "SS2 Tech Park, Petaling Jaya, Selangor",
        "lat": 3.1073, "lng": 101.6067, "radius": 100,
    },
    {
        "id": "bbbbbbbb-0003-0000-0000-000000000003",
        "name": "Cyberjaya Remote Hub",
        "address": "MSC Malaysia, Persiaran APEC, Cyberjaya",
        "lat": 2.9210, "lng": 101.6538, "radius": 200,
    },
]

USERS = [
    # role, id, email, name, dept, site_idx, supervisor_idx
    {"id": "cccccccc-0001-0000-0000-000000000001", "email": "admin@techcorp.demo",      "name": "Amir Hassan",    "role": "org_admin",   "dept": "Management",  "site": 0, "streak": 22},
    {"id": "cccccccc-0002-0000-0000-000000000002", "email": "supervisor@techcorp.demo", "name": "Priya Nair",     "role": "supervisor",  "dept": "Engineering", "site": 0, "streak": 18},
    {"id": "cccccccc-0003-0000-0000-000000000003", "email": "alice@techcorp.demo",      "name": "Alice Tan",      "role": "employee",    "dept": "Engineering", "site": 0, "streak": 15},
    {"id": "cccccccc-0004-0000-0000-000000000004", "email": "bob@techcorp.demo",        "name": "Bob Lim",        "role": "employee",    "dept": "Engineering", "site": 0, "streak": 8},
    {"id": "cccccccc-0005-0000-0000-000000000005", "email": "carol@techcorp.demo",      "name": "Carol Wong",     "role": "employee",    "dept": "Marketing",   "site": 1, "streak": 21},
    {"id": "cccccccc-0006-0000-0000-000000000006", "email": "david@techcorp.demo",      "name": "David Kumar",    "role": "employee",    "dept": "Marketing",   "site": 1, "streak": 5},
    {"id": "cccccccc-0007-0000-0000-000000000007", "email": "eve@techcorp.demo",        "name": "Eve Rashid",     "role": "employee",    "dept": "Operations",  "site": 2, "streak": 12},
    {"id": "cccccccc-0008-0000-0000-000000000008", "email": "frank@techcorp.demo",      "name": "Frank Osman",    "role": "employee",    "dept": "Operations",  "site": 0, "streak": 3},
    {"id": "cccccccc-0009-0000-0000-000000000009", "email": "grace@techcorp.demo",      "name": "Grace Yap",      "role": "employee",    "dept": "HR",          "site": 0, "streak": 19},
    {"id": "cccccccc-0010-0000-0000-000000000010", "email": "henry@techcorp.demo",      "name": "Henry Soh",      "role": "employee",    "dept": "HR",          "site": 1, "streak": 7},
]

# Also keep the original emp1-4@demo.com accounts for backward compat
LEGACY_USERS = [
    {"id": "11111111-1111-1111-1111-111111111111", "email": "admin@demo.com",  "name": "Admin User",   "role": "org_admin",  "dept": "Management",  "site": 0, "streak": 10},
    {"id": "22222222-2222-2222-2222-222222222222", "email": "emp1@demo.com",   "name": "Alice Johnson","role": "employee",   "dept": "Engineering", "site": 0, "streak": 5},
    {"id": "33333333-3333-3333-3333-333333333333", "email": "emp2@demo.com",   "name": "Bob Smith",    "role": "employee",   "dept": "Marketing",   "site": 1, "streak": 3},
    {"id": "44444444-4444-4444-4444-444444444444", "email": "emp3@demo.com",   "name": "Carol White",  "role": "employee",   "dept": "Operations",  "site": 2, "streak": 7},
    {"id": "55555555-5555-5555-5555-555555555555", "email": "emp4@demo.com",   "name": "David Brown",  "role": "employee",   "dept": "HR",          "site": 0, "streak": 2},
]

ALL_USERS = USERS + LEGACY_USERS


def seed(conn) -> None:
    cur = conn.cursor()
    now = datetime.now(timezone.utc)
    hashed_pw = _hash(PASSWORD)

    # ── Organisation ─────────────────────────────────────────────────────────
    cur.execute("SELECT 1 FROM organisations WHERE id = %s", (ORG_ID,))
    if not cur.fetchone():
        cur.execute("""
            INSERT INTO organisations (id, name, slug, timezone, fraud_sensitivity, approval_sla_minutes)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (ORG_ID, "TechCorp Sdn Bhd", "techcorp", "Asia/Kuala_Lumpur", "medium", 30))
        print("  ✓ Organisation: TechCorp Sdn Bhd")
    else:
        print("  – Organisation already exists")

    # ── Sites ─────────────────────────────────────────────────────────────────
    for site in SITES:
        cur.execute("SELECT 1 FROM sites WHERE id = %s", (site["id"],))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO sites (id, org_id, name, address, center_lat, center_lng, radius_meters, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, true)
            """, (site["id"], ORG_ID, site["name"], site["address"], site["lat"], site["lng"], site["radius"]))
            print(f"  ✓ Site: {site['name']}")
        else:
            print(f"  – Site already exists: {site['name']}")

    # ── Users ─────────────────────────────────────────────────────────────────
    for u in ALL_USERS:
        cur.execute("SELECT 1 FROM users WHERE id = %s", (u["id"],))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO users (id, org_id, email, hashed_password, full_name, role, is_active,
                                   streak_count, department, expected_checkin_hour, expected_checkout_hour,
                                   schedule_confidence, risk_level)
                VALUES (%s, %s, %s, %s, %s, %s, true, %s, %s, %s, %s, %s, %s)
            """, (
                u["id"], ORG_ID, u["email"], hashed_pw, u["name"], u["role"],
                u["streak"], u["dept"],
                9.0,   # expected_checkin_hour
                18.0,  # expected_checkout_hour
                0.85,  # schedule_confidence
                "low",
            ))
            print(f"  ✓ User: {u['email']}")
        else:
            print(f"  – User already exists: {u['email']}")

    # ── Attendance: 30 days of rich records ───────────────────────────────────
    employees = [u for u in USERS if u["role"] in ("employee", "supervisor")]
    site_ids  = [s["id"] for s in SITES]

    random.seed(42)  # deterministic so reruns are consistent
    records_added = 0

    for emp in employees:
        site_id = site_ids[emp["site"]]
        base_lat = SITES[emp["site"]]["lat"]
        base_lng = SITES[emp["site"]]["lng"]

        for days_ago in range(30):
            day = date.today() - timedelta(days=days_ago)
            if day.weekday() >= 5:   # skip weekends
                continue

            # Simulate realistic patterns
            roll = random.random()
            if roll < 0.08:          # 8% absent
                continue
            late = roll < 0.18       # 10% of present are late

            checkin_hour   = random.randint(9, 10) if late else random.randint(8, 9)
            checkin_minute = random.randint(0, 59)
            checkout_hour  = random.randint(17, 19)
            checkout_minute= random.randint(0, 59)

            checkin_dt  = datetime.combine(day, time(checkin_hour, checkin_minute), tzinfo=timezone.utc)
            checkout_dt = datetime.combine(day, time(checkout_hour, checkout_minute), tzinfo=timezone.utc)

            # Small GPS jitter
            lat = base_lat + random.uniform(-0.0005, 0.0005)
            lng = base_lng + random.uniform(-0.0005, 0.0005)

            # Fraud score — occasional anomaly
            fraud_score = round(random.uniform(0.0, 0.15), 3)
            if random.random() < 0.05:     # 5% suspicious
                fraud_score = round(random.uniform(0.55, 0.95), 3)

            # Skip if already exists
            cur.execute(
                "SELECT 1 FROM attendance_records WHERE user_id=%s AND created_at::date=%s AND event_type='checkin'",
                (emp["id"], day),
            )
            if cur.fetchone():
                continue

            for ev_type, ts in [("checkin", checkin_dt), ("checkout", checkout_dt)]:
                fraud_flags = {}
                if fraud_score > 0.5 and ev_type == "checkin":
                    fraud_flags = {"unusual_time": True, "location_jump": random.random() > 0.5}
                cur.execute("""
                    INSERT INTO attendance_records
                      (id, user_id, site_id, event_type, lat, lng, accuracy_meters,
                       fraud_score, fraud_flags, is_valid, investigation_status, is_manual, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, true, 'none', false, %s)
                """, (
                    str(uuid.uuid4()), emp["id"], site_id, ev_type,
                    lat, lng, round(random.uniform(3.0, 15.0), 1),
                    fraud_score, __import__("json").dumps(fraud_flags),
                    ts,
                ))
                records_added += 1

    print(f"  ✓ {records_added} attendance records")

    # ── Manual approval requests ──────────────────────────────────────────────
    approvals = [
        {
            "id": "dddddddd-0001-0000-0000-000000000001",
            "user_id": USERS[2]["id"],  # Alice
            "site_id": SITES[0]["id"],
            "reason_code": "indoor",
            "reason_text": "GPS unavailable inside server room",
            "status": "pending",
            "days_ago": 1,
        },
        {
            "id": "dddddddd-0002-0000-0000-000000000002",
            "user_id": USERS[3]["id"],  # Bob
            "site_id": SITES[0]["id"],
            "reason_code": "no_gps",
            "reason_text": "Phone GPS not working, rebooting did not help",
            "status": "pending",
            "days_ago": 0,
        },
        {
            "id": "dddddddd-0003-0000-0000-000000000003",
            "user_id": USERS[6]["id"],  # Eve
            "site_id": SITES[2]["id"],
            "reason_code": "other",
            "reason_text": "Attended offsite client meeting at Cyberjaya",
            "status": "approved",
            "days_ago": 3,
        },
        {
            "id": "dddddddd-0004-0000-0000-000000000004",
            "user_id": USERS[5]["id"],  # David
            "site_id": SITES[1]["id"],
            "reason_code": "indoor",
            "reason_text": "Branch basement — no signal",
            "status": "rejected",
            "days_ago": 5,
        },
        {
            "id": "dddddddd-0005-0000-0000-000000000005",
            "user_id": USERS[4]["id"],  # Carol
            "site_id": SITES[1]["id"],
            "reason_code": "no_gps",
            "reason_text": "GPS drift showing wrong location",
            "status": "pending",
            "days_ago": 0,
        },
    ]
    approvals_added = 0
    for ap in approvals:
        cur.execute("SELECT 1 FROM manual_approval_requests WHERE id = %s", (ap["id"],))
        if not cur.fetchone():
            created = datetime.now(timezone.utc) - timedelta(days=ap["days_ago"], hours=2)
            reviewed_by = USERS[0]["id"] if ap["status"] != "pending" else None
            reviewed_at = (created + timedelta(hours=1)) if ap["status"] != "pending" else None
            cur.execute("""
                INSERT INTO manual_approval_requests
                  (id, user_id, site_id, reason_code, reason_text, status,
                   reviewed_by, reviewed_at, review_note, escalation_level, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s)
            """, (
                ap["id"], ap["user_id"], ap["site_id"],
                ap["reason_code"], ap["reason_text"], ap["status"],
                reviewed_by, reviewed_at,
                "Verified via CCTV" if ap["status"] == "approved" else ("Evidence insufficient" if ap["status"] == "rejected" else None),
                created, created,
            ))
            approvals_added += 1
    print(f"  ✓ {approvals_added} approval requests")

    # ── Notifications ─────────────────────────────────────────────────────────
    notif_templates = [
        ("check_in_reminder",   "Check-in Reminder",        "Don't forget to check in — your shift started 10 minutes ago."),
        ("approval_approved",   "Request Approved ✓",       "Your manual check-in request for HQ has been approved."),
        ("approval_rejected",   "Request Rejected",         "Your manual check-in request was rejected. Please see the review note."),
        ("streak_milestone",    "Streak Milestone! 🔥",     "Amazing! You've reached a 15-day check-in streak. Keep it up!"),
        ("fraud_alert",         "Unusual Activity Detected","An unusual check-in pattern was detected on your account."),
        ("shift_reminder",      "Upcoming Shift",           "Reminder: Your shift starts at 09:00 tomorrow at HQ."),
        ("weekly_summary",      "Weekly Summary",           "You were present 4/5 days this week. Attendance rate: 80%."),
        ("check_out_reminder",  "Check-out Reminder",       "You haven't checked out yet. Please check out before leaving."),
        ("account_update",      "Profile Updated",          "Your profile information has been updated successfully."),
        ("system_notice",       "System Maintenance",       "Scheduled maintenance on Sunday 02:00–04:00 MYT."),
    ]
    notif_added = 0
    employees_for_notif = [u for u in USERS if u["role"] == "employee"][:5]
    for emp in employees_for_notif:
        for i, (ntype, title, body) in enumerate(notif_templates[:6]):
            notif_id = f"eeeeeeee-{emp['id'][-4:]}-{i:04d}-0000-000000000001"
            # ensure valid UUID format
            notif_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{emp['id']}-notif-{i}"))
            cur.execute("SELECT 1 FROM notifications WHERE id = %s", (notif_id,))
            if not cur.fetchone():
                created_at = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 72))
                is_read = random.random() > 0.4
                cur.execute("""
                    INSERT INTO notifications (id, user_id, type, title, body, is_read, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (notif_id, emp["id"], ntype, title, body, is_read, created_at))
                notif_added += 1
    print(f"  ✓ {notif_added} notifications")

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

    print("Seeding rich demo data …\n")
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Demo data seeded successfully!

  LOGIN CREDENTIALS (password: Demo@1234)
  ────────────────────────────────────────
  admin@techcorp.demo      (Admin)
  supervisor@techcorp.demo (Supervisor)
  alice@techcorp.demo      (Engineering)
  bob@techcorp.demo        (Engineering)
  carol@techcorp.demo      (Marketing)
  david@techcorp.demo      (Marketing)
  eve@techcorp.demo        (Operations)
  frank@techcorp.demo      (Operations)
  grace@techcorp.demo      (HR)
  henry@techcorp.demo      (HR)

  Legacy accounts (also work):
  admin@demo.com / emp1-4@demo.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")


if __name__ == "__main__":
    main()
