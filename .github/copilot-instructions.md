# Persona — Copilot Instructions

> This file is automatically loaded by GitHub Copilot in every session.
> It is the single source of truth for project context, stack decisions, and rules.
> Do not delete or rename this file.

---

## What Is Persona?

Persona is an open-source, browser-based help desk management tool for organizations
running hybrid Microsoft identity environments (on-prem Active Directory + Entra ID).

It is designed to be **generic and community-friendly** — no company-specific values,
domain names, or assumptions baked in. Any organization should be able to clone this
repo, run `docker compose up`, complete the setup wizard, and be productive.

**Core design principle:** Guide the tech toward the correct action. Make the wrong
action hard. Safety over speed.

---

## Identity Environment Persona Supports

| Layer | Detail |
|---|---|
| On-prem AD | Traditional Active Directory. Authoritative for all on-prem attributes. |
| Entra ID | Synced from AD via Entra Connect (Azure AD Connect). |
| Exchange | Cloud-only. Exchange attribute SOA = cloud. |
| Key flag | `BlockExchangeProvisioningFromOnPremEnabled = True` |

**Rules that must never be violated:**
- NEVER write Exchange attributes from on-prem. Exchange SOA is cloud-only.
- NEVER modify attributes that Entra Connect owns from the cloud side.
- Respect the sync boundary — on-prem AD owns on-prem attributes.
- LDAP credentials are used only for the bind operation. Never stored. Never logged.

---

## Configuration Philosophy — No Hardcoded Values

Persona uses a **two-layer configuration model:**

### Layer 1 — Bootstrap `.env`
Minimal. Only values the app needs to start before any database or config exists.

```
JWT_SECRET=...
APP_PORT=8000
FRONTEND_PORT=5173
```

That's it. No LDAP values. No domain names. No company data.

### Layer 2 — In-App Settings (persisted in `data/config.json`)

All LDAP/AD connection settings are configured through the **Settings UI** inside
the app. They are stored in `data/config.json`, which is mounted as a Docker volume.

**Why this approach:**
- Any admin can set up the app without editing files on the server.
- Makes Persona portable and community-distributable.
- Settings survive container restarts.
- No sensitive values need to be taught to the end user during deployment docs.

The settings stored in `data/config.json`:
```json
{
  "ldap": {
    "host": "",
    "port": 389,
    "use_ssl": false,
    "base_dn": "",
    "service_account_dn": "",
    "service_account_password": ""
  },
  "app": {
    "site_name": "Persona",
    "setup_complete": false
  }
}
```

### First-Run Experience

If `setup_complete` is `false` (or `data/config.json` does not exist), the app
redirects ALL routes to a **Setup Wizard** — a multi-step form that walks the
admin through:

1. LDAP connection settings (host, port, SSL, base DN)
2. Service account credentials
3. Test connection button (live LDAP bind test before saving)
4. Confirm and save → sets `setup_complete: true`

After setup, the app behaves normally (login → AD tree → user panel).

---

## Tech Stack — Final Decisions

