"""
Site (geofence) model.

Each Site defines a physical location where attendance can be recorded.
The boundary is stored both as a simple centre + radius circle **and** as an
optional GeoJSON polygon string for complex boundaries.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
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
    from app.models.user import User
    from app.models.attendance import AttendanceRecord, Shift
    from app.models.approval import ManualApprovalRequest


class Site(Base):
    """
    A named physical location (geofence) belonging to an organisation.

    Geofence evaluation order:
    1. If ``polygon`` is provided, use the GeoJSON polygon.
    2. Otherwise fall back to the ``center_lat`` / ``center_lng`` + ``radius_meters`` circle.
    """

    __tablename__ = "sites"

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

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    address: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Geofence geometry (circular)
    # ------------------------------------------------------------------
    center_lat: Mapped[float] = mapped_column(
        Float(precision=10),
        nullable=False,
        comment="Latitude of the geofence centre (WGS-84).",
    )
    center_lng: Mapped[float] = mapped_column(
        Float(precision=10),
        nullable=False,
        comment="Longitude of the geofence centre (WGS-84).",
    )
    radius_meters: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=100,
        server_default="100",
        comment="Radius of the circular geofence in metres.",
    )

    # ------------------------------------------------------------------
    # Geofence geometry (polygon – optional override)
    # ------------------------------------------------------------------
    polygon: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment=(
            "GeoJSON string representing a polygon boundary. "
            "When present, takes precedence over the circular boundary."
        ),
    )

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
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
        back_populates="sites",
        lazy="selectin",
    )

    creator: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[created_by],
        lazy="noload",
    )

    attendance_records: Mapped[List["AttendanceRecord"]] = relationship(
        "AttendanceRecord",
        back_populates="site",
        lazy="noload",
    )

    shifts: Mapped[List["Shift"]] = relationship(
        "Shift",
        back_populates="site",
        lazy="noload",
    )

    approval_requests: Mapped[List["ManualApprovalRequest"]] = relationship(
        "ManualApprovalRequest",
        back_populates="site",
        lazy="noload",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"<Site id={self.id} name={self.name!r} "
            f"lat={self.center_lat} lng={self.center_lng}>"
        )
