"""
Persona — FastAPI application entry point.

Bootstrap only — routers are wired in separately (see routes/).
OpenAPI interactive docs available at /api/docs.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routes import ad as ad_router
from backend.routes import auth as auth_router
from backend.routes import entra as entra_router
from backend.routes import settings as settings_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Persona",
    description=(
        "Browser-based help desk management for hybrid Microsoft identity environments."
    ),
    version="0.2.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["meta"])
async def health_check() -> dict:
    """Liveness probe.  Returns 200 when the backend is running."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def on_startup() -> None:
    """Run DB migrations and seed from config.json on first Phase-2 startup."""
    _run_migrations()
    _seed_from_config()


def _run_migrations() -> None:
    alembic_cfg = AlembicConfig(str(Path(__file__).parent / "alembic.ini"))
    alembic_command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations applied")


def _seed_from_config() -> None:
    """
    One-time migration: if no tenants exist yet, create the default tenant and
    local-admin PersonaUser from the existing config.json so Phase-1 installs
    carry forward without data loss.
    """
    from backend.app_config import load_config
    from backend.database.models.tenant import Tenant
    from backend.database.models.user import PersonaUser
    from backend.database.session import SessionLocal

    with SessionLocal() as db:
        if db.query(Tenant).count() > 0:
            return  # already seeded

        config = load_config()
        if not config:
            return  # fresh install — nothing to migrate

        now = datetime.now(timezone.utc).isoformat()
        tenant_id = str(uuid.uuid4())

        tenant = Tenant(
            id=tenant_id,
            slug="default",
            name=config.get("app", {}).get("site_name", "Persona"),
            deployment_mode="single",
            status="active",
            created_at=now,
        )
        db.add(tenant)

        local_admin = config.get("local_admin")
        if local_admin:
            user = PersonaUser(
                id=str(uuid.uuid4()),
                tenant_id=tenant_id,
                username=local_admin.get("username", "admin"),
                password_hash=local_admin.get("password_hash", ""),
                role="local_admin",
                is_local_admin=True,
                created_at=now,
            )
            db.add(user)

        db.commit()
        logger.info("Seeded database from config.json (tenant: default)")


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

api = APIRouter(prefix="/api/v1")
api.include_router(settings_router.router)
api.include_router(auth_router.router)
api.include_router(ad_router.router)
api.include_router(entra_router.router)
app.include_router(api)

# ---------------------------------------------------------------------------
# Static file serving (production only)
#
# When running inside the Docker image, the React build is copied to ./static/
# by the multi-stage Dockerfile.  In development the Vite dev server handles
# all frontend traffic and this block is skipped.
# ---------------------------------------------------------------------------

_STATIC_DIR = Path(__file__).parent / "static"

if _STATIC_DIR.is_dir():
    # Serve Vite-generated assets (hashed filenames) under /assets
    _assets = _STATIC_DIR / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        """
        Return index.html for every non-API path so the React router works
        on hard refresh or direct URL access.
        """
        return FileResponse(_STATIC_DIR / "index.html")
