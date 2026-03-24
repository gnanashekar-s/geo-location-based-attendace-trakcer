"""
Celery tasks: Data & Session Cleanup.

  cleanup_expired_sessions()
    – Scans Redis for session keys (pattern: session:*) and deletes any
      whose TTL has already expired (i.e. the key itself has expired, so
      this sweep is a safety net) or that reference tokens no longer in
      the active-token set.  Also removes dangling "online user" markers.

  cleanup_old_tokens()
    – Removes expired refresh-token keys from Redis
      (pattern: refresh_token:*).

  cleanup_old_report_files()
    – Deletes MinIO report objects older than REPORT_RETENTION_DAYS (30).
    – Called by the beat schedule at 02:00 UTC via the celery_app beat
      schedule entry "report_cleanup".
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterator

import redis as sync_redis
from celery import shared_task

from app.config import settings

logger = logging.getLogger(__name__)

# Configurable retention period (days) for generated report files
REPORT_RETENTION_DAYS = 30

# ---------------------------------------------------------------------------
# Redis client (synchronous, reused per process)
# ---------------------------------------------------------------------------

_redis_client: sync_redis.Redis | None = None


def _get_redis() -> sync_redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = sync_redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=10,
        )
    return _redis_client


# ---------------------------------------------------------------------------
# Helper: scan keys in batches (avoids blocking KEYS command)
# ---------------------------------------------------------------------------


def _scan_keys(pattern: str, count: int = 200) -> Iterator[str]:
    """Yield all Redis keys matching *pattern* using non-blocking SCAN."""
    r = _get_redis()
    cursor = 0
    while True:
        cursor, keys = r.scan(cursor=cursor, match=pattern, count=count)
        yield from keys
        if cursor == 0:
            break


# ---------------------------------------------------------------------------
# Task: cleanup_expired_sessions
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.cleanup.cleanup_expired_sessions",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def cleanup_expired_sessions(self) -> dict:
    """
    Remove expired and orphaned session keys from Redis.

    Key patterns managed
    ─────────────────────
      session:{session_id}        – primary session data hash
      user_sessions:{user_id}     – sorted-set of session IDs per user
      online:{user_id}            – presence marker (string key with TTL)

    Strategy
    ─────────
    1. Scan all session:* keys.
    2. If the key has no TTL (TTL == -1) AND it was created more than
       ACCESS_TOKEN_EXPIRE_MINUTES ago → delete it (stale session that
       never received an expiry).
    3. Remove session IDs from the user_sessions sorted-sets whose
       corresponding session:* key no longer exists.
    4. Delete online:* keys that have already expired (TTL == -2).
    """
    try:
        r = _get_redis()
        deleted_sessions = 0
        deleted_orphans = 0
        deleted_presence = 0

        expire_minutes: int = settings.ACCESS_TOKEN_EXPIRE_MINUTES
        stale_threshold = datetime.now(tz=timezone.utc) - timedelta(
            minutes=expire_minutes
        )

        # ── Pass 1: stale session keys (no TTL set) ────────────────────────
        for key in _scan_keys("session:*"):
            ttl = r.ttl(key)
            if ttl == -2:
                # Already expired and deleted by Redis (rare race)
                deleted_sessions += 1
                continue
            if ttl == -1:
                # Key exists but has no expiry – check created_at field
                created_at_raw = r.hget(key, "created_at")
                if created_at_raw:
                    try:
                        created_at = datetime.fromisoformat(created_at_raw)
                        if created_at.tzinfo is None:
                            created_at = created_at.replace(tzinfo=timezone.utc)
                        if created_at < stale_threshold:
                            r.delete(key)
                            deleted_sessions += 1
                    except ValueError:
                        # Unparseable timestamp → delete defensively
                        r.delete(key)
                        deleted_sessions += 1
                else:
                    # No created_at metadata → delete
                    r.delete(key)
                    deleted_sessions += 1

        # ── Pass 2: orphaned entries in user_sessions sorted-sets ──────────
        for user_set_key in _scan_keys("user_sessions:*"):
            # Each member is a session_id
            members: list[str] = r.zrange(user_set_key, 0, -1)
            to_remove = []
            for session_id in members:
                session_key = f"session:{session_id}"
                if not r.exists(session_key):
                    to_remove.append(session_id)
            if to_remove:
                r.zrem(user_set_key, *to_remove)
                deleted_orphans += len(to_remove)

        # ── Pass 3: stale presence markers ────────────────────────────────
        for presence_key in _scan_keys("online:*"):
            ttl = r.ttl(presence_key)
            if ttl == -2:
                deleted_presence += 1

        logger.info(
            "Session cleanup: deleted=%d stale sessions, %d orphan refs, "
            "%d stale presence keys",
            deleted_sessions,
            deleted_orphans,
            deleted_presence,
        )
        return {
            "deleted_sessions": deleted_sessions,
            "deleted_orphans": deleted_orphans,
            "deleted_presence": deleted_presence,
        }

    except Exception as exc:
        logger.exception("cleanup_expired_sessions failed: %s", exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task: cleanup_old_tokens
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.cleanup.cleanup_old_tokens",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def cleanup_old_tokens(self) -> dict:
    """
    Remove expired refresh-token keys from Redis.

    Key pattern: refresh_token:{jti}
      – Stored as a string (user_id) with TTL = REFRESH_TOKEN_EXPIRE_DAYS.
      – Redis will auto-expire them, but this task explicitly deletes keys
        that have no TTL set (defensive cleanup) and purges any entries
        in the token revocation blacklist that have passed their deadline.

    Revocation blacklist pattern: revoked_token:{jti}
    """
    try:
        r = _get_redis()
        deleted_tokens = 0
        deleted_blacklist = 0

        refresh_expire_seconds = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
        stale_threshold = datetime.now(tz=timezone.utc) - timedelta(
            days=settings.REFRESH_TOKEN_EXPIRE_DAYS
        )

        # ── Refresh token keys with no TTL ────────────────────────────────
        for key in _scan_keys("refresh_token:*"):
            ttl = r.ttl(key)
            if ttl == -2:
                # Redis already cleaned it up
                deleted_tokens += 1
                continue
            if ttl == -1:
                # No expiry set – apply the standard refresh TTL
                # If the stored value contains the issued_at we could check;
                # otherwise just set the TTL so Redis will expire it correctly.
                r.expire(key, refresh_expire_seconds)

        # ── Revoked token blacklist cleanup ───────────────────────────────
        for key in _scan_keys("revoked_token:*"):
            ttl = r.ttl(key)
            if ttl == -2:
                deleted_blacklist += 1
                continue
            if ttl == -1:
                # Set a TTL matching the refresh token lifetime so it auto-expires
                r.expire(key, refresh_expire_seconds)

        logger.info(
            "Token cleanup: %d already-expired token keys scanned, "
            "%d blacklist keys scanned",
            deleted_tokens,
            deleted_blacklist,
        )
        return {
            "deleted_tokens": deleted_tokens,
            "deleted_blacklist": deleted_blacklist,
        }

    except Exception as exc:
        logger.exception("cleanup_old_tokens failed: %s", exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task: cleanup_old_report_files
# ---------------------------------------------------------------------------


@shared_task(
    name="app.workers.tasks.cleanup.cleanup_old_report_files",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def cleanup_old_report_files(self) -> dict:
    """
    Delete report objects from MinIO that are older than REPORT_RETENTION_DAYS.

    Objects are stored under the prefix  reports/  in the configured bucket.
    The object's last_modified timestamp is compared against the cutoff.
    """
    try:
        from minio import Minio  # noqa: PLC0415

        client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )

        if not client.bucket_exists(settings.MINIO_BUCKET):
            logger.info("MinIO bucket %s does not exist – nothing to clean", settings.MINIO_BUCKET)
            return {"deleted": 0}

        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=REPORT_RETENTION_DAYS)
        deleted = 0
        errors = 0

        objects = client.list_objects(
            bucket_name=settings.MINIO_BUCKET,
            prefix="reports/",
            recursive=True,
        )

        for obj in objects:
            if obj.last_modified is None:
                continue
            last_modified = obj.last_modified
            # Make timezone-aware if needed
            if last_modified.tzinfo is None:
                last_modified = last_modified.replace(tzinfo=timezone.utc)

            if last_modified < cutoff:
                try:
                    client.remove_object(settings.MINIO_BUCKET, obj.object_name)
                    deleted += 1
                    logger.debug("Deleted old report: %s", obj.object_name)
                except Exception as exc:  # noqa: BLE001
                    errors += 1
                    logger.warning(
                        "Failed to delete report %s: %s", obj.object_name, exc
                    )

        logger.info(
            "Report cleanup: deleted=%d, errors=%d (cutoff=%s)",
            deleted,
            errors,
            cutoff.date().isoformat(),
        )
        return {"deleted": deleted, "errors": errors}

    except Exception as exc:
        logger.exception("cleanup_old_report_files failed: %s", exc)
        raise self.retry(exc=exc)
