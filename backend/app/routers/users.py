"""
Users router.

Endpoints
---------
GET    /users/me           – current user profile
PATCH  /users/me           – update own profile
GET    /users/             – list users (admin/super_admin only)
POST   /users/             – create user (admin/super_admin only)
GET    /users/{user_id}    – get user detail (admin/super_admin only)
PATCH  /users/{user_id}    – update user (admin/super_admin only)
DELETE /users/{user_id}    – delete user (admin/super_admin only)
"""

from __future__ import annotations

import uuid
import logging
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case as sa_case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, require_roles
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserListResponse, UserProfile, UserUpdate
from app.services.auth_service import hash_password

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["Users"])


# ---------------------------------------------------------------------------
# GET /users/leaderboard
# ---------------------------------------------------------------------------


@router.get(
    "/leaderboard",
    summary="Top 10 performers by streak (any authenticated user)",
)
async def leaderboard(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Return top 10 active users ordered by streak, with punctuality %."""
    org_filter = (
        []
        if current_user.role == UserRole.super_admin
        else [User.org_id == current_user.org_id]
    )

    result = await db.execute(
        select(User)
        .where(User.is_active.is_(True), *org_filter)
        .order_by(User.streak_count.desc())
        .limit(10)
    )
    users = result.scalars().all()
    if not users:
        return []

    user_ids = [u.id for u in users]

    # Bulk punctuality calculation for this month
    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    month_end = (
        datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc)
        if today.month < 12
        else datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
    )

    from app.models.attendance import AttendanceRecord as AttLog, EventType  # noqa: PLC0415

    stats_result = await db.execute(
        select(
            AttLog.user_id,
            func.count().label("total"),
            func.sum(
                sa_case((func.extract("hour", AttLog.created_at) < 9, 1), else_=0)
            ).label("on_time"),
        )
        .where(
            AttLog.user_id.in_(user_ids),
            AttLog.event_type == EventType.checkin,
            AttLog.created_at >= month_start,
            AttLog.created_at < month_end,
        )
        .group_by(AttLog.user_id)
    )
    stats_map = {row.user_id: row for row in stats_result.all()}

    items = []
    for u in users:
        row = stats_map.get(u.id)
        total = int(row.total) if row else 0
        on_time = int(row.on_time) if (row and row.on_time) else 0
        punctuality = round((on_time / max(total, 1)) * 100, 1)
        items.append(
            {
                "id": str(u.id),
                "full_name": u.full_name,
                "streak_count": u.streak_count or 0,
                "punctuality_percentage": punctuality,
            }
        )
    return items


# ---------------------------------------------------------------------------
# GET /users/me
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=UserProfile,
    summary="Get the current authenticated user's profile",
)
async def get_me(current_user: User = Depends(get_current_active_user)) -> UserProfile:
    return UserProfile.model_validate(current_user)


# ---------------------------------------------------------------------------
# PATCH /users/me
# ---------------------------------------------------------------------------


@router.patch(
    "/me",
    response_model=UserProfile,
    summary="Update the current user's profile",
)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return UserProfile.model_validate(current_user)


# ---------------------------------------------------------------------------
# GET /users/  (admin+)
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=UserListResponse,
    summary="List users (admin only)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def list_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    org_id: Optional[uuid.UUID] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserListResponse:
    """
    Paginated list of users.

    - ``super_admin`` can filter by any org or see all users.
    - ``org_admin`` is restricted to their own organisation.
    """
    filters = []

    if current_user.role == UserRole.super_admin:
        if org_id is not None:
            filters.append(User.org_id == org_id)
    else:
        # org_admin can only see own org
        filters.append(User.org_id == current_user.org_id)

    count_result = await db.execute(
        select(func.count(User.id)).where(and_(*filters) if filters else True)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(User)
        .where(and_(*filters) if filters else True)
        .order_by(User.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    users = result.scalars().all()

    return UserListResponse(
        items=[UserProfile.model_validate(u) for u in users],
        total=total,
        skip=skip,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# POST /users/  (admin+)
# ---------------------------------------------------------------------------


@router.post(
    "/",
    response_model=UserProfile,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new user (admin only)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    # Prevent org_admin from creating users in other orgs
    target_org_id = payload.org_id or current_user.org_id
    if current_user.role == UserRole.org_admin and target_org_id != current_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only create users within your own organisation.",
        )

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered.",
        )

    role = UserRole(payload.role) if payload.role else UserRole.employee
    user = User(
        id=uuid.uuid4(),
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        org_id=target_org_id,
        role=role,
        supervisor_id=payload.supervisor_id,
        is_active=True,
        streak_count=0,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserProfile.model_validate(user)


# ---------------------------------------------------------------------------
# GET /users/{user_id}  (admin+)
# ---------------------------------------------------------------------------


@router.get(
    "/{user_id}",
    response_model=UserProfile,
    summary="Get a user by ID (admin only)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if current_user.role == UserRole.org_admin and user.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    return UserProfile.model_validate(user)


# ---------------------------------------------------------------------------
# PATCH /users/{user_id}  (admin+)
# ---------------------------------------------------------------------------


@router.patch(
    "/{user_id}",
    response_model=UserProfile,
    summary="Update a user (admin only)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if current_user.role == UserRole.org_admin and user.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserProfile.model_validate(user)


# ---------------------------------------------------------------------------
# DELETE /users/{user_id}  (admin+)
# ---------------------------------------------------------------------------


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete a user (admin only)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def delete_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if current_user.role == UserRole.org_admin and user.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    await db.delete(user)
    await db.commit()
    logger.info("User %s deleted by %s", user_id, current_user.id)
