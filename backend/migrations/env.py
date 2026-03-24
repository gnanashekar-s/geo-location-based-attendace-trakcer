"""
Alembic async environment.

Supports both:
- ``alembic upgrade head``   (online mode, directly against the database)
- ``alembic revision --autogenerate``  (offline / autogenerate mode)

The async engine is constructed from the DATABASE_URL environment variable
(falling back to the value in alembic.ini for local development).
"""

from __future__ import annotations

import asyncio
import logging
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# ---------------------------------------------------------------------------
# Load Alembic config object (gives access to alembic.ini values)
# ---------------------------------------------------------------------------
config = context.config

# Interpret the config file for Python logging unless we're being called
# programmatically (e.g. pytest-alembic).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

logger = logging.getLogger("alembic.env")

# ---------------------------------------------------------------------------
# Override sqlalchemy.url from the environment when available.
# We use the *synchronous* psycopg2 URL for Alembic; the async URL is only
# used by the running application.
# ---------------------------------------------------------------------------
_db_url = os.getenv(
    "DATABASE_URL",
    config.get_main_option("sqlalchemy.url", ""),
)

# Normalise asyncpg → psycopg2 for Alembic (Alembic itself is synchronous
# internally; we use run_async_migrations below for the actual DDL execution).
if "+asyncpg" in _db_url:
    _sync_url = _db_url.replace("+asyncpg", "+psycopg2")
elif _db_url.startswith("postgresql://"):
    _sync_url = _db_url  # already synchronous
else:
    _sync_url = _db_url

config.set_main_option("sqlalchemy.url", _sync_url)

# ---------------------------------------------------------------------------
# Import all models so Alembic's autogenerate can detect every table.
# ---------------------------------------------------------------------------
# This MUST happen after setting up the config so that app.config can be
# imported without side-effects from alembic.ini parsing.
from app.database import Base  # noqa: E402
import app.models  # noqa: F401, E402  – side-effect: populates Base.metadata

target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# Offline migrations (generate SQL script without a live DB connection)
# ---------------------------------------------------------------------------

def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    Configures the context with just a URL and not an Engine, so that we
    never need a DBAPI to be available.  Calls to context.execute() emit
    the given string to the script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        # Render item-level AS clauses correctly for PostgreSQL arrays / enums
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online migrations (execute against a live database using async engine)
# ---------------------------------------------------------------------------

def do_run_migrations(connection: Connection) -> None:
    """
    Execute pending migrations on an existing synchronous connection.

    Called from within the ``run_async_migrations`` coroutine after the
    async engine provides a synchronous connection via ``run_sync``.
    """
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        render_as_batch=False,
        # Detect auto-generated column default changes
        include_object=_include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def _include_object(object, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]  # noqa: A002
    """
    Filter objects that Alembic autogenerate should consider.

    Exclude PostGIS system tables (spatial_ref_sys, topology, etc.) to avoid
    spurious migration noise.
    """
    _excluded_tables = {
        "spatial_ref_sys",
        "geometry_columns",
        "geography_columns",
        "raster_columns",
        "raster_overviews",
        "topology",
        "layer",
    }
    if type_ == "table" and name in _excluded_tables:
        return False
    return True


async def run_async_migrations() -> None:
    """
    Construct an async engine and run migrations inside a synchronous callback.

    We intentionally use NullPool so that connections are not cached between
    migration runs (important for CI/CD pipelines and test suites).
    """
    # Build a fresh async engine using the (possibly async) DB URL from env
    _async_url = os.getenv("DATABASE_URL", _db_url)
    if not _async_url.startswith("postgresql+asyncpg"):
        # Ensure we use asyncpg for the async engine
        _async_url = _async_url.replace("postgresql://", "postgresql+asyncpg://")
        _async_url = _async_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")

    connectable = async_engine_from_config(
        {"sqlalchemy.url": _async_url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        # Ensure PostGIS is available before running DDL
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Entry point for online migration mode."""
    asyncio.run(run_async_migrations())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if context.is_offline_mode():
    logger.info("Running migrations in OFFLINE mode.")
    run_migrations_offline()
else:
    logger.info("Running migrations in ONLINE mode.")
    run_migrations_online()
