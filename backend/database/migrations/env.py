"""
Alembic environment configuration for Persona.

Reads database URL from application settings so the same config works
in development, Docker, and test environments without hardcoding paths.

render_as_batch=True is required for SQLite because it does not support
ALTER TABLE natively — Alembic rewrites the table as a workaround.
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make the backend package importable when running `alembic` CLI directly
# from the project root (e.g. `alembic -c backend/alembic.ini upgrade head`).
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.config import settings
from backend.database.base import Base

# Register all models so their tables are included in target_metadata.
import backend.database.models.tenant  # noqa: F401 — side-effect import
import backend.database.models.user  # noqa: F401 — side-effect import

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _db_url() -> str:
    db_path = Path(settings.data_dir) / "platform.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path}"


def run_migrations_offline() -> None:
    """Generate SQL script without a live connection (for review / CI)."""
    context.configure(
        url=_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations against a live database connection."""
    cfg_section = config.get_section(config.config_ini_section) or {}
    cfg_section["sqlalchemy.url"] = _db_url()

    connectable = engine_from_config(
        cfg_section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
