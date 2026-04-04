# Spec: Phase 8 — Multi-Tenant & MSP

**Status:** Planned | **Version target:** 0.9.0
**Depends on:** Phase 4 complete, database migration complete

---

## Architecture

Full multi-tenancy is already designed in from Phase 2 (tenant_id on all models,
tenant-scoped API routes). Phase 8 builds the management UI on top.

See docs/specs/architecture/multi-tenancy.md for the full data model.

---

## Deployment Mode Selection

First-run Setup Wizard now asks:

```
How will Persona be deployed?

  ● Single organization
    One Active Directory, one Entra tenant.
    Simplest setup — tenant switcher is hidden.

  ○ Enterprise (multiple domains)
    Multiple AD domains or subsidiaries.
    Tenant switcher visible to admins.

  ○ MSP (managed service provider)
    Multiple client organizations.
    Full operator dashboard and client isolation.
```

---

## MSP Operator Dashboard

Accessible at /operator — operator role only.

```
Persona Operator Dashboard

Tenant Health (12 clients)
─────────────────────────────────────────────────────
Contoso Corp      ● Online    AD ✓  Entra ✓   [Manage]
Fabrikam Inc      ● Online    AD ✓  Entra ✓   [Manage]
Adventure Works   ⚠ Warning   AD ✗  Entra ✓   [Manage]
Northwind         ● Online    AD ✓  Entra ✓   [Manage]

Aggregate (no client data — counts only)
  Total managed users:   4,847
  Active rule violations:  127
  Workflows run today:      43
  Connection issues:         1

Technician Management
─────────────────────────────────────────────────────
Jane Smith    Contoso: Tier2  Fabrikam: Tier1  [Edit] [Remove]
Bob Jones     Adventure Works: Tier2            [Edit] [Remove]
[+ Add Technician]
```

---

## Technician-to-Tenant Assignment

MSP technicians are assigned to specific tenants with specific roles.
A tech can have different roles in different tenants.

```python
class TenantTechAccess(Base):
    tech_id: UUID
    tenant_id: UUID
    role: str   # helpdesk_tier1|helpdesk_tier2|tenant_admin
    assigned_by: UUID
    assigned_at: datetime
```

Access revocation is instant — remove the assignment, JWT is invalidated.

---

## Roles

```
operator          → Platform management only, no tenant data
tenant_admin      → Full access within one tenant + settings
helpdesk_tier2    → Write operations, approve Tier 1 requests
helpdesk_tier1    → Read + limited writes with Tier 2 approval
hr                → User photo view/update only (Phase 5+)
```

Role assignment sources (in priority order):
1. Explicit Persona assignment (in tenant settings)
2. AD group membership → mapped role (configured per tenant)
3. Default: helpdesk_tier1 for all authenticated AD users

---

## HR Role (Phase 5 concept, built in Phase 8)

The HR role is intentionally minimal:

```
HR View — Jane Smith

[Photo]   Jane Smith
          jane.smith@contoso.com
          Finance Department

[Upload Photo]  ← calls Graph API profilePhoto endpoint
```

HR cannot see:
- Group memberships
- Security attributes (lockout, password age, bad pwd count)
- Account status
- Department/title (org chart is in HR system, not Persona's job)

---

## License Management

New report + action flow:

```
License Overview — Contoso Corp

Total licenses: 500 Microsoft 365 Business Premium

Waste:
  47 assigned to disabled accounts    [View Users] [Reclaim All]
  12 assigned, never used (90+ days)  [View Users] [Reclaim All]

By department (top 5):
  Finance:     87 licenses
  Engineering: 203 licenses
  ...
```

Reclaim workflow: removes license via Graph API, notifies manager, audit logs.

---

## Access Certification Campaigns

```
New Certification Campaign

Scope:    [All users ▼]  [Finance group ▼]
Reviewer: [User's manager ▼]
Deadline: [14 days ▼]

Managers will receive an email listing their team members and
their current group memberships. They confirm each one or flag
for removal.

[Create Campaign]
```

Campaign tracking: open / in progress / complete.
Removals flagged by managers queue as Tier 2 tasks.
Campaign completion report downloadable for compliance audit.

---

## Acceptance Criteria

- [ ] Deployment mode selection at first run
- [ ] Single mode: tenant switcher hidden, behaves as before
- [ ] MSP mode: operator dashboard visible to operator role
- [ ] Operator can see health status but NOT tenant user data
- [ ] Tech tenant switcher shows only assigned tenants
- [ ] Switching tenant issues new scoped JWT (logged)
- [ ] Revoking tech access takes effect immediately
- [ ] HR role can view and upload user photo (Graph API)
- [ ] HR role cannot see security attributes or group membership
- [ ] License waste report accurate
- [ ] License reclaim workflow audit logged
- [ ] Certification campaign emails sent to managers
- [ ] Manager approval/denial recorded and actioned
