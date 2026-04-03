# Copilot Kick-Off Prompts — Phase 1

Paste these into GitHub Copilot Chat (Claude Sonnet model) IN ORDER.
Wait for each prompt to complete before sending the next.

Before starting: make sure `.github/copilot-instructions.md`,
`docs/specs/phase-01-ad-auth-tree.md`, and `docs/specs/settings-config.md`
are all committed to the repo. Copilot will reference them.

---

## PROMPT 1 — Backend foundation + config system

```
Read .github/copilot-instructions.md, docs/specs/phase-01-ad-auth-tree.md,
and docs/specs/settings-config.md carefully before writing any code.

Scaffold the backend for Persona. Create these files:

backend/requirements.txt
  Include: fastapi, uvicorn[standard], ldap3, python-jose[cryptography],
  passlib[bcrypt], python-dotenv, pydantic-settings, python-multipart

backend/config.py
  Pydantic BaseSettings — bootstrap values from .env only:
  jwt_secret, jwt_expire_minutes, app_port, frontend_port,
  cors_origins (list[str]), data_dir (str, default "/app/data")
  No LDAP values here.

backend/app_config.py
  Reads and writes data/config.json as specified in docs/specs/settings-config.md.
  Functions: load_config(), save_config(config), is_setup_complete(),
  get_ldap_settings() returning a typed LDAPSettings Pydantic model or None.
  Writes are atomic (write to temp file, os.rename).
  Never logs the service_account_password.

backend/models/schemas.py
  Pydantic models: LDAPSettings, AppConfig, FullConfig, LoginRequest,
  TokenResponse, UserInfo, ADUser (full attribute schema from the Phase 1 spec),
  SettingsStatusResponse, TestConnectionRequest, TestConnectionResponse,
  SetupRequest.

backend/main.py
  FastAPI app. CORS from settings. Health check at GET /api/health.
  OpenAPI at /api/docs. Routers mounted at /api/v1 (wire in later).

Do not create route files yet.
Update CHANGELOG.md — add entries under [Unreleased] for everything created.
```

---

## PROMPT 2 — LDAP module

```
Using backend/app_config.py and backend/models/schemas.py, create
backend/auth/ldap.py as specified in docs/specs/phase-01-ad-auth-tree.md.

Two concerns:

1. authenticate_user(username: str, password: str) -> dict
   - Loads LDAP settings from get_ldap_settings(). Raises 503 if not configured.
   - Uses service account to resolve the user's full DN from sAMAccountName.
   - Attempts a bind with the user's DN + supplied password.
   - Returns dict of user attributes on success. Raises 401 on failure.
   - Password is never logged.

2. get_service_connection() -> ldap3.Connection
   - Returns a RESTARTABLE service account connection.
   - Loads settings from get_ldap_settings(). Raises 503 if not configured.

3. test_ldap_connection(settings: LDAPSettings) -> TestConnectionResponse
   - Performs a live bind with the provided settings.
   - Returns success with object count or failure with a clear error message.
   - Used by the Setup Wizard and Settings page test button.

4. query_tree(dn: str) -> list[dict]
   - One level of children for the given DN.
   - Each: { dn, name, type: "ou"|"container"|"user", has_children: bool }
   - Sorted: OUs/containers first, then users, both alphabetical.

5. query_user(dn: str) -> ADUser
   - Full attribute set as defined in ADUser model.
   - Decodes userAccountControl, Windows FILETIME dates.
   - Resolves manager DN to display name.
   - Returns member_of as display names.

All ldap3 calls are synchronous — document that callers use run_in_threadpool.

Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 3 — Settings routes

```
Create backend/routes/settings.py as specified in docs/specs/settings-config.md.

Endpoints:
  GET  /api/v1/settings/status      — no auth, returns setup_complete + site_name
  POST /api/v1/settings/test-connection — no auth during setup, JWT post-setup
  POST /api/v1/settings/setup       — no auth, only works when setup_complete=false
  GET  /api/v1/settings/ldap        — JWT required, returns config (password redacted)
  PUT  /api/v1/settings/ldap        — JWT required, tests then saves updated LDAP settings

Wire settings router into backend/main.py.

Important: POST /settings/setup must return 403 if setup is already complete.
All connection tests run through ldap.test_ldap_connection().

Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 4 — Auth routes

```
Create backend/routes/auth.py

POST /api/v1/auth/login
  Request: { username: str, password: str }
  If setup is not complete, return 503 with message "Setup not complete".
  Calls ldap.authenticate_user() wrapped in run_in_threadpool.
  On success: issues JWT (sub=sAMAccountName, display_name, dn, exp).
  Returns TokenResponse.
  On failure: 401 with generic message — no detail about why it failed.

GET /api/v1/auth/me
  Requires Bearer token.
  Returns decoded token payload. No LDAP call.

Wire auth router into backend/main.py.
Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 5 — AD routes

```
Create backend/routes/ad.py

All endpoints require a valid JWT.
All LDAP calls use run_in_threadpool.

GET /api/v1/ad/tree
  Query param: dn (optional, defaults to base_dn from app config)
  Returns { dn, children: [{ dn, name, type, has_children }] }

GET /api/v1/ad/ou/{encoded_dn}/children
  DN is URL-encoded. Same response shape as /tree children array.

GET /api/v1/ad/user/{encoded_dn}
  DN is URL-encoded. Returns full ADUser model.

Wire ad router into backend/main.py.
Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 6 — Frontend scaffold + routing

