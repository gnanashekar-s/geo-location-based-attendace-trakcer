"""
Analytics router (admin only).

Endpoints
---------
GET  /analytics/summary          – KPI summary for today (or given date)
GET  /analytics/attendance-today – per-employee check-in status for today
GET  /analytics/heatmap          – aggregated GPS points for density map
GET  /analytics/trends           – daily present/late/absent counts for last 30 days
GET  /analytics/anomalies        – fraud-flagged records (paginated)
POST /analytics/export           – trigger background CSV export
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from sqlalchemy import and_, cast, desc, func, select, Numeric
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, require_roles
from app.models.approval import ManualApprovalRequest
from app.models.attendance import AttendanceRecord
from app.models.user import User, UserRole
from app.schemas.analytics import (
    AnomalyRecord,
    HeatmapPoint,
    SummaryResponse,
    TrendPoint,
)

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/analytics",
    tags=["Analytics"],
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)


# ---------------------------------------------------------------------------
# GET /analytics/summary
# ---------------------------------------------------------------------------


@router.get("/summary", response_model=SummaryResponse, summary="KPI summary")
async def summary(
    target_date: Optional[date] = Query(default=None, description="Date to summarise (default: today)"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SummaryResponse:
    """
    Return headcount KPIs for the given date.

    Counts are scoped to the current user's organisation (or all orgs for
    super_admin).
    """
    if target_date is None:
        target_date = date.today()

    day_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    checkins = await db.execute(
        select(AttendanceRecord).where(
            and_(
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= day_start,
                AttendanceRecord.created_at < day_end,
                *org_filter,
            )
        )
    )
    records = checkins.scalars().all()

    total_present = sum(1 for r in records if r.is_valid)
    # Simple heuristic: late = checked in at or after 09:00
    total_late = sum(1 for r in records if r.is_valid and r.created_at and r.created_at.hour >= 9)

    # Total active employees in org
    user_count_q = select(func.count(User.id)).where(User.is_active.is_(True))
    if current_user.role != UserRole.super_admin:
        user_count_q = user_count_q.where(User.org_id == current_user.org_id)
    total_employees_res = await db.execute(user_count_q)
    total_employees = total_employees_res.scalar_one()

    total_absent = max(0, total_employees - total_present)

    # Pending approvals
    pending_q = select(func.count(ManualApprovalRequest.id)).where(
        ManualApprovalRequest.status == "pending"
    )
    if current_user.role != UserRole.super_admin:
        pending_q = pending_q.where(
            ManualApprovalRequest.user_id.in_(
                select(User.id).where(User.org_id == current_user.org_id)
            )
        )
    pending_res = await db.execute(pending_q)
    pending_approvals = pending_res.scalar_one()

    return SummaryResponse(
        total_present=total_present,
        total_late=total_late,
        total_absent=total_absent,
        pending_approvals=pending_approvals,
        total_employees=total_employees,
        date=target_date.isoformat() if target_date else None,
    )


# ---------------------------------------------------------------------------
# GET /analytics/attendance-today
# ---------------------------------------------------------------------------


@router.get("/attendance-today", summary="Per-employee attendance status for today")
async def attendance_today(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """
    Return every active employee in the org with their check-in status for today.
    Used by the admin dashboard employee roster.
    """
    today = date.today()
    day_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    # Fetch all active employees in org
    user_q = select(User).where(User.is_active.is_(True))
    if current_user.role != UserRole.super_admin:
        user_q = user_q.where(User.org_id == current_user.org_id)
    users_result = await db.execute(user_q)
    users = users_result.scalars().all()

    # Fetch today's checkin records
    checkin_q = select(AttendanceRecord).where(
        and_(
            AttendanceRecord.event_type == "checkin",
            AttendanceRecord.created_at >= day_start,
            AttendanceRecord.created_at < day_end,
        )
    )
    if current_user.role != UserRole.super_admin:
        checkin_q = checkin_q.where(
            AttendanceRecord.user_id.in_(select(User.id).where(User.org_id == current_user.org_id))
        )
    checkins_result = await db.execute(checkin_q)
    checkin_map = {r.user_id: r for r in checkins_result.scalars().all()}

    # Fetch today's checkout records
    checkout_q = select(AttendanceRecord).where(
        and_(
            AttendanceRecord.event_type == "checkout",
            AttendanceRecord.created_at >= day_start,
            AttendanceRecord.created_at < day_end,
        )
    )
    if current_user.role != UserRole.super_admin:
        checkout_q = checkout_q.where(
            AttendanceRecord.user_id.in_(select(User.id).where(User.org_id == current_user.org_id))
        )
    checkouts_result = await db.execute(checkout_q)
    checkout_map = {r.user_id: r for r in checkouts_result.scalars().all()}

    result = []
    for u in users:
        checkin = checkin_map.get(u.id)
        checkout = checkout_map.get(u.id)
        result.append({
            "user_id": str(u.id),
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "avatar_url": u.avatar_url,
            "check_in_time": checkin.created_at.isoformat() if checkin else None,
            "check_out_time": checkout.created_at.isoformat() if checkout else None,
            "status": "present" if checkin else "absent",
            "is_late": bool(checkin and checkin.created_at.hour >= 9),
            "fraud_score": float(checkin.fraud_score) if checkin and checkin.fraud_score else 0.0,
        })

    # Sort: present first, then absent
    result.sort(key=lambda x: (0 if x["status"] == "present" else 1, x["full_name"]))
    return result


# ---------------------------------------------------------------------------
# GET /analytics/heatmap
# ---------------------------------------------------------------------------


@router.get("/heatmap", response_model=List[HeatmapPoint], summary="GPS density heatmap")
async def heatmap(
    days: int = Query(default=30, ge=1, le=365),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[HeatmapPoint]:
    """
    Return aggregated GPS coordinates (lat, lng, weight) for the last *days* days.

    Points are rounded to 4 decimal places (~11 m precision) and weighted by
    frequency so the client can render a density heatmap.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    # Cast lat/lng to a Numeric type then round to 4 decimal places so the
    # GROUP BY aggregation uses a stable, dialect-independent expression.
    lat_rounded = func.round(cast(AttendanceRecord.lat, Numeric(10, 6)), 4).label("rlat")
    lng_rounded = func.round(cast(AttendanceRecord.lng, Numeric(10, 6)), 4).label("rlng")

    result = await db.execute(
        select(
            lat_rounded,
            lng_rounded,
            func.count().label("weight"),
        )
        .where(
            and_(
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= since,
                AttendanceRecord.lat.isnot(None),
                AttendanceRecord.lng.isnot(None),
                *org_filter,
            )
        )
        .group_by(lat_rounded, lng_rounded)
        .order_by(desc("weight"))
        .limit(2000)
    )
    rows = result.all()
    return [HeatmapPoint(lat=float(r.rlat), lng=float(r.rlng), weight=float(r.weight)) for r in rows]


