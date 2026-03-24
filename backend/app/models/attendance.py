"""
Attendance models:

- AttendanceRecord  – individual check-in / check-out / break events
- Shift             – reusable shift template (start time, end time, days)
- UserShift         – assignment of a shift to a specific user with date range
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.location import Site
    from app.models.organisation import Organisation
    from app.models.device import Device
    from app.models.approval import ManualApprovalRequest


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class EventType(str, enum.Enum):
    """The type of attendance event being recorded."""

    checkin = "checkin"
    checkout = "checkout"
    break_start = "break_start"
    break_end = "break_end"


# ---------------------------------------------------------------------------
# AttendanceRecord
# ---------------------------------------------------------------------------

class AttendanceRecord(Base):
    """
    A single timestamped attendance event (check-in, check-out, or break).

    Fraud detection output is stored in ``fraud_score`` (0.0–1.0) and
    ``fraud_flags`` (a JSON object whose keys correspond to individual
    checks that were triggered, e.g. ``{"vpn_detected": true}``).
    """

    __tablename__ = "attendance_records"

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
    device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    approval_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("manual_approval_requests.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Event data
    # ------------------------------------------------------------------
    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, name="event_type", create_type=True),
        nullable=False,
    )

    # GPS coordinates at the time of the event
    lat: Mapped[float] = mapped_column(
        Float(precision=10),
        nullable=False,
    )
    lng: Mapped[float] = mapped_column(
        Float(precision=10),
        nullable=False,
    )
    accuracy_meters: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Reported GPS accuracy radius in metres.",
    )

    # Network identity
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45),   # IPv6-safe
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Fraud detection
    # ------------------------------------------------------------------
    fraud_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0.0",
        comment="Composite fraud probability [0.0, 1.0].",
    )
    fraud_flags: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="Map of individual fraud check keys to their boolean results.",
    )
    is_valid: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="False when fraud_score exceeds the org threshold.",
    )

    # ------------------------------------------------------------------
    # Workflow flags
    # ------------------------------------------------------------------
    is_manual: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="True when submitted as a manual attendance request.",
    )
    photo_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="URL of the selfie captured during check-in (stored in MinIO).",
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

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped["User"] = relationship(
        "User",
        back_populates="attendance_records",
        foreign_keys=[user_id],
        lazy="selectin",
    )
    site: Mapped["Site"] = relationship(
        "Site",
        back_populates="attendance_records",
        lazy="selectin",
    )
    shift: Mapped[Optional["Shift"]] = relationship(
        "Shift",
        back_populates="attendance_records",
        lazy="noload",
    )
    device: Mapped[Optional["Device"]] = relationship(
        "Device",
        back_populates="attendance_records",
        lazy="noload",
    )
    approval: Mapped[Optional["ManualApprovalRequest"]] = relationship(
        "ManualApprovalRequest",
        back_populates="attendance_record",
        foreign_keys=[approval_id],
        lazy="noload",
    )

    def __repr__(self) -> str:
        return (
            f"<AttendanceRecord id={self.id} user_id={self.user_id} "
            f"type={self.event_type} at={self.created_at}>"
        )


# ---------------------------------------------------------------------------
# Shift
# ---------------------------------------------------------------------------

class Shift(Base):
    """
    A reusable work-shift template scoped to an organisation and optionally a site.

    ``days_of_week`` uses ISO weekday numbers: 1=Monday … 7=Sunday.
    ``late_threshold_minutes`` is the grace period after ``start_time`` before
    a check-in is marked late.
    """

    __tablename__ = "shifts"

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
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organisations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    site_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Shift definition
    # ------------------------------------------------------------------
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    start_time: Mapped[time] = mapped_column(
        Time(timezone=False),
        nullable=False,
    )
    end_time: Mapped[time] = mapped_column(
        Time(timezone=False),
        nullable=False,
    )

    # ISO weekday array: [1,2,3,4,5] = Mon–Fri
    days_of_week: Mapped[List[int]] = mapped_column(
        ARRAY(Integer),
        nullable=False,
        default=list,
        server_default="{}",
    )

    late_threshold_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=15,
        server_default="15",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    organisation: Mapped["Organisation"] = relationship(
        "Organisation",
        back_populates="shifts",
        lazy="selectin",
    )
    site: Mapped[Optional["Site"]] = relationship(
        "Site",
        back_populates="shifts",
        lazy="noload",
    )
    user_shifts: Mapped[List["UserShift"]] = relationship(
        "UserShift",
        back_populates="shift",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    attendance_records: Mapped[List["AttendanceRecord"]] = relationship(
        "AttendanceRecord",
        back_populates="shift",
        lazy="noload",
    )

    def __repr__(self) -> str:
        return f"<Shift id={self.id} name={self.name!r}>"


# ---------------------------------------------------------------------------
# UserShift
# ---------------------------------------------------------------------------

class UserShift(Base):
    """
    Assignment of a Shift to a specific User for a given date range.

    ``effective_to`` may be NULL to indicate an open-ended assignment.
    """

    __tablename__ = "user_shifts"

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
    shift_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ------------------------------------------------------------------
    # Effective date range
    # ------------------------------------------------------------------
    effective_from: Mapped[date] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
    )
    effective_to: Mapped[Optional[date]] = mapped_column(
        DateTime(timezone=False),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped["User"] = relationship(
        "User",
        back_populates="user_shifts",
        lazy="selectin",
    )
    shift: Mapped["Shift"] = relationship(
        "Shift",
        back_populates="user_shifts",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<UserShift user_id={self.user_id} shift_id={self.shift_id} "
            f"from={self.effective_from} to={self.effective_to}>"
        )
