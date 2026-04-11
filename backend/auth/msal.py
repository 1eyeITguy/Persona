"""
backend/auth/msal.py — Entra ID integration via MSAL and Microsoft Graph.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

The client secret is NEVER logged or included in exception messages.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import msal
import requests as _requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graph API constants
# ---------------------------------------------------------------------------

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MFA_TYPE_NAMES: dict[str, Optional[str]] = {
    "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod": "Microsoft Authenticator",
    "#microsoft.graph.phoneAuthenticationMethod": "Phone",
    "#microsoft.graph.softwareOathAuthenticationMethod": "Authenticator App (TOTP)",
    "#microsoft.graph.emailAuthenticationMethod": "Email OTP",
    "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod": "Windows Hello",
    "#microsoft.graph.fido2AuthenticationMethod": "Security Key (FIDO2)",
    "#microsoft.graph.temporaryAccessPassAuthenticationMethod": "Temporary Access Pass",
    "#microsoft.graph.passwordAuthenticationMethod": None,  # not an MFA method
}

_SKU_NAMES: dict[str, str] = {
    "SPE_E3": "Microsoft 365 E3",
    "SPE_E5": "Microsoft 365 E5",
    "ENTERPRISEPREMIUM": "Microsoft 365 E5",
    "ENTERPRISEPACK": "Microsoft 365 E3",
    "SPE_F1": "Microsoft 365 F1",
    "SPE_F3": "Microsoft 365 F3",
    "SPB": "Microsoft 365 Business Premium",
    "O365_BUSINESS_ESSENTIALS": "Microsoft 365 Business Basic",
    "O365_BUSINESS_PREMIUM": "Microsoft 365 Business Standard",
    "EXCHANGESTANDARD": "Exchange Online Plan 1",
    "EXCHANGEENTERPRISE": "Exchange Online Plan 2",
    "TEAMS_EXPLORATORY": "Microsoft Teams Exploratory",
    "TEAMS_FREE": "Microsoft Teams Free",
    "POWER_BI_PRO": "Power BI Pro",
    "POWER_BI_STANDARD": "Power BI Free",
    "INTUNE_A": "Microsoft Intune",
    "EMS": "Enterprise Mobility + Security E3",
    "EMSPREMIUM": "Enterprise Mobility + Security E5",
    "AAD_PREMIUM": "Microsoft Entra ID P1",
    "AAD_PREMIUM_P2": "Microsoft Entra ID P2",
    "FLOW_FREE": "Power Automate Free",
    "POWERAPPS_DEV": "Power Apps Developer",
}


def _friendly_sku(sku_part_number: str) -> str:
    return _SKU_NAMES.get(sku_part_number, sku_part_number)


def _classify_mfa_methods(methods: list) -> list[str]:
    result = []
    for m in methods:
        friendly = _MFA_TYPE_NAMES.get(m.get("@odata.type", ""))
        if friendly is not None:
            result.append(friendly)
    return result


def _classify_group_type(group: dict) -> str:
    group_types = group.get("groupTypes") or []
    if "DynamicMembership" in group_types:
        return "Dynamic"
    if "Unified" in group_types:
        return "M365"
    if group.get("securityEnabled"):
        return "Security"
    return "Distribution"


# ---------------------------------------------------------------------------
# Client credentials connection test
# ---------------------------------------------------------------------------


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



# ---------------------------------------------------------------------------
# Cloud user data (client credentials, for Cloud tab in UserDetail)
# ---------------------------------------------------------------------------


def get_entra_user(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    upn: str,
) -> dict:
    """
    Fetch cloud identity data for a user by UPN using client credentials.

    Makes up to 4 Graph API calls:
      1. User profile + sign-in activity
      2. Authentication methods (MFA)
      3. License details
      4. Group memberships

    Returns a dict matching the EntraUserResponse schema.
    If the user is not found in Entra, returns {"found": False}.
    If authentication fails, returns {"found": False, "error": str}.
    Sign-in activity requires Entra ID P1/P2 — gracefully returns None when absent.
    """
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    try:
        app = msal.ConfidentialClientApplication(
            client_id=client_id,
            client_credential=client_secret,
            authority=authority,
        )
        result = app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )
    except Exception:
        return {"found": False, "error": "Invalid Entra configuration."}

    if "access_token" not in result:
        err = result.get("error_description") or result.get("error") or "Authentication failed"
        logger.warning("Entra token acquisition failed for cloud user lookup: %s", err)
        return {"found": False, "error": err}

    token = result["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # ── 1. User profile ────────────────────────────────────────────────────
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{upn}",
            headers=headers,
            params={
                "$select": "id,displayName,accountEnabled,signInActivity,userPrincipalName"
            },
            timeout=10,
        )
        if resp.status_code == 404:
            return {"found": False}
        resp.raise_for_status()
        user_data = resp.json()
    except _requests.HTTPError:
        return {"found": False, "error": "Failed to fetch user from Entra."}
    except Exception as exc:
        logger.warning("Entra user fetch error for %s: %s", upn, exc)
        return {"found": False, "error": "Failed to reach Microsoft Graph."}

    sign_in_activity = user_data.get("signInActivity") or {}
    last_sign_in: str | None = sign_in_activity.get("lastSignInDateTime")

    # ── 2. MFA methods ─────────────────────────────────────────────────────
    mfa_methods: list[str] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{upn}/authentication/methods",
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            mfa_methods = _classify_mfa_methods(resp.json().get("value", []))
    except Exception:
        pass  # MFA data is best-effort

    # ── 3. License details ─────────────────────────────────────────────────
    licenses: list[str] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{upn}/licenseDetails",
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            licenses = [
                _friendly_sku(item.get("skuPartNumber", ""))
                for item in resp.json().get("value", [])
            ]
    except Exception:
        pass  # License data is best-effort

    # ── 4. Group memberships ───────────────────────────────────────────────
    groups: list[dict] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{upn}/memberOf",
            headers=headers,
            params={
                "$select": "id,displayName,groupTypes,mailEnabled,securityEnabled"
            },
            timeout=10,
        )
        if resp.ok:
            raw_groups = resp.json().get("value", [])
            groups = sorted(
                [
                    {
                        "name": g.get("displayName") or "Unknown",
                        "group_type": _classify_group_type(g),
                    }
                    for g in raw_groups
                    if g.get("@odata.type") == "#microsoft.graph.group"
                ],
                key=lambda g: g["name"].lower(),
            )
    except Exception:
        pass  # Group data is best-effort

    return {
        "found": True,
        "entra_object_id": user_data.get("id"),
        "account_enabled": user_data.get("accountEnabled"),
        "last_sign_in": last_sign_in,
        "sign_in_risk_level": None,  # requires Entra ID P2 risky-users API; deferred
        "mfa_methods": mfa_methods,
        "licenses": licenses,
        "groups": groups,
    }
