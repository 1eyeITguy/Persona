# Spec: Phase 1 — AD Login + Directory Tree

**Status:** In progress
**Version target:** 0.2.0

---

## Objective

A help desk tech opens Persona in a browser, logs in with their on-prem AD
credentials, and sees an expandable directory tree identical in structure to
Active Directory Users and Computers (ADUC). Clicking a user opens a side
panel showing that user's standard attributes.

Phase 1 is **read-only**. No write operations of any kind.

---

## Backend Specification

### `backend/config.py` — Bootstrap Settings

Pydantic `BaseSettings`. Reads from `.env` only. No LDAP values here.

```python
class Settings(BaseSettings):
    jwt_secret: str
    jwt_expire_minutes: int = 480
    app_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]
    data_dir: str = "/app/data"

    class Config:
        env_file = ".env"
```

### `backend/app_config.py` — Runtime Config

Reads and writes `data/config.json`. All writes are atomic (temp file + rename).

```python
def load_config() -> dict
def save_config(config: dict) -> None
def is_setup_complete() -> bool       # local_admin_created AND ldap_configured
def get_ldap_settings() -> LDAPSettings | None
def get_local_admin() -> LocalAdmin | None
```

### `backend/auth/ldap.py` — LDAP Operations

All ldap3 calls are synchronous. Callers must use `run_in_threadpool`.

**`authenticate_user(username, password) → dict`**
- Loads LDAP settings. Raises 503 if not configured.
- Uses service account to resolve user DN from sAMAccountName.
- Binds with user's DN + password to authenticate.
- Returns user attributes dict on success. Raises 401 on failure.
- Password is never logged. Error messages are generic.

**`get_service_connection() → ldap3.Connection`**
- Returns RESTARTABLE service account connection.
- Raises 503 if LDAP not configured.

**`test_ldap_connection(settings: LDAPSettings) → TestConnectionResponse`**
- Live bind test with provided settings.
- Returns success + object count, or failure + clear error message.
- Used by Setup Wizard and Settings page.

**`query_tree(dn: str) → list[dict]`**
- One level of children for the given DN.
- Filter: `(|(objectClass=organizationalUnit)(objectClass=container)(objectClass=user))`
- Each node: `{ dn, name, type: "ou"|"container"|"user", has_children: bool }`
- Sort: OUs/containers first (alpha), then users (alpha).

**`query_user(dn: str) → ADUser`**
- Full attribute set per the ADUser model.
- Decodes `userAccountControl` → `account_status` string.
- Decodes `pwdLastSet`, `accountExpires`, `lockoutTime` from Windows FILETIME to ISO 8601.
- Resolves `manager` DN → displayName via second LDAP query.
- Returns `member_of` as list of group display names, not DNs.

### API Endpoints (Phase 1)

#### `GET /api/v1/settings/status` — No auth
```json
{ "local_admin_created": false, "ldap_configured": false, "setup_complete": false }
```

#### `POST /api/v1/settings/bootstrap` — No auth, first run only
```json
Request:  { "username": "admin", "password": "...", "confirm_password": "..." }
Response: { "success": true }
```
- Only works when `local_admin_created = false`. Returns 403 after.
- Validates password strength. Hashes with bcrypt cost 12. Saves to config.json.

#### `POST /api/v1/settings/test-connection` — No auth during setup
```json
Request:  { "host": "...", "port": 389, "use_ssl": false, "base_dn": "...",
            "service_account_dn": "...", "service_account_password": "..." }
Response: { "success": true, "message": "Connected. Found 1,247 objects." }
```

#### `POST /api/v1/settings/setup` — No auth, first run only
Saves LDAP config. Sets `ldap_configured: true`. Returns 403 if already done.

#### `GET /api/v1/settings/ldap` — JWT required
Returns LDAP settings with `service_account_password` replaced by `"••••••••"`.

#### `PUT /api/v1/settings/ldap` — JWT required
Tests connection before saving. Rejects if test fails.

#### `POST /api/v1/auth/login` — No auth
```json
Request:  { "username": "jsmith", "password": "..." }
Response: { "access_token": "...", "token_type": "bearer",
            "user": { "display_name": "Jane Smith", "username": "jsmith", "role": "helpdesk" } }
```
- Tries local admin first, then AD (if configured).
- Returns 503 if AD not configured and local admin login fails.
- Returns 401 with generic message on failure — never specifics.
- Rate-limits: 5 failures → 15-minute lockout per username.

#### `GET /api/v1/auth/me` — JWT required
Returns decoded JWT payload. No LDAP call.

#### `GET /api/v1/ad/tree` — JWT required
Query param: `dn` (optional, defaults to `base_dn`)
```json
{ "dn": "DC=yourdomain,DC=com",
  "children": [{ "dn": "...", "name": "Corp Users", "type": "ou", "has_children": true }] }
```

