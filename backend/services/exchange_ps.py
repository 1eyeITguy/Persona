"""
Exchange Online PowerShell integration.

Uses the ExchangeOnlineManagement PowerShell module with certificate-based
app-only authentication to access EXO data not available via Graph API:
  - BlockExchangeProvisioningFromOnPremEnabled (org-wide SOA flag)
  - Shared mailbox access (Get-MailboxPermission)

All functions are SYNCHRONOUS. FastAPI callers must wrap in run_in_threadpool().

Prerequisites:
  - PowerShell Core (pwsh) installed in the runtime environment
  - ExchangeOnlineManagement module installed
  - Certificate PFX stored at the path in config (data/certs/exchange.pfx)
  - App registration has Exchange.ManageAsApp permission (admin consented)
  - Service principal created in EXO:
      New-ServicePrincipal -AppId <ClientId> -ServiceId <ObjectId>
      New-ManagementRoleAssignment -Role "View-Only Recipients" -App <Identity>

Graceful degradation: if pwsh is not available or cert is not configured,
all functions return safe empty/None values rather than raising.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Org config cache (BlockExchangeProvisioningFromOnPremEnabled doesn't change often)
# ---------------------------------------------------------------------------

_ORG_CONFIG_CACHE: dict = {}   # keys: tenant_domain → {"value": bool, "fetched_at": float}
_ORG_CONFIG_TTL = 3600         # 1 hour


def _pwsh_available() -> bool:
    """Return True if PowerShell Core (pwsh) is on the PATH."""
    return shutil.which("pwsh") is not None


def _run_ps(script: str, timeout: int = 60) -> Optional[str]:
    """
    Execute a PowerShell script and return its stdout, or None on error.
    stderr is logged as a warning.
    """
    if not _pwsh_available():
        logger.debug("pwsh not available — EXO PowerShell features disabled")
        return None

    try:
        proc = subprocess.run(
            ["pwsh", "-NonInteractive", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0 and proc.stderr:
            logger.warning("EXO PS script error: %s", proc.stderr[:1000])
        return proc.stdout.strip() or None, proc.stderr.strip()
    except subprocess.TimeoutExpired:
        logger.warning("EXO PS script timed out after %ds", timeout)
        return None, f"Script timed out after {timeout}s"
    except Exception as exc:
        logger.warning("EXO PS script failed: %s", exc)
        return None, str(exc)


def _connect_snippet(app_id: str, cert_path: str, tenant_domain: str, cert_password: Optional[str] = None) -> str:
    """Return the PowerShell Connect-ExchangeOnline snippet."""
    lines = [
        f"Connect-ExchangeOnline",
        f"  -AppId '{app_id}'",
        f"  -CertificatePath '{cert_path}'",
        f"  -Organization '{tenant_domain}'",
        f"  -ShowBanner:$false",
        f"  -ErrorAction Stop",
    ]
    if cert_password:
        # Escape any single quotes in the password
        safe_pw = cert_password.replace("'", "''")
        lines.insert(
            3,
            f"  -CertificatePassword (ConvertTo-SecureString '{safe_pw}' -AsPlainText -Force)",
        )
    return " `\n".join(lines)


def _disconnect_snippet() -> str:
    return "Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_org_block_flag(
    app_id: str,
    cert_path: str,
    tenant_domain: str,
    cert_password: Optional[str] = None,
) -> Optional[bool]:
    """
    Return the value of BlockExchangeProvisioningFromOnPremEnabled for the tenant.

    Returns None if EXO PS is not available or the call fails.
    Result is cached for 1 hour (the flag rarely changes).
    """
    cache_key = tenant_domain.lower()
    cached = _ORG_CONFIG_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached["fetched_at"]) < _ORG_CONFIG_TTL:
        return cached["value"]

    script = f"""
