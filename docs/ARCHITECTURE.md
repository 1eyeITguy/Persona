# Architecture — Persona

---

## System Overview

```
[Browser]
    │
    ▼
[Docker Container — Persona]
    ├── React Frontend
    └── FastAPI Backend
          ├── Identity Providers
          │     ├── AD (ldap3) ──────────────→ On-prem Domain Controller
          │     ├── Entra ID (msal) ─────────→ Microsoft Graph API
          │     └── Hybrid (both)
          ├── Exchange Providers
          │     ├── Online (Graph API) ──────→ Exchange Online
          │     ├── On-Prem (EWS/LDAP) ─────→ Exchange Server
          │     └── Hybrid (SOA-resolved)
          ├── Integration Plugins
          │     ├── Sophos, Umbrella, etc. → Vendor APIs
          │     └── Community plugins
          ├── Workflow Engine
          ├── Rules Engine
          └── data/ (Docker volume)
                ├── platform.db      ← SQLite: platform-wide data
                └── tenants/
                      └── {id}/
                            ├── config.json
                            └── audit.db
```

---

## Authentication Model

### Local Admin (Bootstrap)
- Created in Setup Wizard before AD is connected
- Password hashed with bcrypt cost 12
- Stored in data/tenants/{id}/config.json
- Break-glass account — always available even if AD is down
- Rate-limited: 5 failures → 15-minute lockout
- JWT role: local_admin

### AD Users
- Credentials submitted at login form
- Backend performs LDAP bind to authenticate
- Credentials exist in memory only for bind duration
- Never stored, never logged
- Error messages never reveal which part of credential failed
- On success: JWT issued, all subsequent queries use service account
- JWT role: helpdesk_tier1 | helpdesk_tier2

### Entra OAuth (Phase 2+)
- "Connect to Entra" button triggers MSAL auth code flow
- Application permissions (not delegated)
- Token stored server-side, never exposed to frontend
- Scopes added per phase — never over-provisioned

---

## Service Identity Model

Persona operates as itself — not as the logged-in tech.

```
AD Service Account
    Purpose: All LDAP operations
    Auth:    Simple bind (DN + password)
    Perms:   Read-only Phase 1-3, targeted writes Phase 4+
    Stored:  data/tenants/{id}/config.json
    Never:   .env, source code, API responses

Entra Service Principal
    Purpose: All Graph API operations
    Auth:    Client credentials flow (client_id + secret)
    Perms:   Application permissions, scoped per phase
    Stored:  data/tenants/{id}/config.json (secret encrypted)
    Expiry:  Tracked, warning at 30 days before expiry
    Never:   Delegated user permissions

Audit model:
    External log (Entra/AD): Persona service identity = actor
    Internal log (Persona):  Tech identity = actor
    Combined: who triggered it + what executed it
```

---

## Identity Provider Abstraction

```
IdentityProvider (abstract)
    │
    ├── ADIdentityProvider
    │     └── Auth: LDAP bind
    │     └── Directory: LDAP queries
    │     └── Users: ldap3
    │
    ├── EntraIdentityProvider
    │     └── Auth: MSAL device code / auth code
    │     └── Directory: Graph API /users
    │     └── Users: Graph SDK
    │
    └── HybridIdentityProvider
          └── Auth: LDAP bind (AD authoritative for auth)
          └── Directory: LDAP + Graph (merged view)
          └── AD owns: on-prem attributes
          └── Entra owns: cloud attributes
```

Configured in Setup Wizard. Persona behavior adapts automatically.

---

## Exchange SOA Resolution

Exchange attribute authority is determined per-user using three layers.
This runs on every user lookup where Exchange data is needed.

```python
class ExchangeSOA(str, Enum):
    CLOUD          = "cloud"
    ON_PREM        = "on_prem"
    STALE_AD_ATTRS = "stale_ad_attrs"  # dangerous — never display
    UNKNOWN        = "unknown"          # Entra not connected
    NONE           = "none"             # no mailbox

def resolve_exchange_soa(user, org_config, graph_data=None) -> ExchangeSOA:
    # Layer 1: Per-mailbox declaration (highest trust)
    if graph_data and graph_data.is_exchange_cloud_managed is True:
        return ExchangeSOA.CLOUD
    if graph_data and graph_data.is_exchange_cloud_managed is False:
        return ExchangeSOA.ON_PREM

    # Layer 2: Org-wide block
    if org_config.block_exchange_provisioning_from_onprem:
        # AD Exchange attrs present but cloud is SOA — they are stale
        if user.has_legacy_exchange_attrs:
            return ExchangeSOA.STALE_AD_ATTRS
        # No AD Exchange attrs — clean cloud-only
        if graph_data and graph_data.mailbox_exists:
            return ExchangeSOA.CLOUD
        if graph_data is None:
            return ExchangeSOA.UNKNOWN
        return ExchangeSOA.NONE

    # Layer 3: Mailbox location from AD
    if user.msexch_recipient_type == REMOTE_MAILBOX:
        return ExchangeSOA.CLOUD
    if user.msexch_recipient_type == ONPREM_MAILBOX:
        return ExchangeSOA.ON_PREM

    return ExchangeSOA.NONE
```

