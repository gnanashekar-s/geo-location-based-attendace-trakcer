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


# ─── Fraud Summary ────────────────────────────────────────────────────────────


class FraudFlagBreakdown(BaseModel):
    flag: str
    count: int


class TopRiskyUser(BaseModel):
    user_id: UUID
    full_name: str
    risk_level: str
    avg_fraud_score: float
    flag_count: int


class FraudSummaryResponse(BaseModel):
    total_flagged_today: int = 0
    flag_breakdown: List[FraudFlagBreakdown] = Field(default_factory=list)
    top_risky_users: List[TopRiskyUser] = Field(default_factory=list)
    high_risk_user_count: int = 0
    medium_risk_user_count: int = 0
    low_risk_user_count: int = 0


# ─── User Risk Profile ────────────────────────────────────────────────────────


class DailyFraudPoint(BaseModel):
    date: date
    avg_score: float
    event_count: int


class BehavioralBaseline(BaseModel):
    mean_checkin_hour: float
    std_hours: float
    sample_size: int


class UserRiskProfileResponse(BaseModel):
    user_id: UUID
    full_name: str
    risk_level: str
    thirty_day_history: List[DailyFraudPoint] = Field(default_factory=list)
    flag_frequency: List[FraudFlagBreakdown] = Field(default_factory=list)
    behavioral_baseline: BehavioralBaseline


# ─── Buddy Punch Incidents ────────────────────────────────────────────────────


class BuddyPunchUser(BaseModel):
    user_id: UUID
    full_name: str
    attendance_id: UUID
    lat: float
    lng: float
    timestamp: datetime


class BuddyPunchIncident(BaseModel):
    site_id: UUID
    site_name: str
    incident_time: datetime
    users: List[BuddyPunchUser]
    distance_meters: float


# ─── Investigation / Whitelist ────────────────────────────────────────────────


class InvestigateRequest(BaseModel):
    status: str = Field(..., pattern="^(investigating|resolved)$")
    note: str = Field(default="", max_length=1000)


class WhitelistDeviceRequest(BaseModel):
    user_id: UUID
    device_fingerprint: str = Field(..., min_length=8, max_length=512)
    reason: str = Field(..., min_length=5, max_length=1000)


class RadiusSuggestionResponse(BaseModel):
    site_id: UUID
    site_name: str
    current_radius_meters: float
    suggested_radius_meters: float
    sample_count: int
    confidence: str  # "high" (>=50 samples), "medium" (10-49), "low" (<10)


class DetectedScheduleEntry(BaseModel):
    user_id: UUID
    full_name: str
    expected_checkin_hour: Optional[float]
    expected_checkout_hour: Optional[float]
    schedule_confidence: Optional[float]
    risk_level: str


class DeptLeaderboardEntry(BaseModel):
    rank: int
    department: str
    total_employees: int
    checked_in: int
    attendance_rate: float  # 0–1
    late_count: int
    avg_fraud_score: float
