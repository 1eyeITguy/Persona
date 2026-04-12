# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased] — Phase 3: Exchange Online View

### Added
- **Device ownership tagging** — device cards in the user slideout now show Corporate / Personal / Unknown badges derived from `managedDeviceOwnerType` (Intune) and `trustType` (Entra-only devices)
- **Service presence indicators** — corporate device cards show lit/struck-through badges for Entra ID, Intune, and Autopilot enrollment status; Autopilot is detected via the `[ZTDID]` marker in `physicalIds`
- **Device offboarding flow** — corporate devices can be selected (checkbox) and offboarded via a confirmation modal with per-service checkboxes (Intune, Autopilot, Entra ID, AD computer disable); results shown per-service with success/failure indicators
- **`POST /api/v1/entra/devices/offboard`** — new endpoint processing Intune → Autopilot → Entra → AD in strict order; each step is independent (partial failure does not abort remaining steps); audit logged via `logger.info`
- **`DeviceOffboardModal`** — new frontend component handling confirm → progress → results phases; pre-selects applicable services based on device enrollment status
- **`EntraDevice` schema expansion** — added `intune_device_id`, `entra_device_id`, `ownership`, `in_intune`, `in_entra`, `in_autopilot` fields; corrected ID tracking by linking via `azureADDeviceId`
- **New offboard schemas** — `DeviceOffboardRequest`, `DeviceOffboardItem`, `DeviceOffboardResult`, `DeviceOffboardItemResult`, `DeviceServiceResult`
- **Exchange tab** in the user detail panel — visible for all AD users; content adapts to the resolved Source of Authority (SOA)
- **Exchange SOA resolver** (`backend/services/exchange_soa.py`) — three-layer detection algorithm:
  - Layer 1: Per-mailbox declaration from Graph API
  - Layer 2: Org-wide `BlockExchangeProvisioningFromOnPremEnabled` flag (via EXO PowerShell)
  - Layer 3: AD `msExchRecipientTypeDetails` attribute value
- **Five SOA states**: `cloud`, `on_prem`, `stale_ad_attrs`, `unknown`, `none`
- **STALE_AD_ATTRS protection** — AD Exchange attributes are suppressed when the org has migrated to Exchange Online but AD still carries frozen pre-migration data; a warning card guides the admin to connect Entra for accurate data
- **Graph API Exchange data** (`backend/services/exchange_graph.py`):
  - Primary email and all proxy addresses (labeled primary vs. alias)
  - Mailbox settings: OOO status, archive enabled/disabled
  - Mailbox size (requires `Mail.Read` permission)
  - Distribution group membership (mail-enabled groups via `transitiveMemberOf`)
- **EXO PowerShell integration** (`backend/services/exchange_ps.py`) — certificate-based app-only auth for:
  - `BlockExchangeProvisioningFromOnPremEnabled` org flag (cached 1 hour)
  - Shared mailbox access (`Get-MailboxPermission`, `Get-RecipientPermission`)
  - Graceful degradation: returns empty/None when `pwsh` is unavailable or cert not configured
- **`GET /api/v1/exchange/user/{upn}/mailbox`** — Exchange mailbox endpoint with SOA resolution
- **Exchange PS configuration** endpoints (`/api/v1/settings/exchange-ps-config`, test-exchange-ps) — certificate PFX upload, thumbprint extraction, EXO connection test
- **`get_exchange_attrs_by_upn()`** in `backend/auth/ldap.py` — lightweight LDAP lookup for Exchange-relevant AD attributes
- **`ExchangePSSection`** in Settings page — manage certificate upload, tenant domain, and connection test
- **Exchange PowerShell step** in Setup Wizard (Step 5) — instructions for generating a self-signed certificate, uploading to app registration, and granting `View-Only Recipients` role via `New-ManagementRoleAssignment`
- **STALE warning banner** in the Attributes tab — dismissable notice listing suppressed Exchange attributes when SOA is stale
- **PowerShell Core + ExchangeOnlineManagement module** added to Docker runtime image (~200 MB; can be commented out; all Graph-based Exchange features still work without it)

### Changed
- **Entra app registration permissions updated** — three new application permissions required: `MailboxSettings.Read`, `Mail.Read`, `Exchange.ManageAsApp`; permissions list in Setup Wizard and Settings updated with descriptions
- Setup Wizard step count: 5 → 6 (Exchange PS step inserted before Confirm)

---

## [Unreleased] — Identity Navigation Redesign

### Added
- **Identity navigation section** — "AD Directory" renamed to "Identity" with three sub-items:
  - **Synced Users** (`/identity/synced`) — OU tree showing all AD users with `[S]`/`[AD]` sync badges
  - **AD Only** (`/identity/ad-only`) — OU tree filtered to users with no Entra counterpart
  - **Entra Only** (`/identity/entra`) — flat sortable/searchable list of cloud-only Entra users
- **Sync detection** — all AD user queries now fetch `msDS-ExternalDirectoryObjectId`; users are classified as synced (`is_synced=true`) when the attribute is set by Entra Connect / Cloud Sync
- **Merged user detail panel** — `UserDetail` completely rewritten with 7 help-desk-focused tabs:
  - **Identity**: UPN, SAM, Entra Object ID, Last Sign-in, MFA methods (badges), Licenses (badges)
  - **Account**: password flags, lockout, expiry, UAC flags, logon activity
  - **Contact**: email, phone, mobile, office, full address, profile paths
  - **Organization**: title, dept, company, clickable manager + direct reports
  - **Member Of**: two-column layout for synced users — on-prem AD groups (left) and Entra cloud groups with type badges (right)
  - **Devices**: computers assigned to the user via AD `managedBy` attribute
  - **Attributes**: raw LDAP attribute editor with collapsible object metadata (DN, SID, GUID, USN)
