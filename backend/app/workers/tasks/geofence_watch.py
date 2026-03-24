"""
Celery task: Geofence Breach Detection.

Every 2 minutes Beat fires check_geofence_breaches().  The task:
  1. Fetches all active check-in events (event_type = checkin, most recent
     per user who has not yet checked out).
  2. For each session, reads the employee's last known GPS coordinates
     from Redis (key: geo:location:{user_id}).
  3. Calculates whether the point is inside the site's geofence using
     Shapely (polygon boundary if available, otherwise circular radius).
  4. If a breach is detected:
       - Publishes a real-time alert to the Redis pub/sub channel
         "ws:feed" so connected admin WebSocket clients are notified.
       - Sends an FCM push notification to the employee and their supervisor.
       - Sets a cooldown key (1 h) to avoid repeated notifications.

Model notes (actual schema):
  - AttendanceRecord: event_type (EventType enum), user_id, site_id, lat, lng,
    created_at.  No status/breach fields exist on the model.
  - Site: center_lat, center_lng, radius_meters, polygon (GeoJSON string, optional),
    is_active, org_id.
  - User: supervisor_id (not manager_id), fcm_token attribute may or may not exist
    depending on the column being present — accessed via getattr with a default.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from typing import Optional

import redis as sync_redis
from celery import shared_task
from sqlalchemy import create_engine, select, func as sa_func
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Synchronous SQLAlchemy engine
# ---------------------------------------------------------------------------

_sync_engine = create_engine(
    settings.sync_database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
)
SyncSession: sessionmaker[Session] = sessionmaker(
    bind=_sync_engine, autoflush=False, autocommit=False, expire_on_commit=False
)

# ---------------------------------------------------------------------------
# Redis client (synchronous)
# ---------------------------------------------------------------------------

_redis_client: Optional[sync_redis.Redis] = None


def _get_redis() -> sync_redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = sync_redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    return _redis_client


# ---------------------------------------------------------------------------
# FCM helper
# ---------------------------------------------------------------------------


def _send_fcm(token: str, title: str, body: str, data: Optional[dict] = None) -> None:
    try:
        import firebase_admin  # noqa: PLC0415
        from firebase_admin import credentials, messaging  # noqa: PLC0415

        if not firebase_admin._apps:
            cred = credentials.Certificate(settings.FCM_CREDENTIALS_PATH)
            firebase_admin.initialize_app(cred)

        msg = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            token=token,
        )
        messaging.send(msg)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FCM send failed: %s", exc)


# ---------------------------------------------------------------------------
# Geofence check helpers
# ---------------------------------------------------------------------------


def _point_in_polygon(lat: float, lng: float, geojson: dict) -> bool:
    """
    Return True when the coordinate is inside the GeoJSON polygon geometry.
    Uses Shapely if available; returns True (fail-open) on any error.
    """
    try:
        from shapely.geometry import Point, shape  # noqa: PLC0415

        geofence_shape = shape(geojson)
        point = Point(lng, lat)  # GeoJSON uses (longitude, latitude)
        return geofence_shape.contains(point)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Geofence polygon check failed: %s", exc)
        return True  # fail-open


def _haversine_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _point_in_site(lat: float, lng: float, site: object) -> bool:
    """
    Return True when the coordinate is inside the site's geofence.

    Priority:
      1. If site.polygon is a non-empty GeoJSON string → use polygon check.
      2. Otherwise → circular check (haversine vs radius_meters).
    """
    polygon_str = getattr(site, "polygon", None)
    if polygon_str:
        try:
            geojson = json.loads(polygon_str)
            return _point_in_polygon(lat, lng, geojson)
        except (json.JSONDecodeError, Exception) as exc:
            logger.warning("Could not parse site polygon for site %s: %s", getattr(site, "id", "?"), exc)

    # Circular fallback
    center_lat = getattr(site, "center_lat", None)
    center_lng = getattr(site, "center_lng", None)
    radius = getattr(site, "radius_meters", settings.DEFAULT_GEOFENCE_RADIUS_METERS)
    if center_lat is None or center_lng is None:
        return True  # no geometry defined — fail-open
    dist = _haversine_distance_meters(lat, lng, center_lat, center_lng)
    return dist <= radius


# ---------------------------------------------------------------------------
# Main task
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.geofence_watch.check_geofence_breaches",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def check_geofence_breaches(self) -> dict:
    """
    For every currently checked-in employee, verify that their last known
    GPS position is still within their site's geofence.

    We identify "currently checked in" as: the most recent AttendanceRecord
    for a user has event_type == EventType.checkin (i.e. they have not yet
    checked out).

    Redis key schema
    ─────────────────
      geo:location:{user_id}   →  JSON {"lat": float, "lng": float, "ts": ISO8601}
      geo:breach:{user_id}:{site_id}  →  "1" with 1-hour TTL (cooldown to avoid
                                          repeated notifications for the same breach)
    """
    try:
        from app.models.attendance import AttendanceRecord, EventType  # noqa: PLC0415
        from app.models.location import Site  # noqa: PLC0415
        from app.models.user import User  # noqa: PLC0415
    except ImportError as exc:
        logger.error("Model import failed in geofence_watch: %s", exc)
        return {"checked": 0, "breaches": 0, "error": str(exc)}

    r = _get_redis()
    checked = 0
    breaches = 0

    with SyncSession() as session:
        try:
            # ── Find users whose last attendance event was a check-in ──────
            # Subquery: latest created_at per user
            latest_subq = (
                select(
                    AttendanceRecord.user_id,
                    sa_func.max(AttendanceRecord.created_at).label("max_created_at"),
                )
                .group_by(AttendanceRecord.user_id)
                .subquery()
            )

            # Join back to get the full record and filter for checkin events
            stmt = (
                select(AttendanceRecord, User, Site)
                .join(
                    latest_subq,
                    (latest_subq.c.user_id == AttendanceRecord.user_id)
                    & (latest_subq.c.max_created_at == AttendanceRecord.created_at),
                )
                .join(User, User.id == AttendanceRecord.user_id)
                .join(Site, Site.id == AttendanceRecord.site_id)
                .where(
                    AttendanceRecord.event_type == EventType.checkin,
                    Site.is_active.is_(True),
                    User.is_active.is_(True),
                )
            )
            results = session.execute(stmt).all()
            logger.info(
                "Geofence watch: checking %d currently checked-in employees",
                len(results),
            )

            for attendance, user, site in results:
                checked += 1

                # ── Read last known coordinates from Redis ─────────────────
                location_key = f"geo:location:{user.id}"
                location_raw = r.get(location_key)
                if not location_raw:
                    # No cached position available — skip silently
                    continue

                try:
                    location = json.loads(location_raw)
                    lat: float = float(location["lat"])
                    lng: float = float(location["lng"])
                except (KeyError, ValueError, json.JSONDecodeError) as exc:
                    logger.warning(
                        "Invalid location data for user %s: %s", user.id, exc
                    )
                    continue

                # ── Check geofence ─────────────────────────────────────────
                inside = _point_in_site(lat, lng, site)
                if inside:
                    continue

                # ── Breach detected ────────────────────────────────────────
                breach_key = f"geo:breach:{user.id}:{site.id}"
                if r.exists(breach_key):
                    # Already alerted within the last hour — skip
                    continue

                breaches += 1
                logger.warning(
                    "Geofence breach: user=%s site=%s lat=%.6f lng=%.6f",
                    user.id,
                    site.id,
                    lat,
                    lng,
                )

                # Set cooldown key (1 hour) to avoid notification spam
                r.setex(breach_key, 3600, "1")

                # Publish real-time alert to WebSocket feed
                alert_payload = json.dumps(
                    {
                        "event": "geofence_breach",
                        "user_id": str(user.id),
                        "user_name": user.full_name,
                        "attendance_id": str(attendance.id),
                        "lat": lat,
                        "lng": lng,
                        "site_id": str(site.id),
                        "site_name": site.name,
                        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                    }
                )
                r.publish("ws:feed", alert_payload)

                # FCM to employee (fcm_token may not exist on all deployments)
                employee_token = getattr(user, "fcm_token", None)
                if employee_token:
                    _send_fcm(
                        token=employee_token,
                        title="Geofence Alert",
                        body=(
                            f"You appear to have left the designated work area "
                            f"({site.name}). Please return or contact your supervisor."
                        ),
                        data={
                            "type": "GEOFENCE_BREACH",
                            "attendance_id": str(attendance.id),
                            "site_id": str(site.id),
                        },
                    )

                # FCM to supervisor if available
                supervisor: Optional[User] = _get_supervisor(session, user, User)
                if supervisor:
                    supervisor_token = getattr(supervisor, "fcm_token", None)
                    if supervisor_token:
                        _send_fcm(
                            token=supervisor_token,
                            title="Employee Geofence Alert",
                            body=(
                                f"{user.full_name} has left the designated work area "
                                f"({site.name})."
                            ),
                            data={
                                "type": "EMPLOYEE_GEOFENCE_BREACH",
                                "user_id": str(user.id),
                                "attendance_id": str(attendance.id),
                            },
                        )

            session.commit()

        except Exception as exc:
            session.rollback()
            logger.exception("Geofence watch task failed: %s", exc)
            raise self.retry(exc=exc)

    return {"checked": checked, "breaches": breaches}


# ---------------------------------------------------------------------------
# Helper: resolve supervisor
# ---------------------------------------------------------------------------


def _get_supervisor(session: Session, user: object, User: type) -> Optional[object]:
    """Return the user's supervisor, or None if not set or on any error."""
    try:
        supervisor_id = getattr(user, "supervisor_id", None)
        if not supervisor_id:
            return None
        return session.get(User, supervisor_id)
    except Exception:  # noqa: BLE001
        return None
