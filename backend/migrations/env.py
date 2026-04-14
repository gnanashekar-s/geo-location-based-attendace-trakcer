"""
Alembic migration environment — synchronous (psycopg2).

Uses SYNC_DATABASE_URL env var when available, falling back to DATABASE_URL
(converting asyncpg → psycopg2).  This keeps migrations simple and reliable.
"""

from __future__ import annotations

import logging
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# ---------------------------------------------------------------------------
# Alembic config
# ---------------------------------------------------------------------------
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

logger = logging.getLogger("alembic.env")

# ---------------------------------------------------------------------------
# Resolve a synchronous database URL
# Priority: SYNC_DATABASE_URL > DATABASE_URL (normalised) > alembic.ini value
# ---------------------------------------------------------------------------
def _get_sync_url() -> str:
    # 1. Explicit sync URL
    sync = os.getenv("SYNC_DATABASE_URL", "")
    if sync:
        return sync

    # 2. Async URL → convert to psycopg2
    db_url = os.getenv("DATABASE_URL", config.get_main_option("sqlalchemy.url", ""))
    if "+asyncpg" in db_url:
        return db_url.replace("+asyncpg", "+psycopg2")
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return db_url


_sync_url = _get_sync_url()
config.set_main_option("sqlalchemy.url", _sync_url)

# ---------------------------------------------------------------------------
# Models metadata (for autogenerate)
# ---------------------------------------------------------------------------
from app.database import Base   # noqa: E402
import app.models               # noqa: F401, E402

target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# PostGIS / system tables to skip during autogenerate
# ---------------------------------------------------------------------------
_EXCLUDED_TABLES = {
    "spatial_ref_sys", "geometry_columns", "geography_columns",
    "raster_columns", "raster_overviews", "topology", "layer",
}


def _include_object(object, name, type_, reflected, compare_to):  # noqa: A002
    if type_ == "table" and name in _EXCLUDED_TABLES:
        return False
    return True


# ---------------------------------------------------------------------------
# Offline mode
# ---------------------------------------------------------------------------
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=False,
    )
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online mode (synchronous psycopg2 engine)
# ---------------------------------------------------------------------------
def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=False,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if context.is_offline_mode():
    logger.info("Running migrations OFFLINE.")
    run_migrations_offline()
else:
    logger.info("Running migrations ONLINE via %s", _sync_url.split("@")[-1])
    run_migrations_online()
