"""
Pydantic schemas for authentication flows.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)

    model_config = {"json_schema_extra": {"example": {"email": "user@example.com", "password": "secret123"}}}


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=200)
    org_id: Optional[UUID] = None
    role: Optional[str] = Field(default="employee", description="employee | supervisor | org_admin")

    model_config = {
        "json_schema_extra": {
            "example": {
                "email": "newuser@example.com",
                "password": "strongpassword",
                "full_name": "Jane Doe",
                "org_id": None,
            }
        }
    }


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: str
    org_id: Optional[str] = None
    is_active: bool
    streak_count: int = 0
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}


class TokenData(BaseModel):
    """Internal token payload decoded from JWT."""

    user_id: Optional[str] = None
    role: Optional[str] = None
    org_id: Optional[str] = None
