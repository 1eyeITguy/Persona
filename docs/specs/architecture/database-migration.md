# Architecture: Database & Migration Strategy

---

## Phase 1 (Current) — JSON Files

data/config.json holds all config including LDAP settings.
This works and should not be broken.

---

## Phase 2 — SQLite + Alembic

Replace JSON with a proper database. Existing config.json is migrated,
not deleted — it becomes the tenant-specific config store.

### Why SQLite First

- Zero operational overhead (no database server to run)
- Single file — easy backup, easy portability
- Full SQL with transactions, constraints, indexes
- SQLAlchemy abstracts it from PostgreSQL (swap is mechanical later)
- Alembic migrations work identically for SQLite and PostgreSQL

### File Structure After Migration

```
data/
├── platform.db             ← SQLAlchemy / Alembic managed
│                             Tables: tenants, persona_users,
│                                     role_assignments, tenant_tech_access
└── tenants/
      └── {tenant_id}/
            ├── config.json ← LDAP, Entra, plugin credentials (NOT in DB)
            └── audit.db    ← Alembic managed, tenant-isolated
```

Credentials stay in JSON files (not in the database) because:
- Easier to apply file-level permissions (chmod 600)
- Physical isolation between tenants
- No risk of a SQL query accidentally returning credentials

---

## SQLAlchemy Models

```python
# backend/database/base.py
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String
import uuid

class Base(DeclarativeBase):
    pass

# All tenant-scoped models inherit this
class TenantScopedMixin:
    tenant_id = Column(String(36), nullable=False, index=True)

# backend/database/models/tenant.py
class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True,
                default=lambda: str(uuid.uuid4()))
    slug = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    deployment_mode = Column(String(16), nullable=False, default="single")
    status = Column(String(16), nullable=False, default="active")
    created_at = Column(String(32), nullable=False)

# backend/database/models/user.py
class PersonaUser(Base, TenantScopedMixin):
    __tablename__ = "persona_users"

    id = Column(String(36), primary_key=True,
                default=lambda: str(uuid.uuid4()))
    # tenant_id from mixin
    username = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(64), nullable=False)
    is_local_admin = Column(Boolean, default=False)
    created_at = Column(String(32))
    last_login = Column(String(32))

    __table_args__ = (
        UniqueConstraint("tenant_id", "username"),
    )
```

---

## Alembic Setup

```
backend/
└── database/
      ├── base.py           ← DeclarativeBase
      ├── session.py        ← get_db() dependency
      ├── migrations/
      │     ├── env.py      ← Alembic config
      │     ├── script.py.mako
      │     └── versions/
      │           ├── 0001_initial_schema.py
      │           ├── 0002_add_tenant_tech_access.py
      │           └── ...
      └── models/
            ├── __init__.py
            ├── tenant.py
            ├── user.py
            └── audit.py
```

### Migration Rules

1. Every schema change = one Alembic migration file. No exceptions.
2. Migration files are numbered sequentially: 0001_, 0002_, etc.
3. Each migration has an upgrade() and downgrade() function.
4. Never modify an existing migration — always create a new one.
5. App runs `alembic upgrade head` on startup automatically.

```python
# main.py startup
from alembic.config import Config
from alembic import command

@app.on_event("startup")
async def startup():
    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations applied")
```

---

## Config Versioning

config.json includes a schema version to handle upgrades safely:

```json
{
  "schema_version": 2,
  "ldap": { ... },
  "app": { ... },
  "plugins": { ... }
}
```

```python
# app_config.py
CURRENT_CONFIG_VERSION = 2

def load_config(tenant_id: str) -> dict:
    config = _read_json(tenant_id)
    version = config.get("schema_version", 1)

    if version < CURRENT_CONFIG_VERSION:
        config = _migrate_config(config, version)
        save_config(tenant_id, config)

    return config

def _migrate_config(config: dict, from_version: int) -> dict:
    if from_version == 1:
        # v1 → v2: move top-level ldap fields into ldap object
        # (example migration)
        ...
    return config
```

---

## Diagnostics Endpoint

```python
# routes/admin.py

@router.get("/api/v1/admin/diagnostics")
async def diagnostics():
    """
    Returns system health without exposing secrets.
    Useful for support — customer can share this output safely.
    """
    return {
        "version": settings.app_version,
        "migration_version": get_current_migration(),
        "uptime_seconds": get_uptime(),
        "database": {
            "platform_db": check_db_health("platform.db"),
            "migration_head": alembic_is_at_head(),
        },
        "providers": {
            "ldap": {
                "configured": ldap_is_configured(),
                "reachable": await check_ldap_reachable(),
                "last_successful_query": get_last_ldap_query_time(),
            },
            "entra": {
                "configured": entra_is_configured(),
                "token_valid": entra_token_is_valid(),
                "token_expires": get_entra_token_expiry(),
                "service_principal_secret_expires": get_sp_secret_expiry(),
            },
        },
        "config": {
            "deployment_mode": get_deployment_mode(),
            "identity_provider": get_identity_provider_type(),
            "exchange_provider": get_exchange_provider_type(),
        },
        # Never include: passwords, secrets, tokens, LDAP DNs, user data
    }
```

---

## PostgreSQL Migration Path (Future)

When scaling to hosted multi-tenant:

1. Change DATABASE_URL in .env from sqlite:/// to postgresql://
2. Run alembic upgrade head against PostgreSQL
3. Migrate data using pgloader or custom script
4. No application code changes required

This works because SQLAlchemy + Alembic abstract the database engine.
