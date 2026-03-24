"""
FastAPI dependency functions.

All dependencies are defined here so they can be imported in any router
without circular-import issues.

Available dependencies
----------------------
get_db                  – yields an AsyncSession
get_current_user        – decodes Bearer JWT, returns User ORM object
get_current_active_user – wraps get_current_user, enforces is_active=True
require_roles           – factory: enforces one of the given UserRole values
get_redis               – returns a connected redis.asyncio.Redis client
get_redis_client        – alias of get_redis (kept for backwards compat)
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import AsyncGenerator, Callable, Optional, Sequence

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.auth_service import verify_token

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HTTP Bearer security scheme
# ---------------------------------------------------------------------------

_bearer_scheme = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield a transactional AsyncSession.

    The session is committed on success and rolled back on any exception.
    This dependency is registered at the router level via ``Depends(get_db)``.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_redis_pool() -> aioredis.Redis:
    """
    Create a single shared Redis connection pool.

    ``lru_cache`` ensures the pool is initialised once per process.
    """
    return aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        max_connections=20,
    )


async def get_redis() -> aioredis.Redis:
    """Return the shared Redis client (no teardown needed for pool)."""
    return _get_redis_pool()


# Alias kept for backwards-compatibility
async def get_redis_client() -> aioredis.Redis:
    """Return the shared Redis client (alias of get_redis)."""
    return _get_redis_pool()


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _decode_token(token: str) -> dict:
    """
    Decode and validate a JWT token using verify_token from auth_service.

    Raises HTTPException 401 on any validation failure.
    Returns a dict with at least a ``sub`` key holding the user_id.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token_data = verify_token(token)
        # Normalise to a plain dict so downstream code can use payload.get("sub")
        return {"sub": token_data.user_id, "role": token_data.role, "org_id": token_data.org_id}
    except JWTError as exc:
        logger.debug("JWT validation failed: %s", exc)
        raise credentials_exception from exc
    except Exception as exc:  # noqa: BLE001
        logger.debug("Token decode error: %s", exc)
        raise credentials_exception from exc


async def _get_user_from_payload(
    payload: dict,
    db: AsyncSession,
) -> User:
    """
    Look up the User identified by the ``sub`` claim in the JWT payload.

    Raises HTTPException 401 if the user is not found.
    """
    user_id: Optional[str] = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing 'sub' claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user: Optional[User] = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Decode the Bearer token from the Authorization header and return the
    corresponding User ORM instance.

    Raises 401 when:
    - No Authorization header is present.
    - The token is malformed or expired.
    - The user referenced by the token does not exist.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _decode_token(credentials.credentials)
    return await _get_user_from_payload(payload, db)


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Extend get_current_user with an is_active check.

    Raises 403 when the account has been deactivated.
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Please contact your administrator.",
        )
    return current_user


# ---------------------------------------------------------------------------
# Role-based access control
# ---------------------------------------------------------------------------

def require_roles(*roles: UserRole) -> Callable:
    """
    Dependency factory that enforces one of the specified roles.

    Returns a plain callable (not a Depends-wrapped object) so that callers
    can use it either directly as a parameter annotation or inside a
    ``dependencies=[Depends(require_roles(...))]`` list.

    Usage::

        # As a parameter dependency (function-signature style):
        @router.get("/admin/users")
        async def list_users(
            _: User = Depends(require_roles(UserRole.super_admin, UserRole.org_admin))
        ):
            ...

        # In the ``dependencies=`` list:
        @router.get("/admin/users",
                    dependencies=[Depends(require_roles(UserRole.super_admin))])
        async def list_users(): ...

    Raises 403 when the authenticated user's role is not in the provided list.
    """
    async def _check_roles(
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Insufficient permissions. Required role(s): "
                    f"{', '.join(r.value for r in roles)}."
                ),
            )
        return current_user

    # Give the inner function a meaningful name for OpenAPI operation IDs
    _check_roles.__name__ = f"require_roles_{'_'.join(r.value for r in roles)}"
    # Return the raw callable so callers can do Depends(require_roles(...))
    # without double-wrapping (require_roles no longer returns Depends() itself)
    return _check_roles


# ---------------------------------------------------------------------------
# WebSocket auth helper
# ---------------------------------------------------------------------------

async def get_current_user_ws(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Authenticate a WebSocket connection using a JWT passed as a query param.

    The client should connect with ``?token=<jwt>`` appended to the WS URL.

    Closes the WebSocket with code 1008 (policy violation) on auth failure.
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing authentication token.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    try:
        payload = _decode_token(token)
        user = await _get_user_from_payload(payload, db)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid authentication token.")
        raise

    if not user.is_active:
        await websocket.close(code=1008, reason="Account deactivated.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    return user
