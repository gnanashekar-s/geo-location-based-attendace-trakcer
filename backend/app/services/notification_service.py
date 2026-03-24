"""
Notification service.

Responsibilities:
- Persist notifications to the database.
- Attempt FCM push delivery (gracefully degraded if credentials absent).
- Publish WebSocket broadcast messages via Redis pub/sub.
- Query unread notifications.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_FCM_AVAILABLE = False
_FCM_APP = None

# Try to import and initialise Firebase Admin SDK
try:
    import firebase_admin  # type: ignore
    from firebase_admin import credentials, messaging  # type: ignore

    _FCM_AVAILABLE = True
except ImportError:
    logger.debug("firebase-admin not installed; push notifications disabled.")


def _init_fcm(credentials_path: str) -> bool:
    """Initialise the Firebase Admin SDK once."""
    global _FCM_APP, _FCM_AVAILABLE
    if _FCM_APP is not None:
        return True
    try:
        import os

        if not os.path.exists(credentials_path):
            logger.info("FCM credentials file not found at %s; push disabled.", credentials_path)
            return False
        cred = credentials.Certificate(credentials_path)
        _FCM_APP = firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialised.")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("FCM init failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Push notifications
# ---------------------------------------------------------------------------


async def send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]],
    db: AsyncSession,
) -> None:
    """
    Save a notification record and, if an FCM token exists, deliver it.

    This is a best-effort delivery — failures are logged but not raised.
    """
    from app.models.audit_log import Notification  # Notification lives in audit_log
    from app.models.user import User  # type: ignore[attr-defined]

    # Persist to DB
    notif = Notification(
        id=uuid.uuid4(),
        user_id=user_id,
        type="push",  # required NOT NULL field
        title=title,
        body=body,
        data=data or {},
        is_read=False,
    )
    db.add(notif)
    await db.flush()

    # Attempt FCM delivery
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalars().first()
    if user is None:
        return

    fcm_token = getattr(user, "fcm_token", None)
    if not fcm_token:
        logger.debug("No FCM token for user %s; skipping push.", user_id)
        return

    if not _FCM_AVAILABLE:
        logger.debug("FCM unavailable; notification saved to DB only.")
        return

    from app.config import settings

    if not _init_fcm(settings.FCM_CREDENTIALS_PATH):
        return

    try:
        from firebase_admin import messaging  # type: ignore

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            token=fcm_token,
        )
        response = messaging.send(message)
        logger.debug("FCM message sent: %s", response)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FCM delivery failed for user %s: %s", user_id, exc)


# ---------------------------------------------------------------------------
# WebSocket broadcast via Redis pub/sub
# ---------------------------------------------------------------------------


async def send_websocket_notification(
    channel: str,
    message: Dict[str, Any],
    redis: Redis,
) -> None:
    """
    Publish *message* to a Redis pub/sub *channel*.

    WebSocket workers subscribed to the channel will receive and forward
    the payload to connected clients.

    Args:
        channel:  Redis pub/sub channel name (e.g. ``"ws:approvals"``).
        message:  Arbitrary JSON-serialisable dict to publish.
        redis:    Connected ``redis.asyncio.Redis`` client.
    """
    try:
        payload = json.dumps(message, default=str)
        await redis.publish(channel, payload)
        logger.debug("WebSocket notification sent to channel '%s': %s", channel, payload[:120])
    except Exception as exc:  # noqa: BLE001
        logger.warning("send_websocket_notification failed for channel '%s': %s", channel, exc)


# Keep the old name as a direct alias for backwards compatibility.
async def broadcast_ws_message(channel: str, message: Dict[str, Any], redis: Redis) -> None:
    """Alias for send_websocket_notification (backwards-compatible)."""
    await send_websocket_notification(channel, message, redis)


# ---------------------------------------------------------------------------
# Approval-specific notification
# ---------------------------------------------------------------------------


async def send_approval_notification(approval_request, db: AsyncSession) -> None:
    """
    Notify the requester's supervisor (or org admin) about a new approval request.
    """
    from app.models.user import User  # type: ignore[attr-defined]

    requester_result = await db.execute(
        select(User).where(User.id == approval_request.user_id)
    )
    requester = requester_result.scalars().first()
    if requester is None:
        return

    supervisor_id = getattr(requester, "supervisor_id", None)
    if supervisor_id:
        await send_push_notification(
            user_id=str(supervisor_id),
            title="New Attendance Approval Request",
            body=f"{requester.full_name} submitted a manual attendance request.",
            data={
                "approval_id": str(approval_request.id),
                "reason_code": approval_request.reason_code,
            },
            db=db,
        )
    else:
        logger.debug(
            "No supervisor for user %s; approval notification skipped.", requester.id
        )


# ---------------------------------------------------------------------------
# Read notifications
# ---------------------------------------------------------------------------


async def get_unread_notifications(user_id: str, db: AsyncSession) -> List:
    """Return all unread notifications for a user, newest first."""
    from app.models.audit_log import Notification  # Notification lives in audit_log

    result = await db.execute(
        select(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
        .order_by(Notification.created_at.desc())
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Password reset email
# ---------------------------------------------------------------------------


async def send_reset_email(email: str, reset_token: str) -> None:
    """
    Send a password reset email via SMTP (MailHog on port 1025 in development).

    The call is dispatched to a thread-pool executor so it never blocks the
    async event loop even if the SMTP connection is slow.
    """
    import asyncio  # noqa: PLC0415
    import smtplib  # noqa: PLC0415
    from email.message import EmailMessage  # noqa: PLC0415

    from app.config import settings  # noqa: PLC0415

    def _send() -> None:
        msg = EmailMessage()
        msg["Subject"] = "GeoAttendance – Reset your password"
        msg["From"] = settings.SMTP_FROM
        msg["To"] = email
        msg.set_content(
            f"Hi,\n\n"
            f"You requested a password reset for your GeoAttendance account.\n\n"
            f"Your reset token is:\n\n  {reset_token}\n\n"
            f"This token expires in 15 minutes.\n\n"
            f"If you did not request this, please ignore this email.\n\n"
            f"— GeoAttendance"
        )
        try:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5) as s:
                s.send_message(msg)
            logger.info("Reset email sent to %s via %s:%s", email, settings.SMTP_HOST, settings.SMTP_PORT)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to send reset email to %s: %s", email, exc)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send)
