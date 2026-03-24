"""
MinIO object storage service.

Uses asyncio-friendly patterns by running blocking MinIO SDK calls
in a thread-pool executor so they do not block the event loop.

Public API
----------
upload_file(file_bytes, filename, content_type) -> Optional[str]
    Generic upload; returns the internal URL of the stored object.

get_file_url(filename, expiry_seconds=3600) -> Optional[str]
    Return a pre-signed GET URL for a stored object.

upload_photo(file_bytes, filename, content_type) -> Optional[str]
    Convenience wrapper for photo uploads (alias of upload_file).

upload_report(file_bytes, filename) -> Optional[str]
    Convenience wrapper for report (CSV / PDF) uploads.

get_presigned_url(object_name, expiry_seconds=3600) -> Optional[str]
    Alias of get_file_url kept for backwards compatibility.
"""

from __future__ import annotations

import asyncio
import io
import logging
from datetime import timedelta
from functools import partial
from typing import Optional

from minio import Minio
from minio.error import S3Error

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

_client: Optional[Minio] = None


def _get_client() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
    return _client


# ---------------------------------------------------------------------------
# Bucket initialisation
# ---------------------------------------------------------------------------


def _init_bucket_sync() -> None:
    """Create the default bucket if it does not exist (blocking)."""
    client = _get_client()
    bucket = settings.MINIO_BUCKET
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info("MinIO bucket '%s' created.", bucket)
        else:
            logger.debug("MinIO bucket '%s' already exists.", bucket)
    except S3Error as exc:
        logger.error("MinIO bucket init error: %s", exc)
        raise


async def init_bucket() -> None:
    """Async wrapper: create the bucket on application startup."""
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _init_bucket_sync)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MinIO bucket init failed (MinIO may be unreachable): %s", exc)


# ---------------------------------------------------------------------------
# Internal sync helpers
# ---------------------------------------------------------------------------


def _upload_object_sync(
    object_name: str,
    data: bytes,
    content_type: str,
) -> str:
    """Upload *data* as *object_name* and return the internal URL."""
    client = _get_client()
    client.put_object(
        bucket_name=settings.MINIO_BUCKET,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    scheme = "https" if settings.MINIO_SECURE else "http"
    return f"{scheme}://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{object_name}"


def _presigned_url_sync(object_name: str, expiry_seconds: int) -> str:
    client = _get_client()
    url = client.presigned_get_object(
        bucket_name=settings.MINIO_BUCKET,
        object_name=object_name,
        expires=timedelta(seconds=expiry_seconds),
    )
    return url


# ---------------------------------------------------------------------------
# Primary public API
# ---------------------------------------------------------------------------


async def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> Optional[str]:
    """
    Upload arbitrary bytes to MinIO under *filename*.

    Args:
        file_bytes:   Raw bytes to store.
        filename:     Object name / path within the bucket
                      (e.g. ``"photos/user_id/checkin.jpg"``).
        content_type: MIME type (e.g. ``"image/jpeg"``).

    Returns:
        Full internal URL of the stored object, or ``None`` if MinIO is
        unreachable.
    """
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            partial(_upload_object_sync, filename, file_bytes, content_type),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("MinIO upload_file failed for '%s': %s", filename, exc)
        return None


async def get_file_url(
    filename: str,
    expiry_seconds: int = 3600,
) -> Optional[str]:
    """
    Generate a pre-signed GET URL for *filename*.

    Args:
        filename:       Object name / path within the bucket.
        expiry_seconds: Link validity window in seconds (default 1 hour).

    Returns:
        Pre-signed URL string, or ``None`` if MinIO is unreachable.
    """
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            partial(_presigned_url_sync, filename, expiry_seconds),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("MinIO get_file_url failed for '%s': %s", filename, exc)
        return None


# ---------------------------------------------------------------------------
# Convenience wrappers (kept for backwards compatibility)
# ---------------------------------------------------------------------------


async def upload_photo(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> Optional[str]:
    """
    Upload a photo to MinIO.

    Thin wrapper around :func:`upload_file` kept for backwards compatibility.
    """
    return await upload_file(file_bytes, filename, content_type)


async def upload_report(file_bytes: bytes, filename: str) -> Optional[str]:
    """
    Upload a generated report (CSV, PDF, etc.) to MinIO.

    Returns:
        Full URL string to the uploaded object, or None if MinIO is unreachable.
    """
    content_type = "text/csv" if filename.endswith(".csv") else "application/octet-stream"
    return await upload_file(file_bytes, filename, content_type)


async def get_presigned_url(
    object_name: str,
    expiry_seconds: int = 3600,
) -> Optional[str]:
    """
    Alias of :func:`get_file_url` kept for backwards compatibility.
    """
    return await get_file_url(object_name, expiry_seconds)
