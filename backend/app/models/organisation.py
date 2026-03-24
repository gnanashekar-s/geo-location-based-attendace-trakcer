"""
Organisation model and FraudSensitivity enumeration.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, Enum, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.location import Site
    from app.models.attendance import Shift


class FraudSensitivity(str, enum.Enum):
    """
    Controls how aggressively the fraud-detection pipeline flags events.

    - low: only flag obvious anomalies (VPN, impossible travel)
    - medium: include mock-location, GPS drift heuristics
    - high: strict mode – include IP reputation, device trust score
    """

    low = "low"
    medium = "medium"
    high = "high"


class Organisation(Base):
    """
    Top-level tenant entity.

    Every user, site, shift, and attendance record belongs to an organisation.
    The slug is used in public-facing URLs and must be globally unique.
    """

    __tablename__ = "organisations"

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
    # Identity
    # ------------------------------------------------------------------
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
    )

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="UTC",
        server_default="UTC",
    )

    fraud_sensitivity: Mapped[FraudSensitivity] = mapped_column(
        Enum(FraudSensitivity, name="fraud_sensitivity", create_type=True),
        nullable=False,
        default=FraudSensitivity.medium,
        server_default=FraudSensitivity.medium.value,
    )

    approval_sla_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=30,
        server_default="30",
        comment=(
            "Maximum minutes a manual approval request may remain pending "
            "before it is automatically escalated."
        ),
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
    users: Mapped[List["User"]] = relationship(
        "User",
        back_populates="organisation",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    sites: Mapped[List["Site"]] = relationship(
        "Site",
        back_populates="organisation",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    shifts: Mapped[List["Shift"]] = relationship(
        "Shift",
        back_populates="organisation",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return f"<Organisation id={self.id} slug={self.slug!r}>"
