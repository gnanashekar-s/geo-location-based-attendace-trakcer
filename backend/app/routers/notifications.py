"""
Notifications router.

Endpoints
---------
GET   /notifications/           – list current user's notifications (unread first)
POST  /notifications/read-all   – mark all as read
POST  /notifications/{id}/read  – mark one as read
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db
from app.models.audit_log import Notification
from app.models.user import User
from app.schemas.notification import NotificationListResponse, NotificationResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["Notifications"])


# ---------------------------------------------------------------------------
# GET /notifications/
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=NotificationListResponse,
    summary="List current user's notifications (unread first, max 50)",
)
async def list_notifications(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationListResponse:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.is_read.asc(), Notification.created_at.desc())
        .limit(50)
    )
    notifications = result.scalars().all()
    unread_count = sum(1 for n in notifications if not n.is_read)

    return NotificationListResponse(
        items=[NotificationResponse.model_validate(n) for n in notifications],
        total=len(notifications),
        unread_count=unread_count,
    )


# ---------------------------------------------------------------------------
# POST /notifications/read-all
# ---------------------------------------------------------------------------


@router.post(
    "/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Mark all notifications as read",
)
async def mark_all_read(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True, read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# POST /notifications/{id}/read
# ---------------------------------------------------------------------------


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Mark a single notification as read",
)
async def mark_one_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalars().first()
    if notif is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    notif.is_read = True
    notif.read_at = datetime.now(timezone.utc)
    db.add(notif)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