Import-Module ExchangeOnlineManagement -ErrorAction Stop
{_connect_snippet(app_id, cert_path, tenant_domain, cert_password)}
try {{
    $cfg = Get-OrganizationConfig | Select-Object -ExpandProperty BlockExchangeProvisioningFromOnPremEnabled
    $cfg | ConvertTo-Json
}} finally {{
    {_disconnect_snippet()}
}}
"""
    output, _ = _run_ps(script)
    if output is None:
        return None

    try:
        value = json.loads(output)
        flag = bool(value) if value is not None else False
        _ORG_CONFIG_CACHE[cache_key] = {"value": flag, "fetched_at": time.monotonic()}
        return flag
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("Could not parse org config output: %s — raw: %s", exc, output[:200])
        return None


def get_shared_mailbox_access(
    app_id: str,
    cert_path: str,
    tenant_domain: str,
    upn: str,
    cert_password: Optional[str] = None,
) -> list[dict]:
    """
    Return shared mailboxes that the given user has explicit access to.

    Each entry: {"display_name": str, "email": str, "access_type": str}
    access_type is "FullAccess", "SendAs", or "SendOnBehalf".

    Returns an empty list if EXO PS is not available or no access found.
    """
    # Sanitize upn for use in PowerShell (basic guard — UPNs are validated upstream)
    safe_upn = upn.replace("'", "''")

    script = f"""
Import-Module ExchangeOnlineManagement -ErrorAction Stop
{_connect_snippet(app_id, cert_path, tenant_domain, cert_password)}
try {{
    $results = @()

    # FullAccess permissions on shared mailboxes
    $mailboxes = Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize Unlimited -ErrorAction SilentlyContinue
    foreach ($mb in $mailboxes) {{
        $perms = Get-MailboxPermission -Identity $mb.Identity -User '{safe_upn}' -ErrorAction SilentlyContinue
        if ($perms) {{
            foreach ($p in $perms) {{
                if ($p.AccessRights -contains 'FullAccess') {{
                    $results += [PSCustomObject]@{{
                        display_name = $mb.DisplayName
                        email        = $mb.PrimarySmtpAddress
                        access_type  = 'FullAccess'
                    }}
                }}
            }}
        }}
    }}

    # SendAs permissions
    $sendAs = Get-RecipientPermission -Trustee '{safe_upn}' -ErrorAction SilentlyContinue
    foreach ($p in $sendAs) {{
        if ($p.AccessRights -contains 'SendAs') {{
            $results += [PSCustomObject]@{{
                display_name = $p.Identity
                email        = $p.Identity
                access_type  = 'SendAs'
            }}
        }}
    }}

    $results | ConvertTo-Json -Depth 3
}} finally {{
    {_disconnect_snippet()}
}}
"""
    output, _ = _run_ps(script, timeout=120)
    if not output:
        return []

    try:
        data = json.loads(output)
        if isinstance(data, dict):
            data = [data]  # single result
        if not isinstance(data, list):
            return []

        seen = set()
        deduped = []
        for item in data:
            key = (item.get("email", ""), item.get("access_type", ""))
            if key not in seen:
                seen.add(key)
                deduped.append({
                    "display_name": item.get("display_name") or item.get("email") or "",
                    "email":        item.get("email") or "",
                    "access_type":  item.get("access_type") or "FullAccess",
                })
        return deduped
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("Could not parse shared mailbox output: %s — raw: %s", exc, output[:200])
        return []


def test_ewo_connection(
    app_id: str,
    cert_path: str,
    tenant_domain: str,
    cert_password: Optional[str] = None,
) -> dict:
    """
    Test the EXO PowerShell connection. Returns {"success": bool, "message": str}.
    """
    if not _pwsh_available():
        return {"success": False, "message": "PowerShell Core (pwsh) is not installed in this environment."}

    script = f"""
Import-Module ExchangeOnlineManagement -ErrorAction Stop
{_connect_snippet(app_id, cert_path, tenant_domain, cert_password)}
try {{
    $count = (Get-Mailbox -ResultSize 1 -ErrorAction Stop | Measure-Object).Count
    "connected"
}} finally {{
    {_disconnect_snippet()}
}}
"""
    output, stderr = _run_ps(script, timeout=60)
    if output and "connected" in output.lower():
        return {"success": True, "message": "Exchange Online PowerShell connection successful."}

    # Surface the real PowerShell error so the admin can diagnose without exec'ing into the container
    error_detail = ""
    if stderr:
        # Extract the most useful line — PowerShell errors are verbose; grab the first non-blank line
        first_line = next((l.strip() for l in stderr.splitlines() if l.strip()), "")
        if first_line:
            error_detail = f" PowerShell error: {first_line}"

    return {
        "success": False,
        "message": f"Could not connect to Exchange Online.{error_detail}",
    }
