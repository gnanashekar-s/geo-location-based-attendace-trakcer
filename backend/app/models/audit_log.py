"""
Audit log and Notification models.

AuditLog provides a tamper-evident record of every significant state change
in the system (create / update / delete operations on sensitive entities).

Notification represents a user-facing push/in-app notification.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


# ---------------------------------------------------------------------------
# AuditLog
# ---------------------------------------------------------------------------

class AuditLog(Base):
    """
    Immutable record of a state-changing action performed by an actor.

    ``actor_id`` is nullable to support system-generated actions (e.g. Celery
    tasks that escalate approval requests or expire sessions).

    ``old_value`` / ``new_value`` capture the before/after state of the
    affected entity as raw JSONB so they survive schema migrations.
    """

    __tablename__ = "audit_logs"

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )

    # ------------------------------------------------------------------
    # Actor (who performed the action)
    # ------------------------------------------------------------------
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Action descriptor
    # ------------------------------------------------------------------
    action: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment=(
            "Verb describing what happened, e.g. 'user.create', "
            "'attendance.approve', 'site.delete'."
        ),
    )

    # ------------------------------------------------------------------
    # Affected entity
    # ------------------------------------------------------------------
    entity_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="SQLAlchemy model / table name of the affected entity.",
    )
    entity_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="String representation of the affected entity's primary key.",
    )

    # ------------------------------------------------------------------
    # Diff payload
    # ------------------------------------------------------------------
    old_value: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="JSON snapshot of the entity before the action.",
    )
    new_value: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="JSON snapshot of the entity after the action.",
    )

    # ------------------------------------------------------------------
    # Request context
    # ------------------------------------------------------------------
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45),   # IPv6-safe
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Timestamp (no updated_at – audit logs are append-only)
    # ------------------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    actor: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="audit_logs",
        foreign_keys=[actor_id],
        lazy="noload",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"<AuditLog id={self.id} action={self.action!r} "
            f"entity={self.entity_type}/{self.entity_id}>"
        )


# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------

class Notification(Base):
    """
    In-app / push notification sent to a user.

    ``data`` is an arbitrary JSONB payload forwarded to the push provider
    (FCM / APNs) as the notification's data object, allowing the client to
    deep-link to the relevant screen.
    """

    __tablename__ = "notifications"

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )

    # ------------------------------------------------------------------
    # Recipient
    # ------------------------------------------------------------------
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ------------------------------------------------------------------
    # Notification content
    # ------------------------------------------------------------------
    type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment=(
            "Notification category, e.g. 'approval.pending', "
            "'approval.approved', 'streak.achieved'."
        ),
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Arbitrary key-value pairs forwarded to the push provider.",
    )

    # ------------------------------------------------------------------
    # Read state
    # ------------------------------------------------------------------
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the notification was dispatched to the push provider.",
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the user dismissed / read the notification.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped["User"] = relationship(
        "User",
        back_populates="notifications",
        lazy="noload",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"<Notification id={self.id} user_id={self.user_id} "
            f"type={self.type!r} read={self.is_read}>"
        )
