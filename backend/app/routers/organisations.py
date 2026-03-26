"""
Organisations (and Sites) router.

Endpoints
---------
GET    /organisations/                            – list organisations (super_admin)
POST   /organisations/                            – create organisation
GET    /organisations/{org_id}                    – get organisation
PATCH  /organisations/{org_id}                    – update organisation
DELETE /organisations/{org_id}                    – delete organisation (super_admin)
GET    /organisations/{org_id}/sites              – list geofence sites
POST   /organisations/{org_id}/sites              – create site (admin)
PATCH  /organisations/{org_id}/sites/{site_id}   – update site
DELETE /organisations/{org_id}/sites/{site_id}   – delete site (soft)
"""

from __future__ import annotations

import json
import uuid
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_active_user, get_db, require_roles
from app.models.location import Site
from app.models.organisation import Organisation
from app.models.user import User, UserRole
from app.schemas.location import SiteCreate, SiteResponse, SiteUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/organisations", tags=["Organisations"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_org_or_404(org_id: uuid.UUID, db: AsyncSession) -> Organisation:
    result = await db.execute(select(Organisation).where(Organisation.id == org_id))
    org = result.scalars().first()
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
    return org


async def _get_site_or_404(site_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> Site:
    result = await db.execute(
        select(Site).where(and_(Site.id == site_id, Site.org_id == org_id))
    )
    site = result.scalars().first()
    if site is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")
    return site


def _site_to_schema(site: Site) -> SiteResponse:
    polygon = None
    if site.polygon:
        try:
            polygon = json.loads(site.polygon) if isinstance(site.polygon, str) else site.polygon
        except (json.JSONDecodeError, TypeError):
            polygon = None
    return SiteResponse(
        id=site.id,
        org_id=site.org_id,
        name=site.name,
        address=site.address or "",
        center_lat=site.center_lat,
        center_lng=site.center_lng,
        radius_meters=float(site.radius_meters),
        polygon=polygon,
        is_active=site.is_active,
        created_at=str(site.created_at) if site.created_at else None,
        updated_at=str(site.updated_at) if site.updated_at else None,
    )


# ---------------------------------------------------------------------------
# GET /organisations/
# ---------------------------------------------------------------------------


@router.get(
    "/",
    summary="List all organisations (super_admin only)",
    dependencies=[Depends(require_roles(UserRole.super_admin))],
)
async def list_organisations(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> List[dict]:
    result = await db.execute(
        select(Organisation).order_by(Organisation.created_at.desc()).offset(skip).limit(limit)
    )
    orgs = result.scalars().all()
    return [
        {
            "id": str(o.id),
            "name": o.name,
            "slug": o.slug,
            "timezone": o.timezone,
            "fraud_sensitivity": o.fraud_sensitivity.value,
            "created_at": str(o.created_at),
        }
        for o in orgs
    ]


# ---------------------------------------------------------------------------
# POST /organisations/
# ---------------------------------------------------------------------------


@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new organisation",
    dependencies=[Depends(require_roles(UserRole.super_admin, UserRole.org_admin))],
)
async def create_organisation(
    name: str,
    slug: Optional[str] = None,
    timezone: str = "UTC",
    fraud_sensitivity: str = "medium",
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Auto-generate slug from name if not provided
    if not slug:
        import re
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    existing = await db.execute(select(Organisation).where(Organisation.slug == slug))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Slug '{slug}' is already taken.",
        )

    from app.models.organisation import FraudSensitivity
    try:
        fs = FraudSensitivity(fraud_sensitivity)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid fraud_sensitivity '{fraud_sensitivity}'. Must be one of: low, medium, high.",
        )

    org = Organisation(
        id=uuid.uuid4(),
        name=name,
        slug=slug,
        timezone=timezone,
        fraud_sensitivity=fs,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "timezone": org.timezone,
        "fraud_sensitivity": org.fraud_sensitivity.value,
    }


# ---------------------------------------------------------------------------
# GET /organisations/{org_id}
# ---------------------------------------------------------------------------


@router.get("/{org_id}", summary="Get organisation details")
async def get_organisation(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    org = await _get_org_or_404(org_id, db)
    if current_user.role != UserRole.super_admin and current_user.org_id != org.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "timezone": org.timezone,
        "fraud_sensitivity": org.fraud_sensitivity.value,
        "approval_sla_minutes": org.approval_sla_minutes,
        "created_at": str(org.created_at),
        "updated_at": str(org.updated_at),
    }


