"""
Attendance service.

Handles:
- GPS check-in with geofence validation and fraud checking.
- GPS check-out.
- Break start/end.
- History queries.
- Streak maintenance.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.attendance import (
    AttendanceRecord,
    BreakRequest,
    CheckinRequest,
    CheckoutRequest,
)
from app.services.fraud_service import evaluate_checkin
from app.services.geo_service import get_site_geofence, check_within_geofence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _today_start_end() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# Check-in
# ---------------------------------------------------------------------------


async def create_checkin(
    request: CheckinRequest,
    user,
    db: AsyncSession,
    redis: Redis,
) -> AttendanceRecord:
    """
    Validate geofence, run fraud checks, persist a check-in event and update
    the user's streak.

    Raises:
        HTTPException 400: already checked in today.
        HTTPException 403: fraud score blocks entry.
        HTTPException 422: outside geofence.
    """
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]
    from app.models.location import Site  # type: ignore[attr-defined]

    # --- Guard: already checked in today ---
    start, end = _today_start_end()
    existing = await db.execute(
        select(AttendanceLog).where(
            and_(
                AttendanceLog.user_id == user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= start,
                AttendanceLog.created_at < end,
            )
        )
    )
    if existing.scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already checked in today.")

    # --- Find the closest active site for the org ---
    sites_result = await db.execute(
        select(Site).where(and_(Site.org_id == user.org_id, Site.is_active.is_(True)))
    )
    sites = sites_result.scalars().all()

    matched_site = None
    for site in sites:
        site_geofence = await get_site_geofence(str(site.id), redis, db)
        if check_within_geofence(request.lat, request.lng, site_geofence):
            matched_site = site
            break

    if matched_site is None:
        if sites:
            # Sites exist but user is outside all of them
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="You are outside all registered geofences. Check-in not allowed.",
            )
        # No sites registered yet — allow check-in as unverified (setup/demo mode)
        logger.warning(
            "No active sites for org %s. Allowing check-in without geofence validation.",
            user.org_id,
        )

    # --- Fraud evaluation ---
    fraud = await evaluate_checkin(request, user, db, redis, None)

    if fraud.block:
        logger.warning(
            "Check-in blocked for user %s: fraud_score=%.2f flags=%s",
            user.id,
            fraud.score,
            fraud.flags,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Check-in blocked due to suspicious activity (score={fraud.score:.2f}).",
        )

    # --- Persist ---
    log = AttendanceLog(
        id=uuid.uuid4(),
        user_id=user.id,
        site_id=matched_site.id if matched_site else None,
        event_type=EventType.checkin,
        lat=request.lat,
        lng=request.lng,
        accuracy_meters=request.accuracy_meters,
        photo_url=request.photo_url,
        ip_address=request.ip_address,
        fraud_score=fraud.score,
        fraud_flags={flag: True for flag in fraud.flags},
        is_valid=not fraud.block,
    )
    db.add(log)
    await db.flush()

    # --- Streak ---
    await update_streak(user, db)

    await db.commit()
    await db.refresh(log)

    # --- Publish to WebSocket feed ---
    import json as _json
    try:
        await redis.publish(
            "ws:feed",
            _json.dumps(
                {
                    "event": "check_in",
                    "user_id": str(user.id),
                    "site_id": str(matched_site.id),
                    "timestamp": log.created_at.isoformat(),
                    "fraud_score": fraud.score,
                },
                default=str,
            ),
        )
    except Exception as _pub_exc:  # noqa: BLE001
        logger.warning("Failed to publish to ws:feed: %s", _pub_exc)

    return AttendanceRecord.model_validate(log)


# ---------------------------------------------------------------------------
# Check-out
# ---------------------------------------------------------------------------


async def create_checkout(
    request: CheckoutRequest,
    user,
    db: AsyncSession,
) -> AttendanceRecord:
    """
    Record a checkout event.

    Raises:
        HTTPException 400: no open check-in found for today.
    """
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]

    start, end = _today_start_end()

    # Must have a checkin today
    checkin_result = await db.execute(
        select(AttendanceLog).where(
            and_(
                AttendanceLog.user_id == user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= start,
                AttendanceLog.created_at < end,
            )
        )
    )
    checkin = checkin_result.scalars().first()
    if checkin is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No check-in found for today.")

    # Guard against double checkout
    existing_checkout = await db.execute(
        select(AttendanceLog).where(
            and_(
                AttendanceLog.user_id == user.id,
                AttendanceLog.event_type == EventType.checkout,
                AttendanceLog.created_at >= start,
                AttendanceLog.created_at < end,
            )
        )
    )
    if existing_checkout.scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already checked out today.")

    log = AttendanceLog(
        id=uuid.uuid4(),
        user_id=user.id,
        site_id=checkin.site_id,
        event_type=EventType.checkout,
        lat=request.lat,
        lng=request.lng,
        accuracy_meters=request.accuracy_meters,
        photo_url=request.photo_url,
        ip_address=request.ip_address,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return AttendanceRecord.model_validate(log)


# ---------------------------------------------------------------------------
# Break
# ---------------------------------------------------------------------------


async def create_break(
    request: BreakRequest,
    user,
    db: AsyncSession,
) -> AttendanceRecord:
    """
    Record a break_start or break_end event.

    Raises:
        HTTPException 400: no check-in today or invalid break sequence.
    """
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]

    start, end = _today_start_end()

    checkin_result = await db.execute(
        select(AttendanceLog).where(
            and_(
                AttendanceLog.user_id == user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= start,
                AttendanceLog.created_at < end,
            )
        )
    )
    checkin = checkin_result.scalars().first()
    if checkin is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No check-in found for today.")

    event_type = EventType.break_start if request.type == "start" else EventType.break_end

    if request.type == "end":
        # Must have an open break_start
        bs_result = await db.execute(
            select(AttendanceLog).where(
                and_(
                    AttendanceLog.user_id == user.id,
                    AttendanceLog.event_type == EventType.break_start,
                    AttendanceLog.created_at >= start,
                    AttendanceLog.created_at < end,
                )
            ).order_by(desc(AttendanceLog.created_at)).limit(1)
        )
        last_break_start = bs_result.scalars().first()
        if last_break_start is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No open break found. Start a break first.",
            )

    log = AttendanceLog(
        id=uuid.uuid4(),
        user_id=user.id,
        site_id=checkin.site_id,
        event_type=event_type,
        lat=checkin.lat,
        lng=checkin.lng,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return AttendanceRecord.model_validate(log)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


async def get_today_attendance(user_id: str, db: AsyncSession) -> List[AttendanceRecord]:
    """Return all attendance events for the current day."""
    from app.models.attendance import AttendanceRecord as AttendanceLog  # type: ignore[attr-defined]

    start, end = _today_start_end()
    result = await db.execute(
        select(AttendanceLog)
        .where(
            and_(
                AttendanceLog.user_id == user_id,
                AttendanceLog.created_at >= start,
                AttendanceLog.created_at < end,
            )
        )
        .order_by(AttendanceLog.created_at)
    )
    return [AttendanceRecord.model_validate(r) for r in result.scalars().all()]


async def get_attendance_history(
    user_id: str,
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
) -> List[AttendanceRecord]:
    """Return paginated attendance history for a user."""
    from app.models.attendance import AttendanceRecord as AttendanceLog  # type: ignore[attr-defined]

    result = await db.execute(
        select(AttendanceLog)
        .where(AttendanceLog.user_id == user_id)
        .order_by(desc(AttendanceLog.created_at))
        .offset(skip)
        .limit(limit)
    )
    return [AttendanceRecord.model_validate(r) for r in result.scalars().all()]


# ---------------------------------------------------------------------------
# Streak
# ---------------------------------------------------------------------------


async def update_streak(user, db: AsyncSession) -> None:
    """
    Increment the user's ``streak_count`` if they checked in on the previous
    calendar day; otherwise reset it to 1.
    """
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]

    yesterday_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)
    yesterday_end = yesterday_start + timedelta(days=1)

    result = await db.execute(
        select(AttendanceLog).where(
            and_(
                AttendanceLog.user_id == user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= yesterday_start,
                AttendanceLog.created_at < yesterday_end,
            )
        )
    )
    had_yesterday = result.scalars().first() is not None

    if had_yesterday:
        user.streak_count = (user.streak_count or 0) + 1
    else:
        user.streak_count = 1

    db.add(user)
    logger.debug("Updated streak for user %s → %d", user.id, user.streak_count)
