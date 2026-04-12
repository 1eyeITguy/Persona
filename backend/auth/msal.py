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
    "#microsoft.graph.phoneAuthenticationMethod":                  "Phone number",
    "#microsoft.graph.softwareOathAuthenticationMethod":           "Authenticator App (TOTP)",
    "#microsoft.graph.emailAuthenticationMethod":                  "Email OTP",
    "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod": "Windows Hello for Business",
    "#microsoft.graph.fido2AuthenticationMethod":                  "Passkey",
    "#microsoft.graph.temporaryAccessPassAuthenticationMethod":    "Temporary Access Pass",
    "#microsoft.graph.passwordAuthenticationMethod":               None,  # not an MFA method
}

# Maps userPreferredMethodForSecondaryAuthentication values to display labels
_DEFAULT_METHOD_LABELS: dict[str, str] = {
    "push":                     "Microsoft Authenticator notification",
    "oath":                     "Authenticator App (TOTP)",
    "voiceMobile":              "Phone call",
    "sms":                      "Text message (SMS)",
    "voiceAlternateMobile":     "Alternate mobile (call)",
    "voiceOffice":              "Office phone (call)",
    "fido2":                    "Passkey (FIDO2)",
    "windowsHelloForBusiness":  "Windows Hello for Business",
    "email":                    "Email OTP",
    "temporaryAccessPass":      "Temporary Access Pass",
    "microsoftAuthenticator":   "Microsoft Authenticator",
}

