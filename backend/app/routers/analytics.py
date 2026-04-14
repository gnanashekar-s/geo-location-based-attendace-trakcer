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
    BehavioralBaseline,
    BuddyPunchIncident,
    BuddyPunchUser,
    DailyFraudPoint,
    DeptLeaderboardEntry,
    DetectedScheduleEntry,
    FraudFlagBreakdown,
    FraudSummaryResponse,
    HeatmapPoint,
    InvestigateRequest,
    RadiusSuggestionResponse,
    SummaryResponse,
    TopRiskyUser,
    TrendPoint,
    UserRiskProfileResponse,
    WhitelistDeviceRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/analytics",
    tags=["Analytics"],
    dependencies=[Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))],
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

    # Anomaly count (fraud_score >= 0.5 for today)
    anomaly_q = select(func.count(AttendanceRecord.id)).where(
        and_(
            AttendanceRecord.fraud_score >= 0.5,
            AttendanceRecord.created_at >= day_start,
            AttendanceRecord.created_at < day_end,
            *org_filter,
        )
    )
    anomaly_res = await db.execute(anomaly_q)
    anomaly_count = anomaly_res.scalar_one()

    return SummaryResponse(
        total_present=total_present,
        total_late=total_late,
        total_absent=total_absent,
        pending_approvals=pending_approvals,
        total_employees=total_employees,
        anomaly_count=anomaly_count,
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
            "latitude": float(checkin.lat) if checkin and checkin.lat is not None else None,
            "longitude": float(checkin.lng) if checkin and checkin.lng is not None else None,
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
    from app.workers.tasks.reports import generate_csv_report as generate_attendance_csv  # noqa: PLC0415

    if start_date is None:
        start_date = date.today() - timedelta(days=30)
    if end_date is None:
        end_date = date.today()

    # Enqueue Celery task
    try:
        task = generate_attendance_csv.apply_async(
            kwargs={
                "org_id": str(current_user.org_id),
                "date_from": start_date.isoformat(),
                "date_to": end_date.isoformat(),
            },
            queue="reports",
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


# ---------------------------------------------------------------------------
# GET /analytics/fraud-summary
# ---------------------------------------------------------------------------


@router.get(
    "/fraud-summary",
    response_model=FraudSummaryResponse,
    summary="Fraud KPI summary for today",
)
async def fraud_summary(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> FraudSummaryResponse:
    """Return fraud KPIs: flagged today, flag breakdown, top risky users, risk level counts."""
    today = date.today()
    day_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    # Flagged records today
    flagged_q = await db.execute(
        select(AttendanceRecord).where(
            and_(
                AttendanceRecord.fraud_score >= 0.5,
                AttendanceRecord.created_at >= day_start,
                *org_filter,
            )
        )
    )
    flagged_records = flagged_q.scalars().all()

    # Flag breakdown
    flag_counts: dict = {}
    for r in flagged_records:
        flags = r.fraud_flags
        if isinstance(flags, list):
            flag_list = flags
        elif isinstance(flags, dict):
            flag_list = [k for k, v in flags.items() if v]
        else:
            flag_list = []
        for flag in flag_list:
            base = flag.split(":")[0]
            flag_counts[base] = flag_counts.get(base, 0) + 1

    flag_breakdown = [
        FraudFlagBreakdown(flag=f, count=c)
        for f, c in sorted(flag_counts.items(), key=lambda x: -x[1])
    ]

    # All active users in org
    user_q = select(User).where(User.is_active.is_(True))
    if current_user.role != UserRole.super_admin:
        user_q = user_q.where(User.org_id == current_user.org_id)
    all_users_res = await db.execute(user_q)
    all_users = all_users_res.scalars().all()

    high_count = sum(1 for u in all_users if getattr(u, "risk_level", "low") == "high")
    medium_count = sum(1 for u in all_users if getattr(u, "risk_level", "low") == "medium")
    low_count = sum(1 for u in all_users if getattr(u, "risk_level", "low") == "low")

    # Top risky users (non-low, sorted by risk level desc then avg score)
    risky = sorted(
        [u for u in all_users if getattr(u, "risk_level", "low") != "low"],
        key=lambda u: (0 if getattr(u, "risk_level", "low") == "high" else 1),
    )[:10]

    top_risky: List[TopRiskyUser] = []
    for u in risky:
        avg_q = await db.execute(
            select(func.avg(AttendanceRecord.fraud_score)).where(
                AttendanceRecord.user_id == u.id
            )
        )
        avg_score = float(avg_q.scalar() or 0.0)
        cnt_q = await db.execute(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.user_id == u.id,
                AttendanceRecord.fraud_score >= 0.5,
            )
        )
        top_risky.append(
            TopRiskyUser(
                user_id=u.id,
                full_name=u.full_name,
                risk_level=getattr(u, "risk_level", "low"),
                avg_fraud_score=round(avg_score, 4),
                flag_count=int(cnt_q.scalar() or 0),
            )
        )

    return FraudSummaryResponse(
        total_flagged_today=len(flagged_records),
        flag_breakdown=flag_breakdown,
        top_risky_users=top_risky,
        high_risk_user_count=high_count,
        medium_risk_user_count=medium_count,
        low_risk_user_count=low_count,
    )


# ---------------------------------------------------------------------------
# GET /analytics/user-risk-profile/{user_id}
# ---------------------------------------------------------------------------


@router.get(
    "/user-risk-profile/{user_id}",
    response_model=UserRiskProfileResponse,
    summary="30-day fraud risk profile for a user",
)
async def user_risk_profile(
    user_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserRiskProfileResponse:
    """Return 30-day fraud history, flag frequency, and behavioral baseline for a user."""
    import statistics as _stats  # noqa: PLC0415
    from fastapi import HTTPException  # noqa: PLC0415

    target_q = await db.execute(select(User).where(User.id == user_id))
    target = target_q.scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.role != UserRole.super_admin and target.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    since_30 = datetime.now(timezone.utc) - timedelta(days=30)
    records_q = await db.execute(
        select(AttendanceRecord).where(
            and_(
                AttendanceRecord.user_id == user_id,
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= since_30,
            )
        ).order_by(AttendanceRecord.created_at)
    )
    records = records_q.scalars().all()

    # Daily history
    daily: dict = {}
    for r in records:
        d = r.created_at.date()
        if d not in daily:
            daily[d] = {"scores": [], "count": 0}
        daily[d]["scores"].append(r.fraud_score)
        daily[d]["count"] += 1

    thirty_day_history = [
        DailyFraudPoint(
            date=d,
            avg_score=round(sum(v["scores"]) / len(v["scores"]), 4),
            event_count=v["count"],
        )
        for d, v in sorted(daily.items())
    ]

    # Flag frequency
    flag_counts: dict = {}
    for r in records:
        flags = r.fraud_flags
        fl = (
            flags if isinstance(flags, list)
            else ([k for k, v in flags.items() if v] if isinstance(flags, dict) else [])
        )
        for flag in fl:
            base = flag.split(":")[0]
            flag_counts[base] = flag_counts.get(base, 0) + 1

    flag_frequency = [
        FraudFlagBreakdown(flag=f, count=c)
        for f, c in sorted(flag_counts.items(), key=lambda x: -x[1])
    ]

    # Behavioral baseline
    hours = [r.created_at.hour for r in records if r.created_at]
    if len(hours) >= 2:
        mean_h = _stats.mean(hours)
        std_h = _stats.pstdev(hours)
    elif len(hours) == 1:
        mean_h, std_h = float(hours[0]), 0.0
    else:
        mean_h, std_h = 0.0, 0.0

    return UserRiskProfileResponse(
        user_id=target.id,
        full_name=target.full_name,
        risk_level=getattr(target, "risk_level", "low"),
        thirty_day_history=thirty_day_history,
        flag_frequency=flag_frequency,
        behavioral_baseline=BehavioralBaseline(
            mean_checkin_hour=round(mean_h, 2),
            std_hours=round(std_h, 2),
            sample_size=len(hours),
        ),
    )


# ---------------------------------------------------------------------------
# GET /analytics/buddy-punch-incidents
# ---------------------------------------------------------------------------


@router.get(
    "/buddy-punch-incidents",
    response_model=List[BuddyPunchIncident],
    summary="Recent buddy punch incidents",
)
async def buddy_punch_incidents(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[BuddyPunchIncident]:
    """Return attendance records flagged with BUDDY_PUNCH, grouped into incidents."""
    import math as _m  # noqa: PLC0415
    from app.models.location import Site  # noqa: PLC0415
    from sqlalchemy import cast as sa_cast, String as SA_String  # noqa: PLC0415

    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [AttendanceRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )

    result = await db.execute(
        select(AttendanceRecord, User, Site)
        .join(User, User.id == AttendanceRecord.user_id)
        .join(Site, Site.id == AttendanceRecord.site_id)
        .where(
            and_(
                sa_cast(AttendanceRecord.fraud_flags, SA_String).contains("BUDDY_PUNCH"),
                *org_filter,
            )
        )
        .order_by(desc(AttendanceRecord.created_at))
        .limit(limit * 3)
    )
    rows = result.all()

    incidents_out: List[BuddyPunchIncident] = []
    used_ids: set = set()

    for rec_a, user_a, site_a in rows:
        if rec_a.id in used_ids:
            continue
        incident_users = [
            BuddyPunchUser(
                user_id=rec_a.user_id,
                full_name=user_a.full_name,
                attendance_id=rec_a.id,
                lat=rec_a.lat,
                lng=rec_a.lng,
                timestamp=rec_a.created_at,
            )
        ]
        used_ids.add(rec_a.id)
        max_dist = 0.0

        for rec_b, user_b, _ in rows:
            if rec_b.id in used_ids or rec_a.user_id == rec_b.user_id:
                continue
            if rec_a.site_id != rec_b.site_id:
                continue
            ta = rec_a.created_at if rec_a.created_at.tzinfo else rec_a.created_at.replace(tzinfo=timezone.utc)
            tb = rec_b.created_at if rec_b.created_at.tzinfo else rec_b.created_at.replace(tzinfo=timezone.utc)
            if abs((ta - tb).total_seconds()) > 300:
                continue
            R = 6_371_000.0
            p1, p2 = _m.radians(rec_a.lat), _m.radians(rec_b.lat)
            dp = _m.radians(rec_b.lat - rec_a.lat)
            dl = _m.radians(rec_b.lng - rec_a.lng)
            a = _m.sin(dp / 2) ** 2 + _m.cos(p1) * _m.cos(p2) * _m.sin(dl / 2) ** 2
            dist_m = R * 2 * _m.atan2(_m.sqrt(a), _m.sqrt(1 - a))
            max_dist = max(max_dist, dist_m)
            incident_users.append(
                BuddyPunchUser(
                    user_id=rec_b.user_id,
                    full_name=user_b.full_name,
                    attendance_id=rec_b.id,
                    lat=rec_b.lat,
                    lng=rec_b.lng,
                    timestamp=rec_b.created_at,
                )
            )
            used_ids.add(rec_b.id)

        if len(incident_users) >= 2:
            incidents_out.append(
                BuddyPunchIncident(
                    site_id=site_a.id,
                    site_name=site_a.name,
                    incident_time=rec_a.created_at,
                    users=incident_users,
                    distance_meters=round(max_dist, 2),
                )
            )
        if len(incidents_out) >= limit:
            break

    return incidents_out


# ---------------------------------------------------------------------------
# GET /analytics/my-risk-profile  (employee self-service — no admin role required)
# ---------------------------------------------------------------------------

# A separate sub-router without the admin role guard so that any authenticated
# employee can access their own risk profile without needing org_admin rights.
_employee_router = APIRouter(prefix="/analytics", tags=["Analytics"])


@_employee_router.get(
    "/my-risk-profile",
    response_model=UserRiskProfileResponse,
    summary="Current user's 30-day fraud risk profile (self-service)",
)
async def my_risk_profile(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserRiskProfileResponse:
    """
    Return the calling employee's own 30-day fraud history, flag frequency, and
    behavioural baseline.  Scoped to the current user's organisation so the
    query is always isolated to the correct tenant.
    """
    import statistics as _stats  # noqa: PLC0415

    user_id = current_user.id
    org_id = current_user.org_id

    since_30 = datetime.now(timezone.utc) - timedelta(days=30)

    # Fetch the 30-day check-in records for this user within their org
    records_q = await db.execute(
        select(AttendanceRecord)
        .join(User, User.id == AttendanceRecord.user_id)
        .where(
            and_(
                AttendanceRecord.user_id == user_id,
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= since_30,
                User.org_id == org_id,
            )
        )
        .order_by(AttendanceRecord.created_at)
    )
    records = records_q.scalars().all()

    # Daily history
    daily: dict = {}
    for r in records:
        d = r.created_at.date()
        if d not in daily:
            daily[d] = {"scores": [], "count": 0}
        daily[d]["scores"].append(r.fraud_score)
        daily[d]["count"] += 1

    thirty_day_history = [
        DailyFraudPoint(
            date=d,
            avg_score=round(sum(v["scores"]) / len(v["scores"]), 4),
            event_count=v["count"],
        )
        for d, v in sorted(daily.items())
    ]

    # Flag frequency
    flag_counts: dict = {}
    for r in records:
        flags = r.fraud_flags
        fl = (
            flags if isinstance(flags, list)
            else ([k for k, v in flags.items() if v] if isinstance(flags, dict) else [])
        )
        for flag in fl:
            base = flag.split(":")[0]
            flag_counts[base] = flag_counts.get(base, 0) + 1

    flag_frequency = [
        FraudFlagBreakdown(flag=f, count=c)
        for f, c in sorted(flag_counts.items(), key=lambda x: -x[1])
    ]

    # Behavioral baseline
    hours = [r.created_at.hour for r in records if r.created_at]
    if len(hours) >= 2:
        mean_h = _stats.mean(hours)
        std_h = _stats.pstdev(hours)
    elif len(hours) == 1:
        mean_h, std_h = float(hours[0]), 0.0
    else:
        mean_h, std_h = 0.0, 0.0

    return UserRiskProfileResponse(
        user_id=current_user.id,
        full_name=current_user.full_name,
        risk_level=getattr(current_user, "risk_level", "low"),
        thirty_day_history=thirty_day_history,
        flag_frequency=flag_frequency,
        behavioral_baseline=BehavioralBaseline(
            mean_checkin_hour=round(mean_h, 2),
            std_hours=round(std_h, 2),
            sample_size=len(hours),
        ),
    )


# Absorb the employee sub-router into the main (admin) router so that
# main.py only needs to import a single ``router`` attribute from this module.
router.include_router(_employee_router)


# ---------------------------------------------------------------------------
# POST /analytics/whitelist-device
# ---------------------------------------------------------------------------


@router.post(
    "/whitelist-device",
    status_code=status.HTTP_201_CREATED,
    summary="Whitelist a device fingerprint for a user",
)
async def whitelist_device(
    body: WhitelistDeviceRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Permanently whitelist a (user_id, device_fingerprint) pair, bypassing all fraud checks."""
    from app.models.fraud_whitelist import FraudWhitelist  # noqa: PLC0415
    from app.models.audit_log import AuditLog  # noqa: PLC0415
    from fastapi import HTTPException  # noqa: PLC0415

    target_q = await db.execute(select(User).where(User.id == body.user_id))
    target = target_q.scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.role != UserRole.super_admin and target.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    existing_q = await db.execute(
        select(FraudWhitelist).where(
            FraudWhitelist.user_id == body.user_id,
            FraudWhitelist.device_fingerprint == body.device_fingerprint,
        )
    )
    entry = existing_q.scalars().first()
    if entry:
        entry.reason = body.reason
        entry.admin_id = current_user.id
    else:
        entry = FraudWhitelist(
            user_id=body.user_id,
            device_fingerprint=body.device_fingerprint,
            admin_id=current_user.id,
            reason=body.reason,
        )
        db.add(entry)

    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="fraud.whitelist_device",
            entity_type="fraud_whitelist",
            entity_id=str(body.user_id),
            new_value={
                "device_fingerprint": body.device_fingerprint,
                "reason": body.reason,
            },
        )
    )
    await db.commit()
    await db.refresh(entry)

    return {
        "id": str(entry.id),
        "user_id": str(entry.user_id),
        "device_fingerprint": entry.device_fingerprint,
        "created_at": entry.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# PATCH /analytics/attendance/{record_id}/investigate
# ---------------------------------------------------------------------------


@router.patch(
    "/attendance/{record_id}/investigate",
    summary="Set investigation status on a flagged attendance record",
)
async def investigate_attendance(
    record_id: UUID,
    body: InvestigateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update investigation_status on a fraud-flagged record (none → investigating → resolved)."""
    from app.models.audit_log import AuditLog  # noqa: PLC0415
    from fastapi import HTTPException  # noqa: PLC0415

    record_q = await db.execute(
        select(AttendanceRecord).where(AttendanceRecord.id == record_id)
    )
    record = record_q.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if current_user.role != UserRole.super_admin:
        owner_q = await db.execute(select(User).where(User.id == record.user_id))
        owner = owner_q.scalars().first()
        if not owner or owner.org_id != current_user.org_id:
            raise HTTPException(status_code=403, detail="Access denied")

    old_status = getattr(record, "investigation_status", "none")
    record.investigation_status = body.status

    db.add(
        AuditLog(
            actor_id=current_user.id,
            action=f"fraud.investigate.{body.status}",
            entity_type="attendance_records",
            entity_id=str(record_id),
            old_value={"investigation_status": old_status},
            new_value={"investigation_status": body.status, "note": body.note},
        )
    )
    await db.commit()

    return {
        "id": str(record.id),
        "investigation_status": record.investigation_status,
        "fraud_score": record.fraud_score,
        "fraud_flags": record.fraud_flags,
    }


# ---------------------------------------------------------------------------
# GET /analytics/detected-schedules
# ---------------------------------------------------------------------------


@router.get(
    "/detected-schedules",
    response_model=List[DetectedScheduleEntry],
    summary="Auto-detected shift schedules for all employees",
)
async def get_detected_schedules(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[DetectedScheduleEntry]:
    """Returns employees' auto-detected shift times, sorted by confidence descending."""
    result = await db.execute(
        select(User)
        .where(
            User.org_id == current_user.org_id,
            User.is_active == True,
            User.expected_checkin_hour.isnot(None),
        )
        .order_by(User.schedule_confidence.desc())
    )
    users = result.scalars().all()
    return [
        DetectedScheduleEntry(
            user_id=u.id,
            full_name=u.full_name,
            expected_checkin_hour=u.expected_checkin_hour,
            expected_checkout_hour=u.expected_checkout_hour,
            schedule_confidence=u.schedule_confidence,
            risk_level=u.risk_level,
        )
        for u in users
    ]


# ---------------------------------------------------------------------------
# GET /analytics/geofence-radius-suggestion
# ---------------------------------------------------------------------------


@router.get(
    "/geofence-radius-suggestion",
    response_model=RadiusSuggestionResponse,
    summary="Suggest optimal geofence radius based on historical GPS scatter (p95)",
)
async def get_geofence_radius_suggestion(
    site_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> RadiusSuggestionResponse:
    """
    Analyses GPS coordinates of the last 90 days of check-ins for a site
    and returns the 95th-percentile distance from the site centre as the
    suggested geofence radius.
    """
    import math
    from datetime import datetime, timezone, timedelta
    from fastapi import HTTPException  # noqa: PLC0415
    from app.models.location import Site  # noqa: PLC0415

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    # Fetch site
    site_result = await db.execute(
        select(Site).where(
            Site.id == site_id,
            Site.org_id == current_user.org_id,
        )
    )
    site = site_result.scalars().first()
    if site is None:
        raise HTTPException(status_code=404, detail="Site not found.")

    # Fetch check-ins with valid GPS for this site
    records_result = await db.execute(
        select(AttendanceRecord.lat, AttendanceRecord.lng)
        .where(
            AttendanceRecord.site_id == site_id,
            AttendanceRecord.created_at >= cutoff,
            AttendanceRecord.lat.isnot(None),
            AttendanceRecord.lng.isnot(None),
        )
    )
    rows = records_result.all()

    def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6_371_000.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return 2 * R * math.asin(math.sqrt(a))

    distances = sorted(
        haversine(site.center_lat, site.center_lng, r.lat, r.lng)
        for r in rows
    )

    sample_count = len(distances)
    if sample_count == 0:
        suggested = site.radius_meters or 100.0
    else:
        p95_idx = max(0, int(0.95 * sample_count) - 1)
        suggested = distances[p95_idx]

    if sample_count >= 50:
        confidence = "high"
    elif sample_count >= 10:
        confidence = "medium"
    else:
        confidence = "low"

    return RadiusSuggestionResponse(
        site_id=site.id,
        site_name=site.name,
        current_radius_meters=float(site.radius_meters or 0),
        suggested_radius_meters=round(suggested, 1),
        sample_count=sample_count,
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# GET /analytics/department-leaderboard
# ---------------------------------------------------------------------------


@router.get(
    "/department-leaderboard",
    response_model=List[DeptLeaderboardEntry],
    summary="Today's attendance rate ranked by department",
)
async def get_department_leaderboard(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[DeptLeaderboardEntry]:
    """
    Returns departments ranked by today's check-in attendance rate.
    Only includes departments with at least 1 employee.
    """
    from datetime import date, datetime, timezone  # noqa: PLC0415
    today = date.today()

    # Get all active users for the org grouped by department
    users_result = await db.execute(
        select(User.id, User.department)
        .where(
            User.org_id == current_user.org_id,
            User.is_active == True,
            User.department.isnot(None),
            User.department != "",
        )
    )
    user_rows = users_result.all()

    if not user_rows:
        return []

    # Build map: department → list of user_ids
    from collections import defaultdict  # noqa: PLC0415
    dept_users: dict[str, list] = defaultdict(list)
    for row in user_rows:
        dept_users[row.department].append(row.id)

    all_user_ids = [row.id for row in user_rows]

    # Get today's attendance for all users (check-ins only)
    attendance_result = await db.execute(
        select(
            AttendanceRecord.user_id,
            AttendanceRecord.fraud_score,
        )
        .where(
            AttendanceRecord.user_id.in_(all_user_ids),
            func.date(AttendanceRecord.created_at) == today,
            AttendanceRecord.event_type == "checkin",
        )
    )
    attendance_rows = attendance_result.all()

    # Map user_id → fraud_score (keep first check-in per user)
    user_attendance: dict = {}
    for row in attendance_rows:
        if row.user_id not in user_attendance:
            user_attendance[row.user_id] = {"fraud_score": row.fraud_score or 0.0}

    # Build leaderboard
    entries = []
    for dept, user_ids in dept_users.items():
        total = len(user_ids)
        checked_in = sum(1 for uid in user_ids if uid in user_attendance)
        fraud_scores = [user_attendance[uid]["fraud_score"] for uid in user_ids if uid in user_attendance]
        avg_fraud = sum(fraud_scores) / len(fraud_scores) if fraud_scores else 0.0

        entries.append(DeptLeaderboardEntry(
            rank=0,  # set after sorting
            department=dept,
            total_employees=total,
            checked_in=checked_in,
            attendance_rate=checked_in / total if total > 0 else 0.0,
            late_count=0,  # no status field on AttendanceRecord; requires shift comparison
            avg_fraud_score=round(avg_fraud, 3),
        ))

    entries.sort(key=lambda e: e.attendance_rate, reverse=True)
    for i, entry in enumerate(entries):
        entry.rank = i + 1

    return entries[:10]  # top 10 departments


# ---------------------------------------------------------------------------
# GET /analytics/employee/{user_id}  – per-employee attendance stats (admin)
# ---------------------------------------------------------------------------


@router.get(
    "/employee/{user_id}",
    summary="Attendance statistics for a specific employee",
)
async def employee_stats(
    user_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return attendance statistics for any employee in the org (admin view)."""
    from fastapi import HTTPException  # noqa: PLC0415
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # type: ignore[attr-defined]

    target_q = await db.execute(select(User).where(User.id == user_id))
    target = target_q.scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.role != UserRole.super_admin and target.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    month_end = (
        datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc)
        if today.month < 12
        else datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
    )

    total_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == user_id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.is_valid.is_(True),
            )
        )
    )
    total_check_ins = total_q.scalar_one() or 0

    month_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == user_id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= month_start,
                AttendanceLog.created_at < month_end,
            )
        )
    )
    month_checkins = month_q.scalar_one() or 0

    late_q = await db.execute(
        select(func.count(AttendanceLog.id)).where(
            and_(
                AttendanceLog.user_id == user_id,
                AttendanceLog.event_type == EventType.checkin,
                AttendanceLog.created_at >= month_start,
                AttendanceLog.created_at < month_end,
                func.extract("hour", AttendanceLog.created_at) >= 9,
            )
        )
    )
    late_count = late_q.scalar_one() or 0

    working_days = (today - today.replace(day=1)).days + 1
    on_time = month_checkins - late_count
    punctuality = round((on_time / max(month_checkins, 1)) * 100, 1)

    return {
        "total_check_ins": total_check_ins,
        "current_streak": getattr(target, "streak_count", 0) or 0,
        "longest_streak": getattr(target, "streak_count", 0) or 0,
        "punctuality_percentage": punctuality,
        "late_count": late_count,
        "absent_count": max(0, working_days - month_checkins),
    }
