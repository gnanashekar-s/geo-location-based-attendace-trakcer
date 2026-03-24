"""
Redis helper service.

Thin wrappers around redis.asyncio providing:
- JSON-aware get / set / delete.
- Geofence-specific helpers (get_geofence / set_geofence).
- Sliding-window rate limiting.
- Atomic counter with TTL.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

# Default TTL for geofence cache entries (10 minutes)
_GEOFENCE_TTL_SECONDS = 600
_GEOFENCE_KEY_PREFIX = "geofence:"


# ---------------------------------------------------------------------------
# Generic get / set / delete
# ---------------------------------------------------------------------------


async def get_cached(redis: Redis, key: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve a JSON-serialised dict from Redis.

    Returns None if the key does not exist or cannot be deserialised.
    """
    raw = await redis.get(key)
    if raw is None:
        return None
    try:
        payload = raw if isinstance(raw, str) else raw.decode("utf-8")
        return json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("get_cached: failed to decode key=%s: %s", key, exc)
        return None


async def set_cached(redis: Redis, key: str, value: Any, ttl: int) -> None:
    """
    Serialise *value* as JSON and store it under *key* with *ttl* seconds expiry.
    """
    try:
        payload = json.dumps(value, default=str)
        await redis.set(key, payload, ex=ttl)
    except (TypeError, ValueError) as exc:
        logger.error("set_cached: serialisation error for key=%s: %s", key, exc)
        raise


async def delete_cached(redis: Redis, key: str) -> bool:
    """
    Delete a key from Redis.

    Returns True if the key existed and was removed.
    """
    deleted = await redis.delete(key)
    return deleted > 0


# ---------------------------------------------------------------------------
# Geofence cache helpers
# ---------------------------------------------------------------------------


def _geofence_key(site_id: str) -> str:
    """Build the Redis key for a geofence entry."""
    return f"{_GEOFENCE_KEY_PREFIX}{site_id}"


async def get_geofence(redis: Redis, site_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve cached geofence data for *site_id*.

    Returns a dict with geofence configuration (e.g. lat, lng, radius_meters)
    or ``None`` if not cached.

    Args:
        redis:    Connected ``redis.asyncio.Redis`` client.
        site_id:  UUID string identifying the site.
    """
    return await get_cached(redis, _geofence_key(site_id))


async def set_geofence(
    redis: Redis,
    site_id: str,
    data: Dict[str, Any],
    ttl: int = _GEOFENCE_TTL_SECONDS,
) -> None:
    """
    Cache geofence data for *site_id*.

    Args:
        redis:    Connected ``redis.asyncio.Redis`` client.
        site_id:  UUID string identifying the site.
        data:     Dict with geofence fields (lat, lng, radius_meters, …).
        ttl:      Cache TTL in seconds (default 10 minutes).
    """
    await set_cached(redis, _geofence_key(site_id), data, ttl)


async def invalidate_geofence(redis: Redis, site_id: str) -> bool:
    """
    Remove cached geofence data for *site_id*.

    Returns True if the cache entry existed and was removed.
    """
    return await delete_cached(redis, _geofence_key(site_id))


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


async def rate_limit_check(
    redis: Redis,
    key: str,
    max_requests: int,
    window_seconds: int,
) -> bool:
    """
    Sliding-window rate limiter using a Redis counter.

    Increments the counter for *key*; sets TTL on first increment.

    Returns:
        True  — request is allowed (counter <= max_requests).
        False — request exceeds the limit.
    """
    count = await increment_counter(redis, key, ttl=window_seconds)
    return count <= max_requests


# ---------------------------------------------------------------------------
# Counter
# ---------------------------------------------------------------------------


async def increment_counter(redis: Redis, key: str, ttl: int) -> int:
    """
    Atomically increment an integer counter in Redis.

    Sets the TTL on the key only when it is first created so an existing
    window is not extended on each increment.

    Returns the new counter value.
    """
    pipe = redis.pipeline(transaction=True)
    await pipe.incr(key)
    # EXPIRE only if TTL is not already set (returns -1 when no expire is set)
    await pipe.expire(key, ttl, nx=True)
    results = await pipe.execute()
    count: int = results[0]
    return count
