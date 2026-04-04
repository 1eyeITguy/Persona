# Roadmap — Persona

Each phase ships before the next begins. Read before write. Always.

---

## Phase 1 — Foundation ✅ COMPLETE

Setup Wizard, local admin account, AD LDAP login, expandable directory tree,
user attribute panel, in-app settings, Docker deployment.

---

## Phase 2 — Entra ID + Groups + Database 🔧 NEXT

**Goal:** Connect to Entra ID. See the cloud-side of a user. Manage groups.
Replace JSON config with a proper database.

### Database Migration
- [ ] Introduce SQLite + Alembic migrations
- [ ] Migrate data/config.json to platform.db + tenant config.json
- [ ] tenant_id on all models from this point forward
- [ ] Config versioning (schema_version in config.json)
- [ ] Diagnostic endpoint: GET /api/v1/admin/diagnostics

### Entra ID Connect
- [ ] Setup Wizard: Step 3 — App registration config
      (tenant ID, client ID, client secret)
- [ ] "Connect to Entra" button — MSAL client credentials flow
- [ ] Service principal model — application permissions only
- [ ] Client secret expiry tracking, warning at 30 days
- [ ] Entra user panel tab — cloud-side attributes alongside AD view
- [ ] Sync status — last Entra Connect sync time
- [ ] MFA registration status (read-only)
- [ ] Entra account enabled/disabled (separate from on-prem state)
- [ ] Sign-in risk level (read-only)

### Temporary Access Pass (TAP)
- [ ] Issue TAP for a user (configurable duration: 1h, 8h, 24h)
- [ ] View active TAPs for a user
- [ ] Revoke TAP
- [ ] TAP issuance requires Tier 2 role or approval
- [ ] Full audit log entry per TAP issued

### Group Membership (Read)
- [ ] Unified group view: AD groups + Entra groups in one panel
- [ ] Per-group labels: Source (AD / Entra / Entra-synced), Type (Security / M365 / Distribution / Dynamic)
- [ ] Dynamic groups: visible, checkbox disabled, membership rule shown
- [ ] AD-synced groups in Entra: labeled "Managed in AD", edit routed to LDAP
- [ ] Export: CSV, JSON, TXT
- [ ] Filter by source, type, search by name

### Account Lockout Investigation
- [ ] Lockout history timeline on user panel
- [ ] Pattern detection notes (same time daily = scheduled task, etc.)
- [ ] Bad password count + reset history
- [ ] Source workstation (from AD event log if available)

---

## Phase 3 — Exchange View

**Goal:** See Exchange Online mailbox details without opening EAC.

- [ ] Exchange SOA resolver (per-user, three-layer check)
- [ ] STALE_AD_ATTRS detection and warning state
- [ ] Exchange Online mailbox panel (Graph API)
      - Primary email, aliases, display name
      - Mailbox size + limits
      - Archive status
      - Out-of-office status
      - Shared mailbox access (read-only)
- [ ] Exchange On-Prem mailbox panel (EWS) — if configured
- [ ] Exchange Hybrid routing (per-user SOA decision)
- [ ] Invisible mailbox detection
      (BlockExchangeProvisioningFromOnPremEnabled + no AD attrs)
- [ ] Proxy address list — clearly labeled primary vs alias
- [ ] Distribution group membership via Graph (read-only)

---

## Phase 4 — Write Operations (Guarded)

**Goal:** Common HD write tasks with preview, confirmation, approval, and audit.

Every write operation has:
- Preview step showing exactly what will change
- Confirmation required before execution
- Approval workflow for sensitive operations
- Full audit log entry with before/after values
- Rollback plan if execution fails

### Account Operations (AD)
- [ ] Password reset
- [ ] Account unlock
- [ ] Enable account
- [ ] Disable account
- [ ] Update telephone, mobile
- [ ] Update title, department

### Group Membership (Write)
- [ ] Add user to AD group
- [ ] Remove user from AD group
- [ ] Add user to Entra-only group (via Graph)
- [ ] Copy group membership from another user
- [ ] Import group membership from CSV (with validation preview)
- [ ] Privileged group protection (Domain Admins, etc. — blocked for Tier 1)

### Approval Workflow
- [ ] Tier 1 requests → held pending Tier 2 approval
- [ ] Tier 2 receives notification
- [ ] Approve → action executes
- [ ] Deny → action cancelled with reason
- [ ] Both parties notified
- [ ] Audit log records full approval chain

### Audit Log Viewer
- [ ] Per-user audit history
- [ ] Tenant-wide audit log (admin/Tier 2 only)
- [ ] Filter by action type, tech, date range
- [ ] Export audit records (CSV)
- [ ] Immutable from HD role

---

## Phase 5 — Workflow Engine

**Goal:** Declarative YAML workflows for coordinated identity operations.

