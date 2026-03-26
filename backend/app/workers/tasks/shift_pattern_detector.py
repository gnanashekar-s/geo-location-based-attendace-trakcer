"""
Celery task: Detect habitual check-in/check-out times for each user.

Runs daily at 04:00 UTC. For each user with ≥5 check-in events in
the last 90 days, computes mean hour-of-day and a confidence score
based on standard deviation. Stores results on User.expected_checkin_hour,
User.expected_checkout_hour, User.schedule_confidence.
"""
from __future__ import annotations
import statistics
import logging
from datetime import datetime, timezone, timedelta

from celery import shared_task
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.user import User
from app.models.attendance import AttendanceRecord

logger = logging.getLogger(__name__)

_engine = None
_SessionLocal = None

def _get_session():
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _SessionLocal()


@shared_task(name="app.workers.tasks.shift_pattern_detector.detect_shift_patterns", bind=True, max_retries=2)
def detect_shift_patterns(self) -> dict:
    logger.info("Starting shift pattern detection")
    updated = 0
    skipped = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    with _get_session() as session:
        # Process users in batches of 100
        offset = 0
        while True:
            users = session.execute(
                select(User).where(User.is_active == True).offset(offset).limit(100)
            ).scalars().all()
            if not users:
                break
            offset += 100

            for user in users:
                # Fetch check-in timestamps
                checkin_rows = session.execute(
                    select(AttendanceRecord.created_at)
                    .where(
                        AttendanceRecord.user_id == user.id,
                        AttendanceRecord.event_type == "checkin",
                        AttendanceRecord.created_at >= cutoff,
                    )
                    .order_by(AttendanceRecord.created_at.desc())
                    .limit(60)
                ).scalars().all()

                if len(checkin_rows) < 5:
                    skipped += 1
                    continue

                # Convert to hour-of-day floats
                checkin_hours = [
                    (ts.astimezone(timezone.utc).hour + ts.astimezone(timezone.utc).minute / 60.0)
                    for ts in checkin_rows
                ]
                mean_in = statistics.mean(checkin_hours)
                std_in = statistics.pstdev(checkin_hours)
                confidence = max(0.0, min(1.0, 1.0 - std_in / 3.0))

                # Fetch check-out timestamps
                checkout_rows = session.execute(
                    select(AttendanceRecord.created_at)
                    .where(
                        AttendanceRecord.user_id == user.id,
                        AttendanceRecord.event_type == "checkout",
                        AttendanceRecord.created_at >= cutoff,
                    )
                    .order_by(AttendanceRecord.created_at.desc())
                    .limit(60)
                ).scalars().all()

                mean_out = None
                if len(checkout_rows) >= 5:
                    checkout_hours = [
                        (ts.astimezone(timezone.utc).hour + ts.astimezone(timezone.utc).minute / 60.0)
                        for ts in checkout_rows
                    ]
                    mean_out = statistics.mean(checkout_hours)

                user.expected_checkin_hour = round(mean_in, 2)
                user.expected_checkout_hour = round(mean_out, 2) if mean_out else None
                user.schedule_confidence = round(confidence, 3)
                session.add(user)
                updated += 1

            session.commit()

    logger.info("Shift pattern detection done: updated=%d skipped=%d", updated, skipped)
    return {"updated": updated, "skipped": skipped}
