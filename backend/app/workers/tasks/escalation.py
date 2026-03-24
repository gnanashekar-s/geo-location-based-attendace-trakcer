"""
Celery task: Approval SLA Escalation.

Every 5 minutes Beat fires check_escalations().  The task:
  1. Opens a synchronous SQLAlchemy session (Celery workers are sync).
  2. Queries ManualApprovalRequest rows that are still PENDING and whose
     created_at + SLA_HOURS_PER_LEVEL hours is in the past.
  3. Escalates the request (bumps escalation_level, sets status=escalated)
     or auto-rejects after the final escalation level (org_admin level).
  4. Sends an FCM push notification to the newly assigned approver.

SLA policy (simple, hardcoded):
  - Level 0 → supervisor has 24 h to respond.
  - Level 1 → org_admin has 24 h to respond.
  - Level 2+ → auto-reject (no further escalation).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from celery import shared_task
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

# SLA per escalation level (hours).  Requests older than this at their current
# level will be bumped to the next level.
_SLA_HOURS = 24
# Maximum escalation level before auto-rejection.
_MAX_ESCALATION_LEVEL = 1

# ---------------------------------------------------------------------------
# Synchronous SQLAlchemy engine (Celery cannot use asyncpg directly)
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
# FCM helper (fire-and-forget)
# ---------------------------------------------------------------------------


def _send_fcm_notification(
    fcm_token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> None:
    """Send a Firebase Cloud Messaging push notification.

    Initialises the Firebase app lazily so the worker process only loads
    credentials when it actually needs them.
    """
    try:
        import firebase_admin  # noqa: PLC0415
        from firebase_admin import credentials, messaging  # noqa: PLC0415

        if not firebase_admin._apps:
            cred = credentials.Certificate(settings.FCM_CREDENTIALS_PATH)
            firebase_admin.initialize_app(cred)

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            token=fcm_token,
        )
        response = messaging.send(message)
        logger.info("FCM sent: %s", response)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FCM notification failed: %s", exc)


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.escalation.check_escalations",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def check_escalations(self) -> dict:  # type: ignore[override]
    """
    Find all pending approvals that have breached their SLA deadline and
    escalate them to the next approval level.

    The actual model is ManualApprovalRequest (app.models.approval).
    Fields used:
      - status        : ApprovalStatus enum (pending / approved / rejected / escalated)
      - escalation_level : int, starts at 0 (supervisor), bumped on each SLA breach
      - created_at    : when the request was originally submitted
      - updated_at    : when escalation_level was last changed (used as SLA start)
      - user_id       : the employee who submitted the request
      - reviewed_by   : set to None while pending

    Returns a summary dict with counts for observability.
    """
    try:
        from app.models.approval import ApprovalStatus, ManualApprovalRequest  # noqa: PLC0415
        from app.models.user import User, UserRole  # noqa: PLC0415
    except ImportError as exc:
        logger.error("Could not import models: %s", exc)
        return {"escalated": 0, "auto_rejected": 0, "error": str(exc)}

    now = datetime.now(tz=timezone.utc)
    sla_cutoff = now - timedelta(hours=_SLA_HOURS)
    escalated = 0
    auto_rejected = 0

    with SyncSession() as session:
        try:
            # Fetch all PENDING requests that were last updated before the SLA cutoff.
            # updated_at is refreshed whenever escalation_level changes so it correctly
            # represents the start of the current escalation window.
            stmt = (
                select(ManualApprovalRequest)
                .where(
                    ManualApprovalRequest.status == ApprovalStatus.pending,
                    ManualApprovalRequest.updated_at < sla_cutoff,
                )
                .with_for_update(skip_locked=True)  # avoid race with other workers
            )
            pending: list[ManualApprovalRequest] = (
                session.execute(stmt).scalars().all()
            )

            logger.info(
                "Escalation check: found %d overdue pending approvals", len(pending)
            )

            for approval in pending:
                current_level: int = approval.escalation_level

                if current_level >= _MAX_ESCALATION_LEVEL:
                    # Already at the top level (org_admin) — auto-reject.
                    approval.status = ApprovalStatus.rejected
                    approval.review_note = (
                        f"Auto-rejected: SLA breached at escalation level "
                        f"{current_level} with no response."
                    )
                    approval.reviewed_at = now
                    auto_rejected += 1
                    logger.info(
                        "Auto-rejected approval %s (escalation_level=%d)",
                        approval.id,
                        current_level,
                    )
                else:
                    # Escalate to the next level.
                    next_level = current_level + 1
                    approval.escalation_level = next_level
                    approval.status = ApprovalStatus.escalated
                    # updated_at will be refreshed by the ORM onupdate; explicitly
                    # setting it here ensures the next SLA window starts from now.
                    approval.updated_at = now

                    escalated += 1
                    logger.info(
                        "Escalated approval %s to level %d", approval.id, next_level
                    )

                    # Notify the org_admin(s) of the same organisation via FCM.
                    org_admins = _get_org_admins(session, approval.user_id, User, UserRole)
                    for admin in org_admins:
                        if getattr(admin, "fcm_token", None):
                            _send_fcm_notification(
                                fcm_token=admin.fcm_token,
                                title="Attendance Approval Escalated",
                                body=(
                                    "An attendance approval request has been escalated "
                                    "to you and requires your attention."
                                ),
                                data={
                                    "type": "APPROVAL_ESCALATION",
                                    "approval_id": str(approval.id),
                                    "level": str(next_level),
                                },
                            )

            session.commit()
        except Exception as exc:
            session.rollback()
            logger.exception("Escalation task failed: %s", exc)
            raise self.retry(exc=exc)

    return {"escalated": escalated, "auto_rejected": auto_rejected}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_org_admins(
    session: Session,
    user_id: object,
    User: type,
    UserRole: type,
) -> list:
    """
    Return org_admin users that belong to the same organisation as *user_id*.
    Falls back to an empty list on any error.
    """
    try:
        # Resolve the requesting user's org_id first.
        requesting_user = session.get(User, user_id)
        if requesting_user is None:
            return []

        stmt = (
            select(User)
            .where(
                User.org_id == requesting_user.org_id,
                User.role == UserRole.org_admin,
                User.is_active.is_(True),
            )
        )
        return session.execute(stmt).scalars().all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not resolve org admins: %s", exc)
        return []
