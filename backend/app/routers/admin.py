"""
Admin router (org_admin+ only).

Endpoints
---------
GET  /admin/users                        – full user list with fraud stats
POST /admin/users/{user_id}/suspend      – deactivate user
POST /admin/users/{user_id}/activate     – reactivate user
GET  /admin/devices                      – list registered devices for org
DELETE /admin/devices/{device_id}        – remove device
GET  /admin/audit-logs                   – paginated audit log
GET  /admin/shifts                       – list shifts for org
POST /admin/shifts                       – create shift
PATCH /admin/shifts/{shift_id}           – update shift
POST /admin/shifts/{shift_id}/assign     – assign shift to user
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, require_roles
from app.models.attendance import Shift, UserShift
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.fraud_whitelist import FraudWhitelist
from app.models.ip_rule import IPRule, IPRuleType
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin",
    tags=["Admin"],
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)


# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------


@router.get("/users", summary="List all users in org with fraud stats")
async def list_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    filters = []
    if current_user.role != UserRole.super_admin:
        filters.append(User.org_id == current_user.org_id)
    if search:
        filters.append(
            User.full_name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        )

    result = await db.execute(
        select(User)
        .where(and_(*filters))
        .order_by(User.full_name)
        .offset(skip)
        .limit(limit)
    )
    users = result.scalars().all()

    out = []
    for u in users:
        out.append({
            "id": str(u.id),
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "is_active": u.is_active,
            "streak_count": u.streak_count,
            "last_checkin_date": str(u.last_checkin_date) if u.last_checkin_date else None,
            "avatar_url": u.avatar_url,
            "created_at": str(u.created_at),
        })
    return out


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/suspend
# ---------------------------------------------------------------------------


@router.post("/users/{user_id}/suspend", summary="Suspend a user account")
async def suspend_user(
    user_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if current_user.role != UserRole.super_admin and user.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    user.is_active = False
    log = AuditLog(
        actor_id=current_user.id,
        action="suspend_user",
        entity_type="user",
        entity_id=str(user_id),
        old_value={"is_active": True},
        new_value={"is_active": False},
        ip_address=None,
    )
    db.add(log)
    await db.commit()
    return {"message": f"User {user.email} suspended.", "user_id": str(user_id)}


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/activate
# ---------------------------------------------------------------------------


@router.post("/users/{user_id}/activate", summary="Activate a suspended user")
async def activate_user(
    user_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if current_user.role != UserRole.super_admin and user.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    user.is_active = True
    log = AuditLog(
        actor_id=current_user.id,
        action="activate_user",
        entity_type="user",
        entity_id=str(user_id),
        old_value={"is_active": False},
        new_value={"is_active": True},
        ip_address=None,
    )
    db.add(log)
    await db.commit()
    return {"message": f"User {user.email} activated.", "user_id": str(user_id)}


# ---------------------------------------------------------------------------
# GET /admin/devices
# ---------------------------------------------------------------------------


@router.get("/devices", summary="List registered devices for org")
async def list_devices(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [Device.user_id.in_(select(User.id).where(User.org_id == current_user.org_id))]
    )
    result = await db.execute(
        select(Device, User.full_name.label("user_name"), User.email.label("user_email"))
        .join(User, User.id == Device.user_id)
        .where(and_(*org_filter))
        .order_by(desc(Device.last_seen_at))
        .offset(skip)
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "id": str(d.id),
            "user_id": str(d.user_id),
            "user_name": user_name,
            "user_email": user_email,
            "platform": d.platform.value if hasattr(d.platform, "value") else str(d.platform),
            "device_fingerprint": d.device_fingerprint,
            "is_trusted": d.is_trusted,
            "last_seen_at": str(d.last_seen_at) if d.last_seen_at else None,
            "created_at": str(d.created_at),
        }
        for d, user_name, user_email in rows
    ]


# ---------------------------------------------------------------------------
# DELETE /admin/devices/{device_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Remove a device registration",
)
async def delete_device(
    device_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found.")

    # Verify device belongs to same org
    user_result = await db.execute(select(User).where(User.id == device.user_id))
    owner = user_result.scalar_one_or_none()
    if owner and current_user.role != UserRole.super_admin and owner.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    await db.delete(device)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# GET /admin/audit-logs
# ---------------------------------------------------------------------------


@router.get("/audit-logs", summary="Paginated audit log")
async def get_audit_logs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    action: Optional[str] = Query(default=None),
    entity_type: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if current_user.role != UserRole.super_admin:
        filters.append(
            AuditLog.actor_id.in_(select(User.id).where(User.org_id == current_user.org_id))
        )

    result = await db.execute(
        select(AuditLog)
        .where(and_(*filters))
        .order_by(desc(AuditLog.created_at))
        .offset(skip)
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(lg.id),
            "actor_id": str(lg.actor_id) if lg.actor_id else None,
            "action": lg.action,
            "entity_type": lg.entity_type,
            "entity_id": lg.entity_id,
            "old_value": lg.old_value,
            "new_value": lg.new_value,
            "ip_address": lg.ip_address,
            "created_at": str(lg.created_at),
        }
        for lg in logs
    ]


# ---------------------------------------------------------------------------
# GET /admin/shifts
# ---------------------------------------------------------------------------


@router.get("/shifts", summary="List shifts for org")
async def list_shifts(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    filters = []
    if current_user.role != UserRole.super_admin:
        filters.append(Shift.org_id == current_user.org_id)

    result = await db.execute(
        select(Shift).where(and_(*filters)).order_by(Shift.name)
    )
    shifts = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "org_id": str(s.org_id),
            "site_id": str(s.site_id) if s.site_id else None,
            "name": s.name,
            "start_time": str(s.start_time),
            "end_time": str(s.end_time),
            "days_of_week": s.days_of_week,
            "late_threshold_minutes": s.late_threshold_minutes,
            "is_active": s.is_active,
        }
        for s in shifts
    ]


# ---------------------------------------------------------------------------
# POST /admin/shifts
# ---------------------------------------------------------------------------


@router.post("/shifts", status_code=status.HTTP_201_CREATED, summary="Create a shift")
async def create_shift(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    from datetime import time as dtime
    org_id = current_user.org_id if current_user.role != UserRole.super_admin else payload.get("org_id", str(current_user.org_id))
    start_parts = [int(x) for x in str(payload["start_time"]).split(":")]
    end_parts = [int(x) for x in str(payload["end_time"]).split(":")]
    shift = Shift(
        org_id=org_id,
        site_id=payload.get("site_id"),
        name=payload["name"],
        start_time=dtime(start_parts[0], start_parts[1] if len(start_parts) > 1 else 0),
        end_time=dtime(end_parts[0], end_parts[1] if len(end_parts) > 1 else 0),
        days_of_week=payload.get("days_of_week", [0, 1, 2, 3, 4]),
        late_threshold_minutes=payload.get("late_threshold_minutes", 15),
        is_active=True,
    )
    db.add(shift)
    await db.commit()
    await db.refresh(shift)
    return {"id": str(shift.id), "name": shift.name, "message": "Shift created."}


# ---------------------------------------------------------------------------
# PATCH /admin/shifts/{shift_id}
# ---------------------------------------------------------------------------


@router.patch("/shifts/{shift_id}", summary="Update a shift")
async def update_shift(
    shift_id: UUID,
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    result = await db.execute(select(Shift).where(Shift.id == shift_id))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    for field in ("name", "days_of_week", "late_threshold_minutes", "is_active"):
        if field in payload:
            setattr(shift, field, payload[field])
    await db.commit()
    return {"id": str(shift.id), "message": "Shift updated."}


# ---------------------------------------------------------------------------
# POST /admin/shifts/{shift_id}/assign
# ---------------------------------------------------------------------------


@router.post("/shifts/{shift_id}/assign", summary="Assign shift to a user")
async def assign_shift(
    shift_id: UUID,
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    from datetime import date

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=422, detail="user_id is required.")

    assignment = UserShift(
        user_id=user_id,
        shift_id=shift_id,
        effective_from=payload.get("effective_from", str(date.today())),
        effective_to=payload.get("effective_to"),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return {"id": str(assignment.id), "message": "Shift assigned."}


# ---------------------------------------------------------------------------
# GET /admin/whitelist
# ---------------------------------------------------------------------------


@router.get("/whitelist", summary="List fraud whitelist entries for org")
async def list_whitelist(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [FraudWhitelist.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )]
    )
    result = await db.execute(
        select(
            FraudWhitelist,
            User.full_name.label("user_name"),
            User.email.label("user_email"),
        )
        .join(User, User.id == FraudWhitelist.user_id)
        .where(and_(*org_filter))
        .order_by(desc(FraudWhitelist.created_at))
    )
    rows = result.all()
    return [
        {
            "id": str(w.id),
            "user_id": str(w.user_id),
            "user_name": user_name,
            "user_email": user_email,
            "device_fingerprint": w.device_fingerprint,
            "reason": w.reason,
            "admin_id": str(w.admin_id) if w.admin_id else None,
            "created_at": str(w.created_at),
        }
        for w, user_name, user_email in rows
    ]


# ---------------------------------------------------------------------------
# POST /admin/whitelist
# ---------------------------------------------------------------------------


@router.post("/whitelist", status_code=status.HTTP_201_CREATED,
             summary="Add a device+user pair to the fraud whitelist")
async def add_whitelist_entry(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    user_id = payload.get("user_id")
    device_fingerprint = payload.get("device_fingerprint", "").strip()
    reason = payload.get("reason", "")

    if not user_id or not device_fingerprint:
        raise HTTPException(status_code=422, detail="user_id and device_fingerprint are required.")

    user_result = await db.execute(select(User).where(User.id == user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    if current_user.role != UserRole.super_admin and target_user.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    entry = FraudWhitelist(
        user_id=user_id,
        admin_id=current_user.id,
        device_fingerprint=device_fingerprint,
        reason=reason,
    )
    db.add(entry)
    log = AuditLog(
        actor_id=current_user.id,
        action="add_whitelist",
        entity_type="fraud_whitelist",
        entity_id=str(user_id),
        old_value=None,
        new_value={"device_fingerprint": device_fingerprint, "reason": reason},
        ip_address=None,
    )
    db.add(log)
    try:
        await db.commit()
        await db.refresh(entry)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This device is already whitelisted for that user.")

    return {"id": str(entry.id), "message": "Whitelist entry added."}


# ---------------------------------------------------------------------------
# DELETE /admin/whitelist/{entry_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/whitelist/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Remove a whitelist entry",
)
async def remove_whitelist_entry(
    entry_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(FraudWhitelist).where(FraudWhitelist.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Whitelist entry not found.")

    user_result = await db.execute(select(User).where(User.id == entry.user_id))
    owner = user_result.scalar_one_or_none()
    if owner and current_user.role != UserRole.super_admin and owner.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    log = AuditLog(
        actor_id=current_user.id,
        action="remove_whitelist",
        entity_type="fraud_whitelist",
        entity_id=str(entry_id),
        old_value={"device_fingerprint": entry.device_fingerprint},
        new_value=None,
        ip_address=None,
    )
    db.add(log)
    await db.delete(entry)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# PATCH /admin/devices/{device_id}/trust
# ---------------------------------------------------------------------------


@router.patch("/devices/{device_id}/trust", summary="Toggle device trusted state")
async def toggle_device_trust(
    device_id: UUID,
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found.")

    user_result = await db.execute(select(User).where(User.id == device.user_id))
    owner = user_result.scalar_one_or_none()
    if owner and current_user.role != UserRole.super_admin and owner.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    old_trusted = device.is_trusted
    new_trusted = bool(payload.get("is_trusted", not old_trusted))
    device.is_trusted = new_trusted

    log = AuditLog(
        actor_id=current_user.id,
        action="toggle_device_trust",
        entity_type="device",
        entity_id=str(device_id),
        old_value={"is_trusted": old_trusted},
        new_value={"is_trusted": new_trusted},
        ip_address=None,
    )
    db.add(log)
    await db.commit()
    return {"id": str(device_id), "is_trusted": new_trusted, "message": "Device trust updated."}


# ---------------------------------------------------------------------------
# GET /admin/ip-rules
# ---------------------------------------------------------------------------


@router.get("/ip-rules", summary="List IP block/allow rules for org")
async def list_ip_rules(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    filters = (
        []
        if current_user.role == UserRole.super_admin
        else [IPRule.org_id == current_user.org_id]
    )
    result = await db.execute(
        select(IPRule).where(and_(*filters)).order_by(desc(IPRule.created_at))
    )
    rules = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "org_id": str(r.org_id),
            "rule_type": r.rule_type.value if hasattr(r.rule_type, "value") else str(r.rule_type),
            "ip_cidr": r.ip_cidr,
            "reason": r.reason,
            "created_by_id": str(r.created_by_id) if r.created_by_id else None,
            "created_at": str(r.created_at),
        }
        for r in rules
    ]


# ---------------------------------------------------------------------------
# POST /admin/ip-rules
# ---------------------------------------------------------------------------


@router.post("/ip-rules", status_code=status.HTTP_201_CREATED,
             summary="Create an IP block or allow rule")
async def create_ip_rule(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    import ipaddress as _ipaddress  # noqa: PLC0415

    rule_type_raw = payload.get("rule_type", "block")
    ip_cidr = payload.get("ip_cidr", "").strip()
    reason = payload.get("reason", "")

    if not ip_cidr:
        raise HTTPException(status_code=422, detail="ip_cidr is required.")

    try:
        _ipaddress.ip_network(ip_cidr, strict=False)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{ip_cidr}' is not a valid IP address or CIDR range.")

    try:
        rule_type = IPRuleType(rule_type_raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="rule_type must be 'block' or 'allow'.")

    rule = IPRule(
        org_id=current_user.org_id,
        created_by_id=current_user.id,
        rule_type=rule_type,
        ip_cidr=ip_cidr,
        reason=reason,
    )
    db.add(rule)
    log = AuditLog(
        actor_id=current_user.id,
        action="create_ip_rule",
        entity_type="ip_rule",
        entity_id=ip_cidr,
        old_value=None,
        new_value={"rule_type": rule_type.value, "ip_cidr": ip_cidr, "reason": reason},
        ip_address=None,
    )
    db.add(log)
    await db.commit()
    await db.refresh(rule)
    return {"id": str(rule.id), "message": "IP rule created."}


# ---------------------------------------------------------------------------
# DELETE /admin/ip-rules/{rule_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/ip-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an IP rule",
)
async def delete_ip_rule(
    rule_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(IPRule).where(IPRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="IP rule not found.")
    if current_user.role != UserRole.super_admin and rule.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    log = AuditLog(
        actor_id=current_user.id,
        action="delete_ip_rule",
        entity_type="ip_rule",
        entity_id=str(rule_id),
        old_value={"rule_type": rule.rule_type.value, "ip_cidr": rule.ip_cidr},
        new_value=None,
        ip_address=None,
    )
    db.add(log)
    await db.delete(rule)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
