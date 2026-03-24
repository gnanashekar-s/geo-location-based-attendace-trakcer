"""
Async SQLAlchemy engine, session factory, declarative Base and FastAPI dependency.

PostGIS extension is created (if not already present) during application startup
via the `init_db()` coroutine called from the lifespan handler in main.py.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, MappedColumn
from sqlalchemy.pool import NullPool

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

# Use NullPool during testing to avoid connection leaks; swap for
# AsyncAdaptedQueuePool in production by removing pool_class kwarg when
# DEBUG=False or by reading from settings.
_engine_kwargs: dict = {
    "echo": settings.DEBUG,
    "pool_pre_ping": True,
    "pool_size": 10,
    "max_overflow": 20,
    "pool_recycle": 3600,
    "connect_args": {
        "server_settings": {"application_name": settings.APP_NAME},
        "command_timeout": 60,
    },
}

engine: AsyncEngine = create_async_engine(
    settings.async_database_url,
    **_engine_kwargs,
)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


# ---------------------------------------------------------------------------
# Declarative Base
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    """Project-wide SQLAlchemy declarative base."""

    # All models inherit from this so we have a single metadata object.
    pass


# ---------------------------------------------------------------------------
# PostGIS initialisation
# ---------------------------------------------------------------------------

async def create_postgis_extension(conn: AsyncConnection) -> None:
    """Create PostGIS extension if it is not yet available."""
    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis_topology;"))
    await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
    logger.info("PostGIS extensions verified/created.")


async def init_db() -> None:
    """
    Called once at application startup.

    1. Ensures PostGIS (and uuid-ossp) extensions exist.
    2. Creates all tables that are not yet present (idempotent).
    """
    async with engine.begin() as conn:
        await create_postgis_extension(conn)
        # Import all models so metadata is populated before create_all
        import app.models  # noqa: F401  – side-effect import
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created / verified.")


async def close_db() -> None:
    """Dispose of the connection pool gracefully on shutdown."""
    await engine.dispose()
    logger.info("Database engine disposed.")


# ---------------------------------------------------------------------------
# FastAPI / async dependency
# ---------------------------------------------------------------------------

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield an async database session and ensure it is closed afterwards.

    Usage in a route::

        async def my_endpoint(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ---------------------------------------------------------------------------
# Context-manager helper (useful in background tasks / tests)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    """Async context-manager wrapper around get_db for non-FastAPI usage."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
