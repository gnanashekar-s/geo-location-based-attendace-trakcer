"""
Celery task: User Risk Profile Update.

Runs daily at 03:00 UTC. For every active user, computes the 7-day rolling
average fraud score from their check-in records and updates User.risk_level:

  avg_score < 0.25  → "low"
  0.25 <= avg < 0.60 → "medium"
  avg_score >= 0.60  → "high"

Users with no check-in records in the past 7 days are skipped (their
risk_level remains unchanged). Users are processed in batches of 100.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis as sync_redis
from celery import shared_task
from sqlalchemy import create_engine, func as sa_func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Synchronous SQLAlchemy engine
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
# Helpers
# ---------------------------------------------------------------------------


def _score_to_risk(avg_score: float) -> str:
    """Map a 7-day average fraud score to a risk level string."""
    if avg_score < 0.25:
        return "low"
    if avg_score < 0.60:
        return "medium"
    return "high"


# ---------------------------------------------------------------------------
# Main task
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.user_risk_profiler.update_user_risk_profiles",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    acks_late=True,
)
def update_user_risk_profiles(self) -> dict:
    """
    Compute 7-day rolling avg fraud score per user and update User.risk_level.

    Processes all active users in batches of 100. Users with no check-ins
    in the last 7 days are skipped to preserve their existing risk level.
    """
    try:
        from app.models.attendance import AttendanceRecord, EventType  # noqa: PLC0415
        from app.models.user import User  # noqa: PLC0415
    except ImportError as exc:
        logger.error("Model import failed in user_risk_profiler: %s", exc)
        return {"users_processed": 0, "error": str(exc)}

    seven_days_ago = datetime.now(tz=timezone.utc) - timedelta(days=7)
    batch_size = 100
    offset = 0
    users_processed = 0
    counts: dict = {"low": 0, "medium": 0, "high": 0}

    with SyncSession() as session:
        try:
            while True:
                # Fetch one batch of active users
                users = session.execute(
                    select(User)
                    .where(User.is_active.is_(True))
                    .order_by(User.id)
                    .limit(batch_size)
                    .offset(offset)
                ).scalars().all()

                if not users:
                    break

                for user in users:
                    # Compute 7-day avg fraud score for check-in events only
                    avg_result = session.execute(
                        select(sa_func.avg(AttendanceRecord.fraud_score))
                        .where(
                            AttendanceRecord.user_id == user.id,
                            AttendanceRecord.event_type == EventType.checkin,
                            AttendanceRecord.created_at >= seven_days_ago,
                        )
                    ).scalar()

                    if avg_result is None:
                        # No check-ins this week — skip, leave risk_level unchanged
                        continue

                    new_level = _score_to_risk(float(avg_result))
                    # Use setattr to handle cases where risk_level column may not
                    # exist yet in older deployments (migration not yet applied)
                    try:
                        user.risk_level = new_level
                    except AttributeError:
                        continue
                    counts[new_level] += 1
                    users_processed += 1

                session.commit()
                offset += batch_size

                if len(users) < batch_size:
                    break  # Last batch processed

        except Exception as exc:
            session.rollback()
            logger.exception("User risk profiler task failed: %s", exc)
            raise self.retry(exc=exc)

    logger.info(
        "User risk profiles updated: total=%d low=%d medium=%d high=%d",
        users_processed,
        counts["low"],
        counts["medium"],
        counts["high"],
    )
    return {
        "users_processed": users_processed,
        "low_risk": counts["low"],
        "medium_risk": counts["medium"],
        "high_risk": counts["high"],
    }
