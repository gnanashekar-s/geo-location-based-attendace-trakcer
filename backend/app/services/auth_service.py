"""
JWT authentication service.

Responsibilities:
- Create / verify access & refresh tokens (python-jose, HS256).
- Hash and verify passwords (passlib bcrypt).
- Authenticate users against the database.
- Store / revoke refresh tokens in Redis (7-day TTL).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.schemas.auth import TokenData

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

# Use bcrypt directly — passlib 1.7.4 is incompatible with bcrypt >= 4.x.

REDIS_REFRESH_PREFIX = "refresh:"


def hash_password(password: str) -> str:
    """Return a bcrypt hash of *password*."""
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches *hashed*."""
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT access token.

    Args:
        data: Payload dict. Must include at minimum ``sub`` (user_id str).
        expires_delta: Override default expiry. Defaults to
            ``settings.ACCESS_TOKEN_EXPIRE_MINUTES``.

    Returns:
        Encoded JWT string.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc), "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


async def create_refresh_token(user_id: str, redis: Redis) -> str:
    """
    Create a refresh token, store it in Redis with a 7-day TTL, and return it.

    The token value stored in Redis is the raw UUID so it can be looked up and
    revoked by ``revoke_refresh_token``.
    """
    token_id = str(uuid.uuid4())
    expire_seconds = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    redis_key = f"{REDIS_REFRESH_PREFIX}{token_id}"
    await redis.set(redis_key, user_id, ex=expire_seconds)
    logger.debug("Stored refresh token %s for user %s (TTL %ds)", token_id, user_id, expire_seconds)
    return token_id


async def revoke_refresh_token(token: str, redis: Redis) -> bool:
    """
    Delete a refresh token from Redis.

    Returns True if the token existed and was deleted.
    """
    deleted = await redis.delete(f"{REDIS_REFRESH_PREFIX}{token}")
    return deleted > 0


async def verify_refresh_token(token: str, redis: Redis) -> Optional[str]:
    """
    Validate a refresh token against Redis.

    Returns the associated user_id str if valid, or None.
    """
    redis_key = f"{REDIS_REFRESH_PREFIX}{token}"
    user_id = await redis.get(redis_key)
    if user_id is None:
        return None
    if isinstance(user_id, bytes):
        user_id = user_id.decode()
    return user_id


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------


def verify_token(token: str) -> TokenData:
    """
    Decode and validate a JWT access token.

    Raises:
        JWTError: If the token is invalid or expired.

    Returns:
        TokenData with user_id, role, org_id fields.
    """
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    user_id: Optional[str] = payload.get("sub")
    if user_id is None:
        raise JWTError("Token missing 'sub' claim")
    return TokenData(
        user_id=user_id,
        role=payload.get("role"),
        org_id=payload.get("org_id"),
    )


# ---------------------------------------------------------------------------
# Database authentication
# ---------------------------------------------------------------------------


async def authenticate_user(db: AsyncSession, email: str, password: str):
    """
    Fetch the user by email and verify the password.

    Returns the User ORM object on success, or None if authentication fails.
    """
    # Import here to avoid circular imports at module load time.
    from app.models.user import User  # type: ignore[attr-defined]

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalars().first()
    if user is None:
        logger.debug("authenticate_user: no user found for email=%s", email)
        return None
    if not verify_password(password, user.hashed_password):
        logger.debug("authenticate_user: wrong password for email=%s", email)
        return None
    if not user.is_active:
        logger.debug("authenticate_user: inactive user email=%s", email)
        return None
    return user
