"""
Authentication router.

Endpoints
---------
POST /auth/register  – create a new user (and organisation if none specified)
POST /auth/login     – return access + refresh tokens
POST /auth/refresh   – exchange a refresh token for a new access token
POST /auth/logout    – revoke the refresh token stored in Redis
"""

from __future__ import annotations

import uuid
import logging
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db, get_redis
from app.models.organisation import Organisation
from app.models.user import User, UserRole
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    hash_password,
    revoke_refresh_token,
    verify_refresh_token,
)


# ---------------------------------------------------------------------------
# Inline schemas for password-reset flow
# ---------------------------------------------------------------------------

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    Create a new user.

    - If ``org_id`` is provided the user is added to that organisation.
    - If ``org_id`` is omitted a new organisation is auto-created using
      the user's email domain as the name.

    Raises 409 if the email is already registered.
    """
    # Check for duplicate email
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    org_id: Optional[uuid.UUID] = payload.org_id

    if org_id is None:
        # Auto-create an organisation from the email domain
        domain = payload.email.split("@")[-1]
        slug = domain.replace(".", "-") + "-" + str(uuid.uuid4())[:8]
        org = Organisation(
            id=uuid.uuid4(),
            name=domain,
            slug=slug,
        )
        db.add(org)
        await db.flush()
        org_id = org.id

    # Verify org exists when provided explicitly
    else:
        org_result = await db.execute(select(Organisation).where(Organisation.id == org_id))
        if org_result.scalars().first() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Organisation {org_id} not found.",
            )

    # Map requested role; only allow safe self-registration roles
    _ALLOWED_SELF_REGISTER_ROLES = {
        "employee": UserRole.employee,
        "supervisor": UserRole.supervisor,
        "org_admin": UserRole.org_admin,
    }
    requested_role = (payload.role or "employee").lower()
    assigned_role = _ALLOWED_SELF_REGISTER_ROLES.get(requested_role, UserRole.employee)

    user = User(
        id=uuid.uuid4(),
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        org_id=org_id,
        role=assigned_role,
        is_active=True,
        streak_count=0,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    logger.info("Registered new user %s (org=%s)", user.email, user.org_id)
    return UserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role.value,
        org_id=str(user.org_id),
        is_active=user.is_active,
        streak_count=user.streak_count,
        avatar_url=user.avatar_url,
    )


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and obtain JWT tokens",
)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> TokenResponse:
    """
    Validate credentials and return an access token + refresh token pair.

    Raises 401 on invalid credentials or inactive account.
    """
    user = await authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": str(user.id), "role": user.role.value, "org_id": str(user.org_id)}
    )
    refresh_token = await create_refresh_token(str(user.id), redis)

    logger.info("User %s logged in successfully.", user.email)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


# ---------------------------------------------------------------------------
# POST /auth/refresh
# ---------------------------------------------------------------------------


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh an access token using a refresh token",
)
async def refresh_token(
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> TokenResponse:
    """
    Exchange a valid refresh token for a new access token + refresh token pair.

    The old refresh token is revoked (single-use rotation).

    Raises 401 if the refresh token is invalid or expired.
    """
    user_id = await verify_refresh_token(payload.refresh_token, redis)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Revoke old refresh token (rotation)
    await revoke_refresh_token(payload.refresh_token, redis)

    # Load user for current role/org_id
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive.",
        )

    new_access = create_access_token(
        data={"sub": str(user.id), "role": user.role.value, "org_id": str(user.org_id)}
    )
    new_refresh = await create_refresh_token(str(user.id), redis)

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        token_type="bearer",
    )


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


@router.post(
    "/logout",
    summary="Revoke the current refresh token",
)
async def logout(
    payload: Optional[LogoutRequest] = None,
    redis=Depends(get_redis),
) -> dict:
    """
    Revoke a refresh token.  The associated access token will expire naturally.

    Returns 200 regardless of whether the token existed (idempotent).
    """
    if payload and payload.refresh_token:
        await revoke_refresh_token(payload.refresh_token, redis)
        logger.debug("Refresh token revoked: %s…", payload.refresh_token[:8])
    return {"message": "Logged out successfully."}


# ---------------------------------------------------------------------------
# POST /auth/forgot-password
# ---------------------------------------------------------------------------


@router.post(
    "/forgot-password",
    summary="Request a password reset email",
)
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> dict:
    """
    Generate a signed 15-minute reset token and send it via email (MailHog).
    Returns the same message regardless of whether the email exists
    to prevent user enumeration.
    """
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalars().first()

    if user and user.is_active:
        token = create_access_token(
            data={"sub": str(user.id), "purpose": "password_reset"},
            expires_delta=timedelta(minutes=15),
        )
        await redis.set(f"pwd_reset:{token}", str(user.id), ex=900)

        from app.services.notification_service import send_reset_email  # noqa: PLC0415
        await send_reset_email(user.email, token)
        logger.info("Password reset token generated for user %s", user.email)

    return {"message": "If an account with that email exists, a reset link has been sent."}


# ---------------------------------------------------------------------------
# POST /auth/reset-password
# ---------------------------------------------------------------------------


@router.post(
    "/reset-password",
    summary="Reset password using a token from the reset email",
)
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> dict:
    """
    Validate the reset token from Redis, update the user's password,
    and invalidate the token.
    """
    redis_key = f"pwd_reset:{payload.token}"
    user_id_bytes = await redis.get(redis_key)
    if user_id_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    # Verify JWT signature and purpose
    try:
        from jose import JWTError, jwt as _jwt  # noqa: PLC0415

        data = _jwt.decode(
            payload.token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if data.get("purpose") != "password_reset":
            raise ValueError("Wrong purpose")
        token_user_id = data.get("sub")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    result = await db.execute(select(User).where(User.id == token_user_id))
    user = result.scalars().first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not found or inactive.",
        )

    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 6 characters.",
        )

    user.hashed_password = hash_password(payload.new_password)
    db.add(user)
    await db.commit()

    await redis.delete(redis_key)
    logger.info("Password reset for user %s", user.email)

    return {"message": "Password reset successfully. Please log in with your new password."}
