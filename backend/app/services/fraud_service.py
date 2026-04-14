"""
Fraud detection service.

Checks performed:
 1. Mock location flag from device.
 2. GPS accuracy threshold.
 3. IP reputation via IPQualityScore API (fallback: ip-api.com).
 3b. IP-GPS country mismatch.
 4. Impossible travel (speed > 900 km/h vs last checkin).
 5. Device fingerprint known/trusted status.
 6. Coordinate replay / fixed-spoof detection.
 7. Time-of-day behavioral anomaly.
 8. Rapid re-checkin (< 2 minutes since last checkout).
 9. Excessive daily check-ins (>= 6 events today).
10. Buddy-punching proximity detection.

Results are aggregated into a FraudResult with a composite score.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from redis.asyncio import Redis
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.attendance import CheckinRequest, FraudResult
from app.services.geo_service import haversine_distance

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_IP_CACHE_TTL = 3600          # 1 hour
_GEO_CACHE_TTL = 86400        # 24 hours
_IMPOSSIBLE_TRAVEL_SPEED_KMPH = 900.0
_HIGH_ACCURACY_THRESHOLD_METERS = 100.0


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class IPReputationResult:
    is_vpn: bool = False
    is_proxy: bool = False
    is_tor: bool = False
    fraud_score: float = 0.0
    country_code: str = ""
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return False


async def _ipqs_lookup(ip: str, api_key: str) -> IPReputationResult:
    url = f"https://www.ipqualityscore.com/api/json/ip/{api_key}/{ip}"
    params = {"strictness": 1, "allow_public_access_points": True}
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    result = IPReputationResult(
        is_vpn=bool(data.get("vpn", False)),
        is_proxy=bool(data.get("proxy", False)),
        is_tor=bool(data.get("tor", False)),
        fraud_score=float(data.get("fraud_score", 0)) / 100.0,
        raw=data,
    )
    result.country_code = str(data.get("country_code", ""))
    return result


async def _ipapi_lookup(ip: str) -> IPReputationResult:
    url = f"http://ip-api.com/json/{ip}?fields=status,proxy,hosting,countryCode"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    is_proxy = bool(data.get("proxy", False))
    is_hosting = bool(data.get("hosting", False))
    result = IPReputationResult(
        is_vpn=is_hosting,
        is_proxy=is_proxy,
        is_tor=False,
        fraud_score=0.5 if (is_proxy or is_hosting) else 0.0,
        raw=data,
    )
    result.country_code = data.get("countryCode", "")
    return result


async def _get_gps_country(lat: float, lng: float, redis: Redis) -> str:
    """Return ISO country code for (lat, lng). Cached 24h. Rounds to 2dp (~1km)."""
    lat_r = round(lat, 2)
    lng_r = round(lng, 2)
    cache_key = f"geo:country:{lat_r}:{lng_r}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return cached if isinstance(cached, str) else cached.decode()
    try:
        url = f"http://ip-api.com/json/?lat={lat_r}&lon={lng_r}&fields=countryCode,status"
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        code = data.get("countryCode", "") if data.get("status") == "success" else ""
    except Exception as exc:
        logger.warning("GPS country lookup failed for (%.2f, %.2f): %s", lat, lng, exc)
        code = ""
    if code:
        await redis.set(cache_key, code, ex=_GEO_CACHE_TTL)
    return code


async def _fetch_recent_records(user_id: str, db: AsyncSession, limit: int = 30) -> list:
    """Single DB query for last N check-in+checkout events. Powers 4 behavioral checks."""
    from app.models.attendance import AttendanceRecord as AR, EventType  # noqa: PLC0415

    result = await db.execute(
        select(AR)
        .where(
            AR.user_id == user_id,
            AR.event_type.in_([EventType.checkin, EventType.checkout]),
        )
        .order_by(desc(AR.created_at))
        .limit(limit)
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# IP reputation
# ---------------------------------------------------------------------------


async def check_ip_reputation(
    ip: str,
    redis: Redis,
    ipqs_api_key: str = "",
) -> IPReputationResult:
    """
    Return IP reputation data for *ip*.

    Primary source: IPQualityScore API (requires *ipqs_api_key*).
    Fallback: ip-api.com (free, limited fields).
    Results are cached in Redis for 1 hour.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return IPReputationResult()

    cache_key = f"ip_rep:{ip}"
    cached = await redis.get(cache_key)
    if cached is not None:
        data = json.loads(cached if isinstance(cached, str) else cached.decode())
        return IPReputationResult(**data)

    result = IPReputationResult()
    try:
        if ipqs_api_key:
            result = await _ipqs_lookup(ip, ipqs_api_key)
        else:
            result = await _ipapi_lookup(ip)
    except Exception as exc:  # noqa: BLE001
        logger.warning("IP reputation lookup failed for %s: %s", ip, exc)

    await redis.set(
        cache_key,
        json.dumps(
            {
                "is_vpn": result.is_vpn,
                "is_proxy": result.is_proxy,
                "is_tor": result.is_tor,
                "fraud_score": result.fraud_score,
                "country_code": result.country_code,
                "raw": result.raw,
            }
        ),
        ex=_IP_CACHE_TTL,
    )
    return result


