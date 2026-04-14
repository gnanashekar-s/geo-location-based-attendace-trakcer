"""
IPRule model — admin-defined IP/CIDR block or allow rules per organisation.

Rules are evaluated in evaluate_checkin() before external IP reputation
lookups. BLOCK rules immediately return score=1.0/block=True.
ALLOW rules suppress the external IP reputation check entirely.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IPRuleType(str, enum.Enum):
    block = "block"
    allow = "allow"


class IPRule(Base):
    __tablename__ = "ip_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organisations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    rule_type: Mapped[IPRuleType] = mapped_column(
        Enum(IPRuleType, name="ip_rule_type", create_type=True),
        nullable=False,
    )
    ip_cidr: Mapped[str] = mapped_column(String(50), nullable=False)
    reason: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return (
            f"<IPRule id={self.id} org_id={self.org_id} "
            f"type={self.rule_type} cidr={self.ip_cidr!r}>"
        )
