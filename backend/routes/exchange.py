"""
Exchange Online routes — /api/v1/exchange/

Routes:
  GET  /user/{upn}/mailbox    Return Exchange mailbox data with SOA resolution (JWT required)
  GET  /user/{upn}/extended   EXO PowerShell data: mailbox size + shared mailbox access (JWT required)
                               Fetched lazily by the frontend after the tab renders.
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.app_config import (
    get_entra_settings,
    get_exchange_ps_config,
    is_entra_configured,
    is_exchange_ps_configured,
)
from backend.auth.ldap import get_exchange_attrs_by_upn
from backend.deps import require_jwt
from backend.models.schemas import ExchangeExtendedResponse, ExchangeMailboxResponse, ProxyAddress, SharedMailboxAccess
from backend.services.exchange_graph import get_exchange_mailbox_data
from backend.services.exchange_ps import get_mailbox_extended, get_org_block_flag
from backend.services.exchange_soa import ExchangeSOA, resolve_exchange_soa

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exchange", tags=["exchange"])


def _parse_proxy_addresses(raw: list[str]) -> list[ProxyAddress]:
    """
    Parse the raw proxyAddresses list into structured ProxyAddress objects.

    AD stores them as "SMTP:jane@contoso.com" (primary) or "smtp:alias@contoso.com".
    The uppercase prefix marks the primary address for that protocol.
    """
    result = []
    for entry in raw:
        if ":" not in entry:
            continue
        protocol, _, address = entry.partition(":")
        result.append(
            ProxyAddress(
                address=address,
                is_primary=protocol == protocol.upper(),
                protocol=protocol,
            )
        )
    # Primary SMTP first, then sorted alphabetically
    result.sort(key=lambda p: (not p.is_primary, p.protocol.lower(), p.address.lower()))
    return result


@router.get("/user/{upn}/mailbox", response_model=ExchangeMailboxResponse)
async def get_user_mailbox(
    upn: str,
    _token: dict = Depends(require_jwt),
) -> ExchangeMailboxResponse:
    """
    Return Exchange mailbox data for a user with SOA resolution.

    Performs a three-layer SOA check:
      Layer 1 — Per-mailbox declaration from Graph API (highest trust)
      Layer 2 — Org-wide BlockExchangeProvisioningFromOnPremEnabled flag
      Layer 3 — AD msExchRecipientTypeDetails attribute value

    When SOA is STALE_AD_ATTRS or UNKNOWN, no mailbox data is returned.
    When SOA is CLOUD, returns data from Graph API + EXO PowerShell.
    """
    upn = unquote(upn)

    # ── Step 1: Get AD Exchange attributes for SOA Layer 3 ────────────────────
    ad_attrs = await run_in_threadpool(get_exchange_attrs_by_upn, upn)
    # ad_attrs may be None if LDAP not configured or user not found
    msexch_recipient_type = (ad_attrs or {}).get("msexch_recipient_type")
    proxy_addresses_raw = (ad_attrs or {}).get("proxy_addresses") or []
    home_mdb = (ad_attrs or {}).get("home_mdb")

    # ── Step 2: Get org block flag via EXO PowerShell (SOA Layer 2) ───────────
    block_flag: bool | None = None
    if is_exchange_ps_configured():
        ps_cfg = get_exchange_ps_config()
        if ps_cfg:
            block_flag = await run_in_threadpool(
                get_org_block_flag,
                ps_cfg["app_id"],
                ps_cfg.get("cert_path", ""),
                ps_cfg["tenant_domain"],
                ps_cfg.get("cert_password"),
            )

    # ── Step 3: Get Graph mailbox data (SOA Layer 1 + cloud mailbox details) ──
    graph_data: dict | None = None
    if is_entra_configured():
        entra_cfg = get_entra_settings()
        if entra_cfg:
            # Use entra_object_id if available for more reliable lookup;
            # fall back to UPN which Graph accepts directly.
            graph_data = await run_in_threadpool(
                get_exchange_mailbox_data,
                entra_cfg["tenant_id"],
                entra_cfg["client_id"],
                entra_cfg["client_secret"],
                upn,
            )

    graph_mailbox_exists = (graph_data or {}).get("mailbox_exists") if graph_data else None
    graph_is_cloud_managed = (graph_data or {}).get("is_exchange_cloud_managed") if graph_data else None

    # ── Step 4: Resolve SOA ───────────────────────────────────────────────────
    soa = resolve_exchange_soa(
        msexch_recipient_type=msexch_recipient_type,
        proxy_addresses=proxy_addresses_raw,
        home_mdb=home_mdb,
        block_exchange_provisioning_from_onprem=block_flag,
        graph_mailbox_exists=graph_mailbox_exists,
        graph_is_exchange_cloud_managed=graph_is_cloud_managed,
    )

    # ── Step 5: Build response based on SOA ──────────────────────────────────
    if soa != ExchangeSOA.CLOUD:
        return ExchangeMailboxResponse(soa=soa.value)

    # CLOUD: populate from Graph data
    if not graph_data or not graph_data.get("found"):
        # Entra not configured or user not found — return cloud SOA with empty data
        return ExchangeMailboxResponse(
            soa=ExchangeSOA.CLOUD.value,
            primary_email=None,
        )

    proxy_addresses = _parse_proxy_addresses(graph_data.get("proxy_addresses") or [])

    # Primary email from proxyAddresses (SMTP: uppercase prefix)
    primary_email = graph_data.get("mail")
    if not primary_email:
        for pa in proxy_addresses:
            if pa.protocol == "SMTP":
                primary_email = pa.address
                break

    dist_groups = graph_data.get("distribution_groups") or []

    # NOTE: mailbox size + shared mailbox access are in /extended (lazy-loaded by the frontend)
    return ExchangeMailboxResponse(
        soa=ExchangeSOA.CLOUD.value,
        primary_email=primary_email,
        display_name=graph_data.get("display_name"),
        proxy_addresses=proxy_addresses,
        mailbox_size_bytes=None,
        archive_enabled=graph_data.get("archive_enabled"),
        ooo_enabled=graph_data.get("ooo_enabled"),
        ooo_message=graph_data.get("ooo_external_message"),
        distribution_groups=dist_groups,
        shared_mailbox_access=[],
    )


@router.get("/user/{upn}/extended", response_model=ExchangeExtendedResponse)
async def get_user_exchange_extended(
    upn: str,
    _token: dict = Depends(require_jwt),
) -> ExchangeExtendedResponse:
    """
    EXO PowerShell data for a user — mailbox size and shared mailbox access.

    This endpoint is intentionally separate from /mailbox so the Exchange tab
    can render immediately from Graph data while this slower EXO PS call runs
    in the background.
    """
    upn = unquote(upn)

    if not is_exchange_ps_configured():
        return ExchangeExtendedResponse(ps_available=False)

    ps_cfg = get_exchange_ps_config()
    if not ps_cfg:
        return ExchangeExtendedResponse(ps_available=False)

    app_id      = ps_cfg["app_id"]
    cert_path   = ps_cfg.get("cert_path", "")
    tenant      = ps_cfg["tenant_domain"]
    cert_pw     = ps_cfg.get("cert_password")

    extended = await run_in_threadpool(
        get_mailbox_extended, app_id, cert_path, tenant, upn, cert_pw
    )

    shared_access = [
        SharedMailboxAccess(
            display_name=s["display_name"],
            email=s["email"],
            access_type=s["access_type"],
        )
        for s in extended.get("shared_access", [])
    ]

    return ExchangeExtendedResponse(
        mailbox_size_bytes=extended.get("size_bytes"),
        shared_mailbox_access=shared_access,
        ps_available=True,
    )
