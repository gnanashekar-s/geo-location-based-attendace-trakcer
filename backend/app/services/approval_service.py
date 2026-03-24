"""
Manual attendance approval service.

Handles the lifecycle of ManualApprovalRequest records:
create → pending → approved / rejected → (optional) escalation.

After each state change an event is published to the Redis channel
``ws:approvals`` so WebSocket workers can broadcast updates to connected
supervisor clients in real time.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import ApprovalStatus, ManualApprovalRequest, ReasonCode
from app.schemas.attendance import ManualApprovalRequest as ManualApprovalRequestSchema

logger = logging.getLogger(__name__)

# Redis pub/sub channel used by WebSocket workers
_WS_APPROVALS_CHANNEL = "ws:approvals"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_approval_or_404(approval_id: str, db: AsyncSession) -> ManualApprovalRequest:
    result = await db.execute(
        select(ManualApprovalRequest).where(ManualApprovalRequest.id == approval_id)
    )
    approval = result.scalars().first()
    if approval is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Approval request {approval_id!r} not found.",
        )
    return approval


async def _publish_approval_event(
    redis,
    event_type: str,
    approval: ManualApprovalRequest,
) -> None:
    """Publish an approval lifecycle event to Redis so WS workers can relay it."""
    if redis is None:
        return
    try:
        payload = json.dumps(
            {
                "event": event_type,
                "approval_id": str(approval.id),
                "user_id": str(approval.user_id),
                "status": approval.status.value if hasattr(approval.status, "value") else str(approval.status),
                "escalation_level": approval.escalation_level,
            },
            default=str,
        )
        await redis.publish(_WS_APPROVALS_CHANNEL, payload)
        logger.debug("Published '%s' to channel '%s'", event_type, _WS_APPROVALS_CHANNEL)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to publish approval event to Redis: %s", exc)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def create_manual_request(
    request: ManualApprovalRequestSchema,
    user,
    db: AsyncSession,
    redis=None,
) -> ManualApprovalRequest:
    """
    Create a new manual approval request in ``pending`` status and publish
    a creation event to the ``ws:approvals`` Redis channel.

    Args:
        request:  Validated schema carrying site_id, reason_code, etc.
        user:     ORM User object of the requester.
        db:       Async SQLAlchemy session.
        redis:    Optional Redis client for pub/sub notification.

    Returns:
        The newly created ManualApprovalRequest ORM object.
    """
    approval = ManualApprovalRequest(
        id=uuid.uuid4(),
        user_id=user.id,
        site_id=request.site_id,
        shift_id=request.shift_id,
        reason_code=request.reason_code,
        reason_text=request.reason_text,
        photo_url=request.photo_url,
        status=ApprovalStatus.pending,
        escalation_level=0,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    logger.info("Created approval request %s for user %s", approval.id, user.id)
    await _publish_approval_event(redis, "approval.created", approval)
    return approval


# Keep old name as alias for backwards compatibility
async def create_approval_request(
    request: ManualApprovalRequestSchema,
    user,
    db: AsyncSession,
    redis=None,
) -> ManualApprovalRequest:
    """Alias for create_manual_request (backwards-compatible)."""
    return await create_manual_request(request, user, db, redis)


async def approve_request(
    approval_id: str,
    reviewer,
    note: str,
    db: AsyncSession,
    redis=None,
) -> ManualApprovalRequest:
    """
    Approve a pending manual request, create an AttendanceRecord for the
    requester, and publish an event to ``ws:approvals``.

    Raises:
        HTTPException 404: approval not found.
        HTTPException 400: approval is not in ``pending`` status.
    """
    from app.models.attendance import AttendanceRecord, EventType  # local import to avoid circles

    approval = await _get_approval_or_404(approval_id, db)

    if approval.status != ApprovalStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Approval is already in status '{approval.status.value}'.",
        )

    approval.status = ApprovalStatus.approved
    approval.reviewed_by = reviewer.id
    approval.review_note = note

    # Create a corresponding AttendanceRecord for the employee.
    # lat/lng default to 0.0 because this is a manual (non-GPS) approval.
    attendance_record = AttendanceRecord(
        id=uuid.uuid4(),
        user_id=approval.user_id,
        site_id=approval.site_id,
        shift_id=approval.shift_id,
        approval_id=approval.id,
        event_type=EventType.checkin,
        lat=0.0,
        lng=0.0,
        is_manual=True,
        is_valid=True,
        fraud_score=0.0,
        fraud_flags={},
        photo_url=approval.photo_url,
    )
    db.add(attendance_record)
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    logger.info("Approval %s approved by %s", approval_id, reviewer.id)
    await _publish_approval_event(redis, "approval.approved", approval)
    return approval


async def reject_request(
    approval_id: str,
    reviewer,
    note: str,
    db: AsyncSession,
    redis=None,
) -> ManualApprovalRequest:
    """
    Reject a pending manual request and publish an event to ``ws:approvals``.

    Raises:
        HTTPException 404: approval not found.
        HTTPException 400: approval is not in ``pending`` status.
    """
    approval = await _get_approval_or_404(approval_id, db)

    if approval.status != ApprovalStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Approval is already in status '{approval.status.value}'.",
        )

    approval.status = ApprovalStatus.rejected
    approval.reviewed_by = reviewer.id
    approval.review_note = note
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    logger.info("Approval %s rejected by %s", approval_id, reviewer.id)
    await _publish_approval_event(redis, "approval.rejected", approval)
    return approval


async def escalate_request(
    approval_id: str,
    db: AsyncSession,
    redis=None,
) -> ManualApprovalRequest:
    """
    Increment the escalation level of an approval request and publish an
    event to ``ws:approvals``.

    Raises:
        HTTPException 404: approval not found.
        HTTPException 400: approval has already been resolved.
    """
    approval = await _get_approval_or_404(approval_id, db)

    if approval.status != ApprovalStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot escalate a request in status '{approval.status.value}'.",
        )

    approval.escalation_level = (approval.escalation_level or 0) + 1
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    logger.info("Approval %s escalated to level %d", approval_id, approval.escalation_level)
    await _publish_approval_event(redis, "approval.escalated", approval)
    return approval


async def get_pending_approvals(org_id: str, db: AsyncSession) -> List[ManualApprovalRequest]:
    """Return all pending approval requests for the given organisation."""
    from app.models.user import User  # local import to avoid circles

    result = await db.execute(
        select(ManualApprovalRequest)
        .join(User, User.id == ManualApprovalRequest.user_id)
        .where(
            and_(
                User.org_id == org_id,
                ManualApprovalRequest.status == ApprovalStatus.pending,
            )
        )
        .order_by(ManualApprovalRequest.escalation_level.desc())
    )
    return result.scalars().all()
