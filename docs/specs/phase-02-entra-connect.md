# Spec: Phase 2 — Entra ID + Groups + Database

**Status:** Planned | **Version target:** 0.3.0
**Depends on:** Phase 1 complete

---

## Objectives

1. Migrate data layer from JSON to SQLite + Alembic
2. Connect to Entra ID via service principal
3. Show cloud-side user data alongside AD data
4. Manage and export group memberships
5. Issue and manage Temporary Access Passes
6. Improve lockout investigation

---

## Step 1 — Database Migration (Do This First)

Before any new features, migrate the data layer.

### New Files
- `backend/database/base.py` — SQLAlchemy DeclarativeBase
- `backend/database/session.py` — get_db() FastAPI dependency
- `backend/database/models/tenant.py` — Tenant model
- `backend/database/models/user.py` — PersonaUser model
- `backend/database/migrations/env.py` — Alembic config
- `backend/database/migrations/versions/0001_initial_schema.py`
- `alembic.ini`

### Migration from config.json
On first startup after Phase 2:
1. Check if platform.db exists
2. If not: run migrations, migrate existing config.json to new structure
3. Create default tenant from existing LDAP config
4. Preserve all existing settings — zero data loss

### tenant_id Required
From Phase 2 forward: every new model has tenant_id.
All existing Phase 1 routes updated to be tenant-scoped.
URL structure: /api/v1/t/{slug}/... for all tenant routes.

---

## Step 2 — Entra Service Principal Setup

### Setup Wizard — New Step 3

After AD config (existing Step 2), add optional Entra config:

```
Step 3 — Connect to Entra ID (optional)

You can skip this and connect later in Settings.

To connect, you need an App Registration in Entra ID.
We'll guide you through creating one.

[Open Entra Portal →]  ← links to portal.azure.com/#blade/...

Enter your app registration details:

  Tenant ID     [________________________________]
  Client ID     [________________________________]
  Client Secret [________________________________]

Required API permissions (grant these in Entra):
  ✓ User.Read.All
  ✓ Directory.Read.All
  ✓ AuditLog.Read.All
  (We'll add more permissions as features require them)

[Test Connection]  ← live API call, shows user count on success
[Save and Continue]  [Skip for Now]
```

### Config Storage
```json
// data/tenants/{id}/config.json
{
  "entra": {
    "tenant_id": "...",
    "client_id": "...",
    "client_secret": "encrypted",
    "secret_expires": "2027-04-01",
    "connected": true
  }
}
```

### Secret Expiry Tracking
- Store expiry date when secret is saved
- Warning banner in UI at 30 days before expiry
- Red alert at 7 days before expiry
- Expiry shown in Settings → Entra section

---

## Step 3 — Entra User Data

### User Panel — New "Cloud" Tab

When Entra is connected, user panel shows a second tab:

```
[AD]  [Cloud]

Cloud Identity — Jane Smith

Entra ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Account enabled: ✓ Yes (cloud state — separate from AD)

Sign-in Activity
  Last sign-in: 2 hours ago
  Sign-in risk: None

MFA
  Status: ✓ Registered
  Methods: Authenticator App, Phone

Entra Connect Sync
  Last sync: 4 minutes ago
  Sync status: ✓ Synced
```

### Sync Status Indicator
- Green: synced within last 30 minutes
- Amber: last sync 30min-2hrs ago
- Red: last sync >2hrs ago or sync errors

---

## Step 4 — Temporary Access Pass (TAP)

### Issue TAP
Available from user panel → Actions menu (Tier 2 or approval).

```
Issue Temporary Access Pass — Jane Smith

Duration:    [1 hour ▼]  (options: 1h, 4h, 8h, 24h)
One-time:    [✓] Single use only

This will allow Jane to bypass MFA once to register
a new authentication method.

[Cancel]  [Issue TAP]
```

On issue: Graph API POST /users/{id}/authentication/temporaryAccessPassMethods

### View Active TAPs
Shown in user panel Cloud tab under MFA section.
Shows: TAP value (once, then masked), expiry, use count.

