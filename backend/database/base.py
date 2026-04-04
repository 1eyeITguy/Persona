"""
SQLAlchemy declarative base and shared mixins.

All tenant-scoped models inherit TenantScopedMixin to ensure
tenant_id is always present and indexed.
"""

from __future__ import annotations

from sqlalchemy import Column, String
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class TenantScopedMixin:
    """Mixin that adds tenant_id to every model that holds tenant data."""

    tenant_id = Column(String(36), nullable=False, index=True)
