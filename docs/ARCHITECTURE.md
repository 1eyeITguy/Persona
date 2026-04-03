# Architecture — Persona

## System Overview

```
[Browser]
    │  HTTP
    ▼
[Docker Container — Persona]
    ├── React Frontend  (served by FastAPI in production, Vite in dev)
    └── FastAPI Backend
          ├── LDAP bind ──────────────→ [On-prem Active Directory]
          ├── MSAL OAuth ─────────────→ [Entra ID / Graph API]  ← Phase 2+
          └── data/config.json ───────→ [Docker Volume on host]
```

Persona runs entirely on your infrastructure. No data leaves your network
except for the Entra/Exchange connections you explicitly authorize in Phase 2+.

---

## Authentication Model

### Local Admin (Phase 1)
- Created during Setup Wizard on first run
- Password hashed with bcrypt (cost 12), stored in `data/config.json`
- Used to configure AD before LDAP is available, and as break-glass recovery
- JWT role: `local_admin`

### AD Users (Phase 1)
- Credentials submitted at login form
- Backend performs LDAP bind using user's credentials to authenticate
- Credentials exist in memory only for the bind — never stored, never logged
- On success: JWT issued using service account for all subsequent queries
- JWT role: `helpdesk`

### Entra ID (Phase 2+)
- Triggered by "Connect to Entra" button in the UI
- MSAL OAuth2 authorization code flow
- Scoped to read-only Graph API permissions
- Token stored server-side, never exposed to frontend

---

## Identity Boundary

| Attribute type | Authoritative source | Persona writes? |
|---|---|---|
| AD attributes (sAMAccountName, DN, etc.) | On-prem AD | Phase 4+ with guardrails |
| Exchange attributes (proxy addresses, etc.) | Exchange Online (cloud SOA) | Never |
| Entra-only attributes (MFA state, etc.) | Entra ID | Phase 4+ via Graph API |

`BlockExchangeProvisioningFromOnPremEnabled = True` is respected at the
application level. Persona never writes Exchange attributes via LDAP.

---

## Configuration Model

Two-layer, no secrets in source control:

**Layer 1 — `.env`** (host filesystem, gitignored)
Bootstrap only: JWT secret, port. Read by Docker Compose at startup.

**Layer 2 — `data/config.json`** (host filesystem, gitignored, Docker volume)
LDAP settings + local admin password hash. Written by Setup Wizard and Settings page.

---

## Backend

- Entry point: `backend/main.py`
- Settings: `backend/config.py` (Pydantic BaseSettings, reads `.env`)
- App config: `backend/app_config.py` (reads/writes `data/config.json`)
- All LDAP calls in thread pool via `run_in_threadpool` — never block the event loop

### API Prefix: `/api/v1/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | Health check |
| GET | `/api/v1/settings/status` | None | Setup state |
| POST | `/api/v1/settings/bootstrap` | None (first run only) | Create local admin |
| POST | `/api/v1/settings/test-connection` | None/JWT | Test LDAP bind |
| POST | `/api/v1/settings/setup` | None (first run only) | Save LDAP config |
| GET | `/api/v1/settings/ldap` | JWT | Get LDAP config (password redacted) |
| PUT | `/api/v1/settings/ldap` | JWT | Update LDAP config |
| POST | `/api/v1/auth/login` | None | Login (local or AD) |
| GET | `/api/v1/auth/me` | JWT | Current user info |
| GET | `/api/v1/ad/tree` | JWT | AD OU tree (one level) |
| GET | `/api/v1/ad/ou/{dn}/children` | JWT | Children of an OU |
| GET | `/api/v1/ad/user/{dn}` | JWT | User attributes |

---

## Frontend

- Build tool: Vite
- Styling: Tailwind CSS with custom Persona color palette
- Routing: React Router v6
- State: React Context + hooks (no Redux in Phase 1)
- Token storage: JS module variable — not localStorage or sessionStorage

### Route Logic

```
App loads
    │
    ├── GET /api/v1/settings/status
    │       │
    │       ├── local_admin_created=false → <SetupWizard /> (Step 1)
    │       ├── ldap_configured=false     → <SetupWizard /> (Step 2)
    │       └── both true + no token      → <LoginForm />
    │
    └── Token present → Main app shell → <ADTree /> + <UserPanel />
```

---

## Deployment

### Development
- `docker-compose.dev.yml` — builds from local source, hot reload on both backend and frontend

### Production (End Users)
- `docker-compose.yml` — pulls published image from `ghcr.io`
- GitHub Actions builds and publishes image on every push to `main` and on release tags

### Versioning
- `main` branch → `:latest` tag
- Release tag `v0.2.0` → `:v0.2.0` and `:latest`
- Multi-platform build: `linux/amd64` and `linux/arm64`
