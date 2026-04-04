# Architecture: Multi-Tenancy

---

## The Rule

tenant_id is on every database record that holds tenant-scoped data.
Every query that retrieves tenant-scoped data filters by tenant_id.
A missing tenant_id filter is a data breach. There are no exceptions.

---

## Deployment Modes

Set at first-run Setup Wizard. Stored in platform.db.

```python
class DeploymentMode(str, Enum):
    SINGLE     = "single"      # one tenant, switcher hidden
    ENTERPRISE = "enterprise"  # multiple domains/tenants
    MSP        = "msp"         # many client tenants, operator dashboard
```

In `single` mode, the tenant slug is omitted from the UI (but still in the API).
The multi-tenant infrastructure is invisible when there's only one tenant.

---

## Data Isolation

```
data/
├── platform.db                    ← SQLite: platform-wide data only
│     Tables:
│       tenants              (id, slug, name, mode, status, created_at)
│       persona_users        (id, tenant_id, username, pw_hash, role)
│       role_assignments     (id, user_id, tenant_id, role)
│       tenant_tech_access   (id, tech_id, tenant_id, role)
│                            ← MSP: tech assigned to multiple tenants
│
└── tenants/
      ├── {tenant_id_1}/
      │     ├── config.json         ← LDAP, Entra, Exchange, plugin creds
      │     ├── audit.db            ← immutable audit log (isolated)
      │     ├── rules/              ← YAML rule definitions
      │     └── workflows/          ← YAML workflow overrides
      │
      └── {tenant_id_2}/
            └── ...
```

**Physical isolation:** Each tenant's config and audit log is a separate
file on disk. Even a SQL injection that bypasses ORM filtering cannot
reach another tenant's config.json or audit.db.

---

## API Route Structure

All tenant-scoped routes include the tenant slug:

```
/api/v1/t/{tenant_slug}/ad/...
/api/v1/t/{tenant_slug}/entra/...
/api/v1/t/{tenant_slug}/exchange/...
/api/v1/t/{tenant_slug}/devices/...
/api/v1/t/{tenant_slug}/workflows/...
/api/v1/t/{tenant_slug}/rules/...
/api/v1/t/{tenant_slug}/reports/...
/api/v1/t/{tenant_slug}/settings/...
/api/v1/t/{tenant_slug}/audit/...

/api/v1/operator/...               ← MSP operator only, no tenant slug
/api/v1/settings/status            ← no auth (setup detection)
/api/v1/auth/login                 ← no auth
```

---

## Tenant Resolution Middleware

Every request to a /t/{slug}/... route:

```python
async def resolve_tenant(
    slug: str,
    token: JWTPayload = Depends(require_auth)
) -> Tenant:
    # 1. Look up tenant by slug
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    # 2. Verify the authenticated tech has access to this tenant
    access = db.query(TenantTechAccess).filter(
        TenantTechAccess.tech_id == token.sub,
        TenantTechAccess.tenant_id == tenant.id,
    ).first()
    if not access:
        raise HTTPException(403, "Access denied")

    # 3. Inject tenant into request state
    return tenant
```

No tech can access a tenant they have not been explicitly assigned to.

---

## JWT Payload

```python
class JWTPayload(BaseModel):
    sub: str           # tech's Persona user ID
    display_name: str
    tenant_id: UUID    # primary tenant for this session
    role: str          # role within that tenant
    exp: int
    iat: int
```

When a tech switches tenants (MSP), a new JWT is issued for that tenant context.
Tenant switching is always an explicit action and is always audit-logged.

---

## Tenant Switcher (MSP / Enterprise)

```
[Persona logo]  [▼ Contoso Corp]         ← visible in header
                    Contoso Corp  ✓
                    Fabrikam Inc
                    Adventure Works
                    ─────────────────
                    All Tenants (Operator)
```

Clicking a different tenant:
1. Logs "tech switched to tenant X" in current tenant's audit log
2. Issues new JWT scoped to the selected tenant
3. Reloads the app in the context of the new tenant
4. Tech sees only that tenant's data

---

## MSP Operator Role

The operator role is above all tenants. It manages the platform.
It can NOT see tenant data (client data stays isolated).

```python
class OperatorCapabilities:
    # CAN:
    create_tenant: True
    suspend_tenant: True
    view_tenant_health: True    # connection status, violation counts (no data)
    assign_techs: True
    view_aggregate_counts: True # total users across tenants (no names)

    # CANNOT:
    view_tenant_user_data: False
    view_tenant_audit_logs: False
    access_tenant_settings: False
    impersonate_tenant_user: False
```

---

## First-Run Flow (Multi-Tenant)

```
Fresh install → Setup Wizard

Step 1 — Platform Setup
    Deployment mode: single | enterprise | msp
    Platform name (shown in browser tab, login page)
    Create operator admin account

Step 2 — Create First Tenant
    Tenant name: "Contoso Corp"
    Tenant slug: "contoso" (auto-generated, editable)

Step 3 — Configure Identity (for first tenant)
    Identity provider: AD | Entra | Hybrid
    LDAP connection (if AD)
    Entra app registration (if Entra/Hybrid)
    Test connection

Step 4 — Done
    Redirect to login
    First login: operator admin account
```

Adding subsequent tenants: Operator Dashboard → Tenants → Add Tenant
