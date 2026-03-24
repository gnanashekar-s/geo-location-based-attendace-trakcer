"""
Celery task: Buddy Punch Detection.

Every 10 minutes Beat fires run_buddy_punch_analysis(). The task:
  1. Fetches all check-in events from the last 15 minutes.
  2. Groups by site_id.
  3. For each site, finds pairs of check-ins by DIFFERENT users where:
       - Time gap between them <= 5 minutes
       - GPS distance between them <= 10 metres
       - GPS accuracy < 30 metres for BOTH records
  4. For each detected pair:
       - Appends "BUDDY_PUNCH_CONFIRMED" to fraud_flags (full list reassignment)
       - Adds 0.40 to fraud_score (capped at 1.0)
       - Sets is_valid=False if score >= FRAUD_SCORE_THRESHOLD
       - Publishes a Redis pub/sub alert to channel "ws:feed"
       - Sets 30-minute cooldown per user+site to avoid re-flagging
  5. Returns {"incidents": N, "records_flagged": M}

CRITICAL: Always full-reassign fraud_flags. Never do record.fraud_flags.append().
Use sync SQLAlchemy + sync Redis — same pattern as geofence_watch.py.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis as sync_redis
from celery import shared_task
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Synchronous SQLAlchemy engine (mirrors geofence_watch.py pattern)
# ---------------------------------------------------------------------------

_sync_engine = create_engine(
    settings.sync_database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
)
SyncSession: sessionmaker[Session] = sessionmaker(
    bind=_sync_engine, autoflush=False, autocommit=False, expire_on_commit=False
)

# ---------------------------------------------------------------------------
# Redis client (synchronous)
# ---------------------------------------------------------------------------

_redis_client: Optional[sync_redis.Redis] = None


def _get_redis() -> sync_redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = sync_redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    return _redis_client


# ---------------------------------------------------------------------------
# Geometry helper
# ---------------------------------------------------------------------------


def _haversine_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Main task
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.buddy_punch_analysis.run_buddy_punch_analysis",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def run_buddy_punch_analysis(self) -> dict:
    """
    Scan recent check-ins for buddy punch incidents.

    Two users checking in from the same GPS location within 5 minutes at the
    same site (with high accuracy) indicates one person is checking in for
    another ('buddy punching').

    Redis cooldown key schema
    ─────────────────────────
      fraud:buddy_punch:{user_id}:{site_id}  →  "1" with 30-minute TTL
    """
    try:
        from app.models.attendance import AttendanceRecord, EventType  # noqa: PLC0415
        from app.models.user import User  # noqa: PLC0415
    except ImportError as exc:
        logger.error("Model import failed in buddy_punch_analysis: %s", exc)
        return {"incidents": 0, "records_flagged": 0, "error": str(exc)}

    r = _get_redis()
    incidents = 0
    records_flagged = 0

    with SyncSession() as session:
        try:
            fifteen_min_ago = datetime.now(tz=timezone.utc) - timedelta(minutes=15)

            # Fetch all check-ins from the last 15 minutes with user info
            stmt = (
                select(AttendanceRecord, User)
                .join(User, User.id == AttendanceRecord.user_id)
                .where(
                    AttendanceRecord.event_type == EventType.checkin,
                    AttendanceRecord.created_at >= fifteen_min_ago,
                    AttendanceRecord.lat.isnot(None),
                    AttendanceRecord.lng.isnot(None),
                    User.is_active.is_(True),
                )
            )
            results = session.execute(stmt).all()
            logger.info(
                "Buddy punch check: %d recent check-ins in the last 15 minutes",
                len(results),
            )

            if not results:
                return {"incidents": 0, "records_flagged": 0}

            # Group by site_id
            by_site: dict = {}
            for record, user in results:
                site_key = str(record.site_id)
                if site_key not in by_site:
                    by_site[site_key] = []
                by_site[site_key].append((record, user))

            # Check all pairs within each site
            for site_id_str, entries in by_site.items():
                if len(entries) < 2:
                    continue

                for i in range(len(entries)):
                    for j in range(i + 1, len(entries)):
                        rec_a, user_a = entries[i]
                        rec_b, user_b = entries[j]

                        # Must be different users
                        if rec_a.user_id == rec_b.user_id:
                            continue

                        # Both must have good GPS accuracy (< 30m)
                        acc_a = rec_a.accuracy_meters
                        acc_b = rec_b.accuracy_meters
                        if acc_a is None or acc_b is None or acc_a >= 30 or acc_b >= 30:
                            continue

                        # Within 5 minutes of each other
                        time_a = rec_a.created_at
                        time_b = rec_b.created_at
                        if time_a.tzinfo is None:
                            time_a = time_a.replace(tzinfo=timezone.utc)
                        if time_b.tzinfo is None:
                            time_b = time_b.replace(tzinfo=timezone.utc)
                        time_gap_secs = abs((time_a - time_b).total_seconds())
                        if time_gap_secs > 300:
                            continue

                        # Within 10 metres of each other
                        dist_m = _haversine_distance_meters(
                            rec_a.lat, rec_a.lng, rec_b.lat, rec_b.lng
                        )
                        if dist_m > 10:
                            continue

                        # Check cooldown for both users (avoid re-flagging same incident)
                        cooldown_a = f"fraud:buddy_punch:{rec_a.user_id}:{site_id_str}"
                        cooldown_b = f"fraud:buddy_punch:{rec_b.user_id}:{site_id_str}"
                        if r.exists(cooldown_a) or r.exists(cooldown_b):
                            continue

                        # ── Buddy punch confirmed ──────────────────────────
                        incidents += 1
                        for rec in (rec_a, rec_b):
                            # Build new flags list (never mutate JSONB in place)
                            existing = rec.fraud_flags
                            if isinstance(existing, list):
                                existing_list = list(existing)
                            elif isinstance(existing, dict):
                                existing_list = [k for k, v in existing.items() if v]
                            else:
                                existing_list = []

                            if "BUDDY_PUNCH_CONFIRMED" not in existing_list:
                                rec.fraud_flags = existing_list + ["BUDDY_PUNCH_CONFIRMED"]
                                new_score = min(float(rec.fraud_score) + 0.40, 1.0)
                                rec.fraud_score = round(new_score, 4)
                                if new_score >= settings.FRAUD_SCORE_THRESHOLD:
                                    rec.is_valid = False
                                records_flagged += 1

                        # Set 30-minute cooldown to avoid re-alerting same incident
                        r.setex(cooldown_a, 1800, "1")
                        r.setex(cooldown_b, 1800, "1")

                        # Publish real-time WebSocket alert
                        alert_payload = json.dumps(
                            {
                                "event": "buddy_punch_detected",
                                "users": [str(rec_a.user_id), str(rec_b.user_id)],
                                "user_names": [user_a.full_name, user_b.full_name],
                                "site_id": site_id_str,
                                "distance_meters": round(dist_m, 2),
                                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                            }
                        )
                        r.publish("ws:feed", alert_payload)

                        logger.warning(
                            "Buddy punch detected: users=[%s, %s] site=%s dist=%.1fm gap=%.0fs",
                            rec_a.user_id,
                            rec_b.user_id,
                            site_id_str,
                            dist_m,
                            time_gap_secs,
                        )

            session.commit()

        except Exception as exc:
            session.rollback()
            logger.exception("Buddy punch analysis task failed: %s", exc)
            raise self.retry(exc=exc)

    return {"incidents": incidents, "records_flagged": records_flagged}
