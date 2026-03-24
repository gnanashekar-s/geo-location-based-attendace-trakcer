"""
Pydantic schemas for attendance check-in/out, breaks, manual approvals,
and fraud detection results.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CheckinRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="GPS latitude")
    lng: float = Field(..., ge=-180.0, le=180.0, description="GPS longitude")
    accuracy_meters: float = Field(..., gt=0.0, le=10_000.0, description="GPS accuracy in metres")
    device_fingerprint: str = Field(..., min_length=8, max_length=512)
    is_mock_location: bool = Field(default=False)
    photo_url: Optional[str] = Field(None, max_length=2048)
    ip_address: Optional[str] = Field(None, max_length=45)

    model_config = {
        "json_schema_extra": {
            "example": {
                "lat": 6.5244,
                "lng": 3.3792,
                "accuracy_meters": 12.5,
                "device_fingerprint": "a1b2c3d4e5f6",
                "is_mock_location": False,
                "photo_url": None,
                "ip_address": "102.89.0.1",
            }
        }
    }


class CheckoutRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    accuracy_meters: float = Field(..., gt=0.0, le=10_000.0)
    device_fingerprint: str = Field(..., min_length=8, max_length=512)
    is_mock_location: bool = Field(default=False)
    photo_url: Optional[str] = Field(None, max_length=2048)
    ip_address: Optional[str] = Field(None, max_length=45)

    model_config = {
        "json_schema_extra": {
            "example": {
                "lat": 6.5244,
                "lng": 3.3792,
                "accuracy_meters": 15.0,
                "device_fingerprint": "a1b2c3d4e5f6",
                "is_mock_location": False,
                "photo_url": None,
                "ip_address": "102.89.0.1",
            }
        }
    }


class BreakRequest(BaseModel):
    type: str = Field(..., pattern="^(start|end)$", description="'start' or 'end'")

    model_config = {"json_schema_extra": {"example": {"type": "start"}}}


class ManualApprovalRequest(BaseModel):
    site_id: UUID
    shift_id: Optional[UUID] = None
    reason_code: str = Field(
        ...,
        max_length=50,
        description="Short code e.g. FORGOT_CHECKIN, DEVICE_FAILURE, OFFSITE_WORK",
    )
    reason_text: str = Field(..., min_length=10, max_length=1000)
    photo_url: Optional[str] = Field(None, max_length=2048)

    model_config = {
        "json_schema_extra": {
            "example": {
                "site_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "shift_id": None,
                "reason_code": "FORGOT_CHECKIN",
                "reason_text": "I forgot to check in this morning due to a phone battery issue.",
                "photo_url": None,
            }
        }
    }


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class FraudResult(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0, description="Composite fraud score 0–1")
    flags: List[str] = Field(default_factory=list, description="List of triggered fraud flag codes")
    block: bool = Field(default=False, description="True if checkin should be auto-rejected")


class AttendanceRecord(BaseModel):
    id: UUID
    user_id: UUID
    site_id: Optional[UUID] = None
    event_type: str  # checkin | checkout | break_start | break_end
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_meters: Optional[float] = None
    photo_url: Optional[str] = None
    ip_address: Optional[str] = None
    fraud_score: Optional[float] = None
    fraud_flags: Optional[Dict[str, Any]] = None
    is_valid: bool = True
    is_manual: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class MarkSafeRequest(BaseModel):
    note: str = Field(default="", max_length=1000)


class UpcomingShiftResponse(BaseModel):
    shift_name: str
    site_name: str
    start_time: str  # HH:MM
    end_time: str    # HH:MM
    date: str        # ISO date YYYY-MM-DD
