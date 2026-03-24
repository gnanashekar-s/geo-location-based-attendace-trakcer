"""
Geofence service.

Provides:
- Haversine distance calculation.
- Point-in-radius check.
- Point-in-polygon check (Shapely).
- Redis-cached site lookup.
- Combined geofence evaluation.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any, Dict, Optional

from redis.asyncio import Redis
from shapely.geometry import Point, shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_SITE_CACHE_TTL = 600  # 10 minutes


# ---------------------------------------------------------------------------
# Distance helpers
# ---------------------------------------------------------------------------


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Return the great-circle distance in **kilometres** between two points.

    Uses the Haversine formula. Coordinates are in decimal degrees.
    """
    R = 6_371.0  # Earth's mean radius in km

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_within_radius(
    lat: float,
    lng: float,
    center_lat: float,
    center_lng: float,
    radius_meters: float,
) -> bool:
    """Return True if the point (lat, lng) lies within *radius_meters* of the centre."""
    distance_km = haversine_distance(lat, lng, center_lat, center_lng)
    return (distance_km * 1000) < radius_meters


def check_within_polygon(lat: float, lng: float, geojson_polygon: Dict[str, Any]) -> bool:
    """
    Return True if the point lies within the GeoJSON polygon/multipolygon.

    ``geojson_polygon`` should be a dict with keys ``type`` and ``coordinates``
    conforming to the GeoJSON spec (RFC 7946).
    """
    try:
        polygon = shape(geojson_polygon)
        point = Point(lng, lat)  # GeoJSON uses (lon, lat) ordering
        return polygon.contains(point)
    except Exception as exc:  # noqa: BLE001
        logger.warning("check_within_polygon error: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Site cache + DB lookup
# ---------------------------------------------------------------------------


async def get_site_geofence(site_id: str, redis: Redis, db: AsyncSession):
    """
    Return the Site ORM object for *site_id*, using Redis as a 10-minute cache.

    Raises:
        ValueError: If the site is not found.
    """
    from app.models.location import Site  # type: ignore[attr-defined]

    cache_key = f"geofence:{site_id}"
    cached_raw = await redis.get(cache_key)
    if cached_raw is not None:
        # We cached the site as JSON; reconstruct a lightweight dict so callers
        # can still access the same attributes via attribute access on a namespace.
        data = json.loads(cached_raw if isinstance(cached_raw, str) else cached_raw.decode())
        # Return a simple object with attribute access
        return _SiteProxy(data)

    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalars().first()
    if site is None:
        raise ValueError(f"Site {site_id!r} not found")

    # Serialise to Redis
    site_data: Dict[str, Any] = {
        "id": str(site.id),
        "org_id": str(site.org_id),
        "name": site.name,
        "center_lat": site.center_lat,
        "center_lng": site.center_lng,
        "radius_meters": site.radius_meters,
        "polygon": site.polygon,
        "is_active": site.is_active,
    }
    await redis.set(cache_key, json.dumps(site_data), ex=_SITE_CACHE_TTL)
    return site


class _SiteProxy:
    """Lightweight attribute-access wrapper around a dict (for cached sites)."""

    def __init__(self, data: Dict[str, Any]) -> None:
        self.__dict__.update(data)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<_SiteProxy id={self.__dict__.get('id')}>"


# ---------------------------------------------------------------------------
# Combined evaluation
# ---------------------------------------------------------------------------


def check_within_geofence(lat: float, lng: float, site: Any) -> bool:
    """
    Return True if the point is within the site's geofence.

    Strategy:
    - If the site has a polygon, use the polygon check.
    - Otherwise fall back to the radius check.
    """
    polygon = getattr(site, "polygon", None)
    if polygon:
        if isinstance(polygon, str):
            try:
                polygon = json.loads(polygon)
            except (ValueError, TypeError):
                polygon = None
    if polygon:
        return check_within_polygon(lat, lng, polygon)

    return check_within_radius(lat, lng, site.center_lat, site.center_lng, site.radius_meters)


# Backward-compatible alias
is_within_geofence = check_within_geofence
