# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**Persona** is a self-hosted identity operations platform for hybrid Microsoft environments (Active Directory + Entra ID + Exchange Online). It is a browser-based tool for help desk technicians and IT admins. Phase 1 is complete; Phase 2 (Entra/SQLite) is in progress.

## Development Commands

### Docker (recommended)

```bash
# Hot-reload development (backend :8000, frontend :5173)
docker compose -f docker-compose.dev.yml up

# Production image (from ghcr.io/1eyeITguy/persona)
docker compose up -d
```

### Manual (no Docker)

```bash
# Backend
cd backend && python -m uvicorn main:app --reload

# Frontend
cd frontend && npm install && npm run dev

# Frontend production build (output goes to dist/, then copied to backend/static/)
cd frontend && npm run build
```

### Database Migrations (Alembic)

```bash
cd backend
alembic upgrade head                          # Apply pending migrations (also auto-runs on startup)
alembic revision --autogenerate -m "..."      # Generate new migration after model changes
```

### Docker Build

```bash
docker build -t persona:local .
docker run -p 8000:8000 -v ./data:/app/data --env-file .env persona:local
```

## Environment Setup

Copy `.env.example` to `.env` and set `JWT_SECRET`:

```bash
cp .env.example .env
# Set JWT_SECRET=$(openssl rand -hex 32)
```

Key `.env` variables: `JWT_SECRET`, `JWT_EXPIRE_MINUTES` (default 480), `APP_PORT` (8000), `CORS_ORIGINS`.

Runtime config is stored in `data/config.json` (gitignored) and managed via the UI Setup Wizard — never edit manually or commit it.

## Architecture

### Request Flow

```
Browser (React/Vite)
  ↓
FastAPI @ :8000
  ├─ /api/v1/auth/      → JWT auth, rate limiting (5 failures → 15-min lockout)
  ├─ /api/v1/settings/  → Setup wizard, LDAP/Entra config
  ├─ /api/v1/ad/        → AD tree, user details (JWT required)
  └─ /api/v1/entra/     → Graph API (Phase 2)

Backend services:
  ├─ LDAP (ldap3, always in run_in_threadpool — it's synchronous)
  ├─ Entra/Graph (msal, Phase 2)
  └─ SQLite via SQLAlchemy + Alembic (data/platform.db)
```

### Config Layers

1. **Bootstrap** (`.env` → `backend/config.py`) — JWT secret, ports, CORS
2. **Runtime** (`data/config.json` ↔ `backend/app_config.py`) — LDAP, Entra, local admin hash
3. **Database** (`data/platform.db`) — Tenants, PersonaUsers (Persona app users, not AD identities)

On first startup after Phase 2, `main.py` seeds Phase-1 `config.json` data into the DB.

### Auth Model

- **Local admin**: bcrypt hash in `data/config.json` → DB
- **AD users**: LDAP bind only — credentials never stored
- **JWT**: Short-lived tokens stored in a module-level variable in the frontend (NOT localStorage — cleared on page refresh by design)
- **Service account password**: Always redacted (`••••••••`) in all API responses

### Multi-Tenancy

Every DB model uses `TenantScopedMixin` (adds `tenant_id`, indexed). Every query **must** filter by `tenant_id`. Routes will move to `/api/v1/t/{tenant_slug}/...` in Phase 2+.

## Key File Map

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app, CORS, startup lifecycle (migrations, seed), static serving |
| `backend/config.py` | .env → Pydantic Settings |
| `backend/app_config.py` | data/config.json ↔ Pydantic (atomic reads/writes) |
| `backend/deps.py` | JWT create/verify, `require_jwt`, `optional_jwt` dependencies |
| `backend/auth/ldap.py` | LDAP bind, tree/user queries, account status (FILETIME conversion) |
| `backend/auth/msal.py` | MSAL client credentials, Graph API token, Entra queries |
| `backend/database/base.py` | `DeclarativeBase`, `TenantScopedMixin` |
| `backend/database/session.py` | SQLite engine, `SessionLocal`, `get_db()` dependency |
| `backend/models/schemas.py` | All Pydantic request/response shapes |
| `frontend/src/App.jsx` | Router, AppShell (sidebar + content) |
| `frontend/src/context/AuthContext.jsx` | Module-level JWT, user state, login/logout |
| `frontend/src/components/SetupWizard.jsx` | 5-step setup: local admin → LDAP → Entra → confirm |

## Coding Rules

These rules come from `.github/copilot-instructions.md` and are enforced:

1. **`tenant_id` on every DB model and every query — never omit**
2. **All LDAP calls must use `run_in_threadpool`** (ldap3 is synchronous)
3. **Pydantic models for all API shapes** — no raw dicts in route responses
4. **Alembic migration for every schema change** — no manual SQL
5. **Service account password always redacted in API responses**
6. **Read-only until Phase 4** — no write operations (password reset, group changes) before audit infrastructure exists
7. **Secrets only in `data/config.json`** — never in code, Dockerfile, or `.env` beyond JWT_SECRET
8. **Update `CHANGELOG.md`** on every meaningful change
9. **No org-specific values** in code or docs — keep everything generic

## UI Design Tokens

Colors defined in `frontend/src/index.css` and `tailwind.config.js`:

- Background: `#0f1117`, Surface: `#1a1d27`, Border: `#2d3148`
- Brand primary: `#6474e5`, Accent: `#7c3aed`
- Status: Success `#4ade80`, Warning `#f59e0b`, Danger `#f87171`

Layout: left sidebar + right content. Login/Setup: centered card. Write operations (Phase 4+) always follow: preview → confirm → execute → audit.

## Git & Release Workflow

```bash
# Feature work
git checkout -b feature/my-feature develop
# PRs target `develop`, not `main`

# Release
git checkout main && git merge develop
git tag -a v0.3.0 -m "Release v0.3.0"
git push origin main --tags
# GitHub Actions publishes :latest and :v0.3.0 to ghcr.io
```

CI: `docker-dev.yml` triggers on push to `develop` → `:dev` image. `docker-publish.yml` triggers on push to `main` or version tags → `:latest` / `:v*.*.*`.

## Phase Status

| Phase | Status | Scope |
|-------|--------|-------|
| 1 | Complete | Setup wizard, local admin, AD login, LDAP tree, user panel |
| 2 | In progress | Entra connect, SQLite DB, cloud view, TAP, groups read |
| 3+ | Planned | Exchange, write ops, workflows, rules, devices, MSP, AI |

Full details in `docs/ROADMAP.md`. One phase at a time — validate before starting the next.