### Engine Core
- [ ] YAML workflow parser and validator
- [ ] Jinja2 templating for conditions and values
- [ ] Execution planner — evaluates steps, generates preview
- [ ] Executor — runs steps in order, tracks per-step status
- [ ] Rollback manager — captures before-state, unwinds on failure
- [ ] Partial failure surfacing — never hide incomplete execution

### Built-In Workflows
- [ ] Name Change — updates all name-related attributes correctly
      - AD: sn, displayName, cn, initials, mail, UPN
      - Exchange: primary SMTP updated, old SMTP preserved as alias
      - Alias preservation enforced — cannot be skipped by Tier 1
      - sAMAccountName change: optional, explicit warning shown
- [ ] Employee Onboarding — create user, assign groups, license, notify
- [ ] Employee Offboarding — disable account, remove licenses, archive mailbox
- [ ] Department Transfer — update OU, groups, manager, attributes
- [ ] Role Change / Promotion — update title, groups, access

### Workflow Library UI
- [ ] Browse installed workflows
- [ ] Import from file / community URL
- [ ] Edit workflow YAML in-app
- [ ] Run workflow against selected user or device
- [ ] Execution history per workflow

---

## Phase 6 — Rules Engine + Reporting

**Goal:** Policy enforcement and compliance visibility.

### Rules Engine
- [ ] YAML rule parser and validator
- [ ] Scheduled rule scans (configurable interval)
- [ ] Violation detection with per-user, per-rule granularity
- [ ] Violation dashboard with drill-down
- [ ] Guided remediation — links from violation to fix workflow
- [ ] Bulk fix option (with preview + confirmation)
- [ ] Auto-fix option (admin-only, explicit enablement)

### Built-In Rules
- [ ] License-attribute hygiene
      (e.g. Teams Phone license → telephoneNumber required + formatted)
      (e.g. Exchange license → mail attribute required)
- [ ] Stale account policy (no login in N days)
- [ ] Password age policy
- [ ] Accounts expiring in N days
- [ ] Privileged group membership review
- [ ] Proxy address format validation

### Reporting Engine
- [ ] Report definition: YAML format, shareable
- [ ] Built-in reports:
      - User population (AD / Entra-only / hybrid / disabled)
      - License assignment (per SKU, unused, assigned to disabled)
      - Exchange status (cloud / on-prem / no mailbox)
      - Group inventory (empty, single-member, privileged)
      - Stale accounts
      - Password age distribution
      - Accounts expiring
- [ ] Custom report builder (filter + column selector)
- [ ] Export: browser view, CSV, JSON
- [ ] Scheduled reports with email delivery
- [ ] Report history — compare runs over time
- [ ] Compliance report templates (SOX, HIPAA, ISO27001 — community contributed)

### Alerting
- [ ] Alert rules — trigger on directory events
- [ ] Delivery: email, Teams webhook, Slack webhook
- [ ] Built-in alerts:
      - Privileged group membership change
      - Mass account lockouts (N accounts in N minutes)
      - Service account attribute change
      - Admin account created outside workflow

---

## Phase 7 — Device Management

**Goal:** Device offboarding and lifecycle management across all registered systems.

### Device Objects
- [ ] Device view in sidebar (alongside Users)
- [ ] Search by name, serial, user, OS
- [ ] Device identity map: hostname, serial, Intune ID, Autopilot ID,
      Entra device ID, plugin-discovered IDs
- [ ] Device detail panel: OS, last seen, assigned user, compliance state
- [ ] Computer objects from AD (existing on-prem devices)

### Device Offboarding Workflow
- [ ] Offboard preview: shows every system where device was found
- [ ] Step-by-step execution with live status per step
- [ ] Built-in steps (ordered):
      1. Retire from Intune (required — stop if fails)
      2. Remove from Autopilot (required — re-enrollment prevention)
      3. Delete Entra ID device object (required)
      4. Plugin steps (optional — warn on failure, continue)
- [ ] Partial failure surfacing — never silently skip steps
- [ ] "Mark Manual" option for steps that fail (noted in audit log)

### Integration Plugin Framework
- [ ] Plugin interface definition (DevicePlugin, UserPlugin)
- [ ] Plugin credential storage (per-tenant config.json)
- [ ] Plugin configuration UI (Settings → Integrations)
- [ ] Test connection per plugin
- [ ] Community plugins:
      - Sophos Central (security)
      - Cisco Umbrella (networking)
      - CrowdStrike Falcon (security)
      - SentinelOne (security)
      - Microsoft Defender for Endpoint (security)
      - AnyDesk (remote access)
      - TeamViewer (remote access)
      - ConnectWise Control (remote access)
      - Datto RMM (remote access / MSP)
      - Jamf (MDM — Mac)
      - Kandji (MDM — Mac)
      - Snipe-IT (asset management)

