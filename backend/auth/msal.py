"""
backend/auth/msal.py — Entra ID integration via MSAL and Microsoft Graph.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

The client secret is NEVER logged or included in exception messages.
"""

from __future__ import annotations

import base64
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
    mail: Optional[str] = None,
) -> dict:
    """
    Fetch cloud identity data for a user by UPN using client credentials.

    Falls back to looking up by ``mail`` if the UPN returns 404 — handles
    environments where on-premises UPNs use a non-routable suffix (e.g.
    @company.local) that doesn't exist in Entra.

    Makes up to 5 Graph API calls:
      1. User profile (by UPN, then mail fallback if 404)
      2. Sign-in activity (best-effort — requires AuditLog.Read.All)
      3. Authentication methods (MFA)
      4. License details
      5. Group memberships

    Returns a dict matching the EntraUserResponse schema.
    If the user is not found in Entra, returns {"found": False}.
    If authentication fails, returns {"found": False, "error": str}.
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
    # Try UPN first; if not found and mail is available, retry with mail.
    # This handles on-premises UPN suffixes that don't exist in Entra
    # (e.g. @company.local synced users whose cloud UPN differs).
    def _fetch_user_profile(identifier: str) -> tuple[int, dict | None]:
        """Return (status_code, json_body | None)."""
        try:
            r = _requests.get(
                f"{_GRAPH_BASE}/users/{identifier}",
                headers=headers,
                params={"$select": "id,displayName,accountEnabled,userPrincipalName"},
                timeout=10,
            )
            return r.status_code, r.json() if r.ok else None
        except Exception as exc:
            logger.warning("Entra profile fetch error for %s: %s", identifier, exc)
            return 0, None

    status, user_data = _fetch_user_profile(upn)
    if status == 404 and mail and mail != upn:
        logger.debug("UPN %s not found in Entra, retrying with mail %s", upn, mail)
        status, user_data = _fetch_user_profile(mail)

    if status == 0:
        return {"found": False, "error": "Failed to reach Microsoft Graph."}
    if status == 404 or user_data is None:
        return {"found": False}
    if status >= 400:
        logger.warning("Entra user fetch returned HTTP %s for %s", status, upn)
        return {"found": False, "error": f"Graph API returned HTTP {status}."}

    # Use the resolved identifier (object ID) for subsequent calls so all
    # follow-up requests are stable even when the fallback path was taken.
    resolved_id: str = user_data.get("id", upn)

    # ── 2. Sign-in activity (requires AuditLog.Read.All — best-effort) ────
    last_sign_in: str | None = None
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}",
            headers=headers,
            params={"$select": "signInActivity"},
            timeout=10,
        )
        if resp.ok:
            sign_in_activity = resp.json().get("signInActivity") or {}
            last_sign_in = sign_in_activity.get("lastSignInDateTime")
    except Exception:
        pass  # Sign-in activity is best-effort

    # ── 3. MFA methods ─────────────────────────────────────────────────────
    # Requires UserAuthenticationMethod.Read.All application permission.
    mfa_methods: list[str] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}/authentication/methods",
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            raw_methods = resp.json().get("value", [])
            logger.debug("MFA methods raw for %s: %s", resolved_id, raw_methods)
            mfa_methods = _classify_mfa_methods(raw_methods)
        else:
            logger.warning(
                "MFA methods fetch returned HTTP %s for %s: %s",
                resp.status_code, resolved_id, resp.text[:200],
            )
    except Exception as exc:
        logger.warning("MFA methods fetch error for %s: %s", resolved_id, exc)

    # ── 3. License details ─────────────────────────────────────────────────
    licenses: list[str] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}/licenseDetails",
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
            f"{_GRAPH_BASE}/users/{resolved_id}/memberOf",
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


def get_entra_user_photo(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    object_id: str,
) -> Optional[str]:
    """
    Fetch the profile photo for an Entra user by object ID.

    Calls GET /users/{object_id}/photo/$value via the Graph API.
    Returns a base64 data URL (data:image/jpeg;base64,...) or None when
    the user has no photo, the request fails, or authentication fails.

    Caller MUST use run_in_threadpool.
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
        return None

    if "access_token" not in result:
        return None

    token = result["access_token"]
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{object_id}/photo/$value",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
            b64 = base64.b64encode(resp.content).decode("ascii")
            return f"data:{content_type};base64,{b64}"
    except Exception as exc:
        logger.debug("Entra photo fetch error for %s: %s", object_id, exc)

    return None


def get_entra_only_users(
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> list[dict]:
    """
    Fetch all Entra-only users (no AD counterpart) from the Graph API.

    Filters for users where onPremisesSyncEnabled is null (cloud-only accounts).
    Paginates through all pages automatically.

    Returns a list of dicts matching the EntraOnlyUser schema (minus mfa_methods,
    licenses, groups which are loaded per-user on detail open).

    Caller MUST use run_in_threadpool.
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
        return []

    if "access_token" not in result:
        return []

    token = result["access_token"]
    headers = {
        "Authorization": f"Bearer {token}",
        "ConsistencyLevel": "eventual",
    }

    # Fetch cloud-only users (onPremisesSyncEnabled eq null means never synced from AD)
    select_fields = (
        "id,userPrincipalName,displayName,givenName,surname,mail,"
        "jobTitle,department,accountEnabled,onPremisesSyncEnabled"
    )
    url: Optional[str] = (
        f"{_GRAPH_BASE}/users"
        f"?$filter=onPremisesSyncEnabled eq null"
        f"&$select={select_fields}"
        f"&$top=999"
        f"&$count=true"
    )

    users: list[dict] = []
    pages = 0
    while url and pages < 20:  # hard cap at 20 pages (~20 000 users) for safety
        try:
            resp = _requests.get(url, headers=headers, timeout=15)
            if not resp.ok:
                logger.warning("get_entra_only_users HTTP %s: %s", resp.status_code, resp.text[:200])
                break
            data = resp.json()
        except Exception as exc:
            logger.warning("get_entra_only_users error: %s", exc)
            break

        for u in data.get("value", []):
            # Fetch sign-in activity inline (adds one field per user, no extra call needed
            # because it's on the user object when signInActivity is in $select —
            # however signInActivity requires a separate $select call on some tenants,
            # so we include it as best-effort from the profile data only).
            last_sign_in: Optional[str] = None
            sign_in_activity = u.get("signInActivity") or {}
            if isinstance(sign_in_activity, dict):
                last_sign_in = sign_in_activity.get("lastSignInDateTime")

            users.append({
                "entra_object_id": u.get("id", ""),
                "upn": u.get("userPrincipalName", ""),
                "display_name": u.get("displayName"),
                "given_name": u.get("givenName"),
                "surname": u.get("surname"),
                "mail": u.get("mail"),
                "title": u.get("jobTitle"),
                "department": u.get("department"),
                "account_enabled": u.get("accountEnabled", True),
                "last_sign_in": last_sign_in,
                "mfa_methods": [],
                "licenses": [],
                "groups": [],
                "photo": None,
            })

        url = data.get("@odata.nextLink")
        pages += 1

    return users