### Revoke TAP
Delete button next to active TAP. Requires Tier 2 role.
Audit logged.

---

## Step 5 — Group Membership

### Group Panel (new section in user panel)

```
Group Memberships (23 groups)

[Filter: All ▼]  [Source: All ▼]  [Type: All ▼]  [🔍 Search]
[Export ▼]  [Copy From User]

┌────────────────────────────────┬────────┬──────────┬──────────┐
│ Group Name                     │ Source │ Type     │ Editable │
├────────────────────────────────┼────────┼──────────┼──────────┤
│ ☑ All Staff                    │ AD     │ Security │ Phase 4  │
│ ☑ Finance Team                 │ AD     │ Security │ Phase 4  │
│ ☐ M365-Finance                 │ Entra  │ M365     │ Phase 4  │
│ ☐ All Company (Dynamic)        │ Entra  │ Dynamic  │ View only│
└────────────────────────────────┴────────┴──────────┴──────────┘

Dynamic group rule shown on hover/expand:
"All Company" — Rule: (user.accountEnabled -eq True)
This user matches because: account is enabled
```

### Group Source Labels
- AD: synced via Entra Connect, edit in AD (Phase 4)
- AD-synced: appears in Entra but managed in AD — do not edit via Graph
- Entra: cloud-only group, edit via Graph API (Phase 4)
- Dynamic: membership is automatic, never editable

### Export
```
Export Groups

Format:  ● CSV  ○ JSON  ○ TXT (names only)
Include: ☑ AD groups  ☑ Entra groups  ☑ Dynamic (noted as view-only)

[Export]
```

CSV columns: GroupName, Source, Type, DN, ObjectId, Editable

---

## Step 6 — Account Lockout Investigation

Enhanced lockout section in user panel Security tab:

```
Account Lockout History

Current status: ● Locked Out (since 2h ago)
Bad password count: 5

Recent lockout events (last 30 days):
  Today 2:47 PM    Locked out    [Unlock]
  Today 7:12 AM    Locked out    Unlocked by jsmith at 7:23 AM
  Apr 1 3:15 PM    Locked out    Unlocked by system at 3:45 PM

Pattern Analysis:
  ⚠ Lockouts occur at similar times (morning)
    Possible cause: cached credentials on a device or
    scheduled task using old password.
  
  Suggestion: Check for saved passwords on mobile devices,
  mapped drives, or scheduled tasks running as this account.
```

---

## API Endpoints (Phase 2)

```
GET  /api/v1/t/{slug}/entra/status
GET  /api/v1/t/{slug}/entra/user/{upn_or_id}
GET  /api/v1/t/{slug}/entra/user/{id}/groups
POST /api/v1/t/{slug}/entra/user/{id}/tap
GET  /api/v1/t/{slug}/entra/user/{id}/tap
DELETE /api/v1/t/{slug}/entra/user/{id}/tap/{tap_id}

GET  /api/v1/t/{slug}/ad/user/{dn}/groups
GET  /api/v1/t/{slug}/ad/user/{dn}/groups/export

GET  /api/v1/admin/diagnostics
```

---

## Acceptance Criteria

- [ ] SQLite database created on first startup, migrations applied
- [ ] Existing Phase 1 config.json migrated without data loss
- [ ] All Phase 1 functionality continues to work unchanged
- [ ] Entra connection configured in Settings without restarting
- [ ] Service principal secret expiry shown and alerted
- [ ] Cloud user tab appears when Entra is connected
- [ ] Last sign-in, MFA status, sync time shown accurately
- [ ] TAP can be issued, viewed, and revoked (Tier 2 only)
- [ ] Group panel shows AD and Entra groups with correct labels
- [ ] Dynamic groups show rule and are not editable
- [ ] AD-synced groups in Entra labeled "Managed in AD"
- [ ] Group export produces valid CSV with all columns
- [ ] Lockout history shown with pattern notes
- [ ] /api/admin/diagnostics returns without exposing secrets
