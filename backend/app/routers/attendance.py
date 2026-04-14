"""
Attendance router.

Endpoints
---------
POST /attendance/checkin   – GPS check-in
POST /attendance/checkout  – GPS check-out
POST /attendance/break     – break start / end
GET  /attendance/today     – today's records for the current user
GET  /attendance/history   – paginated history for the current user
POST /attendance/manual    – submit a manual approval request
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, get_redis, require_roles
from app.models.user import User, UserRole
from app.schemas.attendance import (
    AttendanceRecord,
    BreakRequest,
    CheckinRequest,
    CheckoutRequest,
    ManualApprovalRequest,
    MarkSafeRequest,
)
from app.services.attendance_service import (
    create_break,
    create_checkin,
    create_checkout,
    get_attendance_history,
    get_today_attendance,
)
from app.services.approval_service import create_approval_request
from app.services.notification_service import send_approval_notification

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/attendance", tags=["Attendance"])


# ---------------------------------------------------------------------------
# POST /attendance/checkin
# ---------------------------------------------------------------------------


@router.post(
    "/checkin",
    response_model=AttendanceRecord,
    status_code=status.HTTP_201_CREATED,
    summary="GPS check-in",
)
async def checkin(
    payload: CheckinRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> AttendanceRecord:
    """
    Record a GPS-verified check-in.

    Performs geofence validation and five-point fraud assessment before
    persisting. Returns 403 if fraud score exceeds the org threshold.
    Returns 422 if the GPS coordinates are outside all registered geofences.
    """
    return await create_checkin(payload, current_user, db, redis)


# ---------------------------------------------------------------------------
# POST /attendance/checkout
# ---------------------------------------------------------------------------


@router.post(
    "/checkout",
    response_model=AttendanceRecord,
    status_code=status.HTTP_201_CREATED,
    summary="GPS check-out",
)
async def checkout(
    payload: CheckoutRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> AttendanceRecord:
    """
    Record a GPS-verified check-out.

    Requires an open check-in for the current day. Returns 400 if no
    check-in is found or if the user has already checked out.
    """
    return await create_checkout(payload, current_user, db, redis)


# ---------------------------------------------------------------------------
# POST /attendance/break
# ---------------------------------------------------------------------------


@router.post(
    "/break",
    response_model=AttendanceRecord,
    status_code=status.HTTP_201_CREATED,
    summary="Record break start or end",
)
async def record_break(
    payload: BreakRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecord:
    """
    Toggle a break event.

    ``type`` must be ``"start"`` or ``"end"``. A ``break_end`` requires an
    open ``break_start`` event for today.
    """
    return await create_break(payload, current_user, db)


# ---------------------------------------------------------------------------
# GET /attendance/today
# ---------------------------------------------------------------------------


@router.get(
    "/today",
    response_model=List[AttendanceRecord],
    summary="Get today's attendance events for the current user",
)
async def today(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[AttendanceRecord]:
    return await get_today_attendance(str(current_user.id), db)


# ---------------------------------------------------------------------------
# GET /attendance/history
# ---------------------------------------------------------------------------


@router.get(
    "/history",
    response_model=List[AttendanceRecord],
    summary="Get paginated attendance history for the current user",
)
async def history(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[AttendanceRecord]:
    return await get_attendance_history(str(current_user.id), db, skip=skip, limit=limit)


# ---------------------------------------------------------------------------
# GET /attendance/stats
# ---------------------------------------------------------------------------


@router.get(
    "/stats",
    summary="Get attendance statistics for the current user",
)
async def user_stats(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Return personal attendance statistics."""
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]

    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    month_end = datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc) if today.month < 12 else datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)

    # Total check-ins ever
    total_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == current_user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.is_valid.is_(True),
            )
        )
    )
    total_check_ins = total_q.scalar_one() or 0

    # This month's check-ins
    month_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == current_user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= month_start,
                AttendanceLog.created_at < month_end,
            )
        )
    )
    month_checkins = month_q.scalar_one() or 0

    # Late check-ins this month (after 09:00)
    late_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == current_user.id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= month_start,
                AttendanceLog.created_at < month_end,
                func.extract("hour", AttendanceLog.created_at) >= 9,
            )
        )
    )
    late_count = late_q.scalar_one() or 0

    # Working days this month (approximate)
    working_days = (today - today.replace(day=1)).days + 1

    on_time = month_checkins - late_count
    punctuality = round((on_time / max(month_checkins, 1)) * 100, 1)

    return {
        "total_check_ins": total_check_ins,
        "current_streak": getattr(current_user, "streak_count", 0) or 0,
        "longest_streak": getattr(current_user, "streak_count", 0) or 0,
        "punctuality_percentage": punctuality,
        "late_count": late_count,
        "absent_count": max(0, working_days - month_checkins),
    }


