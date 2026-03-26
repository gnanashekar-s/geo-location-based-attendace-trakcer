"""
FastAPI application factory.

Startup sequence
----------------
1. PostGIS extension ensured via init_db()
2. All SQLAlchemy tables created (idempotent)
3. MinIO bucket created if absent
4. Redis connectivity confirmed

Shutdown sequence
-----------------
1. Async DB engine disposed
2. Redis pool closed
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from minio import Minio
from minio.error import S3Error
from prometheus_client import (
    Counter,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.config import settings
from app.database import close_db, init_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------

REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "endpoint", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Record per-endpoint request counts and latencies."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        start = time.perf_counter()
        response = await call_next(request)
        elapsed = time.perf_counter() - start

        # Use the route path template (e.g. /api/v1/users/{user_id}) rather
        # than the concrete URL to avoid high-cardinality label sets.
        route = request.scope.get("route")
        endpoint = route.path if route else request.url.path

        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=endpoint,
            status_code=response.status_code,
        ).inc()
        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=endpoint,
        ).observe(elapsed)

        return response


# ---------------------------------------------------------------------------
# MinIO initialisation
# ---------------------------------------------------------------------------

def _init_minio() -> None:
    """Create the MinIO bucket if it does not exist yet."""
    try:
        client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        if not client.bucket_exists(settings.MINIO_BUCKET):
            client.make_bucket(settings.MINIO_BUCKET)
            logger.info("MinIO bucket '%s' created.", settings.MINIO_BUCKET)
        else:
            logger.info("MinIO bucket '%s' already exists.", settings.MINIO_BUCKET)
    except S3Error as exc:
        logger.error("MinIO initialisation failed: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not connect to MinIO at startup: %s", exc)


# ---------------------------------------------------------------------------
# Redis connectivity check
# ---------------------------------------------------------------------------

async def _check_redis() -> None:
    """Ping Redis to confirm connectivity; log a warning on failure."""
    try:
        r: aioredis.Redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.ping()
        await r.aclose()
        logger.info("Redis connection verified.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis not reachable at startup: %s", exc)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application-level resources across the process lifetime."""
    logger.info("Starting up %s …", settings.APP_NAME)

    # 1. Database (PostGIS + tables)
    await init_db()

    # 2. Object storage
    _init_minio()

    # 3. Cache
    await _check_redis()

    logger.info("%s is ready.", settings.APP_NAME)

    yield  # ← server runs here

    # --------------- teardown ---------------
    logger.info("Shutting down %s …", settings.APP_NAME)
    await close_db()
    logger.info("Shutdown complete.")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    """Construct and configure the FastAPI application."""

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description=(
            "REST & WebSocket API for the geo-location based attendance system. "
            "Provides check-in/out tracking, geofence management, fraud detection, "
            "manual approval workflows, and real-time notifications."
        ),
        docs_url=f"{settings.API_V1_PREFIX}/docs" if settings.DEBUG else None,
        redoc_url=f"{settings.API_V1_PREFIX}/redoc" if settings.DEBUG else None,
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json" if settings.DEBUG else None,
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------
    # Middleware – order matters: outermost middleware runs first on request
    # ------------------------------------------------------------------

    # 1. Prometheus (must be before CORS so it captures every request)
    app.add_middleware(PrometheusMiddleware)

    # 2. CORS — permissive for demo; tighten per-env in production
    cors_origins = [str(o) for o in settings.CORS_ORIGINS]
    allow_all = settings.DEBUG or cors_origins == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_all else cors_origins,
        allow_credentials=not allow_all,  # credentials incompatible with wildcard origin
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With",
                       "bypass-tunnel-logic"],
        expose_headers=["X-Request-ID", "X-Process-Time"],
    )

    # ------------------------------------------------------------------
    # Routers
    # ------------------------------------------------------------------
    _register_routers(app)

    # ------------------------------------------------------------------
    # Exception handlers
    # ------------------------------------------------------------------
    _register_exception_handlers(app)

    # ------------------------------------------------------------------
    # Standalone endpoints
    # ------------------------------------------------------------------
    _register_standalone_routes(app)

    return app


# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------

