"""
PersonaUser model — Persona application users (not AD/Entra identities).

These are the accounts used to log in to the Persona UI itself:
  - Local admin (break-glass account created during setup wizard)
  - Future: help desk techs managed by admins (Phase 4+)

AD/Entra user accounts are never stored here.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, String, UniqueConstraint

from backend.database.base import Base, TenantScopedMixin


class PersonaUser(Base, TenantScopedMixin):
    __tablename__ = "persona_users"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    # tenant_id inherited from TenantScopedMixin (indexed)
    username = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(64), nullable=False)
    is_local_admin = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        String(32),
        nullable=False,
        default=lambda: datetime.now(timezone.utc).isoformat(),
    )
    last_login = Column(String(32), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "username", name="uq_persona_users_tenant_username"),
    )