#### `GET /api/v1/ad/ou/{encoded_dn}/children` — JWT required
DN is URL-encoded. Same response shape as tree children array.

#### `GET /api/v1/ad/user/{encoded_dn}` — JWT required
Returns full ADUser object.

---

## ADUser Attribute Schema

```python
class ADUser(BaseModel):
    dn: str
    sam_account_name: str
    upn: str | None
    display_name: str | None
    given_name: str | None
    surname: str | None
    mail: str | None
    telephone_number: str | None
    mobile: str | None
    title: str | None
    department: str | None
    company: str | None
    manager_dn: str | None
    manager_display_name: str | None   # resolved
    member_of: list[str]               # group display names
    account_expires: str | None        # ISO 8601 or "Never"
    pwd_last_set: str | None           # ISO 8601
    lockout_time: str | None           # ISO 8601 or None
    bad_pwd_count: int | None
    account_status: str                # "Enabled" | "Disabled" | "Locked Out"
    when_created: str | None           # ISO 8601
    when_changed: str | None           # ISO 8601
```

---

## Frontend Specification

### Routing

```
App loads → GET /api/v1/settings/status
    ├── local_admin_created=false → SetupWizard (step 1)
    ├── ldap_configured=false     → SetupWizard (step 2)
    └── complete + no token       → LoginForm

Token present → Main app shell
    ├── /          → ADTree + UserPanel
    └── /settings  → SettingsPage
```

### SetupWizard (`SetupWizard.jsx`)
4 steps as specified in `docs/specs/setup-wizard-local-admin.md`.
Centered card, Persona logo above. No app shell (no sidebar/header).

### LoginForm (`LoginForm.jsx`)
- Username: label "Username", helper text "Your Windows/AD username"
- Password field
- "Sign in" button with loading state
- Inline error on failure: "Invalid username or password"
- No hint about whether it's a local or AD account issue
- On success: store JWT in AuthContext (module variable, not localStorage)

### App Shell
- Left sidebar: Persona logo, nav links, gear icon → /settings
- Top header: "Connect to Entra" button (disabled, tooltip "Coming in Phase 2"),
  logged-in display name, logout button
- Main content area: ADTree + UserPanel side by side

### ADTree (`ADTree.jsx`)
- Lazy-loads children on expand (fetch only if not already cached by DN)
- Folder icon for OU/container, person icon for user
- Chevron rotates on expand, smooth CSS transition
- Spinner on node being fetched, inline error if fetch fails
- 1rem indentation per depth level
- Clicking a user → calls `onUserSelect(dn)` prop

### UserPanel (`UserPanel.jsx`)
- Fetches user on `userDn` prop change
- Header: initials avatar, displayName, title, department
- Status badge: Enabled (green) / Locked Out (amber) / Disabled (red)
- Sections: Identity, Contact, Organization, Security — all read-only
- Close button — tree expansion state preserved
- Loading skeleton, error state

### SettingsPage (`SettingsPage.jsx`)
- Pre-populates LDAP fields from `GET /api/v1/settings/ldap`
- Password field shows redacted — clears when user clicks to edit
- "Test Connection" button required before saving
- "Save Changes" → `PUT /api/v1/settings/ldap`

---

## Docker Files

### `Dockerfile` (single container — backend serves frontend build)
```
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY frontend/dist/ ./static/
RUN mkdir -p /app/data
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```
FastAPI serves the built React app as static files in production.

### `docker-compose.dev.yml` (development — hot reload)
Two services: backend (uvicorn --reload) + frontend (vite dev server).
Both mount source as volumes. Frontend proxies `/api` to backend.

---

## Acceptance Criteria

- [ ] Fresh install shows Setup Wizard on first open
- [ ] Cannot reach login without completing both wizard steps
- [ ] Weak passwords rejected during bootstrap with clear feedback
- [ ] Local admin can log in before LDAP is configured
- [ ] AD users cannot log in until LDAP is configured
- [ ] Login form gives no hint which part of the credential was wrong
- [ ] 5 failed logins triggers 15-minute lockout
- [ ] AD tree renders from base DN
- [ ] OUs expand lazily, children cached after first load
- [ ] Clicking a user loads their attribute panel
- [ ] All dates are human-readable (not raw Windows FILETIME integers)
- [ ] Account status badge is accurate for all three states
- [ ] Service account password never appears in logs or API responses
- [ ] `docker compose up` with only `.env` starts the app cleanly
- [ ] `GET /api/health` returns 200

## Definition of Done

All acceptance criteria pass. CHANGELOG updated to version `0.2.0`.