| Layer | Choice | Notes |
|---|---|---|
| Backend | Python 3.11 + FastAPI | Async, OpenAPI docs at /api/docs |
| AD queries | ldap3 | Best enterprise AD library. Always run in thread pool. |
| Entra / EXO auth | msal (Microsoft's Python library) | Phase 2+ |
| Config persistence | JSON file (`data/config.json`) | Mounted Docker volume |
| Frontend | React 18 + Tailwind CSS + Vite | Dark theme |
| Container | Docker + Docker Compose | python:3.11-slim base |
| Orchestration | Portainer-compatible | Single docker-compose.yml |
| Repo | GitHub | Public, community project |

---

## Project Structure

```
persona/
├── .github/
│   └── copilot-instructions.md   ← YOU ARE HERE
├── backend/
│   ├── main.py                   ← FastAPI app entry point
│   ├── config.py                 ← Bootstrap settings (.env only)
│   ├── app_config.py             ← data/config.json reader/writer
│   ├── auth/
│   │   ├── ldap.py               ← LDAP bind + AD query logic
│   │   └── msal.py               ← Entra OAuth (Phase 2)
│   ├── routes/
│   │   ├── auth.py               ← Login, /me
│   │   ├── ad.py                 ← AD tree + user endpoints
│   │   ├── settings.py           ← Settings read/write + connection test
│   │   └── entra.py              ← Entra endpoints (Phase 2)
│   ├── models/
│   │   └── schemas.py            ← All Pydantic models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ADTree.jsx
│   │   │   ├── UserPanel.jsx
│   │   │   ├── LoginForm.jsx
│   │   │   ├── SetupWizard.jsx   ← First-run LDAP config wizard
│   │   │   ├── SettingsPage.jsx  ← In-app settings UI
│   │   │   └── ConnectEntra.jsx  ← Phase 2 stub
│   │   ├── hooks/
│   │   │   ├── useADTree.js
│   │   │   └── useAppConfig.js   ← Reads app config / setup state
│   │   ├── context/
│   │   │   └── AuthContext.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── data/                         ← Docker volume mount point
│   └── .gitkeep                  ← Keeps folder in git, config.json excluded
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── COPILOT_PROMPTS_PHASE1.md
│   └── specs/
│       ├── phase-01-ad-auth-tree.md
│       └── settings-config.md
├── docker-compose.yml
├── .env.example                  ← Bootstrap only — no LDAP values
├── .gitignore
├── CHANGELOG.md
├── COPILOT_CONTEXT.md
└── README.md
```

---

## Coding Rules

1. **Read-only in Phase 1.** No write operations until Phase 2.
2. **Never store credentials in .env.** LDAP values live in `data/config.json` only.
3. **Never log credentials.** Service account password must never appear in logs.
4. **LDAP runs in a thread pool.** Use `run_in_threadpool` for all ldap3 calls.
5. **Pydantic models for everything.** All API shapes are typed.
6. **Environment config only from .env.** Bootstrap values only — JWT secret, ports.
7. **Generic by default.** No company names, no domain examples except placeholder text.
8. **One feature at a time.** Do not scaffold Phase 2+ until Phase 1 is complete.
9. **Changelog on every change.** Every meaningful change gets a `CHANGELOG.md` entry.
10. **Document as you build.** Update `docs/` when architecture decisions are made.

---

## Community / Open Source Rules

- No company-specific values anywhere in code, comments, or docs.
- Use generic placeholders: `yourdomain.com`, `DC=yourdomain,DC=com`,
  `CN=persona-svc,OU=Service Accounts,DC=yourdomain,DC=com`
- README must be written for a stranger who has never heard of this project.
- All setup must be achievable through the UI — no file editing required after
  the initial `docker compose up`.

---

## Design / UI Rules

- Dark theme only. Background `#0f1117`, surface `#1a1d27`, border `#2d3148`.
- Primary brand color: `#6474e5` (indigo). Accent: `#7c3aed` (violet).
- Status colors: success `#4ade80`, warning `#f59e0b`, danger `#f87171`.
- Left sidebar navigation, right content area.
- "Connect to Entra" button always visible in header — gradient indigo-violet.
- Setup Wizard uses a centered card layout — not the full app shell.
- Settings page lives under a gear icon in the sidebar, accessible when logged in.

---

## Phase Status

| Phase | Feature | Status |
|---|---|---|
| 1 | Setup wizard + AD login + OU tree + user attribute panel | 🔧 In progress |
| 2 | Entra ID connect + user cloud view | ⏳ Planned |
| 3 | Exchange Online mailbox view | ⏳ Planned |
| 4 | Write operations (password reset, unlock) | ⏳ Planned |
| 5 | HR role — photo lookup and change only | ⏳ Planned |
