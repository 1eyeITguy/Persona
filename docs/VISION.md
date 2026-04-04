# Persona — Vision & Platform Overview

> Version: 2.0 | April 2026

---

## What Persona Is

Persona is an open-source, self-hosted **identity operations platform** for
organizations running Microsoft identity environments — on-premises Active
Directory, Entra ID, Exchange Online, or any combination of the three.

Built for help desk technicians, IT administrators, and managed service
providers who need to stop jumping between tools to do simple work.

**The core promise:** One tool. Every identity and device operation. Done
correctly. With a full audit trail. Without needing to know which system
owns which attribute.

---

## The Problem Space

### Tool Sprawl
A help desk tech resolving one user issue today touches:
ADUC → Azure Portal → Exchange Admin Center → Intune → Sophos →
Cisco Umbrella → AnyDesk → potentially more.
Each is a separate login, a separate UI, a separate mental model.
Mistakes happen at every transition. Time is wasted at every login.

### Hybrid Identity Complexity
The AD/Entra/Exchange boundary is genuinely complex. Attributes have
different sources of authority depending on the organization's configuration.

The most dangerous scenario: an organization migrated Exchange to the cloud,
but Exchange attributes still exist in AD — frozen at migration time, months
or years out of date. A tool that reads AD and calls it done displays wrong
data as if it were current. Persona detects this and never does it.

### The Price Wall
Tools that solve this well cost thousands of dollars per year. Organizations
that can't afford them run PowerShell scripts and manual processes. The gap
between nothing and an enterprise tool is where most real-world IT teams live.
Persona lives in that gap, free, forever.

---

## The Platform Model

Persona is not a fixed feature set. It is a platform with four extensible layers:

```
┌─────────────────────────────────────────────────────────┐
│                      Persona UI                         │
│       React · Dark theme · Role-aware · Tenant-scoped   │
├─────────────────────────────────────────────────────────┤
│                   Workflow Engine                        │
│    YAML-defined · Approval chains · Community library   │
├────────────────┬───────────────────┬────────────────────┤
│ Identity       │ Service           │ Integration        │
│ Providers      │ Providers         │ Plugins            │
│                │                   │                    │
│ · AD (LDAP)    │ · Exchange Online │ · Sophos           │
│ · Entra ID     │ · Exchange OnPrem │ · Cisco Umbrella   │
│ · Hybrid       │ · Exchange Hybrid │ · CrowdStrike      │
│                │                   │ · Intune           │
│                │                   │ · AnyDesk          │
│                │                   │ · [community]      │
├────────────────┴───────────────────┴────────────────────┤
│           Rules Engine · Reporting Engine               │
│       Policy enforcement · Compliance reporting         │
├─────────────────────────────────────────────────────────┤
│             AI Assistant · MCP Server                   │
│      Context-aware · Tenant-scoped · Advisor only       │
└─────────────────────────────────────────────────────────┘
```

---

## Deployment Modes

```
Single Organization
    One tenant. Switcher hidden. Purpose-built feel.
    Target: internal IT teams.

Enterprise
    Multiple AD domains or Entra tenants.
    Tenant switcher visible. Operator manages list.
    Target: large organizations, subsidiaries, acquisitions.

MSP (Managed Service Provider)
    Many client tenants. Operator dashboard.
    Tech-to-tenant assignment. Per-tenant audit isolation.
    Community plugin library reused across all clients.
    Target: managed service providers.
```

One codebase. One Docker image. Three deployment personalities.

---

## Community Ecosystem

Persona grows through community contribution:

| Artifact | Format | Repository |
|---|---|---|
| Workflows | YAML | persona-community/workflows |
| Rules | YAML | persona-community/rules |
| Reports | YAML | persona-community/reports |
| Integration plugins | Python package | persona-community/integrations |

Organizations fork what they need, customize it, optionally contribute back.
No vendor controls the library. No per-workflow licensing.

---

## Design Philosophy

**Safety over speed.** Every write operation is previewed before execution.
Every destructive action requires confirmation. The tool guides the tech
toward the correct action.

**Correct by default.** Persona knows which system is authoritative for
which attribute for which user. It routes reads and writes automatically.
The tech does not need to understand SOA boundaries.

**Honest about what it knows.** When Persona cannot determine the correct
state, it says so explicitly. It never shows stale data as current.

**Auditable always.** Every action is logged — who, when, what changed,
what the previous state was. The audit log is immutable from the HD role.

**Open forever.** MIT license. No telemetry without opt-in. No lock-in.
No per-user pricing. Self-hostable by anyone, forever.