def _register_routers(app: FastAPI) -> None:
    """
    Import and include all feature routers.

    Each router module exposes a ``router`` attribute (APIRouter instance).
    Missing router modules are skipped with a warning so the application
    can start even when not all feature modules have been implemented yet.
    """
    # Each router module defines its own prefix (e.g. prefix="/attendance").
    # We mount all routers under the API v1 prefix only; the router's own
    # prefix is appended automatically by FastAPI's include_router.
    _routers = [
        "app.routers.auth",
        "app.routers.users",
        "app.routers.organisations",
        "app.routers.locations",
        "app.routers.attendance",
        "app.routers.approvals",
        "app.routers.analytics",
        "app.routers.notifications",
        "app.routers.admin",
    ]

    for module_path in _routers:
        try:
            import importlib
            module = importlib.import_module(module_path)
            app.include_router(
                module.router,
                prefix=settings.API_V1_PREFIX,
            )
            logger.debug("Registered router: %s", module_path)
        except ModuleNotFoundError:
            logger.warning(
                "Router module '%s' not found – skipping. "
                "Create the module to enable these endpoints.",
                module_path,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to register router '%s': %s", module_path, exc)


# ---------------------------------------------------------------------------
# WebSocket endpoints
# ---------------------------------------------------------------------------
# WebSocket routes are defined here (or imported from a dedicated module).
# They are registered on the app directly because they live outside the
# versioned REST prefix.

def _register_standalone_routes(app: FastAPI) -> None:
    """Register health check, metrics, and WebSocket endpoints."""

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------
    @app.get(
        "/health",
        tags=["Health"],
        summary="Application health probe",
        response_model=dict,
        status_code=status.HTTP_200_OK,
    )
    async def health_check(request: Request) -> dict:
        """
        Lightweight liveness probe.

        Returns ``{"status": "ok"}`` when the application is running.
        Does **not** check downstream dependencies (use /health/ready for that).
        """
        return {
            "status": "ok",
            "app": settings.APP_NAME,
            "version": "1.0.0",
        }

    # ------------------------------------------------------------------
    # Readiness probe (checks DB + Redis)
    # ------------------------------------------------------------------
    @app.get(
        "/health/ready",
        tags=["Health"],
        summary="Application readiness probe",
        status_code=status.HTTP_200_OK,
    )
    async def readiness_check() -> dict:
        """
        Readiness probe that verifies connectivity to PostgreSQL and Redis.

        Returns HTTP 200 when all dependencies are reachable, 503 otherwise.
        """
        from sqlalchemy import text as sa_text
        from app.database import engine

        checks: dict = {"database": "unknown", "redis": "unknown"}

        # Database
        try:
            async with engine.connect() as conn:
                await conn.execute(sa_text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["database"] = f"error: {exc}"

        # Redis
        try:
            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            await r.ping()
            await r.aclose()
            checks["redis"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = f"error: {exc}"

        all_ok = all(v == "ok" for v in checks.values())
        return JSONResponse(
            content={"status": "ok" if all_ok else "degraded", "checks": checks},
            status_code=status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # ------------------------------------------------------------------
    # Prometheus metrics scrape endpoint
    # ------------------------------------------------------------------
    @app.get(
        "/metrics",
        tags=["Observability"],
        summary="Prometheus metrics",
        include_in_schema=False,
    )
    async def metrics() -> Response:
        return Response(
            content=generate_latest(),
            media_type=CONTENT_TYPE_LATEST,
        )

    # ------------------------------------------------------------------
    # WebSocket: real-time feed + approvals (defined in app.websocket)
    # ------------------------------------------------------------------
    try:
        from app import websocket as ws_module  # noqa: F401
        app.include_router(ws_module.router)
        logger.debug("WebSocket router registered.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("WebSocket router could not be registered: %s", exc)


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------

def _register_exception_handlers(app: FastAPI) -> None:
    """Attach global exception handlers to the application."""

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Return a structured 422 response for Pydantic validation errors."""
        body = exc.body
        if isinstance(body, bytes):
            try:
                body = body.decode("utf-8")
            except Exception:
                body = repr(body)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": exc.errors(),
                "body": body,
            },
        )

    @app.exception_handler(status.HTTP_404_NOT_FOUND)
    async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": "The requested resource was not found."},
        )

    @app.exception_handler(status.HTTP_500_INTERNAL_SERVER_ERROR)
    async def internal_error_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception("Unhandled server error for %s %s", request.method, request.url)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal server error occurred."},
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception(
            "Unhandled exception for %s %s: %s",
            request.method,
            request.url,
            exc,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An unexpected error occurred."},
        )


# ---------------------------------------------------------------------------
# Module-level app instance
# ---------------------------------------------------------------------------

app: FastAPI = create_app()


# ---------------------------------------------------------------------------
# Entry point (python -m app.main  or  uvicorn app.main:app)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )
