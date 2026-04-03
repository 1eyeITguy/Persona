# Roadmap — Persona

Each phase is self-contained and shippable before the next begins.
Read-only comes before write operations. Always.

---

## Phase 1 — Foundation (Current)

**Goal:** Get the app running. Set up AD. Log in. Browse users.

- [ ] Setup Wizard — first-run experience, no file editing required
- [ ] Local admin bootstrap account (break-glass recovery)
- [ ] Login with on-prem AD credentials (LDAP bind)
- [ ] Expandable AD directory tree (mirrors ADUC)
- [ ] User attribute panel — click any user, see their details
- [ ] In-app Settings — update AD connection without restarting
- [ ] Docker image published to ghcr.io via GitHub Actions
- [ ] Read-only. No write operations.

---

## Phase 2 — Entra ID Connect

**Goal:** See the cloud-side view of the same user alongside AD data.

- [ ] "Connect to Entra" button — MSAL OAuth2 flow
- [ ] Entra user panel tab — cloud-side attributes
- [ ] Sync status — last Entra Connect sync time
- [ ] MFA registration status (read-only)
- [ ] Entra account enabled/disabled state (separate from on-prem)
- [ ] Conditional Access policy status (read-only)

---

## Phase 3 — Exchange Online

**Goal:** Mailbox data without opening Exchange Admin Center.

- [ ] Mailbox details — size, limits, archive status
- [ ] Email aliases / proxy addresses (read-only, cloud SOA respected)
- [ ] Shared mailbox access (read-only)
- [ ] Out-of-office status (read-only)
- [ ] Distribution group membership via Graph (read-only)

---

## Phase 4 — Write Operations (Guarded)

**Goal:** Common help desk actions with confirmation guardrails.

Every write operation has:
- A confirmation step before executing
- An audit log entry after executing
- Role-based access control (Tier 1 vs Tier 2 permissions)

Actions (each individually designed and gated):
- [ ] Password reset (on-prem AD)
- [ ] Unlock account (on-prem AD)
- [ ] Enable / disable account (on-prem AD)
- [ ] Update phone / mobile number (on-prem AD)
- [ ] Audit log viewer

**Never in scope:**
- Delete or deprovision accounts
- Modify privileged group memberships (Domain Admins, etc.)
- Write Exchange attributes via LDAP

---

## Phase 5 — Role-Based Access + HR Role

**Goal:** Different users see different things based on their role.

- [ ] Role detection at login (AD group membership → Persona role)
- [ ] Roles: `local_admin`, `helpdesk_tier2`, `helpdesk_tier1`, `hr`
- [ ] HR role: user search (name/email only)
- [ ] HR role: view and update Microsoft 365 profile photo (Graph API)
- [ ] HR role: cannot see security attributes (lockout, pwd age, group membership)
- [ ] Tier 1 role: read-only + account unlock + password reset
- [ ] Tier 2 role: full Phase 4 write access

---

## Future / Backlog

- Computer object lookup (AD)
- Group management view (read-only)
- Bulk user search and CSV export
- Ticket system webhook on write actions
- Dark/light theme toggle
- Multi-domain / multi-forest support
