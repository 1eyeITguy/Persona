"""
Persona — FastAPI application entry point.

Bootstrap only — routers are wired in separately (see routes/).
OpenAPI interactive docs available at /api/docs.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routes import ad as ad_router
from backend.routes import auth as auth_router
from backend.routes import settings as settings_router

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
# Routers
# ---------------------------------------------------------------------------

api = APIRouter(prefix="/api/v1")
api.include_router(settings_router.router)
api.include_router(auth_router.router)
api.include_router(ad_router.router)
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
