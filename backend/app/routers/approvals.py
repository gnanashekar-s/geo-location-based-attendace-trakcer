"""
Approvals router.

Endpoints
---------
GET  /approvals/                        – list pending approvals (supervisor+)
POST /approvals/bulk-approve            – bulk approve by list of IDs  [MUST be before /{id}]
GET  /approvals/{approval_id}           – get approval detail
POST /approvals/{approval_id}/approve   – approve a request
POST /approvals/{approval_id}/reject    – reject a request
"""

from __future__ import annotations

import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, get_redis, require_roles
from app.models.approval import ManualApprovalRequest
from app.models.user import User, UserRole
from app.services.approval_service import (
    approve_request,
    get_pending_approvals,
    reject_request,
)
from app.services.notification_service import send_push_notification

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approvals", tags=["Approvals"])


ESCALATION_LABELS = {0: "low", 1: "medium", 2: "high", 3: "critical"}


def _approval_dict(a: ManualApprovalRequest, user: User | None = None) -> dict:
    level_int = a.escalation_level if isinstance(a.escalation_level, int) else 0
    return {
        "id": str(a.id),
        "attendance_id": str(a.id),  # reuse id as attendance_id fallback
        "user_id": str(a.user_id),
        "employee_id": str(a.user_id),
        "employee_name": user.full_name if user else "Unknown",
        "employee_email": user.email if user else "",
        "site_id": str(a.site_id),
        "reason_code": a.reason_code.value if hasattr(a.reason_code, "value") else str(a.reason_code),
        "reason": a.reason_text or "",
        "reason_text": a.reason_text,
        "photo_url": a.photo_url,
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "reviewed_by": str(a.reviewed_by) if a.reviewed_by else None,
        "review_note": a.review_note,
        "notes": a.review_note,
        "escalation_level": ESCALATION_LABELS.get(level_int, "low"),
        "fraud_score": 0.0,
        "fraud_flags": [],
        "latitude": None,
        "longitude": None,
        "accuracy": 0,
        "submitted_at": str(a.created_at),
        "created_at": str(a.created_at),
        "updated_at": str(a.updated_at),
    }


# ---------------------------------------------------------------------------
# GET /approvals/
# ---------------------------------------------------------------------------


@router.get(
    "/",
    summary="List pending approval requests (supervisor+)",
    dependencies=[
        Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))
    ],
)
async def list_pending_approvals(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[dict]:
    """
    Return all pending manual approval requests for the current user's org.

    Results are ordered by escalation level (highest first) so the most
    urgent requests appear at the top.
    """
    approvals = await get_pending_approvals(str(current_user.org_id), db)
    # Build a user lookup map so we can include employee name/email
    user_ids = list({a.user_id for a in approvals})
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in users_result.scalars().all()}
    return [_approval_dict(a, user_map.get(a.user_id)) for a in approvals]


# ---------------------------------------------------------------------------
# POST /approvals/bulk-approve   <- MUST be defined before /{approval_id}
# ---------------------------------------------------------------------------


@router.post(
    "/bulk-approve",
    summary="Bulk approve multiple requests",
    dependencies=[
        Depends(require_roles(UserRole.org_admin, UserRole.super_admin))
    ],
)
async def bulk_approve(
    approval_ids: List[UUID] = Body(..., embed=True),
    note: str = Body(default="Bulk approved", embed=True),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    """
    Approve multiple approval requests in a single call.

    Returns a summary of successes and failures.
    """
    succeeded: List[str] = []
    failed: List[dict] = []

    for aid in approval_ids:
        try:
            approval = await approve_request(str(aid), current_user, note, db, redis)
            succeeded.append(str(approval.id))
            await send_push_notification(
                user_id=str(approval.user_id),
                title="Attendance Request Approved",
                body="Your manual attendance request has been approved.",
                data={"approval_id": str(approval.id)},
                db=db,
            )
        except HTTPException as exc:
            failed.append({"id": str(aid), "detail": exc.detail})
        except Exception as exc:  # noqa: BLE001
            logger.error("Bulk approve error for %s: %s", aid, exc)
            failed.append({"id": str(aid), "detail": "Internal error."})

    return {
        "succeeded": succeeded,
        "failed": failed,
        "total_requested": len(approval_ids),
        "total_succeeded": len(succeeded),
    }


# ---------------------------------------------------------------------------
# GET /approvals/{approval_id}
# ---------------------------------------------------------------------------


@router.get(
    "/{approval_id}",
    summary="Get approval detail",
    dependencies=[
        Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))
    ],
)
async def get_approval(
    approval_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(ManualApprovalRequest).where(ManualApprovalRequest.id == approval_id)
    )
    approval = result.scalars().first()
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found.")
    # ManualApprovalRequest has no org_id column; access is controlled via role
    if current_user.role != UserRole.super_admin:
        if approval.user_id != current_user.id and current_user.role not in (
            UserRole.org_admin, UserRole.supervisor
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    return _approval_dict(approval)


# ---------------------------------------------------------------------------
# POST /approvals/{approval_id}/approve
# ---------------------------------------------------------------------------


@router.post(
    "/{approval_id}/approve",
    summary="Approve a manual attendance request",
    dependencies=[
        Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))
    ],
)
async def approve(
    approval_id: UUID,
    note: str = Body(default="", embed=True),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    """
    Approve the request and auto-create an AttendanceRecord for the employee.
    Publishes an event to the ``ws:approvals`` Redis channel and sends a push
    notification to the employee.
    """
    approval = await approve_request(str(approval_id), current_user, note, db, redis)

    # Notify the employee
    await send_push_notification(
        user_id=str(approval.user_id),
        title="Attendance Request Approved",
        body="Your manual attendance request has been approved.",
        data={"approval_id": str(approval.id)},
        db=db,
    )

    return _approval_dict(approval)


# ---------------------------------------------------------------------------
# POST /approvals/{approval_id}/reject
# ---------------------------------------------------------------------------


@router.post(
    "/{approval_id}/reject",
    summary="Reject a manual attendance request",
    dependencies=[
        Depends(require_roles(UserRole.supervisor, UserRole.org_admin, UserRole.super_admin))
    ],
)
async def reject(
    approval_id: UUID,
    note: str = Body(default="", embed=True),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    """
    Reject the request, publish an event to ``ws:approvals``, and notify
    the employee.
    """
    approval = await reject_request(str(approval_id), current_user, note, db, redis)

    await send_push_notification(
        user_id=str(approval.user_id),
        title="Attendance Request Rejected",
        body=f"Your manual attendance request was rejected. Note: {note or 'No note provided.'}",
        data={"approval_id": str(approval.id)},
        db=db,
    )

    return _approval_dict(approval)
