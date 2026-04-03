# Security Policy

## Secrets Architecture

Persona uses a two-layer configuration model designed so that no secret
ever touches source control.

### Layer 1 — `.env` (on the host, gitignored)

Contains only the JWT signing secret and app port. Nothing AD-related.

| Variable | Purpose | How to generate |
|---|---|---|
| `JWT_SECRET` | Signs session tokens | `openssl rand -hex 32` |

### Layer 2 — `data/config.json` (on the host, gitignored)

Created by the Setup Wizard. Contains LDAP connection settings and the
local admin password hash. Never committed to git.

Recommended host permissions:
```bash
chmod 700 data/
chmod 600 data/config.json
```

---

## Where Secrets Must Never Live

| Location | Why not |
|---|---|
| Source code | Gets committed to git |
| `docker-compose.yml` as literal values | Gets committed to git |
| `Dockerfile` as `ENV` or `ARG` | Baked into image layers, visible in `docker history` |
| `.env.example` | Public file — use placeholders only |
| Application logs | Logs can be forwarded externally |
| JWT payload | JWTs are encoded, not encrypted |
| `localStorage` / `sessionStorage` | Accessible to any JavaScript on the page |

---

## Login Credential Handling

LDAP user credentials (username + password) submitted at login:
- Exist in memory only for the duration of the LDAP bind operation
- Are never written to disk, logs, or any persistent store
- Are discarded immediately after the bind succeeds or fails
- Error messages never reveal whether the username or password was wrong

---

## Local Admin Account

The bootstrap local admin account password is:
- Hashed with bcrypt (minimum cost factor 12) before storage
- Stored only in `data/config.json` (gitignored, on the host)
- Never logged in plain text or hash form
- Rate-limited: 5 failed attempts triggers a 15-minute lockout

---

## Service Account Recommendations

The AD service account used by Persona should:
- Have **read-only** permissions only
- Be scoped to the OUs help desk staff need to see
- Be named clearly (e.g. `persona-svc`) for auditability
- **Not** be a Domain Admin — ever

---

## Reporting a Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Open a [GitHub Security Advisory](../../security/advisories/new) on this
repository instead. We will respond within 72 hours and coordinate
disclosure responsibly.
