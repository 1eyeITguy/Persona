"""
SQLAlchemy engine and session factory.

get_db() is a FastAPI dependency that yields a Session and closes it on exit.
The data directory is created if it does not exist so the first startup
does not fail on a fresh install.
"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.config import settings


def _make_engine():
    db_path = Path(settings.data_dir) / "platform.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        echo=False,
    )


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — yields a DB session and closes it on exit."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
