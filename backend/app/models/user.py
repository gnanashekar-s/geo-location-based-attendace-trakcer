"""
User model and UserRole enumeration.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.organisation import Organisation
    from app.models.attendance import AttendanceRecord, UserShift
    from app.models.device import Device
    from app.models.approval import ManualApprovalRequest
    from app.models.audit_log import AuditLog, Notification


class UserRole(str, enum.Enum):
    """Hierarchical roles within the system."""

    super_admin = "super_admin"   # Platform-level administrator
    org_admin = "org_admin"       # Organisation administrator
    supervisor = "supervisor"     # Team lead / supervisor
    employee = "employee"         # Regular field employee


class User(Base):
    """
    Represents an authenticated user of the system.

    Relationships:
    - belongs to one Organisation (org_id)
    - optionally reports to another User (supervisor_id)
    - has many Device records
    - has many AttendanceRecord entries
    - has many ManualApprovalRequest entries (as requestor and as reviewer)
    """

    __tablename__ = "users"

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

    supervisor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Identity / credentials
    # ------------------------------------------------------------------
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )
    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # ------------------------------------------------------------------
    # Role & status
    # ------------------------------------------------------------------
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", create_type=True),
        nullable=False,
        default=UserRole.employee,
        server_default=UserRole.employee.value,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    # ------------------------------------------------------------------
    # Profile
    # ------------------------------------------------------------------
    avatar_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Gamification / streaks
    # ------------------------------------------------------------------
    streak_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    last_checkin_date: Mapped[Optional[date]] = mapped_column(
        Date,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
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
    organisation: Mapped["Organisation"] = relationship(
        "Organisation",
        back_populates="users",
        lazy="selectin",
    )

    supervisor: Mapped[Optional["User"]] = relationship(
        "User",
        remote_side="User.id",
        foreign_keys=[supervisor_id],
        back_populates="subordinates",
        lazy="noload",
    )
    subordinates: Mapped[List["User"]] = relationship(
        "User",
        foreign_keys=[supervisor_id],
        back_populates="supervisor",
        lazy="noload",
    )

    devices: Mapped[List["Device"]] = relationship(
        "Device",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    attendance_records: Mapped[List["AttendanceRecord"]] = relationship(
        "AttendanceRecord",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
        foreign_keys="AttendanceRecord.user_id",
    )

    approval_requests: Mapped[List["ManualApprovalRequest"]] = relationship(
        "ManualApprovalRequest",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="ManualApprovalRequest.user_id",
        lazy="noload",
    )

    reviewed_approvals: Mapped[List["ManualApprovalRequest"]] = relationship(
        "ManualApprovalRequest",
        back_populates="reviewer",
        foreign_keys="ManualApprovalRequest.reviewed_by",
        lazy="noload",
    )

    user_shifts: Mapped[List["UserShift"]] = relationship(
        "UserShift",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    audit_logs: Mapped[List["AuditLog"]] = relationship(
        "AuditLog",
        back_populates="actor",
        foreign_keys="AuditLog.actor_id",
        lazy="noload",
    )

    notifications: Mapped[List["Notification"]] = relationship(
        "Notification",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.role}>"

    @property
    def is_admin(self) -> bool:
        return self.role in (UserRole.super_admin, UserRole.org_admin)

    @property
    def display_name(self) -> str:
        return self.full_name or self.email
