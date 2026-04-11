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

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool

from backend.app_config import (
    get_entra_settings,
    is_entra_configured,
    load_config,
    save_config,
)
from backend.auth.msal import (
    assign_user_licenses,
    get_entra_only_users,
    get_entra_user,
    get_entra_user_devices,
    get_entra_user_photo,
    get_tenant_licenses,
    test_entra_connection as _test_entra,
)
from backend.deps import require_jwt
from backend.models.schemas import (
    EntraConfigResponse,
    EntraConfigUpdate,
    EntraDevice,
    EntraOnlyUser,
    EntraUserResponse,
    TenantLicense,
    TestEntraConnectionResponse,
    UserLicense,
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


@router.get("/licenses", response_model=list[TenantLicense])
async def get_licenses(
    _token: dict = Depends(require_jwt),
) -> list[TenantLicense]:
    """
    Return all active Microsoft 365 / Entra license subscriptions for the tenant.
    Shows total purchased, assigned (consumed), and available seats per SKU.

    Requires Directory.Read.All or Organization.Read.All on the app registration.
    Returns 503 if Entra is not configured.
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(
            status_code=503,
            detail="Entra ID is not configured. Connect it in Settings first.",
        )

    raw = await run_in_threadpool(
        get_tenant_licenses,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
    )
    return [TenantLicense(**lic) for lic in raw]


@router.get("/users-cloud-only", response_model=list[EntraOnlyUser])
async def get_cloud_only_users(
    q: str | None = Query(default=None, description="Display name or UPN substring"),
    department: str | None = Query(default=None),
    account_status: str | None = Query(default=None, description="enabled | disabled"),
    _token: dict = Depends(require_jwt),
) -> list[EntraOnlyUser]:
    """
    Return all Entra-only users (no AD counterpart, onPremisesSyncEnabled is null).
    Supports optional filtering by name/UPN, department, and account status.
    Returns 503 if Entra is not configured.
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(
            status_code=503,
            detail="Entra ID is not configured. Connect it in Settings first.",
        )

    raw = await run_in_threadpool(
        get_entra_only_users,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
    )

    # Python-side filtering
    results = raw
    if q:
        q_lower = q.lower()
        results = [
            u for u in results
            if q_lower in (u.get("display_name") or "").lower()
            or q_lower in (u.get("upn") or "").lower()
        ]
    if department:
        results = [u for u in results if u.get("department") == department]
    if account_status == "enabled":
        results = [u for u in results if u.get("account_enabled") is True]
    elif account_status == "disabled":
        results = [u for u in results if u.get("account_enabled") is False]

    return [EntraOnlyUser(**u) for u in results]


@router.get("/users/{object_id}/devices", response_model=list[EntraDevice])
async def get_user_devices(
    object_id: str,
    _token: dict = Depends(require_jwt),
) -> list[EntraDevice]:
    """
    Return Intune managed devices and Entra registered devices for a user by Entra object ID.

    Combines results from:
      - /users/{id}/managedDevices  (Intune — requires DeviceManagementManagedDevices.Read.All)
      - /users/{id}/registeredDevices (Entra — requires Device.Read.All)

    Intune entries take precedence when the same device appears in both lists.
    Returns 503 if Entra is not configured. Returns an empty list if neither
    permission is granted rather than erroring out.
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(status_code=503, detail="Entra ID is not configured.")

    raw = await run_in_threadpool(
        get_entra_user_devices,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
        object_id,
    )
    return [EntraDevice(**d) for d in raw]


@router.post("/users/{object_id}/assign-licenses")
async def assign_licenses(
    object_id: str,
    add: list[str] = Query(default=[], description="SKU IDs to assign"),
    remove: list[str] = Query(default=[], description="SKU IDs to remove"),
    _token: dict = Depends(require_jwt),
) -> dict:
    """
    Assign and/or remove licenses for an Entra user.

    Pass SKU IDs (GUIDs) to add and/or remove as repeated query parameters:
      ?add=<skuId>&add=<skuId>&remove=<skuId>

    Requires User.ReadWrite.All or Directory.ReadWrite.All on the app registration.
    Returns 503 if Entra is not configured.
    Returns 400 with error message if the Graph API call fails (e.g. no available seats).
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(status_code=503, detail="Entra ID is not configured.")

    if not add and not remove:
        raise HTTPException(status_code=400, detail="No license changes requested.")

    result = await run_in_threadpool(
        assign_user_licenses,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
        object_id,
        add,
        remove,
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "License assignment failed."))

    return {"success": True}


@router.get("/users/{object_id}/photo")
async def get_user_photo(
    object_id: str,
    _token: dict = Depends(require_jwt),
) -> Response:
    """
    Return the Entra profile photo for a user by object ID as a JPEG image.
    Returns 404 if the user has no photo or Entra is not configured.
    JWT required.
    """
    cfg = get_entra_settings()
    if cfg is None:
        raise HTTPException(status_code=404, detail="Entra not configured")

    photo_data_url = await run_in_threadpool(
        get_entra_user_photo,
        cfg["tenant_id"],
        cfg["client_id"],
        cfg["client_secret"],
        object_id,
    )

    if not photo_data_url:
        raise HTTPException(status_code=404, detail="No photo available")

    # photo_data_url is "data:image/jpeg;base64,..." — extract raw bytes for response
    try:
        _prefix, b64_data = photo_data_url.split(",", 1)
        content_type = _prefix.split(":")[1].split(";")[0]
        import base64 as _b64
        image_bytes = _b64.b64decode(b64_data)
        return Response(content=image_bytes, media_type=content_type)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decode photo")


@router.get("/users/{upn:path}", response_model=EntraUserResponse)
async def get_cloud_user(
    upn: str,
    mail: str | None = None,
    _token: dict = Depends(require_jwt),
) -> EntraUserResponse:
    """
    Fetch Entra cloud identity data for a user by UPN.
    Used by the Cloud tab in UserDetail.
    JWT required.

    Optional query param ``mail`` is used as a fallback lookup identifier when
    the UPN returns 404 — handles environments where on-premises UPNs use a
    non-routable suffix (e.g. @company.local) that doesn't exist in Entra.

    Returns 503 if Entra is not configured.
    Returns found=False when neither identifier resolves to an Entra account.
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
        mail,
    )

    return EntraUserResponse(**result)
