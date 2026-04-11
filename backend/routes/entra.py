"""
Entra ID management routes — /api/v1/entra/

Routes:
  Config CRUD (JWT required — Settings page only):
    GET    /config           Return current config with secret redacted
    PUT    /config           Save or update credentials (tests connection first)
    DELETE /config           Disconnect Entra

  Cloud user data (JWT required — UserDetail Cloud tab):
    GET    /users/{upn}      Fetch Entra cloud identity for a user by UPN

The client secret is NEVER returned in any API response.
"""

from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.app_config import (
    get_entra_settings,
    is_entra_configured,
    load_config,
    save_config,
)
from backend.auth.msal import (
    get_entra_user,
    test_entra_connection as _test_entra,
)
from backend.deps import require_jwt
from backend.models.schemas import (
    EntraConfigResponse,
    EntraConfigUpdate,
    EntraUserResponse,
    TestEntraConnectionResponse,
)

router = APIRouter(prefix="/entra", tags=["entra"])

# ---------------------------------------------------------------------------
# Config CRUD
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Cloud user data
# ---------------------------------------------------------------------------


@router.get("/users/{upn:path}", response_model=EntraUserResponse)
async def get_cloud_user(
    upn: str,
    _token: dict = Depends(require_jwt),
) -> EntraUserResponse:
    """
    Fetch Entra cloud identity data for a user by UPN.
    Used by the Cloud tab in UserDetail.
    JWT required.

    Returns 503 if Entra is not configured.
    Returns found=False when the UPN has no matching Entra account.
    """
    upn = unquote(upn)

    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(
            status_code=503,
            detail="Entra ID is not configured. Connect it in Settings first.",
        )

    result = await run_in_threadpool(
        get_entra_user,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
        upn,
    )

    return EntraUserResponse(**result)
