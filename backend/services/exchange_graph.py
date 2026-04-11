"""
Exchange Online data via Microsoft Graph API.

All functions are SYNCHRONOUS. FastAPI callers must wrap in run_in_threadpool().

Required Graph API permissions (application):
  - User.Read.All           (existing — user profile, mail, proxyAddresses)
  - MailboxSettings.Read    (new — OOO status, archive settings)
  - Mail.Read               (new — per-user mailbox folder size)
  - Group.Read.All          (existing — distribution group membership)
"""

from __future__ import annotations

import logging
from typing import Optional

import msal
import requests as _requests

logger = logging.getLogger(__name__)

_GRAPH_BASE      = "https://graph.microsoft.com/v1.0"
_GRAPH_BASE_BETA = "https://graph.microsoft.com/beta"


def _acquire_token(tenant_id: str, client_id: str, client_secret: str) -> Optional[str]:
    """Acquire a Graph API access token via client credentials. Returns None on failure."""
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
    except Exception as exc:
        logger.warning("Exchange Graph token acquisition failed: %s", exc)
        return None

    if "access_token" not in result:
        err = result.get("error_description") or result.get("error") or "unknown"
        logger.warning("Exchange Graph token denied: %s", err)
        return None

    return result["access_token"]


def get_exchange_mailbox_data(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    user_id: str,
) -> dict:
    """
    Fetch all Exchange-relevant data for a user from Graph API.

    Returns a dict with keys:
      found                      bool
      mail                       str | None
      proxy_addresses            list[str]
      display_name               str | None
      is_exchange_cloud_managed  bool | None  (per-mailbox SOA declaration)
      mailbox_exists             bool
      ooo_enabled                bool | None
      ooo_external_message       str | None
      archive_enabled            bool | None
      archive_size_bytes         int | None
      mailbox_size_bytes         int | None
      distribution_groups        list[dict]   [{name, mail}]
    """
    token = _acquire_token(tenant_id, client_id, client_secret)
    if not token:
        return {"found": False}

    headers = {"Authorization": f"Bearer {token}"}
    result: dict = {
        "found": False,
        "mail": None,
        "proxy_addresses": [],
        "display_name": None,
        "is_exchange_cloud_managed": None,
        "mailbox_exists": False,
        "ooo_enabled": None,
        "ooo_external_message": None,
        "archive_enabled": None,
        "archive_size_bytes": None,
        "mailbox_size_bytes": None,
        "distribution_groups": [],
    }

    # ── 1. User profile (mail, proxyAddresses, display name) ──────────────────
    try:
        r = _requests.get(
            f"{_GRAPH_BASE}/users/{user_id}",
            headers=headers,
            params={
                "$select": (
                    "id,displayName,mail,proxyAddresses,"
                    "onPremisesProvisioningErrors"
                )
            },
            timeout=10,
        )
        if r.status_code == 404:
            return result  # user not found in Entra at all
        if r.ok:
            data = r.json()
            result["found"] = True
            result["mail"] = data.get("mail")
            result["display_name"] = data.get("displayName")
            result["proxy_addresses"] = data.get("proxyAddresses") or []
            result["mailbox_exists"] = bool(data.get("mail"))
    except Exception as exc:
        logger.warning("Exchange Graph user profile fetch failed for %s: %s", user_id, exc)
        return result

    # ── 2. Mailbox settings (OOO, archive) ────────────────────────────────────
    try:
        r = _requests.get(
            f"{_GRAPH_BASE}/users/{user_id}/mailboxSettings",
            headers=headers,
            timeout=10,
        )
        if r.ok:
            ms = r.json()
            auto_reply = ms.get("automaticRepliesSetting", {})
            result["ooo_enabled"] = (
                auto_reply.get("status", "disabled").lower() != "disabled"
            )
            result["ooo_external_message"] = auto_reply.get("externalReplyMessage") or None

            archive = ms.get("archiveFolder")
            result["archive_enabled"] = archive is not None
        elif r.status_code == 404:
            # No mailbox on this user
            result["mailbox_exists"] = False
    except Exception as exc:
        logger.warning("Exchange mailboxSettings fetch failed for %s: %s", user_id, exc)

    # ── 3. Mailbox size (requires Mail.Read) ───────────────────────────────────
    # sizeInBytes is only available on the beta mailFolders endpoint, not v1.0.
    # We use beta exclusively for this one call; the same auth token works.
    try:
        r = _requests.get(
            f"{_GRAPH_BASE_BETA}/users/{user_id}/mailFolders",
            headers=headers,
            params={"$select": "sizeInBytes", "$top": "50"},
            timeout=15,
        )
        if r.ok:
            folders = r.json().get("value", [])
            total = sum(f.get("sizeInBytes") or 0 for f in folders)
            if total > 0:
                result["mailbox_size_bytes"] = total
    except Exception as exc:
        logger.warning("Exchange mailbox size fetch failed for %s: %s", user_id, exc)

    # ── 4. Archive folder size ────────────────────────────────────────────────
    if result["archive_enabled"]:
        try:
            r = _requests.get(
                f"{_GRAPH_BASE}/users/{user_id}/mailFolders/recoverableitemsroot",
                headers=headers,
                params={"$select": "sizeInBytes"},
                timeout=10,
            )
            # In-place archive is separate; just mark enabled without size for now
            # as the archive mailbox requires a separate identity lookup
        except Exception:
            pass

    # ── 5. Distribution group membership (mail-enabled groups only) ───────────
    try:
        r = _requests.get(
            f"{_GRAPH_BASE}/users/{user_id}/transitiveMemberOf",
            headers=headers,
            params={
                "$select": "id,displayName,mail,groupTypes,mailEnabled",
                "$top": "100",
            },
            timeout=10,
        )
        if r.ok:
            groups = r.json().get("value", [])
            dist_groups = []
            for g in groups:
                odata = g.get("@odata.type", "")
                mail_enabled = g.get("mailEnabled", False)
                group_types = g.get("groupTypes") or []
                # Distribution lists: mail-enabled, NOT unified (M365) groups
                is_unified = "Unified" in group_types
                if mail_enabled and not is_unified and "microsoft.graph.group" in odata:
                    dist_groups.append({
                        "name": g.get("displayName") or "",
                        "mail": g.get("mail") or "",
                    })
            result["distribution_groups"] = dist_groups
    except Exception as exc:
        logger.warning("Exchange distribution group fetch failed for %s: %s", user_id, exc)

    return result
