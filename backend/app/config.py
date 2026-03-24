"""
Application configuration using Pydantic Settings.
All sensitive values are loaded from environment variables or a .env file.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import List, Optional, Union

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration object for the Geo-Attendance API."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---------------------------------------------------------------------------
    # General
    # ---------------------------------------------------------------------------
    APP_NAME: str = "Geo-Location Attendance API"
    DEBUG: bool = False
    
    API_V1_PREFIX: str = "/api/v1"

    # ---------------------------------------------------------------------------
    # Database (PostgreSQL + PostGIS via asyncpg)
    # ---------------------------------------------------------------------------
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/geo_attendance"
    )
    # Synchronous URL used only by Alembic migrations
    SYNC_DATABASE_URL: str = (
        "postgresql+psycopg2://postgres:postgres@localhost:5432/geo_attendance"
    )

    # ---------------------------------------------------------------------------
    # Redis
    # ---------------------------------------------------------------------------
    REDIS_URL: str = "redis://localhost:6379/0"

    # ---------------------------------------------------------------------------
    # JWT / Authentication
    # ---------------------------------------------------------------------------
    JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION_USE_RS256_PRIVATE_KEY"
    JWT_ALGORITHM: str = "HS256"
    # For RS256 supply PEM-encoded keys; for HS256 the SECRET is used directly.
    JWT_PRIVATE_KEY: Optional[str] = None   # PEM string or path
    JWT_PUBLIC_KEY: Optional[str] = None    # PEM string or path
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ---------------------------------------------------------------------------
    # MinIO / S3-compatible object storage
    # ---------------------------------------------------------------------------
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "geo-attendance"
    MINIO_SECURE: bool = False

    # ---------------------------------------------------------------------------
    # External APIs
    # ---------------------------------------------------------------------------
    IPQS_API_KEY: str = ""                  # IPQualityScore fraud detection
    FCM_CREDENTIALS_PATH: str = "firebase_credentials.json"
    MAPBOX_ACCESS_TOKEN: str = ""

    # ---------------------------------------------------------------------------
    # CORS
    # ---------------------------------------------------------------------------
    CORS_ORIGINS: Union[List[AnyHttpUrl], List[str]] = ["http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        """Accept a JSON array string or a comma-separated string."""
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # ---------------------------------------------------------------------------
    # Celery
    # ---------------------------------------------------------------------------
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # ---------------------------------------------------------------------------
    # SMTP (MailHog in development)
    # ---------------------------------------------------------------------------
    SMTP_HOST: str = "mailhog"
    SMTP_PORT: int = 1025
    SMTP_FROM: str = "noreply@geoattendance.local"

    # ---------------------------------------------------------------------------
    # Fraud / Geofencing defaults
    # ---------------------------------------------------------------------------
    DEFAULT_GEOFENCE_RADIUS_METERS: int = 100
    FRAUD_SCORE_THRESHOLD: float = 0.75     # above this → auto-reject

    # ---------------------------------------------------------------------------
    # Derived helpers
    # ---------------------------------------------------------------------------
    @model_validator(mode="after")
    def _set_sync_url(self) -> "Settings":
        """Auto-derive a synchronous DB URL from the async one when not set."""
        if "asyncpg" in self.DATABASE_URL and self.SYNC_DATABASE_URL == (
            "postgresql+psycopg2://postgres:postgres@localhost:5432/geo_attendance"
        ):
            self.SYNC_DATABASE_URL = self.DATABASE_URL.replace(
                "postgresql+asyncpg", "postgresql+psycopg2"
            )
        return self

    @property
    def async_database_url(self) -> str:
        """Ensure the URL always uses asyncpg driver."""
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    @property
    def sync_database_url(self) -> str:
        """Synchronous URL for Celery workers and Alembic (psycopg2)."""
        url = self.DATABASE_URL
        if "asyncpg" in url:
            url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()


# Module-level convenience alias
settings: Settings = get_settings()