- **Entra photo in header** — synced users and cloud-only users show their Microsoft 365 profile photo (from Graph API); AD-only users show their AD `thumbnailPhoto`
- **Dual status badges** — synced user header shows both AD account status and Entra account state
- **`GET /api/v1/ad/user/{dn}/merged`** — new endpoint that fetches AD attributes then merges Entra data (sign-in, MFA, licenses, cloud groups, photo) for synced users in a single response
- **`GET /api/v1/entra/users-cloud-only`** — lists Entra-only users (onPremisesSyncEnabled=null) with name/department/status filtering
- **`GET /api/v1/entra/users/{object_id}/photo`** — returns Entra profile photo as image bytes
- **`GET /api/v1/ad/user-devices`** — returns computers where `managedBy` equals a given user DN
- **`sync_filter` query param** on `/api/v1/ad/search` and tree endpoints — filter results to `synced` or `ad-only` users
- **`EntraOnlyList`** component — paginated list with debounced search, sort, and status filters
- **`EntraUserDetailPanel`** component — cloud user detail with Identity, Contact, and Member Of tabs

### Changed
- **Navigation**: Devices nav item temporarily removed (will return as its own top-level section)
- `/users` and `/devices` routes now redirect to `/identity/synced`
- `ADNode`, `ADUser`, `ADUserSummary` schemas extended with `is_synced` and `entra_object_id` fields
- `ADUser` schema extended with optional merged Entra fields (`entra_photo`, `entra_mfa_methods`, `entra_licenses`, `entra_cloud_groups`, `entra_last_sign_in`, `entra_account_enabled`)
- `SearchBar` supports `mode='synced'` and `mode='ad-only'` in addition to existing `users` and `devices`

---

## [0.3.1-alpha] — dev branch (Phase 2 in progress)

### Removed
- **Automatic Entra App Registration setup** — the OAuth2/PKCE flow that created an App Registration
  on behalf of the admin has been removed entirely. Attempts to make it work reliably required too
  many Azure Portal pre-conditions (Allow public client flows, bootstrap app registration, etc.),
  creating more friction than the manual path.
- `ENTRA_BOOTSTRAP_CLIENT_ID` env var — no longer needed or read
- `/api/v1/entra/oauth2/start`, `/oauth2/exchange`, `/oauth2/create-app` backend routes removed
- `EntraCallbackPage` component and `/entra-callback` route removed from frontend

### Added
- **In-app step-by-step Entra setup guide** — both the Setup Wizard (Step 4) and the Settings page
  Entra section now include a collapsible "How to create an App Registration in Azure" card showing
  all six required steps (registration, copy IDs, API permissions, admin consent, secret, enter in Persona).
  The guide is expanded by default in the Setup Wizard (first-time setup) and collapsed by default
  in Settings (editing existing config).

### Fixed
- **Cloud tab — "No cloud identity found" for all synced users** — Graph user lookup now falls back
  to the user's `mail` attribute when the on-premises UPN returns 404. This handles the common case
  where on-premises UPNs use a non-routable suffix (e.g. `@company.local`) that doesn't exist in
  Entra — the cloud UPN is the routable `mail` address instead. Subsequent calls (MFA, licenses,
  groups, sign-in activity) all use the resolved Entra object ID for stability.
- **Sign-in activity separated into its own best-effort call** — previously included in the main
  `$select`, which can cause failures in some environments. Now fetched independently so core profile
  data always loads.

### Changed
- **Entra setup UX simplified** — the "choose" mode selector (auto vs. manual) is gone; clicking
  "Connect" goes directly to the credential form with the guide card inline

---

## [0.3.0-alpha] — dev branch (Phase 2 in progress)

### Added
- Version number displayed on login page and sidebar (injected from package.json at build time)

### Phase 2 — Entra Connect: Programmatic App Registration + Cloud Tab

#### Added
- `backend/auth/msal.py` — OAuth2 Authorization Code + PKCE helpers:
  - `build_oauth_auth_url` — generates Microsoft authorization URL with PKCE state stored server-side
  - `exchange_oauth_code` — exchanges auth code for delegated access token
  - `consume_oauth_session` — retrieves and removes a session entry
  - `create_app_registration` — creates App Registration + SP + admin consent grants + client secret via Graph API
  - `get_entra_user` — fetches cloud identity (profile, MFA, licenses, groups) by UPN using client credentials
- `backend/models/schemas.py` — new schemas: `OAuthStartRequest/Response`, `OAuthExchangeRequest/Response`, `CreateAppRequest/Response`, `EntraGroupRef`, `EntraUserResponse`
- `backend/routes/entra.py` — four new endpoints:
  - `POST /api/v1/entra/oauth2/start` — generate auth URL
  - `POST /api/v1/entra/oauth2/exchange` — exchange auth code
  - `POST /api/v1/entra/oauth2/create-app` — create App Registration and save credentials
  - `GET /api/v1/entra/users/{upn}` — cloud identity data for Cloud tab
- `frontend/src/App.jsx` — `EntraCallbackPage` component and `/entra-callback` route check to handle OAuth redirect
- `frontend/src/components/SetupWizard.jsx` — Step 4 "Set up automatically" path with interactive Microsoft login flow (`AutoEntraSetup`); LDAP data preserved across OAuth redirect via sessionStorage
- `frontend/src/components/UserDetail.jsx` — new "Cloud" tab with `CloudTab` component showing Entra Object ID, account status, last sign-in, MFA methods, licenses, and cloud group memberships

---

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
