"""
Tenant model — one row per deployment tenant.

In single-tenant deployments there is always exactly one row with slug="default".
MSP deployments (Phase 8) add one row per managed client.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String

from backend.database.base import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    slug = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    deployment_mode = Column(String(16), nullable=False, default="single")
    status = Column(String(16), nullable=False, default="active")
    created_at = Column(
        String(32),
        nullable=False,
        default=lambda: datetime.now(timezone.utc).isoformat(),
    )