```
Read .github/copilot-instructions.md for UI design rules before starting.

Scaffold the React frontend:

frontend/package.json
  Dependencies: react@18, react-dom@18, react-router-dom, axios,
  lucide-react, @vitejs/plugin-react, vite, tailwindcss, autoprefixer,
  postcss

frontend/vite.config.js
  Proxy /api → http://localhost:8000

frontend/tailwind.config.js
  Extend colors:
  brand: { primary: '#6474e5', accent: '#7c3aed' }
  surface: '#1a1d27'
  app-bg: '#0f1117'
  border-subtle: '#2d3148'
  success: '#4ade80'
  warning: '#f59e0b'
  danger: '#f87171'

frontend/src/context/AuthContext.jsx
  Provides: token, user, login(token, user), logout()
  Token in module-level variable — NOT localStorage.

frontend/src/hooks/useAppConfig.js
  Calls GET /api/v1/settings/status on mount.
  Returns { setupComplete, loading, error }

frontend/src/App.jsx
  On load, calls useAppConfig.
  If loading → show full-screen spinner.
  If !setupComplete → show <SetupWizard />
  If setupComplete and no token → show <LoginForm />
  If setupComplete and token → show main app shell.
  Main shell: left sidebar + top header + content area (React Router Outlet).

frontend/src/main.jsx and frontend/index.html
  Title: "Persona"

Do not create component files yet. Just the scaffold and routing.
Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 7 — Setup Wizard

```
Create frontend/src/components/SetupWizard.jsx
as specified in docs/specs/settings-config.md.

4-step wizard. Centered card layout. Persona logo above the card.
Dark theme using Tailwind custom colors defined in tailwind.config.js.

Step 1 — Welcome screen with "Get Started" button.

Step 2 — LDAP connection fields:
  Host, Port (default 389), SSL toggle (switches port to 636),
  Base DN with helper text explaining what it is.
  "Next" button.

Step 3 — Service account fields:
  Service Account DN with placeholder example.
  Password field.
  Helper text explaining what permissions the service account needs.
  "Test Connection" button → POST /api/v1/settings/test-connection
  Shows inline success (green) or failure (red + message).
  "Next" disabled until test succeeds.

Step 4 — Summary + save.
  Shows all entered values (password redacted).
  "Save & Finish" → POST /api/v1/settings/setup
  On success → navigate to /login

Step indicators at the top showing 1-2-3-4 with current step highlighted.

Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 8 — Login form

```
Create frontend/src/components/LoginForm.jsx

Centered card layout (same aesthetic as Setup Wizard — consistent card style).
Persona logo + wordmark above the card.
Fields: Username (label: "Username", helper: "Your Windows/AD username"),
        Password.
"Sign in with Active Directory" button.
Loading state on the button.
Error state: inline "Invalid username or password" — no technical detail.
On success: store token via AuthContext.login(), navigate to /.

Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 9 — AD Tree + User Panel

```
Create:
  frontend/src/hooks/useADTree.js
  frontend/src/components/ADTree.jsx
  frontend/src/components/UserPanel.jsx

ADTree:
  Lazy-loads children on OU/container expand.
  Caches loaded children by DN (no re-fetching on collapse/expand).
  Folder icon for OU/container, person icon for user.
  Chevron rotates on expand. Smooth CSS transition.
  Spinner on the node being fetched.
  Error shown inline if fetch fails.
  Clicking user calls onUserSelect(dn) prop.
  Indentation: 1rem per depth level.

UserPanel:
  Fetches GET /api/v1/ad/user/{encodedDn} when userDn prop changes.
  Header: initials avatar (brand-primary bg), displayName, title, department.
  Account status badge: Enabled (success), Locked Out (warning), Disabled (danger).
  Sections: Identity, Contact, Organization, Security — all read-only.
  Close button. Tree expansion state is preserved on close.
  Loading skeleton. Error state.

App shell (update App.jsx):
  Left sidebar: Persona logo, nav links (AD Directory active, others dimmed),
  gear icon at bottom → /settings.
  Top header: "Connect to Entra" button (disabled, tooltip "Coming soon"),
  logged-in displayName, logout button.
  Main content: <ADTree /> with <UserPanel /> as a right-side panel
  (rendered alongside tree, not replacing it).

Update CHANGELOG.md under [Unreleased].
```

---

## PROMPT 10 — Settings page + Docker

```
Create frontend/src/components/SettingsPage.jsx

Accessible at /settings from the sidebar gear icon.
Shows current LDAP settings pre-populated (GET /api/v1/settings/ldap).
Password field shows redacted value — clears when user clicks to edit.
"Test Connection" button before saving.
"Save Changes" → PUT /api/v1/settings/ldap.
Success/error feedback inline.

Then create the Docker files:

docker-compose.yml
  backend service: build ./backend, port APP_PORT:8000, env_file .env,
  volume ./data:/app/data (config persistence), volume ./backend:/app (dev HMR)

  frontend service: build ./frontend, port FRONTEND_PORT:5173,
  volume ./frontend:/app, exclude /app/node_modules

backend/Dockerfile
  FROM python:3.11-slim. Install requirements. Copy app. Run uvicorn.
  Create /app/data directory in the image.

frontend/Dockerfile
  FROM node:20-alpine. Install deps. Run vite dev --host.

.gitignore
  .env, __pycache__, .venv, *.pyc, node_modules, dist, data/config.json, data/*.json

data/.gitkeep
  Empty file — keeps the data/ directory in git without committing config.json.

Finally, update CHANGELOG.md:
  Move all [Unreleased] entries into version [0.2.0] with today's date.
  Description: "Phase 1 — Setup Wizard, AD Login, Directory Tree, Settings"

List any remaining gaps before docker compose up.
```

---

## After All 10 Prompts

```bash
cp .env.example .env
# Edit JWT_SECRET only — generate with:
# python -c "import secrets; print(secrets.token_hex(32))"

docker compose up --build
# Open http://localhost:5173
# You'll see the Setup Wizard — no file editing needed.
```