# Comprehensive SKU part-number → friendly product name mapping.
# Source: https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference
_SKU_NAMES: dict[str, str] = {

    # ── Microsoft 365 ────────────────────────────────────────────────────────
    "SPE_E3":                           "Microsoft 365 E3",
    "SPE_E5":                           "Microsoft 365 E5",
    "SPE_E3_USGOV_GCCHIGH":             "Microsoft 365 E3 (GCC High)",
    "SPE_E5_COMPLIANCE":                "Microsoft 365 E5 Compliance",
    "SPE_E5_SECURITY":                  "Microsoft 365 E5 Security",
    "SPE_E5_SECURITY_USGOV_GCCHIGH":    "Microsoft 365 E5 Security (GCC High)",
    "SPE_F1":                           "Microsoft 365 F1",
    "SPE_F3":                           "Microsoft 365 F3",
    "SPB":                              "Microsoft 365 Business Premium",
    "O365_BUSINESS_ESSENTIALS":         "Microsoft 365 Business Basic",
    "O365_BUSINESS_PREMIUM":            "Microsoft 365 Business Standard",
    "O365_BUSINESS":                    "Microsoft 365 Apps for Business",
    "OFFICESUBSCRIPTION":               "Microsoft 365 Apps for Enterprise",
    "OFFICESUBSCRIPTION_FACULTY":       "Microsoft 365 Apps for Faculty",
    "OFFICESUBSCRIPTION_STUDENT":       "Microsoft 365 Apps for Students",

    # ── Office 365 ───────────────────────────────────────────────────────────
    "ENTERPRISEPACK":                   "Office 365 E3",
    "ENTERPRISEPREMIUM":                "Office 365 E5",
    "ENTERPRISEPREMIUM_NOPSTNCONF":     "Office 365 E5 (without Audio Conferencing)",
    "STANDARDPACK":                     "Office 365 E1",
    "STANDARDWOFFPACK":                 "Office 365 E2",
    "ENTERPRISEWITHSCAL":               "Office 365 E4",
    "DESKLESSPACK":                     "Office 365 F3",
    "LITEPACK":                         "Office 365 P1",
    "LITEPACK_P2":                      "Office 365 P2",
    "O365_MIDSIZE":                     "Office 365 Midsize Business",
    "DEVELOPERPACK":                    "Office 365 E3 Developer",
    "DEVELOPERPACK_E5":                 "Office 365 E5 Developer",
    "ENTERPRISEPACKWITHOUTPROPLUS":     "Office 365 E3 (no Microsoft 365 Apps)",

    # Office 365 Education
    "STANDARDPACK_FACULTY":             "Office 365 A1 for Faculty",
    "STANDARDPACK_STUDENT":             "Office 365 A1 for Students",
    "ENTERPRISEPACK_FACULTY":           "Office 365 A3 for Faculty",
    "ENTERPRISEPACK_STUDENT":           "Office 365 A3 for Students",
    "ENTERPRISEPREMIUM_FACULTY":        "Office 365 A5 for Faculty",
    "ENTERPRISEPREMIUM_STUDENT":        "Office 365 A5 for Students",

    # ── Microsoft 365 Education ──────────────────────────────────────────────
    "M365EDU_A1":                       "Microsoft 365 A1",
    "M365EDU_A3_FACULTY":               "Microsoft 365 A3 for Faculty",
    "M365EDU_A3_STUDENT":               "Microsoft 365 A3 for Students",
    "M365EDU_A5_FACULTY":               "Microsoft 365 A5 for Faculty",
    "M365EDU_A5_STUDENT":               "Microsoft 365 A5 for Students",
    "M365EDU_A5_STUUSEBNFT":            "Microsoft 365 A5 Student Use Benefits",

    # ── Exchange Online ───────────────────────────────────────────────────────
    "EXCHANGESTANDARD":                 "Exchange Online Plan 1",
    "EXCHANGEENTERPRISE":               "Exchange Online Plan 2",
    "EXCHANGEDESKLESS":                 "Exchange Online Kiosk",
    "EXCHANGETELCO":                    "Exchange Online POP",
    "EXCHANGE_S_DESKLESS_GOV":          "Exchange Online Kiosk (Government)",
    "EXCHANGE_L_STANDARD":              "Exchange Online Plan 1 (Large)",
    "EXCHANGEARCHIVE":                  "Exchange Online Archiving for Exchange Server",
    "EXCHANGEARCHIVE_ADDON":            "Exchange Online Archiving for Exchange Online",
    "EOP_ENTERPRISE_FACULTY":           "Exchange Online Protection",
    "EOP_ENTERPRISE":                   "Exchange Online Protection",

    # ── SharePoint Online ─────────────────────────────────────────────────────
    "SHAREPOINTSTANDARD":               "SharePoint Online Plan 1",
    "SHAREPOINTENTERPRISE":             "SharePoint Online Plan 2",
    "SHAREPOINTDESKLESS":               "SharePoint Online Kiosk",
    "SHAREPOINTSTORAGE":                "SharePoint Online Storage",
    "ONEDRIVE_BASIC":                   "OneDrive for Business Basic",

    # ── Microsoft Teams ───────────────────────────────────────────────────────
    "TEAMS_EXPLORATORY":                "Microsoft Teams Exploratory",
    "TEAMS_FREE":                       "Microsoft Teams Free",
    "TEAMS_FREE_GOV":                   "Microsoft Teams Free (Government)",
    "MCO_TEAMS_IW":                     "Microsoft Teams Trial",
    "MCOMEETADV":                       "Microsoft 365 Audio Conferencing",
    "MCOEV":                            "Microsoft 365 Phone System",
    "MCOEV_FACULTY":                    "Microsoft 365 Phone System for Faculty",
    "MCOEV_DOD":                        "Microsoft 365 Phone System (DoD)",
    "MCOEV_GCCHIGH":                    "Microsoft 365 Phone System (GCC High)",
    "MCOPSTN1":                         "Microsoft 365 Domestic Calling Plan",
    "MCOPSTN2":                         "Microsoft 365 International Calling Plan",
    "MCOPSTN_5":                        "Microsoft 365 Domestic Calling Plan (120 min)",
    "MCOPSTNC":                         "Microsoft 365 Communications Credits",
    "Teams_Rooms_Standard":             "Microsoft Teams Rooms Standard",
    "Teams_Rooms_Pro":                  "Microsoft Teams Rooms Pro",
    "MEETING_ROOM":                     "Microsoft Teams Rooms Standard",

    # ── Microsoft Intune ─────────────────────────────────────────────────────
    "INTUNE_A":                         "Microsoft Intune Plan 1",
    "INTUNE_A_D":                       "Microsoft Intune Plan 1 for Education",
    "INTUNE_SMB":                       "Microsoft Intune SMB",
    "INTUNE_O365":                      "Microsoft Intune for Office 365",
    "INTUNE_STORAGE":                   "Intune Extra Storage",

    # ── Microsoft Entra ID (formerly Azure AD) ────────────────────────────────
    "AAD_BASIC":                        "Microsoft Entra ID Basic",
    "AAD_PREMIUM":                      "Microsoft Entra ID P1",
    "AAD_PREMIUM_P2":                   "Microsoft Entra ID P2",
    "AAD_PREMIUM_FACULTY":              "Microsoft Entra ID P1 for Faculty",
    "ENTRA_ID_GOVERNANCE":              "Microsoft Entra ID Governance",
    "ENTRA_ID_GOVERNANCE_STANDALONE":   "Microsoft Entra ID Governance Standalone",

    # ── Enterprise Mobility + Security ───────────────────────────────────────
    "EMS":                              "Enterprise Mobility + Security E3",
    "EMSPREMIUM":                       "Enterprise Mobility + Security E5",
    "EMS_EDU":                          "Enterprise Mobility + Security A3 for Faculty",
    "EMSPREMIUM_STUDENT":               "Enterprise Mobility + Security A5 for Students",

    # ── Microsoft Defender / Security ────────────────────────────────────────
    "ATP_ENTERPRISE":                   "Microsoft Defender for Office 365 Plan 1",
    "THREAT_INTELLIGENCE":              "Microsoft Defender for Office 365 Plan 2",
    "WINDEFATP":                        "Microsoft Defender for Endpoint Plan 2",
    "WIN_DEF_ATP":                      "Microsoft Defender for Endpoint Plan 1",
    "MDE_SMB":                          "Microsoft Defender for Business",
    "ATA":                              "Microsoft Defender for Identity",
    "M365_DEFENDER":                    "Microsoft 365 Defender",
    "ADALLOM_S_APP_SEC":                "Microsoft Defender for Cloud Apps",
    "ADALLOM_STANDALONE":               "Microsoft Defender for Cloud Apps",
    "CVCF_ADDON":                       "Microsoft Defender Vulnerability Management",

    # ── Azure Information Protection ──────────────────────────────────────────
    "RMS_S_ENTERPRISE":                 "Azure Information Protection Premium P1",
    "RMS_S_PREMIUM":                    "Azure Information Protection Premium P1",
    "RMS_S_PREMIUM2":                   "Azure Information Protection Premium P2",
    "INFORMATION_PROTECTION_COMPLIANCE": "Microsoft Purview Information Protection",

    # ── Power BI ─────────────────────────────────────────────────────────────
    "POWER_BI_PRO":                     "Power BI Pro",
    "POWER_BI_PREMIUM_PER_USER":        "Power BI Premium Per User",
    "POWER_BI_PREMIUM_PER_USER_ADDON":  "Power BI Premium Per User Add-On",
    "POWER_BI_STANDARD":                "Power BI (free)",
    "PBI_PREMIUM_P1_ADDON":             "Power BI Premium P1",
    "PBI_PREMIUM_P2_ADDON":             "Power BI Premium P2",

    # ── Power Platform ────────────────────────────────────────────────────────
    "FLOW_FREE":                        "Power Automate Free",
    "FLOW_PER_USER":                    "Power Automate per user plan",
    "FLOW_PER_USER_DEPT":               "Power Automate per user plan (dept)",
    "FLOW_PER_USER_GCC":                "Power Automate per user plan (GCC)",
    "FLOW_BUSINESS_PROCESS":            "Power Automate per flow plan",
    "POWERAPPS_DEV":                    "Power Apps Developer Plan",
    "POWERAPPS_PER_USER":               "Power Apps per user plan",
    "POWERAPPS_PER_USER_DEPT":          "Power Apps per user plan (dept)",
    "POWERAPPS_PER_USER_GCC":           "Power Apps per user plan (GCC)",
    "POWERAPPS_VIRAL":                  "Power Apps Plan 2 Trial",
    "POWERAUTOMATE_ATTENDED_RPA":       "Power Automate with Attended RPA",
    "POWERAUTOMATE_UNATTENDED_RPA":     "Power Automate with Unattended RPA",
    "POWER_VIRTUAL_AGENTS_VIRAL":       "Power Virtual Agents Viral Trial",

    # ── Visio ─────────────────────────────────────────────────────────────────
    "VISIOCLIENT":                      "Visio Online Plan 2",
    "VISIOONLINE_PLAN1":                "Visio Online Plan 1",
    "VISIO_PLAN1_DEP":                  "Visio Plan 1",
    "VISIO_PLAN2_DEP":                  "Visio Plan 2",

    # ── Project ───────────────────────────────────────────────────────────────
    "PROJECTPREMIUM":                   "Project Online Premium",
    "PROJECTPROFESSIONAL":              "Project Online Professional",
    "PROJECTESSENTIALS":                "Project Online Essentials",
    "PROJECT_P1":                       "Project Plan 1",
    "PROJECT_P3":                       "Project Plan 3",
    "PROJECT_P5":                       "Project Plan 5",
    "PROJECTCLIENT":                    "Project for Office 365",

    # ── Windows ───────────────────────────────────────────────────────────────
    "WIN10_PRO_ENT_SUB":                "Windows 10/11 Enterprise E3",
    "WIN10_VDA_E3":                     "Windows 10/11 Enterprise E3 VDA",
    "WIN10_VDA_E5":                     "Windows 10/11 Enterprise E5 VDA",
    "WIN_ENT_E3":                       "Windows 10/11 Enterprise E3",
    "WIN_ENT_E5":                       "Windows 10/11 Enterprise E5",
    "WINDOWS_STORE":                    "Windows Store for Business",

    # ── Dynamics 365 ─────────────────────────────────────────────────────────
    "DYN365_ENTERPRISE_PLAN1":          "Dynamics 365 Customer Engagement Plan",
    "DYN365_ENTERPRISE_SALES":          "Dynamics 365 Sales Enterprise",
    "DYN365_ENTERPRISE_CUSTOMER_SERVICE": "Dynamics 365 Customer Service Enterprise",
    "DYN365_ENTERPRISE_FIELD_SERVICE":  "Dynamics 365 Field Service",
    "DYN365_ENTERPRISE_TEAM_MEMBERS":   "Dynamics 365 Team Members",
    "DYN365_FINANCIALS_BUSINESS_SKU":   "Dynamics 365 Business Central Essentials",
    "DYN365_BUSINESS_PREMIUM":          "Dynamics 365 Business Central Premium",
    "DYN365_AI_SERVICE_INSIGHTS":       "Dynamics 365 Customer Insights",
    "DYN365_MARKETING_USER":            "Dynamics 365 Marketing",
    "Dynamics_365_for_Operations":      "Dynamics 365 Finance",
    "DYN365_TALENT_ENTERPRISE":         "Dynamics 365 Talent",

    # ── Microsoft Copilot ─────────────────────────────────────────────────────
    "Microsoft_365_Copilot":            "Microsoft 365 Copilot",
    "Copilot_Studio_in_a_Day_AddOn":    "Copilot Studio",
    "COPILOT_STUDIO_VIRAL":             "Copilot Studio Viral Trial",

    # ── Miscellaneous ─────────────────────────────────────────────────────────
    "RIGHTSMANAGEMENT":                 "Azure Rights Management",
    "RIGHTSMANAGEMENT_ADHOC":           "Rights Management Adhoc",
    "MCOSTANDARD":                      "Skype for Business Online Plan 2",
    "MCOIMP":                           "Skype for Business Online Plan 1",
    "YAMMER_ENTERPRISE":                "Yammer Enterprise",
    "YAMMER_MIDSIZE":                   "Yammer Midsize",
    "KAIZALA_STANDALONE":               "Microsoft Kaizala Pro",
    "FORMS_PRO":                        "Microsoft Dynamics 365 Customer Voice",
    "WHITEBOARD_PLAN3":                 "Microsoft Whiteboard Plan 3",
    "STREAM":                           "Microsoft Stream",
    "STREAM_P2":                        "Microsoft Stream Plan 2",
    "NONPROFIT_PORTAL":                 "Microsoft Nonprofit Portal",
    "CRMSTANDARD":                      "Dynamics CRM Online",
    "CRMPLAN2":                         "Dynamics CRM Online Basic",
}


