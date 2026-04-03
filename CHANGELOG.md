# Changelog

All notable changes to Persona are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed
- Root `Dockerfile` (multi-stage) added for GitHub Actions workflow.
  Stage 1: `node:20-alpine` builds the React app (`npm run build` → `dist/`).
  Stage 2: `python:3.11-slim` installs backend deps, copies backend source and
  the built `dist/` into `./static/`.
- `backend/main.py` — mounts `static/assets` as `StaticFiles` and adds a
  SPA catch-all (`/{full_path:path}` → `index.html`) when `./static/` exists.
  Block is skipped in local dev (no `static/` dir — Vite handles the frontend).

---

## [0.2.0] — 2026-04-03

**Phase 1 — Setup Wizard, AD Login, Directory Tree, Settings**

### Added- `backend/requirements.txt` — Python dependencies: fastapi, uvicorn[standard],
  ldap3, python-jose[cryptography], passlib[bcrypt], python-dotenv,
  pydantic-settings, python-multipart
- `backend/config.py` — Pydantic `BaseSettings` reading bootstrap values from
  `.env` only (`jwt_secret`, `jwt_expire_minutes`, `app_port`, `frontend_port`,
  `cors_origins`, `data_dir`). No LDAP values.
- `backend/app_config.py` — Runtime config reader/writer for `data/config.json`.
  Atomic writes via temp-file + `os.replace`. Functions: `load_config()`,
  `save_config()`, `is_setup_complete()`, `get_ldap_settings()`,
  `get_local_admin()`. Service account password is never logged.
- `backend/models/schemas.py` — All Pydantic models: `LDAPSettings`,
  `LocalAdmin`, `AppConfig`, `FullConfig`, `LoginRequest`, `TokenResponse`,
  `UserInfo`, `SettingsStatusResponse`, `TestConnectionRequest`,
  `TestConnectionResponse`, `SetupRequest`, `BootstrapRequest`, `ADNode`,
  `ADTreeResponse`, `ADUser` (full Phase 1 attribute schema).
- `backend/deps.py` — shared JWT helpers: `create_access_token()`,
  `require_jwt` dependency (401 on missing/invalid token),
  `optional_jwt` dependency (None when unauthenticated).
- `backend/routes/settings.py` — settings endpoints:
  - `GET  /api/v1/settings/status` — public; returns setup state + site_name.
  - `POST /api/v1/settings/bootstrap` — create local admin (bcrypt cost 12,
    password strength enforced); 403 if already created; password never logged.
  - `POST /api/v1/settings/test-connection` — live LDAP bind test; public
    during setup, JWT required post-setup.
  - `POST /api/v1/settings/setup` — save LDAP config; 403 if setup complete.
  - `GET  /api/v1/settings/ldap` — JWT required; password redacted.
  - `PUT  /api/v1/settings/ldap` — JWT required; tests before saving.
- `backend/main.py` — settings router wired into `/api/v1`.
- `backend/routes/auth.py` — auth endpoints:
  - `POST /api/v1/auth/login` — local admin first, then AD; generic 401 on
    failure; 503 when setup incomplete; per-username rate limit (5 failures
    → 15-minute window); password never logged.
  - `GET  /api/v1/auth/me` — returns decoded JWT payload; no LDAP call.
- `backend/routes/ad.py` — AD directory endpoints (JWT required):
  - `GET /api/v1/ad/tree` — one-level tree from optional dn param (defaults to base_dn).
  - `GET /api/v1/ad/ou/{encoded_dn}/children` — lazy children for a DN.
  - `GET /api/v1/ad/user/{encoded_dn}` — full ADUser attribute set.
- `frontend/package.json` — React 18, react-router-dom, axios, lucide-react,
  Vite, Tailwind CSS, PostCSS.
- `frontend/vite.config.js` — Vite config; `/api` proxy → `http://localhost:8000`.
- `frontend/tailwind.config.js` — custom brand/surface/status colors.
- `frontend/postcss.config.js`, `frontend/index.html`, `frontend/src/index.css`
- `frontend/src/main.jsx` — React 18 entry point.
- `frontend/src/context/AuthContext.jsx` — token in module variable (not localStorage);
  provides `login()`, `logout()`, `getToken()`.
- `frontend/src/hooks/useAppConfig.js` — fetches `/api/v1/settings/status` on mount.
- `frontend/src/App.jsx` — root router; loading spinner → SetupWizard →
  LoginForm → AppShell; sidebar + header with "Connect to Entra" stub.
- `frontend/src/components/SetupWizard.jsx` — 4-step wizard (Welcome →
  Create Admin → Connect AD → Confirm); step indicators; password strength
  meter; Test Connection live bind; Save & Finish → POST /settings/setup.
