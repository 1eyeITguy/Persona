# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased — develop branch]

---

## [0.2.0] — Phase 1 Complete

### Added
- Setup Wizard — first-run LDAP configuration through UI
- Local admin bootstrap account (break-glass, bcrypt hashed)
- AD login via LDAP bind (credentials never stored)
- Expandable AD directory tree (OU/container/user)
- User attribute panel (full AD attribute set)
- In-app Settings — LDAP reconfiguration without restart
- Docker + docker-compose (prod and dev)
- Single-container Dockerfile (FastAPI serves React build)
- GitHub Actions — docker-publish.yml (main → :latest, tags → :v*)

### Architecture
- Python 3.11 + FastAPI backend
- React 18 + Tailwind CSS frontend
- ldap3 for AD queries (thread pool)
- bcrypt for local admin password
- JWT session tokens (short-lived, signed)
- data/config.json for runtime configuration (gitignored)

---

## [0.1.0] — Project Initialization

### Added
- Repository structure
- .github/copilot-instructions.md
- Full documentation set (VISION, ARCHITECTURE, ROADMAP, PLATFORM)
- Phase specs (2-9) and architecture deep-dives
- .gitignore, LICENSE (MIT), SECURITY.md
- .env.example (bootstrap only — no LDAP values)
- data/.gitkeep
- GitHub Actions — docker-dev.yml (develop → :dev)
- Branch strategy: feature/* → develop → main → v*.*.*

### Decisions
- Backend: Python 3.11 + FastAPI
- AD: ldap3 (thread pool, never block event loop)
- DB: SQLite + Alembic (Phase 2), PostgreSQL path for hosted
- Auth: Service account + service principal (not user credentials)
- Multi-tenancy: built in from Phase 2 (tenant_id on everything)
- Exchange SOA: per-user resolution, STALE_AD_ATTRS detection mandatory
- License: MIT (Commons Clause considered if hosted tier launches)
- Deployment: Docker image on ghcr.io/1eyeITguy/persona