UI behavior per SOA result:
- CLOUD: show Graph data, label "Exchange Online"
- ON_PREM: show EWS/LDAP data, label "Exchange Server"
- STALE_AD_ATTRS: suppress AD Exchange data, show warning + "Connect Entra"
- UNKNOWN: show warning + "Connect Entra to see mailbox details"
- NONE: show "No mailbox assigned"

---

## Multi-Tenancy

tenant_id is on every database record. Every query filters by tenant_id.
Missing this filter is a data breach. Copilot must include it on every query.

```
data/
├── platform.db                 ← tenants, persona users, role assignments
└── tenants/
      └── {tenant_id}/
            ├── config.json     ← LDAP, Entra, Exchange, plugin credentials
            ├── rules/          ← YAML rule definitions
            ├── workflows/      ← YAML workflow definitions
            └── audit.db        ← immutable audit log, isolated per tenant

API routes:
    /api/v1/t/{tenant_slug}/ad/...
    /api/v1/t/{tenant_slug}/entra/...
    /api/v1/t/{tenant_slug}/devices/...
    /api/v1/operator/...          ← MSP operator only
```

---

## Database

Phase 1: data/config.json (existing — keep working)
Phase 2+: SQLite + Alembic

```
platform.db tables:
    tenants           (id, slug, name, deployment_mode, created_at)
    persona_users     (id, tenant_id, username, password_hash, role)
    role_assignments  (id, user_id, tenant_id, role)

tenants/{id}/audit.db tables:
    audit_log         (id, tenant_id, tech_id, action, target_type,
                       target_id, before_state, after_state, timestamp)
```

Migration rules:
- Every schema change = one Alembic migration file
- App runs migrations on startup automatically
- Never modify schema without a migration
- Config versioning: config.json has schema_version field

---

## API Structure

```
/api/health                              ← no auth
/api/v1/settings/status                  ← no auth
/api/v1/settings/bootstrap               ← no auth (first run only)
/api/v1/settings/test-connection         ← no auth during setup
/api/v1/settings/setup                   ← no auth (first run only)
/api/v1/auth/login                       ← no auth
/api/v1/auth/me                          ← JWT

/api/v1/t/{slug}/settings/ldap           ← JWT + tenant scope
/api/v1/t/{slug}/settings/entra          ← JWT + tenant scope
/api/v1/t/{slug}/settings/integrations   ← JWT + tenant scope

/api/v1/t/{slug}/ad/tree                 ← JWT
/api/v1/t/{slug}/ad/user/{dn}            ← JWT
/api/v1/t/{slug}/ad/group/{dn}           ← JWT (Phase 2)
/api/v1/t/{slug}/ad/device/{dn}          ← JWT (Phase 7)

/api/v1/t/{slug}/entra/user/{id}         ← JWT (Phase 2)
/api/v1/t/{slug}/entra/groups            ← JWT (Phase 2)
/api/v1/t/{slug}/entra/tap               ← JWT (Phase 2)

/api/v1/t/{slug}/exchange/mailbox/{id}   ← JWT (Phase 3)

/api/v1/t/{slug}/devices                 ← JWT (Phase 7)
/api/v1/t/{slug}/devices/{id}/offboard   ← JWT (Phase 7)

/api/v1/t/{slug}/workflows               ← JWT (Phase 5)
/api/v1/t/{slug}/workflows/{id}/run      ← JWT (Phase 5)

/api/v1/t/{slug}/rules                   ← JWT (Phase 6)
/api/v1/t/{slug}/reports                 ← JWT (Phase 6)

/api/v1/t/{slug}/audit                   ← JWT (Phase 4)

/api/v1/operator/tenants                 ← Operator JWT (Phase 8)
/api/v1/operator/users                   ← Operator JWT (Phase 8)
/api/v1/operator/diagnostics             ← Operator JWT
```

---

## Frontend Routing

```
App loads
    └── GET /api/v1/settings/status
          ├── setup not complete → <SetupWizard />
          └── setup complete
                ├── no token → <LoginForm />
                └── token valid → App Shell
                      ├── /t/:slug/          → AD Tree + User Panel
                      ├── /t/:slug/entra     → Entra View (Phase 2)
                      ├── /t/:slug/exchange  → Exchange View (Phase 3)
                      ├── /t/:slug/groups    → Group Management (Phase 2)
                      ├── /t/:slug/devices   → Device Management (Phase 7)
                      ├── /t/:slug/workflows → Workflow Library (Phase 5)
                      ├── /t/:slug/rules     → Rules Dashboard (Phase 6)
                      ├── /t/:slug/reports   → Reports (Phase 6)
                      ├── /t/:slug/settings  → Settings
                      └── /operator          → MSP Operator (Phase 8)
```

---

## Release & Branching

```
feature/* → develop → main → v*.*.*
               ↓          ↓       ↓
             :dev      :latest  :v0.2.0

:dev     unstable, tracks develop, for testing
:latest  stable, tracks main, for production
:v0.2.0  pinned release, never changes
```

Portainer stack for dev: pulls :dev, separate data/, different port
Portainer stack for prod: pulls :latest, production data/
