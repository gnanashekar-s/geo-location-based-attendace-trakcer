"""
Celery task: Dispatch proactive late check-in warnings.

Runs every 5 minutes. For employees whose auto-detected check-in time
has passed by more than 15 minutes AND who haven't checked in today,
creates a Notification record and sets a Redis cooldown (once per day).

Requires: User.expected_checkin_hour and User.schedule_confidence populated
          by the shift_pattern_detector task.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import redis
from celery import shared_task
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.audit_log import Notification
from app.models.user import User

logger = logging.getLogger(__name__)

_engine = None
_SessionLocal = None
_redis_client = None


def _get_session():
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _SessionLocal()


def _get_redis():
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


def _format_hour(hour_float: float) -> str:
    """Convert 8.75 → '08:45'"""
    h = int(hour_float)
    m = int(round((hour_float - h) * 60))
    return f"{h:02d}:{m:02d}"


@shared_task(
    name="app.workers.tasks.late_warning_dispatcher.dispatch_late_warnings",
    bind=True,
    max_retries=1,
)
def dispatch_late_warnings(self) -> dict:
    now_utc = datetime.now(timezone.utc)

    # Only run during working hours (04:00–14:00 UTC)
    if not (4 <= now_utc.hour < 14):
        return {"skipped": "outside_working_hours"}

    today = date.today()
    r = _get_redis()
    dispatched = 0
    already_in = 0
    cooldown_hit = 0

    with _get_session() as session:
        # Load users who have a detected schedule with reasonable confidence
        users = session.execute(
            select(User).where(
                User.is_active == True,
                User.expected_checkin_hour.isnot(None),
                User.schedule_confidence >= 0.40,
            )
        ).scalars().all()

        for user in users:
            expected_hour = user.expected_checkin_hour  # e.g. 8.75
            # Add 15-minute grace period
            threshold_dt = datetime(
                today.year, today.month, today.day,
                tzinfo=timezone.utc,
            ) + timedelta(hours=expected_hour + 0.25)

            # Not yet past threshold
            if now_utc < threshold_dt:
                continue

            # Check cooldown (once per user per day)
            cooldown_key = f"notif:late_warn:{user.id}:{today.isoformat()}"
            if r.get(cooldown_key):
                cooldown_hit += 1
                continue

            # Check if user already checked in today
            checkin_result = session.execute(
                text(
                    "SELECT 1 FROM attendance_records "
                    "WHERE user_id = :uid "
                    "AND DATE(created_at AT TIME ZONE 'UTC') = :today "
                    "AND event_type = 'checkin' "
                    "LIMIT 1"
                ),
                {"uid": str(user.id), "today": today.isoformat()},
            ).first()

            if checkin_result:
                already_in += 1
                continue

            # Create notification
            notif = Notification(
                id=uuid.uuid4(),
                user_id=user.id,
                type="late_warning",
                title="Check-In Reminder",
                body=(
                    f"Your usual check-in time is {_format_hour(expected_hour)}. "
                    f"You haven't checked in yet today. Please check in if you are working."
                ),
                is_read=False,
            )
            session.add(notif)
            session.commit()

            # Set Redis cooldown (24h)
            r.setex(cooldown_key, 86400, "1")
            dispatched += 1
            logger.info("Late warning dispatched for user_id=%s", user.id)

    logger.info(
        "Late warning dispatch complete: dispatched=%d already_in=%d cooldown_hit=%d",
        dispatched, already_in, cooldown_hit,
    )
    return {"dispatched": dispatched, "already_in": already_in, "cooldown_hit": cooldown_hit}
