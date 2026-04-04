# Future Hosting Considerations

This document captures decisions and architectural notes relevant to a
potential future hosted/commercial offering. Decisions made here should
not affect the open-source self-hosted product in any negative way.

---

## Business Model: Open Core

If a hosted offering is ever built, it follows the open-core model:

```
Free Forever (Self-Hosted)
    Full platform — all features
    MIT licensed (with possible Commons Clause addition)
    Community workflows, rules, plugins
    Docker image on ghcr.io

Paid (Hosted by Persona)
    Persona manages infrastructure, updates, backups
    Support SLA with response time guarantees
    Managed tenant provisioning (MSP tier)
    Uptime SLA
    Feature parity with self-hosted — no paywalled features
```

Rule: Infrastructure and support are paid. Features are always free.

---

## License Decision

Current: MIT

If a hosted tier is launched:
- Add Commons Clause on top of MIT
- Prevents others from selling a hosted version of Persona
- Self-hosting remains completely free and unrestricted
- Do NOT change to GPL or BUSL — too much friction for enterprise adoption

Action: Do not change the license until a hosted offering is actually being built.
Document: Create a git tag when the license changes so the pre-change
          commit is always available for anyone who wants it.

---

## Database Path

Phase 1: data/config.json (current)
Phase 2: SQLite + Alembic migrations (required)
Hosted:  PostgreSQL (swap from SQLite when needed)

The Alembic migration infrastructure built in Phase 2 makes the SQLite →
PostgreSQL swap mechanical. SQLAlchemy abstracts the difference.
The connection string in .env changes. Nothing else does.

Do NOT build for PostgreSQL now. Build for SQLite with clean migrations.

---

## Telemetry (Opt-In Only)

For self-hosted: build the hook now, collect nothing.

```python
# config.py addition
class Settings(BaseSettings):
    telemetry_enabled: bool = False  # default off, always

# main.py — telemetry stub
if settings.telemetry_enabled:
    # Future: report version, rough scale bucket, feature flags
    # Never: usernames, directory data, IP addresses, org names
    pass
```

Settings toggle: "Share anonymous usage data with the Persona project"
Documented clearly. Trivially disableable. Off by default.

For hosted: full usage analytics (customers expect this).

---

## Tenant Provisioning for Hosted

When a customer signs up for hosted Persona:
1. Payment processed (Stripe)
2. Tenant provisioning service calls Persona's operator API
3. New tenant created automatically
4. Customer receives setup wizard URL
5. Customer configures their own AD/Entra/plugins

The provisioning service is external to Persona. Persona exposes a clean
operator API (Phase 8). The provisioning service is glue code, not core.

---

## Support Infrastructure

Minimum viable when hosting:
- GitHub Issues (already exists)
- Discord server (community — build this before hosting)
- Email for paid tier (can start with dedicated email)
- Status page (UptimeRobot free tier)
- Diagnostics endpoint (built in Phase 2)

The diagnostics endpoint is the key support tool:
GET /api/v1/admin/diagnostics returns:
- Version number
- Config summary (no secrets — only connection status)
- LDAP connection status + last successful query
- Graph API status + token expiry
- Migration version
- Last sync time per provider
Support can ask customer to hit this URL — no SSH needed.

---

## Decisions That Must Be Made Before Hosting

These are not relevant now but must be decided before launch:

1. Pricing model: per-tenant flat? per-user? tiered by tenant count?
2. Data residency: single region? multi-region? customer choice?
3. Backup strategy: frequency, retention, customer access
4. Incident response: who gets paged, what is the SLA
5. Customer data deletion: what happens when customer cancels

---

## What NOT to Build into Persona Core

Keep these out of the Persona codebase entirely:
- Billing logic (use Stripe Billing)
- Invoice generation (Stripe handles this)
- Customer portal for plan changes (Stripe portal)
- Marketing/signup pages (separate static site)

Persona core stays focused on identity operations.