# ---------------------------------------------------------------------------
# Impossible travel
# ---------------------------------------------------------------------------


async def check_impossible_travel(
    user_id: str,
    lat: float,
    lng: float,
    db: AsyncSession,
) -> tuple[bool, float]:
    """
    Compare the new checkin location against the most recent checkin.

    Returns:
        (is_impossible, speed_kmph) — is_impossible is True when the calculated
        speed between the last checkin and this one exceeds 900 km/h.
    """
    from app.models.attendance import AttendanceRecord as AttendanceLog, EventType  # noqa: PLC0415

    result = await db.execute(
        select(AttendanceLog)
        .where(
            AttendanceLog.user_id == user_id,
            AttendanceLog.event_type == EventType.checkin,
        )
        .order_by(desc(AttendanceLog.created_at))
        .limit(1)
    )
    last = result.scalars().first()
    if last is None or last.lat is None or last.lng is None:
        return False, 0.0

    distance_km = haversine_distance(last.lat, last.lng, lat, lng)
    now = datetime.now(timezone.utc)
    last_time = last.created_at
    if last_time.tzinfo is None:
        last_time = last_time.replace(tzinfo=timezone.utc)
    elapsed_hours = max((now - last_time).total_seconds() / 3600.0, 1e-6)
    speed_kmph = distance_km / elapsed_hours

    is_impossible = speed_kmph > _IMPOSSIBLE_TRAVEL_SPEED_KMPH
    if is_impossible:
        logger.warning(
            "Impossible travel detected for user %s: %.1f km/h", user_id, speed_kmph
        )
    return is_impossible, speed_kmph


# ---------------------------------------------------------------------------
# Device fingerprint
# ---------------------------------------------------------------------------


async def check_device_fingerprint(
    user_id: str,
    fingerprint: str,
    db: AsyncSession,
) -> tuple[bool, bool]:
    """
    Check whether the device fingerprint is known and trusted.

    Returns:
        (is_known, is_trusted)
        - is_known: fingerprint has been seen for this user before.
        - is_trusted: explicitly marked trusted in the DB.
    """
    from app.models.device import Device  # noqa: PLC0415

    result = await db.execute(
        select(Device).where(
            Device.user_id == user_id,
            Device.device_fingerprint == fingerprint,
        )
    )
    device = result.scalars().first()
    if device is None:
        return False, False
    return True, bool(getattr(device, "is_trusted", False))


# ---------------------------------------------------------------------------
# Behavioral checks (synchronous, operate on pre-fetched record list)
# ---------------------------------------------------------------------------


def check_coordinate_replay(recent_records: list, lat: float, lng: float) -> bool:
    """True if >= 8 of last 10 check-ins are within ±0.00005° (5.5 m). Requires >= 10 records."""
    from app.models.attendance import EventType  # noqa: PLC0415

    checkins = [r for r in recent_records if r.event_type == EventType.checkin]
    if len(checkins) < 10:
        return False
    last_10 = checkins[:10]
    matches = sum(
        1 for r in last_10
        if r.lat is not None and r.lng is not None
        and abs(r.lat - lat) < 0.00005
        and abs(r.lng - lng) < 0.00005
    )
    return matches >= 8


