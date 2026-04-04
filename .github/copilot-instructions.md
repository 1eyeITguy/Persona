# Persona — Copilot Instructions
> v2.0 Full Platform Vision | April 2026
> Auto-loaded every Copilot session. Do not delete or rename.

---

## What Is Persona?

Persona is an open-source, self-hosted **identity operations platform** for
organizations running Microsoft identity environments. Built for help desk
technicians, IT administrators, and MSPs who need to stop jumping between
ADUC, the Azure Portal, Exchange Admin Center, Intune, and vendor portals.

It is a **platform** with four extensible layers:
identity providers, service providers, integration plugins, and a workflow engine.

**Core promise:** One tool. Every identity and device operation. Done correctly.
With a full audit trail. Without needing to know which system owns which attribute.

---

## Current State — What Exists vs What Is Planned

Phase 1 is **complete and running**. Do NOT rewrite Phase 1 code unless
explicitly asked to fix a specific bug.

```
Phase 1  COMPLETE   Setup wizard, local admin, AD login, LDAP tree, user panel
Phase 2  NEXT       Entra connect, cloud view, TAP, groups read, SQLite DB
Phase 3  PLANNED    Exchange view, SOA resolution, mailbox details
Phase 4  PLANNED    Write operations with guardrails, approval workflows
Phase 5  PLANNED    Workflow engine, name change, onboarding, offboarding
Phase 6  PLANNED    Rules engine, reporting engine, community library
Phase 7  PLANNED    Device management, device offboarding, integration plugins
Phase 8  PLANNED    Multi-tenant MSP, operator dashboard, tenant isolation
Phase 9  PLANNED    AI assistant, MCP server
```

---

## SECURITY RULES — ENFORCED IN EVERY FILE

### 1. Secrets Never in Code
```python
# CORRECT
class Settings(BaseSettings):
    jwt_secret: str

# WRONG
JWT_SECRET = "some-value"
```

### 2. Secrets Never in docker-compose.yml
```yaml
# CORRECT
services:
  backend:
    env_file: .env

# WRONG
services:
  backend:
    environment:
      JWT_SECRET: "actual-secret"
```

### 3. Secrets Never in Dockerfile
ENV and ARG bake into image layers visible via docker history. Never.

### 4. LDAP Credentials — Memory Only
Exist only during the bind operation. Never logged. Never in exceptions.
Error messages never reveal whether username or password was wrong.

### 5. Service Account Password
Stored only in data/config.json on the Docker host.
API responses always return "••••••••" — never the actual value.

### 6. JWT — Minimal Payload
sub, display_name, dn, role, tenant_id, exp only.
Frontend: module variable only — NOT localStorage or sessionStorage.

### 7. .env.example
Placeholder values only. Never real-looking values.

---

## IDENTITY ARCHITECTURE

### Three Supported Worlds
```
AD Only          → LDAP bind auth, LDAP directory, no cloud
Hybrid           → LDAP bind auth, AD + Entra data, Exchange SOA aware
Entra Only       → MSAL auth, Graph API directory, Exchange Online
```
Configured in Setup Wizard. Persona adapts all behavior to the declared world.

### Exchange SOA Resolution (per-user, not per-org)
```
Resolution layers (highest to lowest priority):
  1. IsExchangeCloudManaged (Graph API, per-mailbox)
  2. BlockExchangeProvisioningFromOnPremEnabled (org config)
  3. msExchRecipientTypeDetails (LDAP attribute)

Results:
  CLOUD          → write via Graph API only
  ON_PREM        → write via LDAP/EWS only
  STALE_AD_ATTRS → AD has Exchange data BUT IT IS WRONG
                   frozen at migration time, do not display
                   show warning: connect Entra to see real data
  UNKNOWN        → Entra not connected, cannot determine
  NONE           → no mailbox
```

STALE_AD_ATTRS is the dangerous case. Never display stale AD Exchange
attributes as current data. Always surface the warning state.

### Service Identity Model
```
AD Service Account
  → LDAP bind for all directory operations
  → Credentials in data/config.json, never in .env

Entra Service Principal
  → Graph API for all Entra/Exchange Online operations
  → Application permissions (not delegated user permissions)
  → Client secret encrypted in data/config.json
  → Expiry tracked, warning at 30 days

Audit trail:
  External (Entra/AD logs): Persona service identity is the actor
  Internal (Persona audit): which tech triggered the action
```

---

## MULTI-TENANCY — tenant_id ON EVERYTHING

Every DB record, API call, audit entry, config file is tenant-scoped.

```python
# Every model
class AnyModel(Base):
    tenant_id: UUID  # always present, always in queries

# Every query
db.query(Model).filter(
    Model.tenant_id == tenant_id,  # never omit this
    ...
)
```

