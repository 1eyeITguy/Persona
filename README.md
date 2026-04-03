# Persona

An open-source, browser-based help desk management tool for hybrid Microsoft
identity environments (on-prem Active Directory + Entra ID + Exchange Online).

Built for Tier 1 and Tier 2 help desk technicians. One tool instead of three.

> **Community project.** Contributions welcome.
> See [ROADMAP](docs/ROADMAP.md) for what's planned.

---

## Quick Start

You do not need to clone this repo to run Persona.
Pull the published image and you're up in under 5 minutes.

### 1. Create a folder and download the compose file

```bash
mkdir persona && cd persona
curl -o docker-compose.yml https://raw.githubusercontent.com/OWNER/persona/main/docker-compose.yml
```

### 2. Create your `.env` file

```bash
curl -o .env.example https://raw.githubusercontent.com/OWNER/persona/main/.env.example
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to a random string:

```bash
# Generate one automatically:
openssl rand -hex 32
```

### 3. Create the data directory

```bash
mkdir data
chmod 700 data
```

### 4. Start Persona

```bash
docker compose up -d
```

### 5. Open the Setup Wizard

Open **http://localhost:8000** in your browser.

The Setup Wizard will walk you through:
1. Creating a local admin account (your recovery account if AD is unreachable)
2. Connecting to Active Directory

After setup, your help desk team logs in with their Windows credentials.

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Your configuration in `data/` is preserved across updates.

---

## What It Does

### Phase 1 (Current)
- First-run Setup Wizard — no file editing required after `.env`
- Local admin account — break-glass access if AD is down
- Login with on-prem Active Directory credentials
- Expandable AD directory tree (like ADUC in a browser)
- Click any user → full attribute panel
- In-app Settings to update AD connection

### Coming Soon
- Entra ID connect + cloud user view
- Exchange Online mailbox view
- Password reset and account unlock (with confirmation guardrails)
- HR role — user photo management only

See [ROADMAP](docs/ROADMAP.md) for the full plan.

---

## Architecture

```
Browser → Persona Container → On-prem Active Directory (LDAP)
                           → Entra ID (OAuth — Phase 2)
                           → Exchange Online (Graph API — Phase 3)
```

Persona runs entirely on your infrastructure. No data leaves your network
except for the Entra/Exchange connections you explicitly authorize.

---

## Identity Environment

Persona is built for organizations with:
- On-prem Active Directory synced to Entra ID via **Entra Connect**
- Exchange **cloud-only** (`BlockExchangeProvisioningFromOnPremEnabled = True`)

Persona respects the Exchange SOA — it never writes Exchange attributes from on-prem.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + FastAPI |
| AD Queries | ldap3 |
| Auth | bcrypt (local admin), LDAP bind (AD users), MSAL (Entra — Phase 2) |
| Frontend | React 18 + Tailwind CSS |
| Config | JSON file on Docker volume |
| Image | `ghcr.io/OWNER/persona` |

---

## Service Account Requirements

Persona's AD service account needs **read-only** access:
- Read access to User, OrganizationalUnit, and Container objects
- Read access to Group objects (for group name resolution)
- No write permissions required for Phase 1

---

## Documentation

| Doc | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System design and auth model |
| [Roadmap](docs/ROADMAP.md) | Feature phases |
| [Security](SECURITY.md) | Secrets model and vulnerability reporting |
| [Changelog](CHANGELOG.md) | Version history |

---

## Contributing

1. Read `.github/copilot-instructions.md` for project context and coding rules
2. Check the [ROADMAP](docs/ROADMAP.md) for planned phases
3. Open an issue before starting work on a new feature
4. Update `CHANGELOG.md` with your changes
5. All PRs target the `main` branch

---

## License

MIT — see [LICENSE](LICENSE).
