# Spec: Settings & Configuration System

**Status:** In progress (part of Phase 1)
**Version target:** 0.2.0

---

## Objective

Persona must be configurable entirely through the UI. No admin should need to
edit files on the server after the initial `docker compose up`. All LDAP/AD
connection settings are entered, tested, and saved through the Settings UI.

This makes Persona portable, community-distributable, and safe to document
without exposing sensitive values in config files checked into source control.

---

## Config Storage

Settings are stored in `data/config.json`, mounted as a Docker volume.
The `data/` directory persists across container restarts and rebuilds.

```
persona/
└── data/
    ├── .gitkeep       ← in git (keeps folder), no other files committed
    └── config.json    ← gitignored, created at first-run setup
```

`data/config.json` schema:

```json
{
  "ldap": {
    "host": "192.168.1.10",
    "port": 389,
    "use_ssl": false,
    "base_dn": "DC=yourdomain,DC=com",
    "service_account_dn": "CN=persona-svc,OU=Service Accounts,DC=yourdomain,DC=com",
    "service_account_password": "stored-but-never-logged"
  },
  "app": {
    "site_name": "Persona",
    "setup_complete": true
  }
}
```

---

## Bootstrap `.env` (Minimal)

The `.env` file contains only values needed before config.json exists:

```
JWT_SECRET=generate-with-python-secrets
JWT_EXPIRE_MINUTES=480
APP_PORT=8000
FRONTEND_PORT=5173
CORS_ORIGINS=http://localhost:5173
```

No LDAP values. No domain names. Nothing company-specific.

---

## Backend: `app_config.py`

Module responsible for reading and writing `data/config.json`.

```python
CONFIG_PATH = Path("data/config.json")

def load_config() -> dict
def save_config(config: dict) -> None
def is_setup_complete() -> bool
def get_ldap_settings() -> LDAPSettings | None
```

- `load_config()` returns empty/default dict if file does not exist.
- `save_config()` writes atomically (write to temp file, rename).
- `is_setup_complete()` returns `config.get("app", {}).get("setup_complete", False)`.
- `get_ldap_settings()` returns a typed LDAPSettings object or None.

---

## Backend: Settings Routes (`routes/settings.py`)

All settings endpoints require either:
- No auth (for the initial setup wizard before any user can log in), OR
- A valid JWT for the settings page accessed post-login.

Handle this with a dependency that checks `is_setup_complete()` — if setup
is not complete, allow unauthenticated access to POST /settings/setup only.

### GET `/api/v1/settings/status`
No auth required.
```json
{
  "setup_complete": false,
  "site_name": "Persona"
}
```
Used by the frontend on every load to decide: show Setup Wizard or Login.

### GET `/api/v1/settings/ldap`
Requires JWT.
Returns LDAP settings with password redacted:
```json
{
  "host": "192.168.1.10",
  "port": 389,
  "use_ssl": false,
  "base_dn": "DC=yourdomain,DC=com",
  "service_account_dn": "CN=persona-svc,...",
  "service_account_password": "••••••••"
}
```

### POST `/api/v1/settings/test-connection`
No auth required during setup. JWT required post-setup.
```json
Request:  { host, port, use_ssl, base_dn, service_account_dn, service_account_password }
Response: { success: true, message: "Connected successfully. Found 1,247 objects." }
       or { success: false, message: "Connection refused. Check host and port." }
```
Performs a live LDAP bind using the provided credentials.
Does NOT save anything. Test only.

### POST `/api/v1/settings/setup`
Available without auth ONLY when `setup_complete` is false.
After setup_complete is true, this endpoint returns 403.
```json
Request:  { ldap: { host, port, use_ssl, base_dn, service_account_dn, service_account_password }, site_name: "Persona" }
Response: { success: true }
```
Saves config.json and sets `setup_complete: true`.

### PUT `/api/v1/settings/ldap`
Requires JWT. Updates LDAP settings post-setup.
Same shape as POST /settings/setup ldap block.
Runs a test connection before saving — rejects if connection fails.

---

## Frontend: Setup Wizard (`SetupWizard.jsx`)

Shown when `GET /api/v1/settings/status` returns `setup_complete: false`.
Replaces the entire app — no sidebar, no header — just a centered card.

### Step 1 — Welcome
- Persona logo + wordmark
- Brief description: "Welcome to Persona. Let's connect to your Active Directory."
- "Get Started" button

### Step 2 — LDAP Connection
Fields:
- Domain Controller / LDAP Host (text, placeholder: `192.168.1.10 or dc.yourdomain.com`)
- Port (number, default: 389)
- Use SSL/LDAPS toggle (default: off, changes port to 636 when toggled on)
- Base DN (text, placeholder: `DC=yourdomain,DC=com`)

Helper text under Base DN:
> "Your Base DN is the root of your Active Directory. For a domain like
> yourdomain.com it would be DC=yourdomain,DC=com"

### Step 3 — Service Account
Fields:
- Service Account DN (text, placeholder: `CN=persona-svc,OU=Service Accounts,DC=yourdomain,DC=com`)
- Password (password input)

Helper text:
> "Persona uses a read-only service account to browse the directory.
> This account only needs Read permissions on the AD objects you want
> help desk staff to see."

"Test Connection" button — calls POST /settings/test-connection.
Shows inline success (green) or error (red) result.
"Next" button disabled until test passes.

### Step 4 — Confirm
- Summary of settings entered (password shown as ••••••••)
- "Save & Finish" button — calls POST /settings/setup
- On success: redirect to `/login`

---

## Frontend: Settings Page (`SettingsPage.jsx`)

Accessible from the sidebar gear icon when logged in.
Shows the same LDAP fields as the wizard, pre-populated (password redacted).
"Test Connection" button before saving any changes.
"Save Changes" button — calls PUT /settings/ldap.

Future phases will add additional settings sections here (Entra, roles, etc.).

---

## `.gitignore` Additions

```
# Persona runtime data
data/config.json
data/*.json

# Environment
.env
```

The `data/` directory itself is committed (via `.gitkeep`) so Docker can mount
the volume correctly without the directory needing to exist on the host.

---

## Docker Volume

`docker-compose.yml` must mount the `data/` directory:

```yaml
services:
  backend:
    volumes:
      - ./data:/app/data
```

This ensures config.json persists across container restarts and image rebuilds.

---

## Acceptance Criteria

- [ ] Fresh `docker compose up` with empty `data/` shows Setup Wizard
- [ ] Setup Wizard walks through all steps without requiring file edits
- [ ] "Test Connection" shows a meaningful success or error message
- [ ] After setup, app redirects to login
- [ ] Settings page shows current LDAP config with password redacted
- [ ] Changing settings requires a successful test connection before saving
- [ ] `data/config.json` is gitignored
- [ ] `.env` contains no LDAP values
- [ ] No company-specific values appear anywhere in the UI copy