def _friendly_sku(sku_part_number: str) -> str:
    return _SKU_NAMES.get(sku_part_number, sku_part_number)


def _build_auth_methods(methods: list) -> list[dict]:
    """
    Convert raw Graph authentication method objects to rich dicts with
    method_type and detail fields.  Password entries are filtered out.
    """
    result = []
    for m in methods:
        odata = m.get("@odata.type", "")
        method_type = _MFA_TYPE_NAMES.get(odata)
        if method_type is None:
            continue  # password or unknown — skip

        detail: Optional[str] = None

        if odata == "#microsoft.graph.phoneAuthenticationMethod":
            phone = m.get("phoneNumber", "")
            ptype = m.get("phoneType", "mobile")
            label = {
                "mobile":          "Primary mobile",
                "alternateMobile": "Alternate mobile",
                "office":          "Office",
            }.get(ptype, ptype.capitalize())
            detail = f"{label}: {phone}" if phone else None

        elif odata == "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod":
            detail = m.get("displayName")  # device name

        elif odata == "#microsoft.graph.fido2AuthenticationMethod":
            detail = m.get("model") or m.get("displayName")

        elif odata == "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod":
            detail = m.get("displayName")  # device name

        elif odata == "#microsoft.graph.emailAuthenticationMethod":
            detail = m.get("emailAddress")

        elif odata == "#microsoft.graph.softwareOathAuthenticationMethod":
            detail = m.get("displayName")  # some OATH tokens have a display name

        elif odata == "#microsoft.graph.temporaryAccessPassAuthenticationMethod":
            if not m.get("isUsable"):
                detail = "Used or expired"
            else:
                lifetime = m.get("lifetimeInMinutes")
                detail = f"Valid for {lifetime} min" if lifetime else "Active"

        result.append({"method_type": method_type, "detail": detail})
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

    # ── 3. Authentication methods ───────────────────────────────────────────
    # Requires UserAuthenticationMethod.Read.All application permission.
    mfa_methods: list[dict] = []
    default_mfa_method: Optional[str] = None
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}/authentication/methods",
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            raw_methods = resp.json().get("value", [])
            mfa_methods = _build_auth_methods(raw_methods)
        else:
            logger.warning(
                "Auth methods fetch returned HTTP %s for %s: %s",
                resp.status_code, resolved_id, resp.text[:200],
            )
    except Exception as exc:
        logger.warning("Auth methods fetch error for %s: %s", resolved_id, exc)

    # ── 3a. Default sign-in method (sign-in preferences) ───────────────────
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}/authentication/signInPreferences",
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            pref = resp.json().get("userPreferredMethodForSecondaryAuthentication")
            if pref:
                default_mfa_method = _DEFAULT_METHOD_LABELS.get(pref, pref)
    except Exception:
        pass  # Best-effort — not critical

    # ── 3. License details ─────────────────────────────────────────────────
    licenses: list[dict] = []
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{resolved_id}/licenseDetails",
            headers=headers,
            params={"$select": "skuId,skuPartNumber"},
            timeout=10,
        )
        if resp.ok:
            licenses = [
                {
                    "sku_id":          item.get("skuId", ""),
                    "sku_part_number": item.get("skuPartNumber", ""),
                    "display_name":    _friendly_sku(item.get("skuPartNumber", "")),
                }
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
                "$select": "id,displayName,groupTypes,mailEnabled,securityEnabled,"
                           "onPremisesSyncEnabled,resourceProvisioningOptions"
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
                        # resourceProvisioningOptions contains "Team" when a Teams team
                        # is provisioned on this Microsoft 365 group.
                        "has_team": "Team" in (g.get("resourceProvisioningOptions") or []),
                    }
                    for g in raw_groups
                    if g.get("@odata.type") == "#microsoft.graph.group"
                    and not g.get("onPremisesSyncEnabled")  # cloud-only groups only
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
        "default_mfa_method": default_mfa_method,
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