- `frontend/src/components/LoginForm.jsx` — centered card; username/password;
  loading state; generic error messages (no credential detail); 429 and 503
  handled explicitly; stores token via AuthContext on success.
- `frontend/src/hooks/useADTree.js` — tree state: DN-keyed children cache,
  loading set, error map, expanded set; `fetchRoot()` / `fetchChildren(dn)`
  use `fetchedRef` to prevent duplicate requests; `toggleExpand()` triggers
  lazy fetch on first expand.
- `frontend/src/components/ADTree.jsx` — recursive `TreeNode`; chevron rotates
  on expand (CSS transition); folder icon for OUs/containers, person icon for
  users; spinner replaces icon during fetch; inline error per node; 1rem
  indentation per depth level; user click → `onUserSelect(dn)`.
- `frontend/src/components/UserPanel.jsx` — right-side panel; fetches
  `/api/v1/ad/user/{enc}` on `userDn` prop change; initials avatar; status
  badge (Enabled/Locked Out/Disabled); Identity / Contact / Organization /
  Security sections; loading skeleton; close button (tree state preserved).
- `frontend/src/App.jsx` — `DirectoryPage` updated to real `ADTree` +
  `UserPanel` side-by-side layout.
- `frontend/src/components/SettingsPage.jsx` — pre-populated LDAP fields;
  password shows redacted until user clicks to change; "Test Connection"
  before save; PUT /settings/ldap; success/error feedback inline.
- `backend/models/schemas.py` — added `LDAPSettingsUpdate` (optional
  `service_account_password`); backend keeps existing password when omitted.
- `backend/routes/settings.py` — PUT /settings/ldap updated to use
  `LDAPSettingsUpdate`; falls back to stored password when none supplied.
- `backend/Dockerfile` — python:3.11-slim; installs requirements; creates
  /app/data; runs uvicorn.
- `frontend/Dockerfile` — node:20-alpine; npm install; vite dev --host.
- `docker-compose.dev.yml` — development compose: backend (uvicorn --reload)
  + frontend (vite --host) with source mounts and node_modules exclusion.
  Production `docker-compose.yml` (pull from registry) unchanged.
- `backend/config.py` — fixed `cors_origins` parsing for pydantic-settings v2
  (JSON array format in `.env`); removed redundant field_validator.
- `.env.example` — added `CORS_ORIGINS`, `FRONTEND_PORT`, `DATA_DIR` entries.
- `backend/auth/ldap.py` — All LDAP / Active Directory operations (synchronous;
  callers use `run_in_threadpool`):
  - `authenticate_user()` — service-account DN resolution + user bind; 401 on
    failure with generic message; password never logged.
  - `get_service_connection()` — RESTARTABLE service-account connection; 503
    if LDAP not configured.
  - `test_ldap_connection()` — live bind test with object count; returns
    `TestConnectionResponse`; never raises; used by Setup Wizard and Settings page.
  - `query_tree()` — one-level directory children sorted OUs/containers first
    then users; `has_children` probed per non-user node.
  - `query_user()` — full `ADUser` model; decodes Windows FILETIME timestamps,
    `userAccountControl` account-status, manager DN→displayName, memberOf
    DNs→group displayNames.

---

## [0.1.0] — Project Initialization

### Added
- Repository structure established
- `.github/copilot-instructions.md` — persistent Copilot project context
- `COPILOT_CONTEXT.md` — project summary and design decisions
- `docs/ARCHITECTURE.md` — system architecture overview
- `docs/ROADMAP.md` — phased feature roadmap
- `docs/specs/phase-01-ad-auth-tree.md` — Phase 1 AD tree specification
- `docs/specs/settings-config.md` — Settings & configuration system specification
- `docs/COPILOT_PROMPTS_PHASE1.md` — Copilot prompt sequence for Phase 1
- `CHANGELOG.md` — this file
- `.env.example` — bootstrap environment variables (no LDAP values)
- `data/.gitkeep` — Docker volume mount point for runtime config

### Decisions
- Backend: Python 3.11 + FastAPI (chosen over Node/Express for ldap3 quality)
- AD library: ldap3 (runs in thread pool — never blocks event loop)
- Entra auth: msal (Phase 2+)
- Frontend: React 18 + Tailwind CSS + Vite
- Deployment: Docker + Docker Compose, Portainer-compatible
- Config model: two-layer (.env for bootstrap only, data/config.json for LDAP settings)
- Community-first: no company-specific values anywhere; full Setup Wizard for first run
- Exchange SOA: cloud-only — Persona never writes Exchange attributes via LDAP
