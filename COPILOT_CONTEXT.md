# Persona — Project Context

> Human-readable companion to `.github/copilot-instructions.md`.
> If you are a developer or AI assistant joining this project, start here.

---

## What Is This?

Persona is an open-source, browser-based help desk management tool that
replaces the need to juggle ADUC, the Azure Portal, and Exchange Admin Center
for common user management tasks.

Built for Tier 1 and Tier 2 help desk technicians. Safety first — the tool
guides techs toward correct actions and makes wrong ones hard.

---

## Identity Environment

- On-prem AD synced to Entra via Entra Connect
- Exchange is cloud-only. SOA = cloud.
- `BlockExchangeProvisioningFromOnPremEnabled = True`
- Persona **never** writes Exchange attributes via LDAP

---

## Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11 + FastAPI |
| AD queries | ldap3 (always in thread pool) |
| Entra/EXO | msal (Phase 2+) |
| Frontend | React 18 + Tailwind CSS + Vite |
| Config storage | `data/config.json` via Docker volume |
| Image registry | GitHub Container Registry (ghcr.io) |

---

## Configuration Model

- `.env` — bootstrap only (JWT secret, port). Gitignored.
- `data/config.json` — LDAP settings + local admin hash. Created by Setup Wizard. Gitignored.
- No secrets ever in source code or docker-compose.yml as literal values.

---

## First-Run Flow

1. `docker compose up`
2. Open browser → Setup Wizard appears
3. Step 1: Create local admin account (break-glass recovery account)
4. Step 2: Configure AD connection (host, port, base DN, service account)
5. Test connection → Save → Redirect to login
6. AD users log in with Windows credentials going forward

---

## Docs Map

| File | Purpose |
|---|---|
| `.github/copilot-instructions.md` | Copilot persistent context (auto-loaded) |
| `docs/ARCHITECTURE.md` | System design and auth model |
| `docs/ROADMAP.md` | Phased feature plan |
| `docs/specs/phase-01-ad-auth-tree.md` | Phase 1 — AD tree spec |
| `docs/specs/settings-config.md` | Settings & config system spec |
| `docs/specs/setup-wizard-local-admin.md` | Setup wizard & local admin spec |
| `docs/COPILOT_PROMPTS_PHASE1.md` | Paste-in prompts for Copilot |
| `CHANGELOG.md` | Version history |
| `SECURITY.md` | Secrets architecture |

---

## Current Phase: 1

Building: Setup Wizard → Local admin account → AD login → Tree view → User panel.
Read-only. No write operations.

See `docs/specs/` for full specifications.