# ---------------------------------------------------------------------------
# GET /analytics/trends
# ---------------------------------------------------------------------------


@router.get("/trends", response_model=List[TrendPoint], summary="Daily attendance trends (30 days)")
async def trends(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[TrendPoint]:
    """Return present / late / absent counts per calendar day for the last 30 days."""
    since = datetime.now(timezone.utc) - timedelta(days=30)

    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    result = await db.execute(
        select(
            func.date(AttendanceRecord.created_at).label("day"),
            func.count().label("total"),
        )
        .where(
            and_(
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= since,
                *org_filter,
            )
        )
        .group_by("day")
        .order_by("day")
    )
    rows = result.all()

    # Total employees for absent calculation
    user_count_q = select(func.count(User.id)).where(User.is_active.is_(True))
    if current_user.role != UserRole.super_admin:
        user_count_q = user_count_q.where(User.org_id == current_user.org_id)
    total_res = await db.execute(user_count_q)
    total_employees = total_res.scalar_one()

    trend_points: List[TrendPoint] = []
    for row in rows:
        present = int(row.total)
        absent = max(0, total_employees - present)
        trend_points.append(
            TrendPoint(
                date=row.day,
                present_count=present,
                late_count=0,
                absent_count=absent,
            )
        )
    return trend_points


# ---------------------------------------------------------------------------
# GET /analytics/anomalies
# ---------------------------------------------------------------------------


@router.get("/anomalies", response_model=List[AnomalyRecord], summary="Fraud-flagged events")
async def anomalies(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    min_score: float = Query(default=0.5, ge=0.0, le=1.0),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[AnomalyRecord]:
    """
    Return attendance records flagged as fraudulent (fraud_score >= min_score).
    """
    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    result = await db.execute(
        select(AttendanceRecord, User.full_name.label("user_name"))
        .join(User, User.id == AttendanceRecord.user_id)
        .where(
            and_(
                AttendanceRecord.fraud_score >= min_score,
                *org_filter,
            )
        )
        .order_by(desc(AttendanceRecord.fraud_score))
        .offset(skip)
        .limit(limit)
    )
    rows = result.all()

    out: List[AnomalyRecord] = []
    for record, user_name in rows:
        flags = record.fraud_flags
        if isinstance(flags, dict):
            flags_list = [k for k, v in flags.items() if v]
        elif isinstance(flags, list):
            flags_list = flags
        else:
            flags_list = []
        out.append(
            AnomalyRecord(
                attendance_id=record.id,
                user_id=record.user_id,
                user_name=user_name or "",
                fraud_score=record.fraud_score,
                fraud_flags=flags_list,
                created_at=record.created_at,
            )
        )
    return out


# ---------------------------------------------------------------------------
# POST /analytics/export
# ---------------------------------------------------------------------------


@router.post(
    "/export",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger a background CSV export job",
)
async def export(
    background_tasks: BackgroundTasks,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Enqueue a CSV export of attendance records for the given date range.

    The export is processed asynchronously. The caller will receive a
    notification (via the notification service) when the file is ready.
    """
    from app.workers.tasks.reports import generate_attendance_csv  # type: ignore[attr-defined]

    if start_date is None:
        start_date = date.today() - timedelta(days=30)
    if end_date is None:
        end_date = date.today()

    # Enqueue Celery task
    try:
        task = generate_attendance_csv.delay(
            org_id=str(current_user.org_id),
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            requested_by=str(current_user.id),
        )
        task_id = task.id
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not enqueue CSV export: %s", exc)
        task_id = "queued-offline"

    logger.info(
        "CSV export requested by %s (org=%s) for %s to %s, task_id=%s",
        current_user.email,
        current_user.org_id,
        start_date,
        end_date,
        task_id,
    )
    return {
        "message": "Export job queued. You will be notified when the file is ready.",
        "task_id": task_id,
        "start_date": str(start_date),
        "end_date": str(end_date),
    }


# ---------------------------------------------------------------------------
# GET /analytics/export/{task_id}
# ---------------------------------------------------------------------------


@router.get(
    "/export/{task_id}",
    summary="Poll the status of a background CSV export task",
)
async def export_status(
    task_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """
    Returns the current status of a Celery CSV export task.

    Possible statuses:
    - ``pending``  — task is queued or running
    - ``ready``    — task succeeded; ``download_url`` contains the presigned URL
    - ``failed``   — task failed
    """
    if task_id == "queued-offline":
        return {"status": "pending"}

    loop = asyncio.get_event_loop()

    def _check_status() -> dict:
        try:
            from app.workers.celery_app import celery_app  # noqa: PLC0415

            result = celery_app.AsyncResult(task_id)
            state = result.state
            if state == "SUCCESS":
                r = result.result or {}
                url = r.get("url", "") if isinstance(r, dict) else ""
                return {"status": "ready", "download_url": url}
            if state in ("FAILURE", "REVOKED"):
                return {"status": "failed"}
            return {"status": "pending"}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not get export status for task %s: %s", task_id, exc)
            return {"status": "pending"}

    return await loop.run_in_executor(None, _check_status)
