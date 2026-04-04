"""
backend/auth/msal.py — Entra ID client credentials flow via MSAL.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

The client secret is NEVER logged or included in exception messages.
msal.ConfidentialClientApplication is created per-call (no token cache at
this layer) — caching will be added in Phase 3 when token reuse matters.
"""

from __future__ import annotations

import logging

import msal
import requests as _requests

logger = logging.getLogger(__name__)


def test_entra_connection(
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> dict:
    """
    Acquire a Graph API token using client credentials and fetch the user count.

    Returns:
        {"success": bool, "message": str, "user_count": int | None}

    Errors from MSAL (bad tenant/client/secret) are returned as success=False.
    The client secret is never included in the returned message.
    """
    authority = f"https://login.microsoftonline.com/{tenant_id}"

    try:
        app = msal.ConfidentialClientApplication(
            client_id=client_id,
            client_credential=client_secret,
            authority=authority,
        )
    except Exception:
        return {
            "success": False,
            "message": "Invalid Entra configuration.",
            "user_count": None,
        }

    result = app.acquire_token_for_client(
        scopes=["https://graph.microsoft.com/.default"]
    )

    if "access_token" not in result:
        err = (
            result.get("error_description")
            or result.get("error")
            or "Authentication failed"
        )
        logger.warning("Entra token acquisition failed: %s", err)
        return {"success": False, "message": err, "user_count": None}

    token: str = result["access_token"]

    try:
        resp = _requests.get(
            "https://graph.microsoft.com/v1.0/users/$count",
            headers={
                "Authorization": f"Bearer {token}",
                "ConsistencyLevel": "eventual",
            },
            timeout=10,
        )
        resp.raise_for_status()
        count = int(resp.text)
        noun = "user" if count == 1 else "users"
        return {
            "success": True,
            "message": f"Connected. {count:,} {noun} found in Entra.",
            "user_count": count,
        }
    except _requests.HTTPError as exc:
        return {
            "success": False,
            "message": f"Token acquired but Graph API returned {exc.response.status_code}.",
            "user_count": None,
        }
    except Exception as exc:
        return {
            "success": False,
            "message": f"Token acquired but Graph API call failed: {exc}",
            "user_count": None,
        }
