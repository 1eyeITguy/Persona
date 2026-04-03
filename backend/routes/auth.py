"""
Auth routes — /api/v1/auth/

POST /api/v1/auth/login
  Tries local admin first, then AD (if configured).
  Returns 503 if setup is not complete.
  Returns 401 with a generic message on failure — never reveals specifics.
  Rate-limits: 5 failures per username → 15-minute lockout.

GET /api/v1/auth/me
  Returns decoded JWT payload. No LDAP call.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from starlette.concurrency import run_in_threadpool

from backend.app_config import get_local_admin, is_setup_complete, load_config
from backend.auth.ldap import authenticate_user
from backend.deps import create_access_token, require_jwt
from backend.models.schemas import LoginRequest, TokenResponse, UserInfo

router = APIRouter(prefix="/auth", tags=["auth"])

logger = logging.getLogger(__name__)

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ---------------------------------------------------------------------------
# In-memory rate limiter — 5 failures per username → 15-minute lockout
# ---------------------------------------------------------------------------

_RATE_LIMIT_MAX_FAILURES: int = 5
_RATE_LIMIT_WINDOW_SECONDS: int = 15 * 60  # 15 minutes

_failure_counts: dict[str, list[float]] = defaultdict(list)
_rate_lock = Lock()


def _check_rate_limit(username: str) -> None:
    """Raise 429 if the username has hit the failure threshold recently."""
    now = time.monotonic()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS

    with _rate_lock:
        recent = [t for t in _failure_counts[username] if t > cutoff]
        _failure_counts[username] = recent

        if len(recent) >= _RATE_LIMIT_MAX_FAILURES:
            raise HTTPException(
                status_code=429,
                detail="Too many failed attempts. Try again in 15 minutes.",
            )


def _record_failure(username: str) -> None:
    with _rate_lock:
        _failure_counts[username].append(time.monotonic())


def _clear_failures(username: str) -> None:
    with _rate_lock:
        _failure_counts.pop(username, None)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    """
    Authenticate and return a signed JWT.

    Order of checks:
      1. Local admin account (always tried first — available even without LDAP)
      2. AD user via LDAP (only when LDAP is configured)

    Returns 503 if setup is not complete (neither admin nor LDAP configured).
    Returns 401 with a generic message on any credential failure.
    Password is never logged.
    """
    _check_rate_limit(request.username)

    config = load_config()
    local_admin_created: bool = config.get("local_admin_created", False)
    ldap_configured: bool = config.get("ldap_configured", False)

    if not local_admin_created and not ldap_configured:
        raise HTTPException(
            status_code=503,
            detail="Setup not complete. Please finish the setup wizard.",
        )

    # --- Try local admin ---
    if local_admin_created:
        admin_data = config.get("local_admin", {})
        admin_username: str = admin_data.get("username", "")
        admin_hash: str = admin_data.get("password_hash", "")

        if request.username == admin_username:
            if _pwd_ctx.verify(request.password, admin_hash):
                _clear_failures(request.username)
                token = create_access_token(
                    {
                        "sub": request.username,
                        "display_name": request.username,
                        "role": "local_admin",
                        "dn": None,
                    }
                )
                return TokenResponse(
                    access_token=token,
                    user=UserInfo(
                        display_name=request.username,
                        username=request.username,
                        role="local_admin",
                        dn=None,
                    ),
                )
            # Wrong password for the local admin user — fail immediately with 401
            _record_failure(request.username)
            raise HTTPException(status_code=401, detail="Invalid credentials")

    # --- Try AD ---
    if not ldap_configured:
        _record_failure(request.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    try:
        ad_user = await run_in_threadpool(authenticate_user, request.username, request.password)
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        _record_failure(request.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    _clear_failures(request.username)
    token = create_access_token(
        {
            "sub": ad_user["sam_account_name"],
            "display_name": ad_user.get("display_name") or ad_user["sam_account_name"],
            "role": "helpdesk",
            "dn": ad_user["dn"],
        }
    )
    return TokenResponse(
        access_token=token,
        user=UserInfo(
            display_name=ad_user.get("display_name") or ad_user["sam_account_name"],
            username=ad_user["sam_account_name"],
            role="helpdesk",
            dn=ad_user["dn"],
        ),
    )


@router.get("/me")
async def me(payload: dict = Depends(require_jwt)) -> dict:
    """Return the decoded JWT payload. No LDAP call."""
    return payload
