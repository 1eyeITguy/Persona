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
import re
import shutil
import subprocess
import time
from typing import Optional

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[mGKHF]')

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
        f"  -CertificateFilePath '{cert_path}'",
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


def get_mailbox_extended(
    app_id: str,
    cert_path: str,
    tenant_domain: str,
    upn: str,
    cert_password: Optional[str] = None,
) -> dict:
    """
    Return mailbox size + SendAs shared access in a single EXO PS session.

    Uses one Connect/Disconnect to avoid spawning two separate PowerShell processes.

    NOTE on FullAccess shared mailboxes: discovering them requires iterating every
    shared mailbox in the org (Get-MailboxPermission has no -Trustee parameter for
    inverse lookup). That is O(n) per user view and too slow to include here.
    Only SendAs is returned — it uses Get-RecipientPermission -Trustee which IS
    an efficient server-side filter.

    Requires these two role assignments on the service principal:
      New-ManagementRoleAssignment -Role "Mail Recipients"      -App $sp.Identity
      New-ManagementRoleAssignment -Role "View-Only Recipients" -App $sp.Identity

    Returns: {"size_bytes": int|None, "shared_access": list[dict]}
    Caller MUST use run_in_threadpool.
    """
    safe_upn = upn.replace("'", "''")
    script = f"""
Import-Module ExchangeOnlineManagement -ErrorAction Stop
{_connect_snippet(app_id, cert_path, tenant_domain, cert_password)}
try {{
    $out = @{{ size_bytes = $null; shared_access = @() }}

    # Mailbox size — requires View-Only Recipients role
    try {{
        $stats = Get-MailboxStatistics -Identity '{safe_upn}' -ErrorAction Stop
        $out.size_bytes = $stats.TotalItemSize.Value.ToBytes()
    }} catch {{
        # Role not assigned or mailbox not found — continue without size
    }}

    # SendAs permissions — efficient server-side filter via -Trustee
    $sendAs = Get-RecipientPermission -Trustee '{safe_upn}' -ResultSize Unlimited -ErrorAction SilentlyContinue
    $shared = @()
    foreach ($p in $sendAs) {{
        if ($p.AccessRights -contains 'SendAs') {{
            $shared += [PSCustomObject]@{{
                display_name = $p.Identity
                email        = $p.Identity
                access_type  = 'SendAs'
            }}
        }}
    }}
    $out.shared_access = $shared

    $out | ConvertTo-Json -Depth 3
}} finally {{
    {_disconnect_snippet()}
}}
"""
    output, _ = _run_ps(script, timeout=60)
    if not output:
        return {"size_bytes": None, "shared_access": []}

    try:
        data = json.loads(output)
        raw_shared = data.get("shared_access") or []
        if isinstance(raw_shared, dict):
            raw_shared = [raw_shared]
        shared = [
            {
                "display_name": s.get("display_name") or s.get("email") or "",
                "email":        s.get("email") or "",
                "access_type":  s.get("access_type") or "SendAs",
            }
            for s in raw_shared if isinstance(s, dict)
        ]
        size = data.get("size_bytes")
        return {
            "size_bytes":    int(size) if size is not None else None,
            "shared_access": shared,
        }
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.warning("Could not parse mailbox extended output: %s — raw: %s", exc, output[:200])
        return {"size_bytes": None, "shared_access": []}


# Keep old names as thin wrappers so the route file doesn't need touching
def get_mailbox_size_ps(app_id, cert_path, tenant_domain, upn, cert_password=None):
    return get_mailbox_extended(app_id, cert_path, tenant_domain, upn, cert_password).get("size_bytes")


def get_shared_mailbox_access(app_id, cert_path, tenant_domain, upn, cert_password=None):
    return get_mailbox_extended(app_id, cert_path, tenant_domain, upn, cert_password).get("shared_access", [])


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

    # Return the full cleaned stderr so nothing is hidden
    ps_error = _ANSI_RE.sub("", stderr).strip() if stderr else ""
    return {
        "success": False,
        "message": "Could not connect to Exchange Online.",
        "ps_error": ps_error[:2000],  # cap at 2000 chars
    }
