"""
FraudWhitelist model.

Records (user_id, device_fingerprint) pairs that have been explicitly
whitelisted by an admin. Whitelisted devices bypass all fraud scoring.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class FraudWhitelist(Base):
    """
    Explicitly whitelisted (user_id, device_fingerprint) pairs.

    When a matching entry exists, fraud_service.evaluate_checkin() returns
    FraudResult(score=0.0, flags=[], block=False) immediately.
    """

    __tablename__ = "fraud_whitelist"

    __table_args__ = (
        UniqueConstraint(
            "user_id", "device_fingerprint", name="uq_whitelist_user_device"
        ),
    )

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
    admin_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Device identifier + reason
    # ------------------------------------------------------------------
    device_fingerprint: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )

    # ------------------------------------------------------------------
    # Timestamp
    # ------------------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[user_id],
        lazy="selectin",
    )
    admin: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[admin_id],
        lazy="noload",
    )

    def __repr__(self) -> str:
        return (
            f"<FraudWhitelist id={self.id} user_id={self.user_id} "
            f"fingerprint={self.device_fingerprint!r}>"
        )
