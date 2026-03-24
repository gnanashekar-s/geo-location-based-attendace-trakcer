"""
Manual approval request model.

When an employee cannot check-in via GPS (indoors, no signal, etc.) they
submit a ManualApprovalRequest.  A supervisor or org-admin reviews it and
either approves, rejects, or escalates it.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.location import Site
    from app.models.attendance import AttendanceRecord, Shift


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class ReasonCode(str, enum.Enum):
    """Why GPS-based check-in was not possible."""

    no_gps = "no_gps"
    indoor = "indoor"
    other = "other"


class ApprovalStatus(str, enum.Enum):
    """Lifecycle state of a manual approval request."""

    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    escalated = "escalated"


# ---------------------------------------------------------------------------
# ManualApprovalRequest
# ---------------------------------------------------------------------------

class ManualApprovalRequest(Base):
    """
    Represents an employee's request to have attendance manually approved.

    Workflow:
    1. Employee submits request → status=pending, escalation_level=0
    2. Supervisor reviews within SLA → approved / rejected
    3. If SLA exceeded → Celery task bumps escalation_level and status=escalated,
       notifies org_admin
    """

    __tablename__ = "manual_approval_requests"

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
    # Foreign keys
    # ------------------------------------------------------------------
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    shift_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("shifts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Request details
    # ------------------------------------------------------------------
    reason_code: Mapped[ReasonCode] = mapped_column(
        Enum(ReasonCode, name="reason_code", create_type=True),
        nullable=False,
    )
    reason_text: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Free-text elaboration supplied by the employee.",
    )
    photo_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="URL of the supporting photo stored in MinIO.",
    )

    # ------------------------------------------------------------------
    # Review outcome
    # ------------------------------------------------------------------
    status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, name="approval_status", create_type=True),
        nullable=False,
        default=ApprovalStatus.pending,
        server_default=ApprovalStatus.pending.value,
        index=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    review_note: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Reviewer's comment when approving or rejecting.",
    )
    escalation_level: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment=(
            "Number of times this request has been escalated due to SLA breach. "
            "Level 0 = supervisor, 1 = org_admin, 2+ = super_admin."
        ),
    )

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped["User"] = relationship(
        "User",
        back_populates="approval_requests",
        foreign_keys=[user_id],
        lazy="selectin",
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="reviewed_approvals",
        foreign_keys=[reviewed_by],
        lazy="noload",
    )
    site: Mapped["Site"] = relationship(
        "Site",
        back_populates="approval_requests",
        lazy="selectin",
    )
    shift: Mapped[Optional["Shift"]] = relationship(
        "Shift",
        lazy="noload",
    )

    # Inverse side – the AttendanceRecord (if any) created from this approval
    attendance_record: Mapped[Optional["AttendanceRecord"]] = relationship(
        "AttendanceRecord",
        back_populates="approval",
        foreign_keys="AttendanceRecord.approval_id",
        lazy="noload",
        uselist=False,
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"<ManualApprovalRequest id={self.id} user_id={self.user_id} "
            f"status={self.status}>"
        )

    @property
    def is_pending(self) -> bool:
        return self.status == ApprovalStatus.pending

    @property
    def is_resolved(self) -> bool:
        return self.status in (ApprovalStatus.approved, ApprovalStatus.rejected)
