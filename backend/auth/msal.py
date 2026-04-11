"""
backend/auth/msal.py — Entra ID integration via MSAL and Microsoft Graph.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

The client secret is NEVER logged or included in exception messages.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import msal
import requests as _requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-process OAuth session store
# Sessions are keyed by their state/session UUID.
# Two types of entries:
#   state    → {code_verifier, tenant_id, client_id, redirect_uri, created_at}
#              (created by build_oauth_auth_url, consumed by exchange_oauth_code)
#   session  → {access_token, tenant_id, created_at}
#              (created by exchange_oauth_code, consumed by create_app_registration)
# ---------------------------------------------------------------------------

_OAUTH_SESSIONS: dict[str, dict] = {}
_OAUTH_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Graph API constants
# ---------------------------------------------------------------------------

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Microsoft Graph's well-known app ID (same in every tenant)
_GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000"

# Application (not delegated) permission GUIDs for Microsoft Graph
_APP_PERMISSION_GUIDS: dict[str, str] = {
    "User.Read.All":      "df021288-bdef-4463-88db-98f22de89214",
    "Group.Read.All":     "5b567255-7703-4780-807c-7be8301ae99b",
    "Directory.Read.All": "7ab1d382-f21e-4acd-a863-ba3e13f7da61",
    "AuditLog.Read.All":  "b0afded3-3588-46d8-8b3d-9842eff778da",
}

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


def _graph_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Existing: client credentials connection test
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
# OAuth2 Authorization Code + PKCE flow (for programmatic app registration)
# ---------------------------------------------------------------------------


def build_oauth_auth_url(
    tenant_id: str,
    client_id: str,
    redirect_uri: str,
) -> dict:
    """
    Build a Microsoft OAuth2 authorization URL with PKCE.

    If *tenant_id* is empty, the ``/organizations`` common endpoint is used
    so that the admin can sign in with any work account and the tenant is
    auto-detected from the resulting token.

    Stores the PKCE verifier server-side, keyed by the state UUID.
    The caller should redirect the browser to the returned auth_url.

    Returns:
        {"success": bool, "auth_url": str, "state": str}
    """
    authority_hint = tenant_id.strip() if tenant_id else "organizations"

    # Generate PKCE values
    code_verifier = (
        base64.urlsafe_b64encode(os.urandom(48)).rstrip(b"=").decode()
    )
    code_challenge = (
        base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        )
        .rstrip(b"=")
        .decode()
    )
    state = str(uuid.uuid4())

    with _OAUTH_LOCK:
        _OAUTH_SESSIONS[state] = {
            "type": "state",
            "code_verifier": code_verifier,
            "authority_hint": authority_hint,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "created_at": time.time(),
        }

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": "Application.ReadWrite.All AppRoleAssignment.ReadWrite.All",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "consent",
    }
    auth_url = (
        f"https://login.microsoftonline.com/{authority_hint}/oauth2/v2.0/authorize"
        f"?{urlencode(params)}"
    )
    return {"success": True, "auth_url": auth_url}


def _extract_tenant_id_from_token(access_token: str) -> str | None:
    """
    Decode the JWT payload (without signature verification — we trust the
    token since it came from Microsoft's token endpoint over HTTPS) and
    return the ``tid`` (tenant ID) claim.
    """
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return None
        # JWT base64url padding
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("tid")
    except Exception:
        return None


def exchange_oauth_code(code: str, state: str) -> dict:
    """
    Exchange an OAuth2 authorization code for an access token using PKCE.

    Consumes the stored state entry and creates a new session entry.
    When the ``/organizations`` common endpoint was used, the real tenant ID
    is extracted from the resulting access token.

    Returns:
        {"success": bool, "session_token": str | None, "message": str | None}
    """
    with _OAUTH_LOCK:
        session = _OAUTH_SESSIONS.pop(state, None)

    if session is None or session.get("type") != "state":
        return {
            "success": False,
            "session_token": None,
            "message": "Unknown or expired authorization session. Please try again.",
        }

    # State entries expire after 15 minutes
    if time.time() - session["created_at"] > 900:
        return {
            "success": False,
            "session_token": None,
            "message": "Authorization session expired. Please try again.",
        }

    authority_hint = session.get("authority_hint") or session.get("tenant_id", "organizations")

    try:
        resp = _requests.post(
            f"https://login.microsoftonline.com/{authority_hint}/oauth2/v2.0/token",
            data={
                "grant_type": "authorization_code",
                "client_id": session["client_id"],
                "code": code,
                "redirect_uri": session["redirect_uri"],
                "code_verifier": session["code_verifier"],
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except _requests.HTTPError as exc:
        err_msg = "Token exchange failed."
        try:
            err_data = exc.response.json()
            err_msg = err_data.get("error_description") or err_data.get("error") or err_msg
        except Exception:
            pass
        logger.warning("OAuth code exchange HTTP error: %s", err_msg)
        return {"success": False, "session_token": None, "message": err_msg}
    except Exception as exc:
        logger.warning("OAuth code exchange error: %s", exc)
        return {
            "success": False,
            "session_token": None,
            "message": "Token exchange failed. Please try again.",
        }

    if "access_token" not in token_data:
        err = (
            token_data.get("error_description")
            or token_data.get("error")
            or "Token exchange returned no access token."
        )
        logger.warning("OAuth token exchange returned no access token: %s", err)
        return {"success": False, "session_token": None, "message": err}

    access_token: str = token_data["access_token"]

    # Resolve the real tenant ID — either from the stored state (if a
    # specific tenant was provided) or by decoding the access token.
    tenant_id = (
        authority_hint
        if authority_hint != "organizations"
        else _extract_tenant_id_from_token(access_token)
    )
    if not tenant_id:
        return {
            "success": False,
            "session_token": None,
            "message": "Could not determine tenant ID from sign-in response.",
        }

    session_token = str(uuid.uuid4())
    with _OAUTH_LOCK:
        _OAUTH_SESSIONS[session_token] = {
            "type": "session",
            "access_token": access_token,
            "tenant_id": tenant_id,
            "created_at": time.time(),
        }

    return {"success": True, "session_token": session_token, "message": None}


def consume_oauth_session(session_token: str) -> dict | None:
    """
    Retrieve and remove a session entry by its token.
    Returns None if the token is unknown or expired (30 min).
    """
    with _OAUTH_LOCK:
        session = _OAUTH_SESSIONS.pop(session_token, None)

    if session is None or session.get("type") != "session":
        return None
    if time.time() - session["created_at"] > 1800:
        return None
    return session


# ---------------------------------------------------------------------------
# App Registration creation (uses delegated token from OAuth flow)
# ---------------------------------------------------------------------------


def create_app_registration(
    delegated_token: str,
    tenant_id: str,
    display_name: str = "Persona",
) -> dict:
    """
    Create a Persona App Registration in the tenant using a delegated admin token.

    Steps:
      1. Create the Application object with required resource accesses
      2. Create a Service Principal for the app
      3. Look up Microsoft Graph's Service Principal in the tenant
      4. Grant admin consent for each required permission
      5. Create a client secret

    On failure after step 1, attempts to delete the created application.

    Returns:
        {
            "success": bool,
            "client_id": str | None,
            "client_secret": str | None,   # only on success, store immediately
            "secret_expires": str | None,  # ISO date (YYYY-MM-DD)
            "tenant_id": str,
            "message": str,
        }

    The client_secret is returned once — callers must store it before discarding.
    """
    headers = _graph_headers(delegated_token)
    app_object_id: str | None = None  # for cleanup on partial failure

    try:
        # ── Step 1: Create the Application object ──────────────────────────
        resource_accesses = [
            {"id": guid, "type": "Role"}
            for guid in _APP_PERMISSION_GUIDS.values()
        ]
        resp = _requests.post(
            f"{_GRAPH_BASE}/applications",
            headers=headers,
            json={
                "displayName": display_name,
                "signInAudience": "AzureADMyOrg",
                "requiredResourceAccess": [
                    {
                        "resourceAppId": _GRAPH_APP_ID,
                        "resourceAccess": resource_accesses,
                    }
                ],
            },
            timeout=15,
        )
        resp.raise_for_status()
        app_data = resp.json()
        app_object_id = app_data["id"]      # object ID for addPassword / delete
        app_client_id = app_data["appId"]   # client/application ID

        # ── Step 2: Create the Service Principal ───────────────────────────
        resp = _requests.post(
            f"{_GRAPH_BASE}/servicePrincipals",
            headers=headers,
            json={"appId": app_client_id},
            timeout=15,
        )
        resp.raise_for_status()
        sp_id = resp.json()["id"]

        # ── Step 3: Get Microsoft Graph's SP ID in this tenant ─────────────
        # This SP ID is needed as the resource in appRoleAssignments.
        # It is NOT the static _GRAPH_APP_ID — it's the tenant-specific object ID.
        resp = _requests.get(
            f"{_GRAPH_BASE}/servicePrincipals",
            headers=headers,
            params={
                "$filter": f"appId eq '{_GRAPH_APP_ID}'",
                "$select": "id",
            },
            timeout=15,
        )
        resp.raise_for_status()
        graph_sps = resp.json().get("value", [])
        if not graph_sps:
            raise ValueError("Could not find Microsoft Graph service principal in tenant.")
        graph_sp_id = graph_sps[0]["id"]

        # ── Step 4: Grant admin consent for each permission ────────────────
        for perm_name, app_role_id in _APP_PERMISSION_GUIDS.items():
            try:
                cr = _requests.post(
                    f"{_GRAPH_BASE}/servicePrincipals/{sp_id}/appRoleAssignments",
                    headers=headers,
                    json={
                        "principalId": sp_id,
                        "resourceId": graph_sp_id,
                        "appRoleId": app_role_id,
                    },
                    timeout=15,
                )
                if not cr.ok and cr.status_code != 400:
                    cr.raise_for_status()
            except _requests.HTTPError as exc:
                # Duplicate consent (400) is acceptable; log others and continue
                err_body: dict = {}
                try:
                    err_body = exc.response.json()
                except Exception:
                    pass
                err_code = (err_body.get("error") or {}).get("code", "")
                if err_code not in ("Permission_Duplicated", "DuplicateObjectFound"):
                    logger.warning(
                        "Admin consent for %s failed (non-fatal): %s",
                        perm_name,
                        err_body,
                    )

        # ── Step 5: Create client secret (valid 2 years) ───────────────────
        expiry_dt = datetime.now(timezone.utc) + timedelta(days=730)
        resp = _requests.post(
            f"{_GRAPH_BASE}/applications/{app_object_id}/addPassword",
            headers=headers,
            json={
                "passwordCredential": {
                    "displayName": "Persona auto-generated",
                    "endDateTime": expiry_dt.isoformat(),
                }
            },
            timeout=15,
        )
        resp.raise_for_status()
        secret_data = resp.json()
        client_secret = secret_data["secretText"]   # only available now
        secret_expires = secret_data["endDateTime"][:10]  # YYYY-MM-DD

        return {
            "success": True,
            "client_id": app_client_id,
            "client_secret": client_secret,
            "secret_expires": secret_expires,
            "tenant_id": tenant_id,
            "message": (
                f"App Registration '{display_name}' created successfully "
                "with admin consent granted for all required permissions."
            ),
        }

    except _requests.HTTPError as exc:
        err_msg = "App Registration creation failed."
        try:
            err_data = exc.response.json()
            err_msg = (
                (err_data.get("error") or {}).get("message")
                or err_msg
            )
        except Exception:
            pass
        logger.warning("App registration HTTP error: %s", err_msg)

    except ValueError as exc:
        err_msg = str(exc)
        logger.warning("App registration error: %s", err_msg)

    except Exception as exc:
        err_msg = "An unexpected error occurred during App Registration creation."
        logger.warning("App registration unexpected error: %s", exc)

    # Attempt cleanup if the application object was created
    if app_object_id:
        try:
            _requests.delete(
                f"{_GRAPH_BASE}/applications/{app_object_id}",
                headers=headers,
                timeout=10,
            )
            logger.info("Cleaned up partially created app registration %s", app_object_id)
        except Exception:
            logger.warning(
                "Failed to clean up partially created app registration %s", app_object_id
            )

    return {
        "success": False,
        "client_id": None,
        "client_secret": None,
        "secret_expires": None,
        "tenant_id": tenant_id,
        "message": err_msg,
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