# ---------------------------------------------------------------------------
# POST /attendance/manual
# ---------------------------------------------------------------------------


@router.post(
    "/manual",
    status_code=status.HTTP_201_CREATED,
    summary="Submit a manual attendance approval request",
)
async def manual_request(
    payload: ManualApprovalRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Submit a manual attendance request for supervisor review.

    After creation, a notification is sent to the user's assigned supervisor
    (or org admins if no supervisor is set).
    """
    approval = await create_approval_request(payload, current_user, db)
    await send_approval_notification(approval, db)
    return {
        "id": str(approval.id),
        "status": approval.status.value if hasattr(approval.status, "value") else str(approval.status),
        "reason_code": approval.reason_code.value if hasattr(approval.reason_code, "value") else str(approval.reason_code),
        "created_at": str(approval.created_at),
    }


# ---------------------------------------------------------------------------
# GET /attendance/upcoming-shift
# ---------------------------------------------------------------------------


@router.get(
    "/upcoming-shift",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Get the user's next assigned shift (204 if none assigned)",
)
async def upcoming_shift(
    current_user: User = Depends(get_current_active_user),
) -> Response:
    """
    Returns the user's upcoming shift details.
    Currently returns 204 (no shift assigned) until the Shifts module is implemented.
    """
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# POST /attendance/{record_id}/mark-safe
# ---------------------------------------------------------------------------


@router.post(
    "/{record_id}/mark-safe",
    response_model=AttendanceRecord,
    summary="Mark an attendance record as safe (admin only)",
    dependencies=[Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))],
)
async def mark_safe(
    record_id: uuid.UUID,
    payload: MarkSafeRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecord:
    """
    Clear fraud flags on an attendance record and mark it as safe.
    Writes an audit log entry with the investigator's note.
    """
    from app.models.attendance import AttendanceRecord as AttLog  # noqa: PLC0415
    from app.models.audit_log import AuditLog  # noqa: PLC0415

    result = await db.execute(select(AttLog).where(AttLog.id == record_id))
    record = result.scalars().first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found.")

    # Enforce org scoping for org_admin
    if current_user.role == UserRole.org_admin:
        user_result = await db.execute(select(User).where(User.id == record.user_id))
        record_user = user_result.scalars().first()
        if record_user is None or record_user.org_id != current_user.org_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    old_score = record.fraud_score
    old_flags = record.fraud_flags

    record.fraud_score = 0.0
    record.fraud_flags = {}
    record.is_valid = True
    db.add(record)

    # Audit trail
    audit = AuditLog(
        id=uuid.uuid4(),
        actor_id=current_user.id,
        action="mark_safe",
        entity_type="attendance_records",
        entity_id=str(record.id),
        old_value={"fraud_score": float(old_score or 0), "fraud_flags": old_flags},
        new_value={"fraud_score": 0.0, "fraud_flags": {}, "note": payload.note},
    )
    db.add(audit)
    await db.commit()
    await db.refresh(record)

    logger.info("Attendance %s marked safe by %s", record_id, current_user.id)
    return AttendanceRecord.model_validate(record)
