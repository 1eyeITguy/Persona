# Persona

An open-source, self-hosted **identity operations platform** for hybrid Microsoft
identity environments — Active Directory, Entra ID, Exchange Online, or any
combination of the three.

Built for help desk technicians, IT administrators, and managed service providers
who need to stop jumping between tools to do simple work.

> **Community project.** Contributions welcome.
> See [ROADMAP](docs/ROADMAP.md) for what's planned and what's next.

---

## Quick Start

You do not need to clone this repo to run Persona.

```bash
# 1. Create a folder
mkdir persona && cd persona

# 2. Get the compose file
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/1eyeITguy/Persona/main/docker-compose.yml

# 3. Create your .env
curl -o .env.example \
  https://raw.githubusercontent.com/1eyeITguy/Persona/main/.env.example
cp .env.example .env
# Edit .env — set JWT_SECRET using: openssl rand -hex 32

# 4. Create the data directory
mkdir data && chmod 700 data

# 5. Start
docker compose up -d

# 6. Open http://localhost:8000
# The Setup Wizard will guide you through the rest.
```

No file editing beyond `.env`. Everything else is configured through the UI.

---

## What It Does

### Phase 1 — Complete
- First-run Setup Wizard (no file editing after .env)
- Local admin account (break-glass if AD is unreachable)
- Login with on-prem Active Directory credentials
- Expandable AD directory tree — like ADUC in a browser
- Click any user → full attribute panel
- In-app Settings to update AD connection

### Planned (see [ROADMAP](docs/ROADMAP.md))
- Entra ID connect + cloud user view + TAP management
- Exchange Online mailbox view with SOA-aware data
- Write operations: password reset, unlock, group management
- Workflow engine: name change, onboarding, offboarding
- Rules engine: policy enforcement + attribute hygiene
- Device management: offboarding across Intune, Autopilot, and vendor tools
- Multi-tenant MSP support with operator dashboard
- AI assistant + MCP server

---

## Docker Image Tags

| Tag | Description | Use |
|---|---|---|
| `:latest` | Current stable release | Production |
| `:v0.2.0` | Pinned release | Stable, no surprises |
| `:dev` | Current develop branch | Testing only — may be unstable |

---

## Architecture

```
Browser → Persona Container → On-prem Active Directory (LDAP)
                           → Entra ID (OAuth — Phase 2)
                           → Exchange Online (Graph API — Phase 3)
                           → Integration plugins (Phase 7)
```

Persona runs entirely on your infrastructure. No data leaves your network
except for the Entra/Exchange connections you explicitly authorize.

---

## Identity Environment Support

| Configuration | Supported |
|---|---|
| AD only (on-prem, no cloud) | ✓ Phase 1 |
| AD + Entra hybrid (Entra Connect) | ✓ Phase 1 (AD) + Phase 2 (Entra) |
| Entra only (cloud-native) | Phase 2 |
| Exchange Online only | Phase 3 |
| Exchange on-prem only | Phase 3 |
| Exchange hybrid | Phase 3 |

Persona correctly handles Exchange SOA — it detects when AD Exchange attributes
are stale (frozen at migration time) and never displays wrong data as current.

---

## Service Account Requirements

Persona uses a service account — not individual user credentials.
This means consistent permissions and a clean audit trail.

Phase 1 (read-only):
- Read access to User, OU, and Container objects
- Read access to Group objects

Phase 4+ (write operations):
- Password reset rights on target OUs
- Modify specific attributes (telephoneNumber, mobile, etc.)
- Group membership modification (non-privileged groups)

Never: Domain Admin. Never more than what the current phase requires.

---

## Deployment Modes

Persona supports three deployment modes configured at first run:

- **Single organization** — one tenant, one AD domain
- **Enterprise** — multiple domains or subsidiaries  
- **MSP** — many client tenants with operator dashboard and tech-to-tenant assignment

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Database | SQLite + Alembic (Phase 2) |
| AD Queries | ldap3 |
| Entra/EXO | msal + Graph API (Phase 2+) |
| Frontend | React 18 + Tailwind CSS |
| Container | Docker + Docker Compose |
| Registry | ghcr.io/1eyeITguy/persona |

---

## Documentation

| Document | Description |
|---|---|
| [Vision](docs/VISION.md) | What Persona is and why it exists |
| [Architecture](docs/ARCHITECTURE.md) | System design, auth model, API structure |
| [Roadmap](docs/ROADMAP.md) | All phases with feature detail |
| [Platform](docs/PLATFORM.md) | Plugin, workflow, and rules engine design |
| [Future Hosting](docs/FUTURE-HOSTING.md) | Commercial path decisions |
| [Security](SECURITY.md) | Secrets architecture, vulnerability reporting |
| [Changelog](CHANGELOG.md) | Version history |

Phase specs: [docs/specs/](docs/specs/)
Architecture deep-dives: [docs/specs/architecture/](docs/specs/architecture/)

---

## Contributing

1. Read `.github/copilot-instructions.md` — project context and all coding rules
2. Check [ROADMAP](docs/ROADMAP.md) for what's planned next
3. Open an issue before starting work on a new feature
4. Target the `develop` branch — not `main`
5. Update `CHANGELOG.md` with your changes

---

## License

MIT — see [LICENSE](LICENSE).
