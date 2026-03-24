"""
Pydantic schemas for user management.
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=200)
    role: str = Field(default="employee", pattern="^(super_admin|org_admin|supervisor|employee)$")
    org_id: Optional[UUID] = None
    supervisor_id: Optional[UUID] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "email": "employee@acme.com",
                "password": "securepass1",
                "full_name": "John Smith",
                "role": "employee",
                "org_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            }
        }
    }


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=200)
    avatar_url: Optional[str] = Field(None, max_length=2048)
    supervisor_id: Optional[UUID] = None
    is_active: Optional[bool] = None
    role: Optional[str] = Field(None, pattern="^(super_admin|org_admin|supervisor|employee)$")

    model_config = {"json_schema_extra": {"example": {"full_name": "John Updated", "avatar_url": "https://cdn.example.com/avatar.jpg"}}}


class UserProfile(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    role: str
    org_id: Optional[UUID] = None
    is_active: bool
    streak_count: int = 0
    avatar_url: Optional[str] = None
    supervisor_id: Optional[UUID] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: List[UserProfile]
    total: int
    skip: int
    limit: int
