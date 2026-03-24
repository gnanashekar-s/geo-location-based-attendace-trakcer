"""
Locations (geofence sites) router.

Endpoints
---------
GET    /locations/              – list sites for current user's org
GET    /locations/{site_id}     – get site detail
POST   /locations/              – create site (org_admin+)
PATCH  /locations/{site_id}     – update site
DELETE /locations/{site_id}     – soft-delete site (set is_active=False)
GET    /locations/{site_id}/active-count – number of currently checked-in employees
"""

from __future__ import annotations

import json
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, get_redis, require_roles
from app.models.attendance import AttendanceRecord
from app.models.location import Site
from app.models.user import User, UserRole
from app.schemas.location import SiteCreate, SiteResponse, SiteUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/locations", tags=["Locations / Geofences"])

_GEOFENCE_CACHE_TTL = 600  # 10 minutes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _site_to_response(site: Site) -> SiteResponse:
    return SiteResponse(
        id=site.id,
        org_id=site.org_id,
        name=site.name,
        address=site.address,
        center_lat=site.center_lat,
        center_lng=site.center_lng,
        radius_meters=site.radius_meters,
        polygon=json.loads(site.polygon) if site.polygon else None,
        is_active=site.is_active,
        created_by=site.created_by,
        created_at=site.created_at,
        updated_at=site.updated_at,
    )


async def _invalidate_geofence_cache(site_id: UUID, redis) -> None:
    try:
        await redis.delete(f"geofence:{site_id}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not invalidate geofence cache for %s: %s", site_id, exc)


# ---------------------------------------------------------------------------
# GET /locations/
# ---------------------------------------------------------------------------


@router.get("/", response_model=List[SiteResponse], summary="List geofence sites")
async def list_sites(
    active_only: bool = Query(default=True),
    org_id: Optional[UUID] = Query(default=None, description="Filter by org (super_admin only)"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[SiteResponse]:
    """Return all geofence sites visible to the current user."""
    filters = []

    if active_only:
        filters.append(Site.is_active.is_(True))

    if current_user.role == UserRole.super_admin:
        if org_id:
            filters.append(Site.org_id == org_id)
    else:
        filters.append(Site.org_id == current_user.org_id)

    result = await db.execute(select(Site).where(and_(*filters)).order_by(Site.name))
    sites = result.scalars().all()
    return [_site_to_response(s) for s in sites]


# ---------------------------------------------------------------------------
# GET /locations/{site_id}
# ---------------------------------------------------------------------------


@router.get("/{site_id}", response_model=SiteResponse, summary="Get site detail")
async def get_site(
    site_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")
    if current_user.role != UserRole.super_admin and site.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    return _site_to_response(site)


# ---------------------------------------------------------------------------
# POST /locations/
# ---------------------------------------------------------------------------


@router.post(
    "/",
    response_model=SiteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new geofence site",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def create_site(
    payload: SiteCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> SiteResponse:
    org_id = payload.org_id if (current_user.role == UserRole.super_admin and payload.org_id) else current_user.org_id
    site = Site(
        org_id=org_id,
        name=payload.name,
        address=payload.address,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
        radius_meters=payload.radius_meters,
        polygon=json.dumps(payload.polygon) if payload.polygon else None,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)
    await _invalidate_geofence_cache(site.id, redis)
    logger.info("Site '%s' created (org=%s) by %s", site.name, org_id, current_user.email)
    return _site_to_response(site)


# ---------------------------------------------------------------------------
# PATCH /locations/{site_id}
# ---------------------------------------------------------------------------


@router.patch(
    "/{site_id}",
    response_model=SiteResponse,
    summary="Update geofence site",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def update_site(
    site_id: UUID,
    payload: SiteUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> SiteResponse:
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")
    if current_user.role != UserRole.super_admin and site.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    update_data = payload.model_dump(exclude_unset=True)
    if "polygon" in update_data:
        update_data["polygon"] = json.dumps(update_data["polygon"]) if update_data["polygon"] else None

    for field, value in update_data.items():
        setattr(site, field, value)

    await db.commit()
    await db.refresh(site)
    await _invalidate_geofence_cache(site_id, redis)
    logger.info("Site '%s' updated by %s", site.name, current_user.email)
    return _site_to_response(site)


# ---------------------------------------------------------------------------
# DELETE /locations/{site_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a geofence site",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def delete_site(
    site_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> None:
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")
    if current_user.role != UserRole.super_admin and site.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    site.is_active = False
    await db.commit()
    await _invalidate_geofence_cache(site_id, redis)
    logger.info("Site '%s' deactivated by %s", site.name, current_user.email)


# ---------------------------------------------------------------------------
# GET /locations/{site_id}/active-count
# ---------------------------------------------------------------------------


@router.get("/{site_id}/active-count", summary="Count employees currently checked in at site")
async def active_employee_count(
    site_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Returns the number of employees who have checked in today at this site
    but have not yet checked out.
    """
    from datetime import date, datetime, timezone

    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)

    checkins = await db.execute(
        select(func.count(AttendanceRecord.id)).where(
            and_(
                AttendanceRecord.site_id == site_id,
                AttendanceRecord.event_type == "checkin",
                AttendanceRecord.created_at >= today_start,
                AttendanceRecord.is_valid.is_(True),
            )
        )
    )
    checkouts = await db.execute(
        select(func.count(AttendanceRecord.id)).where(
            and_(
                AttendanceRecord.site_id == site_id,
                AttendanceRecord.event_type == "checkout",
                AttendanceRecord.created_at >= today_start,
            )
        )
    )
    count = max(0, (checkins.scalar_one() or 0) - (checkouts.scalar_one() or 0))
    return {"site_id": str(site_id), "active_count": count}
