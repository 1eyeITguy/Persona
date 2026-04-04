# Spec: Phase 1 — Setup Wizard + AD Login + Directory Tree

**Status:** ✅ COMPLETE | **Version:** 0.2.0

---

## What Was Built

- First-run Setup Wizard (multi-step LDAP configuration UI)
- Local admin bootstrap account (bcrypt, break-glass)
- Login form (AD credentials via LDAP bind)
- Expandable AD directory tree (OUs, containers, users)
- User attribute panel (full AD attribute set, click to open)
- In-app Settings (LDAP reconfiguration)
- Docker + docker-compose (prod and dev variants)
- Single Dockerfile (FastAPI serves React build in production)

## What Was NOT Built (by design)

- Write operations — Phase 4
- Entra ID connection — Phase 2
- Exchange view — Phase 3
- Multi-tenancy — Phase 2 (database)
- Group management — Phase 2

## Architecture Notes

- Backend: Python 3.11 + FastAPI
- Frontend: React 18 + Tailwind CSS (Vite)
- AD queries: ldap3 via run_in_threadpool
- Config: data/config.json (will be migrated to SQLite in Phase 2)
- Auth: bcrypt local admin + LDAP bind for AD users + JWT

## Known Technical Debt

- data/config.json must be migrated to SQLite + Alembic in Phase 2
- API routes are not yet tenant-scoped (/api/v1/... not /api/v1/t/{slug}/...)
  → Update to tenant-scoped routes in Phase 2 before adding Entra
- No database — all state is in config.json
  → Introduce SQLite as Phase 2 first step, before any new features