def get_entra_user_devices(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    object_id: str,
) -> list[dict]:
    """
    Fetch devices associated with an Entra user, combining:
      1. Intune managed devices  — GET /users/{id}/managedDevices
         Requires: DeviceManagementManagedDevices.Read.All
      2. Entra registered devices — GET /users/{id}/registeredDevices
         Requires: Device.Read.All

    Results are deduplicated by matching the Intune device's azureADDeviceId
    against the Entra registered device's id. The Intune record takes precedence
    (richer data); Entra-side physicalIds are merged in to detect Autopilot
    enrollment ([ZTDID] tag).

    Returns a list of dicts matching the EntraDevice schema.
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
    headers = {"Authorization": f"Bearer {token}"}

    devices: dict[str, dict] = {}  # intune_device_id → dict

    # Sentinel: azureADDeviceId is this string when the device isn't Entra-joined
    _ZERO_GUID = "00000000-0000-0000-0000-000000000000"

    # ── 1. Intune managed devices ──────────────────────────────────────────────
    intune_select = (
        "id,deviceName,operatingSystem,osVersion,model,manufacturer,"
        "complianceState,managementState,enrolledDateTime,lastSyncDateTime,"
        "managedDeviceOwnerType,azureADDeviceId"
    )
    # Separate lookup: azureADDeviceId → intune key.
    # NOTE: managedDevice.azureADDeviceId == device.deviceId on the Entra side,
    # which is a DIFFERENT field from device.id (the Object ID).
    # We use this map to match records during the Entra registered-devices pass.
    azure_ad_device_id_to_intune_key: dict[str, str] = {}

    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{object_id}/managedDevices",
            headers=headers,
            params={"$select": intune_select, "$top": 100},
            timeout=10,
        )
        if resp.ok:
            for d in resp.json().get("value", []):
                device_id = d.get("id", "")
                raw_owner = d.get("managedDeviceOwnerType", "")
                ownership = (
                    "corporate" if raw_owner == "company"
                    else "personal" if raw_owner == "personal"
                    else None
                )
                # azureADDeviceId corresponds to device.deviceId on the Entra side
                # (NOT device.id). Filter out zero GUIDs (not Entra-joined).
                raw_azure_id = d.get("azureADDeviceId") or ""
                azure_ad_id = raw_azure_id if (raw_azure_id and raw_azure_id != _ZERO_GUID) else None

                if azure_ad_id:
                    azure_ad_device_id_to_intune_key[azure_ad_id] = device_id

                devices[device_id] = {
                    "device_id": device_id,
                    "intune_device_id": device_id,
                    "entra_device_id": None,    # set during Entra pass (needs Entra object ID)
                    "display_name": d.get("deviceName"),
                    "device_type": "intune",
                    "operating_system": d.get("operatingSystem"),
                    "os_version": d.get("osVersion"),
                    "model": d.get("model"),
                    "manufacturer": d.get("manufacturer"),
                    "compliance_state": d.get("complianceState"),
                    "management_state": d.get("managementState"),
                    "enrolled_date_time": d.get("enrolledDateTime"),
                    "last_sync_date_time": d.get("lastSyncDateTime"),
                    "is_managed": True,
                    "trust_type": None,
                    "ownership": ownership,
                    "in_intune": True,
                    "in_entra": azure_ad_id is not None,  # confirmed during Entra pass
                    "in_autopilot": False,                 # refined during Entra pass
                }
        elif resp.status_code == 403:
            logger.debug(
                "DeviceManagementManagedDevices.Read.All not granted — skipping Intune devices for %s",
                object_id,
            )
    except Exception as exc:
        logger.debug("Intune devices fetch error for %s: %s", object_id, exc)

    # ── 2. Entra registered / joined devices ───────────────────────────────────
    # We fetch deviceId (= azureADDeviceId on Intune side) for dedup matching,
    # and physicalIds to detect Autopilot ([ZTDID] tag).
    # device.id is the Entra Object ID, used for DELETE /devices/{id}.
    entra_select = (
        "id,deviceId,displayName,operatingSystem,operatingSystemVersion,model,manufacturer,"
        "trustType,approximateLastSignInDateTime,physicalIds"
    )
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/users/{object_id}/registeredDevices",
            headers=headers,
            params={"$select": entra_select, "$top": 100},
            timeout=10,
        )
        if resp.ok:
            for d in resp.json().get("value", []):
                entra_object_id = d.get("id", "")          # Object ID → used for DELETE /devices/{id}
                entra_device_id = d.get("deviceId") or ""  # device.deviceId → matches azureADDeviceId
                physical_ids = d.get("physicalIds") or []
                in_autopilot = any(p.startswith("[ZTDID]") for p in physical_ids)

                # Check if this Entra device corresponds to an Intune-managed device
                intune_key = azure_ad_device_id_to_intune_key.get(entra_device_id)
                if intune_key:
                    # Merge Entra-side data into the existing Intune record
                    devices[intune_key]["entra_device_id"] = entra_object_id  # now we have the real Object ID
                    devices[intune_key]["in_entra"] = True
                    devices[intune_key]["in_autopilot"] = in_autopilot
                    continue

                if entra_object_id in devices:
                    continue  # edge case: already keyed by this Entra Object ID

                # Entra-only device — infer ownership from trustType
                trust = d.get("trustType")
                if trust in ("AzureAd", "ServerAd"):
                    ownership = "corporate"
                elif trust == "Workplace":
                    ownership = "personal"
                else:
                    ownership = None

                devices[entra_object_id] = {
                    "device_id": entra_object_id,
                    "intune_device_id": None,
                    "entra_device_id": entra_object_id,
                    "display_name": d.get("displayName"),
                    "device_type": "entra",
                    "operating_system": d.get("operatingSystem"),
                    "os_version": d.get("operatingSystemVersion"),
                    "model": d.get("model"),
                    "manufacturer": d.get("manufacturer"),
                    "compliance_state": None,
                    "management_state": None,
                    "enrolled_date_time": None,
                    "last_sync_date_time": d.get("approximateLastSignInDateTime"),
                    "is_managed": False,
                    "trust_type": trust,
                    "ownership": ownership,
                    "in_intune": False,
                    "in_entra": True,
                    "in_autopilot": in_autopilot,
                }
        elif resp.status_code == 403:
            logger.debug(
                "Device.Read.All not granted — skipping Entra registered devices for %s",
                object_id,
            )
    except Exception as exc:
        logger.debug("Entra registered devices fetch error for %s: %s", object_id, exc)

    return sorted(devices.values(), key=lambda d: (d.get("display_name") or "").lower())


def offboard_device(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    item: dict,
) -> dict:
    """
    Offboard a single device from Intune, Autopilot, and/or Entra ID.

    Deletion order is enforced: Intune → Autopilot → Entra → AD.
    Each step runs independently — a failure does NOT abort subsequent steps.

    Required Graph permissions on the app registration:
      DeviceManagementManagedDevices.ReadWrite.All  (Intune delete)
      DeviceManagementServiceConfig.Read.All        (Autopilot lookup)
      DeviceManagementServiceConfig.ReadWrite.All   (Autopilot delete)
      Device.ReadWrite.All                          (Entra delete)

    For AD: requires LDAP write access via the configured service account.

    Returns a DeviceOffboardItemResult-shaped dict.
    Caller MUST use run_in_threadpool.
    """
    display_name = item.get("display_name") or item.get("device_id", "unknown")
    results: list[dict] = []

    # ── Acquire Graph token ────────────────────────────────────────────────────
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    headers: dict[str, str] = {}
    try:
        app = msal.ConfidentialClientApplication(
            client_id=client_id,
            client_credential=client_secret,
            authority=authority,
        )
        token_result = app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )
        if "access_token" in token_result:
            headers = {"Authorization": f"Bearer {token_result['access_token']}"}
        else:
            # Token acquisition failed — all Graph steps will be skipped
            for svc in ("intune", "autopilot", "entra"):
                results.append({
                    "service": svc,
                    "attempted": False,
                    "success": False,
                    "error": "Could not acquire Graph token",
                })
    except Exception as exc:
        for svc in ("intune", "autopilot", "entra"):
            results.append({
                "service": svc,
                "attempted": False,
                "success": False,
                "error": str(exc),
            })

    intune_id = item.get("intune_device_id")
    entra_id = item.get("entra_device_id")

    # ── Step 1: Intune ─────────────────────────────────────────────────────────
    if item.get("remove_from_intune") and intune_id and headers:
        try:
            resp = _requests.delete(
                f"{_GRAPH_BASE}/deviceManagement/managedDevices/{intune_id}",
                headers=headers,
                timeout=15,
            )
            if resp.status_code in (204, 404):
                logger.info("Offboard [%s]: intune → removed (status %s)", display_name, resp.status_code)
                results.append({"service": "intune", "attempted": True, "success": True, "error": None})
            else:
                err = f"HTTP {resp.status_code}"
                try:
                    err = resp.json().get("error", {}).get("message", err)
                except Exception:
                    pass
                logger.warning("Offboard [%s]: intune → failed (%s)", display_name, err)
                results.append({"service": "intune", "attempted": True, "success": False, "error": err})
        except Exception as exc:
            logger.warning("Offboard [%s]: intune → exception: %s", display_name, exc)
            results.append({"service": "intune", "attempted": True, "success": False, "error": str(exc)})
    elif item.get("remove_from_intune") and not intune_id:
        results.append({"service": "intune", "attempted": False, "success": False, "error": "No Intune device ID"})
    else:
        results.append({"service": "intune", "attempted": False, "success": False, "error": None})

    # ── Step 2: Autopilot ──────────────────────────────────────────────────────
    if item.get("remove_from_autopilot") and intune_id and headers:
        autopilot_id: str | None = None
        try:
            lookup = _requests.get(
                f"{_GRAPH_BASE}/deviceManagement/windowsAutopilotDeviceIdentities",
                headers=headers,
                params={"$filter": f"managedDeviceId eq '{intune_id}'", "$select": "id"},
                timeout=15,
            )
            if lookup.ok:
                values = lookup.json().get("value", [])
                if values:
                    autopilot_id = values[0].get("id")
            elif lookup.status_code == 403:
                logger.debug("Offboard [%s]: autopilot lookup — permission denied", display_name)
                results.append({
                    "service": "autopilot",
                    "attempted": False,
                    "success": False,
                    "error": "DeviceManagementServiceConfig.Read.All not granted",
                })
                autopilot_id = None
        except Exception as exc:
            logger.warning("Offboard [%s]: autopilot lookup exception: %s", display_name, exc)
            results.append({"service": "autopilot", "attempted": False, "success": False, "error": str(exc)})
            autopilot_id = None

        if autopilot_id is None and not any(r["service"] == "autopilot" for r in results):
            # Not enrolled in Autopilot
            logger.info("Offboard [%s]: autopilot → not enrolled (skipped)", display_name)
            results.append({"service": "autopilot", "attempted": False, "success": False, "error": None})
        elif autopilot_id:
            try:
                del_resp = _requests.delete(
                    f"{_GRAPH_BASE}/deviceManagement/windowsAutopilotDeviceIdentities/{autopilot_id}",
                    headers=headers,
                    timeout=15,
                )
                if del_resp.status_code in (204, 404):
                    logger.info("Offboard [%s]: autopilot → removed", display_name)
                    results.append({"service": "autopilot", "attempted": True, "success": True, "error": None})
                else:
                    err = f"HTTP {del_resp.status_code}"
                    try:
                        err = del_resp.json().get("error", {}).get("message", err)
                    except Exception:
                        pass
                    logger.warning("Offboard [%s]: autopilot → failed (%s)", display_name, err)
                    results.append({"service": "autopilot", "attempted": True, "success": False, "error": err})
            except Exception as exc:
                logger.warning("Offboard [%s]: autopilot → exception: %s", display_name, exc)
                results.append({"service": "autopilot", "attempted": True, "success": False, "error": str(exc)})
    elif item.get("remove_from_autopilot") and not intune_id:
        results.append({"service": "autopilot", "attempted": False, "success": False, "error": "No Intune device ID for Autopilot lookup"})
    else:
        results.append({"service": "autopilot", "attempted": False, "success": False, "error": None})

    # ── Step 3: Entra ID ───────────────────────────────────────────────────────
    if item.get("remove_from_entra") and entra_id and headers:
        try:
            resp = _requests.delete(
                f"{_GRAPH_BASE}/devices/{entra_id}",
                headers=headers,
                timeout=15,
            )
            if resp.status_code in (204, 404):
                logger.info("Offboard [%s]: entra → removed (status %s)", display_name, resp.status_code)
                results.append({"service": "entra", "attempted": True, "success": True, "error": None})
            else:
                err = f"HTTP {resp.status_code}"
                try:
                    err = resp.json().get("error", {}).get("message", err)
                except Exception:
                    pass
                logger.warning("Offboard [%s]: entra → failed (%s)", display_name, err)
                results.append({"service": "entra", "attempted": True, "success": False, "error": err})
        except Exception as exc:
            logger.warning("Offboard [%s]: entra → exception: %s", display_name, exc)
            results.append({"service": "entra", "attempted": True, "success": False, "error": str(exc)})
    elif item.get("remove_from_entra") and not entra_id:
        results.append({"service": "entra", "attempted": False, "success": False, "error": "No Entra device ID"})
    else:
        results.append({"service": "entra", "attempted": False, "success": False, "error": None})

    # ── Step 4: AD computer disable ────────────────────────────────────────────
    if item.get("remove_from_ad") and display_name and display_name != "unknown":
        try:
            from backend.auth.ldap import _load_ldap_settings, get_service_connection
            from ldap3.utils.conv import escape_filter_chars
            from ldap3 import SUBTREE, MODIFY_REPLACE

            ldap_cfg = _load_ldap_settings()
            if ldap_cfg is None:
                results.append({
                    "service": "ad",
                    "attempted": False,
                    "success": False,
                    "error": "LDAP not configured",
                })
            else:
                conn = get_service_connection()
                safe_name = escape_filter_chars(display_name)
                conn.search(
                    search_base=ldap_cfg.base_dn,
                    search_filter=f"(&(objectClass=computer)(cn={safe_name}))",
                    search_scope=SUBTREE,
                    attributes=["userAccountControl"],
                    size_limit=1,
                )
                if not conn.entries:
                    logger.info("Offboard [%s]: ad → computer not found in AD", display_name)
                    results.append({
                        "service": "ad",
                        "attempted": False,
                        "success": False,
                        "error": "Computer not found in Active Directory",
                    })
                else:
                    entry = conn.entries[0]
                    uac_val = int(entry.userAccountControl.value or 0)
                    new_uac = uac_val | 0x0002  # set ACCOUNTDISABLE bit
                    dn = entry.entry_dn
                    conn.modify(dn, {"userAccountControl": [(MODIFY_REPLACE, [new_uac])]})
                    if conn.result["result"] == 0:
                        logger.info("Offboard [%s]: ad → disabled (DN: %s)", display_name, dn)
                        results.append({"service": "ad", "attempted": True, "success": True, "error": None})
                    else:
                        err = conn.result.get("description", "Modify failed")
                        logger.warning("Offboard [%s]: ad → failed (%s)", display_name, err)
                        results.append({"service": "ad", "attempted": True, "success": False, "error": err})
                conn.unbind()
        except Exception as exc:
            logger.warning("Offboard [%s]: ad → exception: %s", display_name, exc)
            results.append({"service": "ad", "attempted": True, "success": False, "error": str(exc)})
    else:
        results.append({"service": "ad", "attempted": False, "success": False, "error": None})

    return {
        "device_id": item.get("device_id", ""),
        "display_name": display_name if display_name != "unknown" else None,
        "results": results,
    }


def assign_user_licenses(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    object_id: str,
    add_sku_ids: list[str],
    remove_sku_ids: list[str],
) -> dict:
    """
    Assign and/or remove licenses for an Entra user in a single Graph API call.

    Calls POST /users/{id}/assignLicense with addLicenses / removeLicenses.
    Requires User.ReadWrite.All or Directory.ReadWrite.All application permission.

    Returns {"success": True} or {"success": False, "error": str}.
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
        return {"success": False, "error": "Invalid Entra configuration."}

    if "access_token" not in result:
        err = result.get("error_description") or result.get("error") or "Authentication failed"
        return {"success": False, "error": err}

    token = result["access_token"]
    payload = {
        "addLicenses":    [{"skuId": sid} for sid in add_sku_ids],
        "removeLicenses": remove_sku_ids,
    }

    try:
        resp = _requests.post(
            f"{_GRAPH_BASE}/users/{object_id}/assignLicense",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15,
        )
        if resp.ok:
            return {"success": True}

        # Extract a human-readable error from the Graph response
        try:
            err_body = resp.json()
            err_msg = (
                err_body.get("error", {}).get("message")
                or err_body.get("error", {}).get("code")
                or resp.text[:200]
            )
        except Exception:
            err_msg = resp.text[:200]

        logger.warning("assignLicense HTTP %s for %s: %s", resp.status_code, object_id, err_msg)
        return {"success": False, "error": err_msg}

    except Exception as exc:
        logger.warning("assignLicense error for %s: %s", object_id, exc)
        return {"success": False, "error": str(exc)}