```
Deployment modes:
  single      → one tenant, switcher hidden
  enterprise  → multiple domains/subsidiaries
  msp         → many client tenants, operator dashboard

File structure:
  data/
  ├── platform.db          ← SQLite: tenants, Persona users, roles
  └── tenants/
        └── {tenant_id}/
              ├── config.json   ← LDAP, Entra, Exchange, plugin creds
              ├── rules/
              ├── workflows/
              └── audit.db      ← isolated per tenant
```

API routes: /api/v1/t/{tenant_slug}/... for all tenant-scoped operations

---

## DATABASE

Phase 1: data/config.json (keep working, do not break)
Phase 2+: SQLite + Alembic migrations

Rules:
- Every schema change has an Alembic migration file
- App checks and applies migrations on startup
- Never modify schema without a migration
- tenant_id on every table that holds tenant data
- SQLite for self-hosted, PostgreSQL path for future hosted

---

## PLUGIN FRAMEWORK (Phase 7+)

```python
class PersonaPlugin:
    plugin_id: str
    display_name: str
    plugin_type: str  # "security"|"remote-access"|"mdm"|"networking"

class DevicePlugin(PersonaPlugin):
    def find_device(self, identifier: DeviceIdentifier) -> Device | None
    def offboard_device(self, device: Device) -> ActionResult
    def onboard_device(self, device: Device) -> ActionResult

class UserPlugin(PersonaPlugin):
    def find_user(self, identifier: UserIdentifier) -> PluginUser | None
    def offboard_user(self, user: PluginUser) -> ActionResult
```

Plugin credentials: stored per-tenant in data/tenants/{id}/config.json

---

## WORKFLOW ENGINE (Phase 5+)

YAML-defined. Preview-first. Rollback-capable. Audit-native.

```yaml
name: string
version: semver
target: user | device
inputs: [...]
steps:
  - id: string
    type: ad_write|graph_api|exchange_write|plugin|notification
    condition: "{{ jinja2 }}"
    required: bool
    on_failure: stop|warn|skip
    rollback:
      restore_previous_values: true
```

---

## TECH STACK

| Layer | Choice |
|---|---|
| Backend | Python 3.11 + FastAPI (existing) |
| Database | SQLite + Alembic (Phase 2) |
| AD | ldap3, always in thread pool |
| Entra/EXO | msal + Graph API (Phase 2+) |
| Frontend | React 18 + Tailwind CSS (existing) |
| Plugins | Python packages (Phase 7+) |
| AI | Anthropic API claude-sonnet (Phase 9) |
| MCP | Python MCP SDK (Phase 9) |
| Registry | ghcr.io/1eyeITguy/persona |

---

## BRANCHING STRATEGY

```
feature/* → develop → main → tag v*.*.*
               ↓          ↓        ↓
             :dev      :latest  :v0.2.0
```

develop = default branch. Never commit directly to main.

---

## PROJECT STRUCTURE

```
persona/
├── .github/
│   ├── copilot-instructions.md
│   └── workflows/
│       ├── docker-dev.yml        ← develop → :dev
│       └── docker-publish.yml   ← main+tags → :latest+:v*
├── backend/
│   ├── main.py
│   ├── config.py                 ← .env bootstrap only
│   ├── app_config.py             ← config.json
│   ├── database/
│   │   ├── base.py
│   │   ├── migrations/
│   │   └── models/
│   ├── auth/
│   │   ├── ldap.py
│   │   └── msal.py
│   ├── providers/
│   │   ├── identity/
│   │   └── exchange/
│   ├── plugins/
│   ├── workflows/
│   ├── rules/
│   └── routes/
│       ├── auth.py
│       ├── ad.py
│       ├── entra.py
│       ├── exchange.py
│       ├── devices.py
│       ├── workflows.py
│       ├── rules.py
│       ├── reports.py
│       ├── settings.py
│       └── operator.py
├── frontend/src/
├── data/.gitkeep
├── docs/
│   ├── VISION.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── PLATFORM.md
│   ├── FUTURE-HOSTING.md
│   └── specs/
│       ├── architecture/
│       └── phase-*.md
├── docker-compose.yml
├── docker-compose.dev.yml
└── Dockerfile
```

---

## CODING RULES

1. tenant_id on every DB model and query. Always.
2. Read-only until Phase 4. No write operations before then.
3. All LDAP calls in run_in_threadpool.
4. Pydantic models for all API shapes.
5. Alembic migration for every schema change.
6. Secrets never in code, compose, or Dockerfile.
7. Service account password always redacted in responses.
8. One phase at a time. Validate before starting next.
9. CHANGELOG.md updated on every meaningful change.
10. Generic — no org-specific values anywhere in code or docs.

---

## UI RULES

Colors: BG #0f1117 | Surface #1a1d27 | Border #2d3148
Brand: Primary #6474e5 | Accent #7c3aed
Status: Success #4ade80 | Warning #f59e0b | Danger #f87171
Layout: Left sidebar | Right content area
Forms: Centered card (no shell) for Setup Wizard and Login
Write ops: Always preview → confirm → execute → audit
