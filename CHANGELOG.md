# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased — develop branch]

### Phase 2 — Database Migration (Step 1)

#### Added
- SQLite database (`data/platform.db`) managed by SQLAlchemy 2 + Alembic
- `backend/database/base.py` — `DeclarativeBase` and `TenantScopedMixin`
- `backend/database/session.py` — `get_db()` FastAPI dependency
- `backend/database/models/tenant.py` — `Tenant` model (id, slug, name, deployment_mode, status, created_at)
- `backend/database/models/user.py` — `PersonaUser` model (tenant-scoped, bcrypt hash stored)
- Alembic migration `0001_initial_schema` — creates `tenants` and `persona_users` tables
- `backend/alembic.ini` — Alembic config with `%(here)s`-relative script location
- Auto-migration on startup: `alembic upgrade head` runs before first request
- One-time config.json → DB seed: Phase-1 installs carry forward with zero data loss

### Phase 2 — Entra Service Principal Setup (Step 2)

#### Added
- `backend/auth/msal.py` — MSAL client credentials token + Graph API user count test
- `backend/routes/entra.py` — `GET/PUT/DELETE /api/v1/entra/config` (JWT required)
- `POST /api/v1/settings/test-entra-connection` — live credential test (public during setup, JWT after)
- Entra config persisted to `data/config.json` under `entra` key (secret never returned in API)
- Secret expiry date stored; surfaced in `/settings/status` for UI warning banners
- `msal` added to `requirements.txt`

#### Changed
- Setup Wizard expanded from 4 to 5 steps — new optional Step 4 "Connect to Entra ID"
- Confirm step (now Step 5) shows Entra summary or "Skipped" note
- `POST /api/v1/settings/setup` accepts optional `entra` payload
- `GET /api/v1/settings/status` returns `entra_configured` and `entra_secret_expires`
- Settings page has new Entra ID section: connection status, expiry badge, edit form, disconnect

---

## [0.2.0] — Phase 1 Complete

### Added
- Setup Wizard — first-run LDAP configuration through UI
- Local admin bootstrap account (break-glass, bcrypt hashed)
- AD login via LDAP bind (credentials never stored)
- Expandable AD directory tree (OU/container/user)
- User attribute panel (full AD attribute set)
- In-app Settings — LDAP reconfiguration without restart
- Docker + docker-compose (prod and dev)
- Single-container Dockerfile (FastAPI serves React build)
- GitHub Actions — docker-publish.yml (main → :latest, tags → :v*)

### Architecture
- Python 3.11 + FastAPI backend
- React 18 + Tailwind CSS frontend
- ldap3 for AD queries (thread pool)
- bcrypt for local admin password
- JWT session tokens (short-lived, signed)
- data/config.json for runtime configuration (gitignored)

---

## [0.1.0] — Project Initialization

### Added
- Repository structure
- .github/copilot-instructions.md
- Full documentation set (VISION, ARCHITECTURE, ROADMAP, PLATFORM)
- Phase specs (2-9) and architecture deep-dives
- .gitignore, LICENSE (MIT), SECURITY.md
- .env.example (bootstrap only — no LDAP values)
- data/.gitkeep
- GitHub Actions — docker-dev.yml (develop → :dev)
- Branch strategy: feature/* → develop → main → v*.*.*

### Decisions
- Backend: Python 3.11 + FastAPI
- AD: ldap3 (thread pool, never block event loop)
- DB: SQLite + Alembic (Phase 2), PostgreSQL path for hosted
- Auth: Service account + service principal (not user credentials)
- Multi-tenancy: built in from Phase 2 (tenant_id on everything)
- Exchange SOA: per-user resolution, STALE_AD_ATTRS detection mandatory
- License: MIT (Commons Clause considered if hosted tier launches)
- Deployment: Docker image on ghcr.io/1eyeITguy/persona
