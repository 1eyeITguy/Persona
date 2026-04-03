"""
Settings routes — /api/v1/settings/

Auth rules:
  GET  /status                — public
  POST /bootstrap             — public, only when local_admin_created=false
  POST /test-connection       — public when setup incomplete, JWT when complete
  POST /setup                 — public, only when setup_complete=false
  GET  /ldap                  — JWT required
  PUT  /ldap                  — JWT required
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from starlette.concurrency import run_in_threadpool

from backend.app_config import (
    get_ldap_settings,
    is_setup_complete,
    load_config,
    save_config,
)
from backend.auth.ldap import test_ldap_connection
from backend.deps import optional_jwt, require_jwt
from backend.models.schemas import (
    BootstrapRequest,
    LDAPSettings,
    LDAPSettingsUpdate,
    SetupRequest,
    SettingsStatusResponse,
    TestConnectionRequest,
    TestConnectionResponse,
)

router = APIRouter(prefix="/settings", tags=["settings"])

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# ---------------------------------------------------------------------------
# Password strength validation (bootstrap endpoint)
# ---------------------------------------------------------------------------

_PASSWORD_MIN_LEN = 12
_PWD_UPPER = re.compile(r"[A-Z]")
_PWD_LOWER = re.compile(r"[a-z]")
_PWD_DIGIT = re.compile(r"[0-9]")
_PWD_SYMBOL = re.compile(r"[^A-Za-z0-9]")


def _validate_password_strength(password: str) -> None:
    errors: list[str] = []
    if len(password) < _PASSWORD_MIN_LEN:
        errors.append(f"at least {_PASSWORD_MIN_LEN} characters")
    if not _PWD_UPPER.search(password):
        errors.append("an uppercase letter")
    if not _PWD_LOWER.search(password):
        errors.append("a lowercase letter")
    if not _PWD_DIGIT.search(password):
        errors.append("a number")
    if not _PWD_SYMBOL.search(password):
        errors.append("a special character")

    if errors:
        raise HTTPException(
            status_code=422,
            detail=f"Password must contain: {', '.join(errors)}.",
        )


def _validate_username(username: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_]{3,32}", username):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3–32 characters: letters, numbers, and underscores only.",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status", response_model=SettingsStatusResponse)
async def get_status() -> SettingsStatusResponse:
    """Return setup state. Used on every frontend load to decide which screen to show."""
    config = load_config()
    local_admin_created = bool(config.get("local_admin_created", False))
    ldap_configured = bool(config.get("ldap_configured", False))
    site_name = config.get("app", {}).get("site_name", "Persona")
    return SettingsStatusResponse(
        local_admin_created=local_admin_created,
        ldap_configured=ldap_configured,
        setup_complete=local_admin_created and ldap_configured,
        site_name=site_name,
    )


@router.post("/bootstrap")
async def bootstrap(request: BootstrapRequest) -> dict:
    """
    Create the local admin account.

    Only available when local_admin_created=false.  Returns 403 if already done.
    Password is validated for strength, hashed with bcrypt, and never logged.
    """
    config = load_config()
    if config.get("local_admin_created", False):
        raise HTTPException(status_code=403, detail="Local admin already created")

    _validate_username(request.username)
    _validate_password_strength(request.password)
    if request.password != request.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match")

    password_hash = _pwd_ctx.hash(request.password)
    # Never log the password or its hash
    config["local_admin"] = {
        "username": request.username,
        "password_hash": password_hash,
    }
    config["local_admin_created"] = True
    save_config(config)
    return {"success": True}


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(
    request: TestConnectionRequest,
    _token: object = Depends(optional_jwt),
) -> TestConnectionResponse:
    """
    Perform a live LDAP bind test.  Does not persist anything.

    Auth: public when setup is not complete (used by Setup Wizard before login
    is possible); requires JWT when setup is complete (Settings page).
    """
    if is_setup_complete() and _token is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    ldap_cfg = LDAPSettings(
        host=request.host,
        port=request.port,
        use_ssl=request.use_ssl,
        base_dn=request.base_dn,
        service_account_dn=request.service_account_dn,
        service_account_password=request.service_account_password,
    )
    result = await run_in_threadpool(test_ldap_connection, ldap_cfg)
    return result


@router.post("/setup")
async def setup(request: SetupRequest) -> dict:
    """
    Save LDAP configuration and mark ldap_configured=true.

    Only available when setup_complete=false.  Returns 403 if already done.
    """
    if is_setup_complete():
        raise HTTPException(status_code=403, detail="Setup already complete")

    config = load_config()
    config["ldap"] = {
        "host": request.ldap.host,
        "port": request.ldap.port,
        "use_ssl": request.ldap.use_ssl,
        "base_dn": request.ldap.base_dn,
        "service_account_dn": request.ldap.service_account_dn,
        "service_account_password": request.ldap.service_account_password,
    }
    config["ldap_configured"] = True
    if "app" not in config:
        config["app"] = {}
    config["app"]["site_name"] = request.site_name
    config["app"]["setup_complete"] = True
    save_config(config)
    return {"success": True}


@router.get("/ldap")
async def get_ldap_config(
    _token: dict = Depends(require_jwt),
) -> dict:
    """Return current LDAP settings with password redacted. JWT required."""
    cfg = get_ldap_settings()
    if cfg is None:
        raise HTTPException(status_code=404, detail="LDAP not configured")
    return {
        "host": cfg.host,
        "port": cfg.port,
        "use_ssl": cfg.use_ssl,
        "base_dn": cfg.base_dn,
        "service_account_dn": cfg.service_account_dn,
        "service_account_password": "\u2022" * 8,
    }


@router.put("/ldap")
async def update_ldap_config(
    request: LDAPSettingsUpdate,
    _token: dict = Depends(require_jwt),
) -> dict:
    """
    Update LDAP settings.  Tests connection before saving — rejects if test fails.
    JWT required.

    If service_account_password is omitted, the currently stored password is
    used for the test and save — the frontend never needs to handle plaintext.
    """
    # Resolve password: use supplied value or fall back to current config
    if request.service_account_password is not None:
        password = request.service_account_password
    else:
        current = get_ldap_settings()
        if current is None:
            raise HTTPException(
                status_code=422,
                detail="No existing LDAP config to keep password from.",
            )
        password = current.service_account_password

    full_settings = LDAPSettings(
        host=request.host,
        port=request.port,
        use_ssl=request.use_ssl,
        base_dn=request.base_dn,
        service_account_dn=request.service_account_dn,
        service_account_password=password,
    )

    test_result = await run_in_threadpool(test_ldap_connection, full_settings)
    if not test_result.success:
        raise HTTPException(
            status_code=422,
            detail=f"Connection test failed: {test_result.message}",
        )

    config = load_config()
    config["ldap"] = {
        "host": full_settings.host,
        "port": full_settings.port,
        "use_ssl": full_settings.use_ssl,
        "base_dn": full_settings.base_dn,
        "service_account_dn": full_settings.service_account_dn,
        "service_account_password": full_settings.service_account_password,
    }
    config["ldap_configured"] = True
    save_config(config)
    return {"success": True}