def get_tenant_licenses(
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> list[dict]:
    """
    Fetch all Microsoft 365 / Entra license subscriptions for the tenant.

    Calls GET /subscribedSkus.
    Requires Directory.Read.All or Organization.Read.All application permission.

    Returns a list of dicts matching the TenantLicense schema, sorted by
    display_name ascending. Deleted SKUs are excluded.

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
    try:
        resp = _requests.get(
            f"{_GRAPH_BASE}/subscribedSkus",
            headers={"Authorization": f"Bearer {token}"},
            params={"$select": "skuId,skuPartNumber,capabilityStatus,consumedUnits,prepaidUnits"},
            timeout=10,
        )
        if not resp.ok:
            logger.warning("get_tenant_licenses HTTP %s: %s", resp.status_code, resp.text[:200])
            return []
    except Exception as exc:
        logger.warning("get_tenant_licenses error: %s", exc)
        return []

    licenses: list[dict] = []
    for sku in resp.json().get("value", []):
        status = sku.get("capabilityStatus", "Enabled")
        if status == "Deleted":
            continue  # skip fully removed SKUs

        sku_part = sku.get("skuPartNumber", "")
        prepaid = sku.get("prepaidUnits") or {}
        total = prepaid.get("enabled", 0)
        consumed = sku.get("consumedUnits", 0)

        licenses.append({
            "sku_id": sku.get("skuId", ""),
            "sku_part_number": sku_part,
            "display_name": _friendly_sku(sku_part),
            "total": total,
            "assigned": consumed,
            "available": max(total - consumed, 0),
            "warning": prepaid.get("warning", 0),
            "capability_status": status,
        })

    return sorted(licenses, key=lambda x: x["display_name"].lower())


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
