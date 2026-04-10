"""
Entra ID management routes — /api/v1/entra/

Routes are split into two groups:

  Config CRUD (JWT required — Settings page only):
    GET    /config           Return current config with secret redacted
    PUT    /config           Save or update credentials (tests connection first)
    DELETE /config           Disconnect Entra

  OAuth2 / programmatic App Registration (optional JWT — public during setup):
    POST   /oauth2/start     Generate Microsoft authorization URL (PKCE)
    POST   /oauth2/exchange  Exchange auth code for delegated session token
    POST   /oauth2/create-app  Use session token to create App Registration

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
    is_setup_complete,
    load_config,
    save_config,
)
from backend.auth.msal import (
    build_oauth_auth_url,
    consume_oauth_session,
    create_app_registration,
    exchange_oauth_code,
    get_entra_user,
    test_entra_connection as _test_entra,
)
from backend.deps import optional_jwt, require_jwt
from backend.models.schemas import (
    CreateAppRequest,
    CreateAppResponse,
    EntraConfigResponse,
    EntraConfigUpdate,
    EntraUserResponse,
    OAuthExchangeRequest,
    OAuthExchangeResponse,
    OAuthStartRequest,
    OAuthStartResponse,
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
# OAuth2 / programmatic App Registration
# ---------------------------------------------------------------------------


@router.post("/oauth2/start", response_model=OAuthStartResponse)
async def oauth_start(
    request: OAuthStartRequest,
    _token: object = Depends(optional_jwt),
) -> OAuthStartResponse:
    """
    Generate a Microsoft OAuth2 authorization URL with PKCE.
    The frontend should redirect the browser to the returned auth_url.

    Public when setup is incomplete; JWT required when setup is complete.
    """
    if is_setup_complete() and _token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await run_in_threadpool(
        build_oauth_auth_url,
        request.tenant_id,
        request.client_id,
        request.redirect_uri,
    )
    if not result.get("success"):
        raise HTTPException(status_code=422, detail="Failed to build authorization URL.")

    return OAuthStartResponse(auth_url=result["auth_url"])


@router.post("/oauth2/exchange", response_model=OAuthExchangeResponse)
async def oauth_exchange(
    request: OAuthExchangeRequest,
    _token: object = Depends(optional_jwt),
) -> OAuthExchangeResponse:
    """
    Exchange an OAuth2 authorization code for a server-side session token.
    The delegated access token is stored server-side — never returned to the client.

    Public when setup is incomplete; JWT required when setup is complete.
    """
    if is_setup_complete() and _token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await run_in_threadpool(exchange_oauth_code, request.code, request.state)
    return OAuthExchangeResponse(
        success=result["success"],
        session_token=result.get("session_token"),
        message=result.get("message"),
    )


@router.post("/oauth2/create-app", response_model=CreateAppResponse)
async def oauth_create_app(
    request: CreateAppRequest,
    _token: object = Depends(optional_jwt),
) -> CreateAppResponse:
    """
    Create the Persona App Registration using the delegated token from the OAuth session.
    On success, saves the resulting credentials to config.json and verifies the connection.
    The client secret is saved server-side and never returned.

    Public when setup is incomplete; JWT required when setup is complete.
    """
    if is_setup_complete() and _token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Retrieve and consume the session (delegated token + tenant_id)
    session = consume_oauth_session(request.session_token)
    if session is None:
        raise HTTPException(
            status_code=422,
            detail="Session expired or invalid. Please sign in again.",
        )

    delegated_token = session["access_token"]
    tenant_id = session["tenant_id"]

    # Create the App Registration
    app_result = await run_in_threadpool(
        create_app_registration, delegated_token, tenant_id
    )
    if not app_result["success"]:
        return CreateAppResponse(success=False, message=app_result["message"])

    client_id = app_result["client_id"]
    client_secret = app_result["client_secret"]
    secret_expires = app_result["secret_expires"]

    # Verify the new credentials work before saving
    test_result = await run_in_threadpool(_test_entra, tenant_id, client_id, client_secret)
    if not test_result["success"]:
        return CreateAppResponse(
            success=False,
            message=(
                f"App Registration was created but the connection test failed: "
                f"{test_result['message']}. Check the app in Azure Portal."
            ),
        )

    # Persist to config.json — secret written here, never returned to client
    config = load_config()
    config["entra"] = {
        "tenant_id": tenant_id,
        "client_id": client_id,
        "client_secret": client_secret,
        "secret_expires": secret_expires,
        "connected": True,
    }
    save_config(config)

    return CreateAppResponse(
        success=True,
        client_id=client_id,
        secret_expires=secret_expires,
        message="Persona App Registration created and connected successfully.",
    )


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
