"""
Entra ID management routes — /api/v1/entra/

All routes require a valid JWT (post-setup, Settings page only).
The client secret is NEVER returned in API responses — always "••••••••".

Entra config is stored in data/config.json under the "entra" key until
the per-tenant config.json path is introduced in Phase 8.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.app_config import get_entra_settings, is_entra_configured, load_config, save_config
from backend.auth.msal import test_entra_connection as _test_entra
from backend.deps import require_jwt
from backend.models.schemas import EntraConfigResponse, EntraConfigUpdate, TestEntraConnectionResponse

router = APIRouter(prefix="/entra", tags=["entra"])


@router.get("/config", response_model=EntraConfigResponse)
async def get_entra_config(
    _token: dict = Depends(require_jwt),
) -> EntraConfigResponse:
    """
    Return current Entra config with the client secret redacted.
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(status_code=404, detail="Entra not configured")

    return EntraConfigResponse(
        tenant_id=cfg["tenant_id"],
        client_id=cfg["client_id"],
        secret_expires=cfg.get("secret_expires"),
        connected=cfg.get("connected", True),
    )


@router.put("/config", response_model=EntraConfigResponse)
async def update_entra_config(
    request: EntraConfigUpdate,
    _token: dict = Depends(require_jwt),
) -> EntraConfigResponse:
    """
    Save or update Entra credentials.
    Tests the connection before persisting — rejects if the test fails.
    JWT required.
    """
    result = await run_in_threadpool(
        _test_entra, request.tenant_id, request.client_id, request.client_secret
    )
    if not result["success"]:
        raise HTTPException(
            status_code=422,
            detail=f"Connection test failed: {result['message']}",
        )

    config = load_config()
    config["entra"] = {
        "tenant_id": request.tenant_id,
        "client_id": request.client_id,
        "client_secret": request.client_secret,
        "secret_expires": request.secret_expires,
        "connected": True,
    }
    save_config(config)

    return EntraConfigResponse(
        tenant_id=request.tenant_id,
        client_id=request.client_id,
        secret_expires=request.secret_expires,
        connected=True,
    )


@router.delete("/config")
async def delete_entra_config(
    _token: dict = Depends(require_jwt),
) -> dict:
    """
    Disconnect Entra — removes the entra section from config.json.
    JWT required.
    """
    if not is_entra_configured():
        raise HTTPException(status_code=404, detail="Entra not configured")

    config = load_config()
    config.pop("entra", None)
    save_config(config)
    return {"success": True}
