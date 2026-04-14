"""
Models package – importing every model here ensures SQLAlchemy's metadata
is fully populated before any ``create_all`` / Alembic autogenerate call.

Import order matters only to avoid circular-import issues; all cross-model
references are resolved via ``TYPE_CHECKING`` blocks inside each module.
"""

from app.models.organisation import Organisation, FraudSensitivity  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
from app.models.location import Site  # noqa: F401
from app.models.device import Device, DevicePlatform  # noqa: F401
from app.models.attendance import (  # noqa: F401
    AttendanceRecord,
    EventType,
    Shift,
    UserShift,
)
from app.models.approval import (  # noqa: F401
    ManualApprovalRequest,
    ApprovalStatus,
    ReasonCode,
)
from app.models.audit_log import AuditLog, Notification  # noqa: F401
from app.models.fraud_whitelist import FraudWhitelist  # noqa: F401
from app.models.ip_rule import IPRule, IPRuleType  # noqa: F401

__all__ = [
    # Organisation
    "Organisation",
    "FraudSensitivity",
    # User
    "User",
    "UserRole",
    # Location
    "Site",
    # Device
    "Device",
    "DevicePlatform",
    # Attendance
    "AttendanceRecord",
    "EventType",
    "Shift",
    "UserShift",
    # Approval
    "ManualApprovalRequest",
    "ApprovalStatus",
    "ReasonCode",
    # Audit / Notifications
    "AuditLog",
    "Notification",
    # Fraud
    "FraudWhitelist",
    # IP Rules
    "IPRule",
    "IPRuleType",
]