### Additional Device Workflows
- [ ] Device Onboarding — pre-stage Autopilot, assign user, register plugins
- [ ] Device Transfer — reassign from one user to another
- [ ] Device Wipe + Reimage — trigger Intune wipe, coordinate plugins
- [ ] Lost/Stolen — remote lock, Sophos flag, revoke Entra tokens, report

### Privileged Features
- [ ] LAPS password retrieval (for Tier 2 + approval)
- [ ] BitLocker recovery key lookup (for Tier 2 + approval)
- [ ] Both require reason entry and are audit-logged

---

## Phase 8 — Multi-Tenant & MSP

**Goal:** Full multi-tenant support with MSP operator dashboard.

### Tenant Architecture
- [ ] First-run: choose deployment mode (single / enterprise / msp)
- [ ] Tenant management (create, edit, suspend, offboard)
- [ ] Per-tenant configuration isolation
- [ ] Per-tenant audit log isolation (strict — no cross-tenant visibility)
- [ ] Tenant slug in all URLs: /t/{slug}/...

### MSP Operator Dashboard
- [ ] Tenant health overview (all clients at a glance)
      - Connection status (AD reachable? Entra connected?)
      - Rule violation counts
      - Recent activity summary
- [ ] Aggregate stats (counts only, no client data)
- [ ] Technician management
      - Assign techs to specific tenants with specific roles
      - Instant access revocation
      - Audit trail of tenant access per tech
- [ ] Tenant switcher for techs (explicit, always logged)

### Roles & RBAC
- [ ] Roles: operator, tenant_admin, helpdesk_tier2, helpdesk_tier1, hr
- [ ] Roles determined by: local assignment or AD group membership
- [ ] AD group → Persona role mapping (configured per tenant)
- [ ] HR role: user search (name/email only) + photo view/update
- [ ] Tier 1: read + unlock + password reset (with approval for some)
- [ ] Tier 2: full Phase 4 write access
- [ ] Tenant admin: all Tier 2 + settings + user management
- [ ] Operator: platform management, no tenant data access

### License Management
- [ ] License inventory per tenant
- [ ] Licenses assigned to disabled accounts (waste report)
- [ ] Licenses assigned but unused (waste report)
- [ ] Reclaim workflow — remove license, notify manager, audit log
- [ ] License cost breakdown by OU / department

### Access Certification Campaigns
- [ ] Create campaign: scope (OU, group, all users)
- [ ] Email managers: "Review your team's access"
- [ ] Manager reviews: approve or flag for removal
- [ ] Removals queued as Tier 2 tasks
- [ ] Campaign completion report for compliance audit

---

## Phase 9 — AI Assistant + MCP Server

**Goal:** Context-aware AI that understands Persona's data and advises techs.

### AI Assistant (Built-In)
- [ ] Chat panel in sidebar — available on any user/device view
- [ ] Context injection: current user/device object, audit history,
      rule violations, tenant config (no secrets)
- [ ] Capabilities:
      - Answer questions about directory data
      - Explain why something might be happening
      - Suggest what to check or do next
      - Summarize audit history
      - Identify patterns (lockout source, stale credentials, etc.)
      - Draft ticket notes
      - Explain what a workflow will do before running it
- [ ] Hard limits:
      - Cannot execute write operations directly
      - Cannot access data outside tech's tenant scope
      - Cannot exceed tech's role permissions
      - AI is advisor only — human confirms all actions
- [ ] Model: Anthropic claude-sonnet (configurable)
- [ ] API key: stored per-tenant in config.json

### MCP Server
- [ ] Expose Persona as an MCP server
- [ ] MCP tools:
      - persona_get_user(username)
      - persona_search_users(query)
      - persona_get_group_members(group)
      - persona_run_report(report_name)
      - persona_get_rule_violations(rule_name)
      - persona_get_audit_log(user, days)
      - persona_get_device(identifier)
      - persona_run_workflow(name, target, inputs) ← with confirmation
- [ ] Tenant-scoped authentication (MCP token = tenant + role)
- [ ] Read tools: no confirmation needed
- [ ] Action tools: require confirmation before execution
- [ ] MSP operators: cross-tenant summary tools only

---

## Future / Backlog

- Bulk user operations (create from CSV, bulk attribute update)
- Real-time push notifications (WebSocket) for lock/alert events
- Email/SMS notification delivery
- SIEM integration (Syslog/CEF → Splunk, Sentinel, QRadar)
- Webhook integration (Teams, Slack, ticketing systems)
- GPO reporting (read-only view)
- Password breach detection (HaveIBeenPwned on password reset)
- Multi-domain / multi-forest AD support
- Mobile-optimized UI (responsive, usable on tablets)
- Dark/light theme toggle