def check_time_anomaly(recent_records: list, current_hour: int) -> bool:
    """True if current_hour is > 3 std devs from user's historical check-in hour mean. Requires >= 10 records."""
    from app.models.attendance import EventType  # noqa: PLC0415
    import statistics as _stats  # noqa: PLC0415

    checkin_hours = [
        r.created_at.hour for r in recent_records
        if r.event_type == EventType.checkin and r.created_at is not None
    ]
    if len(checkin_hours) < 10:
        return False
    mean = _stats.mean(checkin_hours)
    std = _stats.pstdev(checkin_hours)
    std = max(std, 0.5)
    return abs(current_hour - mean) > 3 * std


def check_rapid_recheckin(recent_records: list) -> bool:
    """True if most recent checkout was less than 120 seconds ago."""
    from app.models.attendance import EventType  # noqa: PLC0415

    now = datetime.now(timezone.utc)
    for r in recent_records:
        if r.event_type == EventType.checkout and r.created_at is not None:
            last_time = r.created_at
            if last_time.tzinfo is None:
                last_time = last_time.replace(tzinfo=timezone.utc)
            if (now - last_time).total_seconds() < 120:
                return True
            break
    return False


def check_excessive_daily_checkins(recent_records: list) -> bool:
    """True if >= 6 attendance events today (3 full in/out cycles = suspicious)."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_events = [
        r for r in recent_records
        if r.created_at is not None and (
            r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        ) >= today_start
    ]
    return len(today_events) >= 6


# ---------------------------------------------------------------------------
# Buddy punching
# ---------------------------------------------------------------------------


async def check_buddy_punching(
    user_id: str,
    site_id: Optional[str],
    lat: float,
    lng: float,
    accuracy_meters: Optional[float],
    db: AsyncSession,
) -> bool:
    """True if another user checked in at same site within 5 min and 10 m. Only fires when accuracy < 30 m."""
    if not site_id:
        return False
    if accuracy_meters is None or accuracy_meters >= 30:
        return False

    from app.models.attendance import AttendanceRecord as AR, EventType  # noqa: PLC0415
    import uuid as _uuid  # noqa: PLC0415

    five_min_ago = datetime.now(timezone.utc) - timedelta(minutes=5)
    try:
        site_uuid = _uuid.UUID(str(site_id))
        user_uuid = _uuid.UUID(str(user_id))
    except (ValueError, AttributeError):
        return False

    result = await db.execute(
        select(AR)
        .where(
            AR.site_id == site_uuid,
            AR.user_id != user_uuid,
            AR.event_type == EventType.checkin,
            AR.created_at >= five_min_ago,
            AR.accuracy_meters.isnot(None),
            AR.accuracy_meters < 30,
        )
        .limit(20)
    )
    nearby = result.scalars().all()
    for record in nearby:
        if record.lat is None or record.lng is None:
            continue
        dist_km = haversine_distance(lat, lng, record.lat, record.lng)
        if dist_km * 1000 <= 10:
            return True
    return False


# ---------------------------------------------------------------------------
# Composite evaluation
# ---------------------------------------------------------------------------


async def evaluate_checkin(
    request: CheckinRequest,
    user,
    db: AsyncSession,
    redis: Redis,
    org,
    site_id: Optional[str] = None,
) -> FraudResult:
    """
    Run all fraud checks and return a composite FraudResult.

    Scoring weights:
    - Mock location detected:           +0.40
    - Poor GPS accuracy (>100 m):       +0.10
    - IP is VPN:                        +0.25
    - IP is Proxy:                      +0.20
    - IP is Tor:                        +0.30
    - Impossible travel (>900 km/h):    +0.50
    - Unknown device:                   +0.10
    - IP-GPS country mismatch:          +0.35
    - Coordinate replay/fixed spoof:    +0.30
    - Buddy punching suspected:         +0.40
    - Time behavioral anomaly:          +0.20
    - Rapid re-checkin (<2 min):        +0.15
    - Excessive daily check-ins (>=6):  +0.25
    """
    score = 0.0
    flags: List[str] = []
    _allowed_by_rule = False

    # 0. Whitelist bypass
    try:
        from app.models.fraud_whitelist import FraudWhitelist  # noqa: PLC0415

        wl_result = await db.execute(
            select(FraudWhitelist).where(
                FraudWhitelist.user_id == user.id,
                FraudWhitelist.device_fingerprint == request.device_fingerprint,
            )
        )
        if wl_result.scalars().first() is not None:
            return FraudResult(score=0.0, flags=[], block=False)
    except Exception:  # noqa: BLE001
        pass

    # 0b. Admin IP rules (block/allow)
    if request.ip_address and not _is_private_ip(request.ip_address):
        try:
            from app.models.ip_rule import IPRule, IPRuleType  # noqa: PLC0415

            ip_rules_result = await db.execute(
                select(IPRule).where(IPRule.org_id == org.id)
            )
            req_addr = ipaddress.ip_address(request.ip_address)
            for rule in ip_rules_result.scalars().all():
                try:
                    if req_addr in ipaddress.ip_network(rule.ip_cidr, strict=False):
                        if rule.rule_type == IPRuleType.block:
                            return FraudResult(score=1.0, flags=["IP_BLOCKED"], block=True)
                        _allowed_by_rule = True
                        break
                except ValueError:
                    continue
        except Exception:  # noqa: BLE001
            pass

    # 1. Mock location
    if request.is_mock_location:
        score += 0.40
        flags.append("MOCK_LOCATION")

    # 2. GPS accuracy
    if request.accuracy_meters > _HIGH_ACCURACY_THRESHOLD_METERS:
        score += 0.10
        flags.append("LOW_GPS_ACCURACY")

    # 3. IP reputation + 3b. IP-GPS country mismatch
    ip_country = ""
    if request.ip_address and not _allowed_by_rule:
        from app.config import settings  # noqa: PLC0415

        ip_result = await check_ip_reputation(
            request.ip_address, redis, settings.IPQS_API_KEY
        )
        if ip_result.is_tor:
            score += 0.30
            flags.append("TOR_EXIT_NODE")
        elif ip_result.is_vpn:
            score += 0.25
            flags.append("VPN_DETECTED")
        elif ip_result.is_proxy:
            score += 0.20
            flags.append("PROXY_DETECTED")
        ip_country = ip_result.country_code

        # 3b. IP-GPS country mismatch
        if not _is_private_ip(request.ip_address) and ip_country:
            try:
                gps_country = await _get_gps_country(request.lat, request.lng, redis)
                if gps_country and ip_country != gps_country:
                    score += 0.35
                    flags.append(f"IP_GPS_MISMATCH:{ip_country}!={gps_country}")
            except Exception as exc:  # noqa: BLE001
                logger.debug("IP-GPS mismatch check failed: %s", exc)

    # 4. Impossible travel
    is_impossible, speed = await check_impossible_travel(
        str(user.id), request.lat, request.lng, db
    )
    if is_impossible:
        score += 0.50
        flags.append(f"IMPOSSIBLE_TRAVEL:{speed:.0f}KMH")

    # 5. Device fingerprint
    is_known, is_trusted = await check_device_fingerprint(
        str(user.id), request.device_fingerprint, db
    )
    if not is_known:
        score += 0.10
        flags.append("UNKNOWN_DEVICE")

    # 6-9. Behavioral checks — single DB query for 4 checks
    recent_records = await _fetch_recent_records(str(user.id), db)
    current_hour = datetime.now(timezone.utc).hour

    if check_coordinate_replay(recent_records, request.lat, request.lng):
        score += 0.30
        flags.append("COORDINATE_REPLAY")

    if check_time_anomaly(recent_records, current_hour):
        score += 0.20
        flags.append("TIME_ANOMALY")

    if check_rapid_recheckin(recent_records):
        score += 0.15
        flags.append("RAPID_RECHECKIN")

    if check_excessive_daily_checkins(recent_records):
        score += 0.25
        flags.append("EXCESSIVE_DAILY_CHECKINS")

    # 10. Buddy punching (real-time)
    if await check_buddy_punching(
        str(user.id), site_id, request.lat, request.lng, request.accuracy_meters, db
    ):
        score += 0.40
        flags.append("BUDDY_PUNCH_SUSPECTED")

    # Cap at 1.0
    score = min(score, 1.0)

    from app.config import settings as _settings  # noqa: PLC0415

    block = score >= _settings.FRAUD_SCORE_THRESHOLD

    return FraudResult(score=round(score, 4), flags=flags, block=block)