# ---------------------------------------------------------------------------
# PATCH /organisations/{org_id}
# ---------------------------------------------------------------------------


@router.patch(
    "/{org_id}",
    summary="Update organisation settings (admin+)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def update_organisation(
    org_id: uuid.UUID,
    name: Optional[str] = None,
    timezone: Optional[str] = None,
    approval_sla_minutes: Optional[int] = None,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    org = await _get_org_or_404(org_id, db)
    if current_user.role == UserRole.org_admin and current_user.org_id != org.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    if name is not None:
        org.name = name
    if timezone is not None:
        org.timezone = timezone
    if approval_sla_minutes is not None:
        org.approval_sla_minutes = approval_sla_minutes
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return {"id": str(org.id), "name": org.name, "timezone": org.timezone}


# ---------------------------------------------------------------------------
# DELETE /organisations/{org_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an organisation (super_admin only)",
    dependencies=[Depends(require_roles(UserRole.super_admin))],
)
async def delete_organisation(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    org = await _get_org_or_404(org_id, db)
    await db.delete(org)
    await db.commit()
    logger.info("Organisation %s deleted.", org_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# GET /organisations/{org_id}/sites
# ---------------------------------------------------------------------------


@router.get("/{org_id}/sites", response_model=List[SiteResponse], summary="List geofence sites")
async def list_sites(
    org_id: uuid.UUID,
    active_only: bool = Query(default=True),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[SiteResponse]:
    if current_user.role != UserRole.super_admin and current_user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    filters = [Site.org_id == org_id]
    if active_only:
        filters.append(Site.is_active.is_(True))

    result = await db.execute(select(Site).where(and_(*filters)).order_by(Site.name))
    sites = result.scalars().all()
    return [_site_to_schema(s) for s in sites]


# ---------------------------------------------------------------------------
# POST /organisations/{org_id}/sites
# ---------------------------------------------------------------------------


@router.post(
    "/{org_id}/sites",
    response_model=SiteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a geofence site (admin)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def create_site(
    org_id: uuid.UUID,
    payload: SiteCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    await _get_org_or_404(org_id, db)
    if current_user.role == UserRole.org_admin and current_user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    polygon_str: Optional[str] = None
    if payload.polygon is not None:
        polygon_str = json.dumps(payload.polygon)

    site = Site(
        id=uuid.uuid4(),
        org_id=org_id,
        created_by=current_user.id,
        name=payload.name,
        address=payload.address,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
        radius_meters=int(payload.radius_meters),
        polygon=polygon_str,
        is_active=True,
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return _site_to_schema(site)


# ---------------------------------------------------------------------------
# PATCH /organisations/{org_id}/sites/{site_id}
# ---------------------------------------------------------------------------


@router.patch(
    "/{org_id}/sites/{site_id}",
    response_model=SiteResponse,
    summary="Update a geofence site (admin)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def update_site(
    org_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: SiteUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SiteResponse:
    site = await _get_site_or_404(site_id, org_id, db)
    if current_user.role == UserRole.org_admin and current_user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    update_data = payload.model_dump(exclude_unset=True)
    if "polygon" in update_data:
        raw_poly = update_data.pop("polygon")
        site.polygon = json.dumps(raw_poly) if raw_poly else None

    for field, value in update_data.items():
        if field == "radius_meters" and value is not None:
            value = int(value)
        setattr(site, field, value)

    db.add(site)
    await db.commit()
    await db.refresh(site)
    return _site_to_schema(site)


# ---------------------------------------------------------------------------
# DELETE /organisations/{org_id}/sites/{site_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{org_id}/sites/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Soft-delete a geofence site (admin)",
    dependencies=[Depends(require_roles(UserRole.org_admin, UserRole.super_admin))],
)
async def delete_site(
    org_id: uuid.UUID,
    site_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    site = await _get_site_or_404(site_id, org_id, db)
    if current_user.role == UserRole.org_admin and current_user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    site.is_active = False
    db.add(site)
    await db.commit()
    logger.info("Site %s soft-deleted by %s", site_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
