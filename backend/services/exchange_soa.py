"""
Exchange Source of Authority (SOA) resolution.

Determines which system is authoritative for a user's Exchange mailbox data.
The five states are documented in docs/specs/architecture/exchange-soa-resolution.md.

IMPORTANT: Never display AD Exchange attributes when SOA is STALE_AD_ATTRS.
Those attributes are frozen at migration time and are wrong.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional


class ExchangeSOA(str, Enum):
    CLOUD = "cloud"
    ON_PREM = "on_prem"
    STALE_AD_ATTRS = "stale_ad_attrs"
    UNKNOWN = "unknown"
    NONE = "none"


# AD Exchange attributes that are frozen/stale after migration to Exchange Online.
# Never display these when SOA is STALE_AD_ATTRS.
SUPPRESSED_FOR_STALE: list[str] = [
    "mail",
    "proxyAddresses",
    "msExchHomeServerName",
    "homeMDB",
    "msExchMailboxGuid",
    "msExchRecipientTypeDetails",
    "msExchRecipientDisplayType",
]

# msExchRecipientTypeDetails values
_REMOTE_MAILBOX = 2147483648  # Exchange Online (remote mailbox)
_ONPREM_MAILBOX = 1           # On-premises Exchange mailbox


def resolve_exchange_soa(
    *,
    msexch_recipient_type: Optional[int],
    proxy_addresses: Optional[list[str]],
    home_mdb: Optional[str],
    block_exchange_provisioning_from_onprem: Optional[bool],
    graph_mailbox_exists: Optional[bool],
    graph_is_exchange_cloud_managed: Optional[bool],
) -> ExchangeSOA:
    """
    Resolve the Exchange Source of Authority for a user.

    Parameters
    ----------
    msexch_recipient_type:
        Value of the AD msExchRecipientTypeDetails attribute (int), or None if absent.
    proxy_addresses:
        Value of the AD proxyAddresses attribute (list), or None/empty if absent.
    home_mdb:
        Value of the AD homeMDB attribute (str), or None if absent.
    block_exchange_provisioning_from_onprem:
        Org-wide flag from EXO: BlockExchangeProvisioningFromOnPremEnabled.
        None means we couldn't determine it (EXO PS not configured).
    graph_mailbox_exists:
        True if Graph API reports the user has a mailbox. None if Entra not connected.
    graph_is_exchange_cloud_managed:
        True/False from Graph per-mailbox declaration. None if unknown/Entra not connected.
    """
    has_legacy_ad_exchange = (
        msexch_recipient_type is not None
        or bool(proxy_addresses)
        or home_mdb is not None
    )

    # Layer 1 — Per-mailbox declaration (highest trust)
    if graph_is_exchange_cloud_managed is True:
        return ExchangeSOA.CLOUD
    if graph_is_exchange_cloud_managed is False:
        return ExchangeSOA.ON_PREM

    # Layer 2 — Org-wide block flag
    if block_exchange_provisioning_from_onprem is True:
        if has_legacy_ad_exchange:
            # Graph confirms mailbox is in Exchange Online — serve cloud data.
            # STALE_AD_ATTRS is only correct when we *can't* reach Graph to verify.
            if graph_mailbox_exists is True:
                return ExchangeSOA.CLOUD
            # Entra not connected — can't confirm current state, flag stale attrs
            return ExchangeSOA.STALE_AD_ATTRS
        # No legacy AD attrs
        if graph_mailbox_exists is True:
            return ExchangeSOA.CLOUD
        if graph_mailbox_exists is None:
            return ExchangeSOA.UNKNOWN
        return ExchangeSOA.NONE

    # Layer 3 — Mailbox location from AD attribute
    if msexch_recipient_type == _REMOTE_MAILBOX:
        return ExchangeSOA.CLOUD
    if msexch_recipient_type == _ONPREM_MAILBOX:
        return ExchangeSOA.ON_PREM

    return ExchangeSOA.NONE
