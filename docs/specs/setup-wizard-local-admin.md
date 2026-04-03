# Spec: Setup Wizard & Local Admin Bootstrap Account

**Status:** In progress (part of Phase 1)
**Version target:** 0.2.0

---

## Why a Local Admin Account?

Persona cannot use AD credentials to configure AD — the connection does not
exist yet. A local admin account solves this chicken-and-egg problem and also
provides a **break-glass recovery account** if the domain controller is
unreachable.

This pattern is used by: Portainer, Gitea, Grafana, Authentik, and most
serious self-hosted tools. It is considered best practice.

---

## First-Run Detection

On every request, the backend checks `data/config.json`:

```python
def get_app_state() -> AppState:
    config = load_config()
    return AppState(
        local_admin_created=config.get("local_admin_created", False),
        ldap_configured=config.get("ldap_configured", False),
        setup_complete=config.get("local_admin_created", False)
                      and config.get("ldap_configured", False)
    )
```

Frontend routing logic:

```
GET /api/v1/settings/status
    │
    ├── local_admin_created = false  →  Show Setup Wizard (Step 1: Create Admin)
    ├── ldap_configured = false      →  Show Setup Wizard (Step 2: Connect AD)
    └── both true                    →  Show Login page
```

---

## Local Admin Account Storage

Stored in `data/config.json` — never in `.env`, never in source code.

```json
{
  "local_admin": {
    "username": "admin",
    "password_hash": "$2b$12$..."
  },
  "local_admin_created": true,
  "ldap": { ... },
  "ldap_configured": true
}
```

**Password hashing:** bcrypt via `passlib[bcrypt]`. Minimum cost factor 12.
**Plain-text password:** Never stored. Never logged. Discarded after hashing.

---

## Backend: Local Auth Routes

### POST `/api/v1/auth/login`

Updated to handle both local admin and AD users:

```python
async def login(request: LoginRequest):
    config = load_config()

    # Try local admin first
    if request.username == config["local_admin"]["username"]:
        if verify_password(request.password, config["local_admin"]["password_hash"]):
            return issue_token(username=request.username, role="local_admin", dn=None)
        raise HTTPException(401, "Invalid credentials")

    # Then try AD (only if LDAP is configured)
    if not config.get("ldap_configured"):
        raise HTTPException(503, "AD not configured. Log in as local admin to complete setup.")

    user = await run_in_threadpool(authenticate_ldap_user, request.username, request.password)
    return issue_token(username=user["sam_account_name"], role="helpdesk", dn=user["dn"])
```

JWT payload gains a `role` field:
- `local_admin` — can access Settings, cannot browse AD tree (no LDAP yet)
- `helpdesk` — standard AD-authenticated user

### POST `/api/v1/settings/bootstrap`

Available ONLY when `local_admin_created = false`. Returns 403 after that.

```
Request:  { username: str, password: str, confirm_password: str }
Response: { success: true }
```

Validation:
- Username: 3–32 chars, alphanumeric + underscore only
- Password: minimum 12 characters, must contain upper, lower, number, symbol
- Passwords must match
- On success: hash password with bcrypt, save to config.json,
  set `local_admin_created: true`
- Never log the password or hash

---

## Setup Wizard Steps

### Step 1 — Welcome

Persona logo centered. Clean card.

```
Welcome to Persona

Your open-source help desk tool for Active Directory
and Entra ID environments.

Let's get you set up in two steps.

[Get Started →]
```

### Step 2 — Create Local Admin Account

```
Create Your Admin Account

This account lets you log in to configure Persona before
connecting to Active Directory. Keep these credentials safe —
this is your recovery account if AD is ever unreachable.

Username [______________]
Password [______________]  ← show strength indicator
Confirm  [______________]

Password requirements:
✓ At least 12 characters
✓ Uppercase and lowercase letters
✓ At least one number
✓ At least one special character

[Create Account →]
```

Password strength meter: weak (red) / fair (amber) / strong (green).
"Create Account" disabled until all requirements pass client-side.

On submit: POST `/api/v1/settings/bootstrap`
On success: advance to Step 3.
On error: show inline message (e.g. "Passwords do not match").

### Step 3 — Connect to Active Directory

Same LDAP fields as previously specified in `settings-config.md`:
- Host, Port, SSL toggle, Base DN
- Service Account DN, Password
- Test Connection button (live bind test)
- "Next" disabled until test passes

### Step 4 — Done

```
You're all set!

✓ Admin account created
✓ Active Directory connected

Your help desk team can now log in with their
Active Directory credentials.

[Go to Login →]
```

Clicking "Go to Login" → navigates to `/login`.

---

## Login Page Behavior

Single login form for all users. No separate "local admin" tab needed.

- AD users: enter their Windows username (sAMAccountName) + password
- Local admin: enter the admin username + password set during setup

The backend tries local admin first, then AD. The user never needs to specify
which type they are.

Helper text under username field:
> "Use your Windows username (e.g. jsmith), or the local admin account
> if you need to access settings."

---

## Settings Page — Local Admin Section

Accessible when logged in as local admin. Shows:
- Current admin username (read-only)
- "Change Password" option (requires current password)

Local admin cannot be renamed or deleted — it is the recovery account.
A future phase may add additional local accounts.

---

## Security Notes for Local Admin

- Password hashed with bcrypt, cost factor 12 minimum
- Plain-text password never stored, never logged
- Account is rate-limited: 5 failed attempts → 15 minute lockout
  (implement in Phase 1 — this is a public-facing login)
- No password reset via email (no mail server required for a self-hosted tool)
  → if lost, admin must edit `data/config.json` directly and re-run bootstrap
- Local admin JWT role is `local_admin` — the backend enforces what each role can access

---

## Acceptance Criteria

- [ ] Fresh install with empty `data/` shows Step 1 (Welcome) of Setup Wizard
- [ ] Cannot skip to Step 3 (AD config) without creating admin account first
- [ ] Weak passwords are rejected client-side with clear feedback
- [ ] Password is never stored in plain text — bcrypt hash only
- [ ] After bootstrap, POST /settings/bootstrap returns 403
- [ ] Local admin can log in before LDAP is configured
- [ ] AD users cannot log in until LDAP is configured
- [ ] After LDAP is configured, login works for both local admin and AD users
- [ ] Login page does not reveal which account type failed
- [ ] 5 failed login attempts triggers a 15-minute lockout
