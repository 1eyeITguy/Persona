"""
Persona — FastAPI application entry point.

Bootstrap only — routers are wired in separately (see routes/).
OpenAPI interactive docs available at /api/docs.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter

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
