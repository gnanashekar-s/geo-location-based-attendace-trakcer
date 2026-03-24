"""
Pydantic schemas for analytics and reporting endpoints.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class SummaryResponse(BaseModel):
    total_present: int = 0
    total_late: int = 0
    total_absent: int = 0
    pending_approvals: int = 0
    total_employees: int = 0
    anomaly_count: int = 0
    date: Optional[str] = None  # ISO date string e.g. "2026-03-22"


class HeatmapPoint(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    weight: float = Field(..., ge=0.0, description="Relative weight/density for heatmap rendering")


class TrendPoint(BaseModel):
    date: date
    present_count: int = 0
    late_count: int = 0
    absent_count: int = 0


class AnomalyRecord(BaseModel):
    attendance_id: UUID
    user_id: UUID
    user_name: str
    fraud_score: float
    fraud_flags: List[str] = Field(default_factory=list)
    created_at: datetime

    model_config = {"from_attributes": True}
