# Architecture: Exchange SOA Resolution

---

## The Problem

Exchange attribute authority is not consistent across organizations or even
across users within the same organization. A tool that assumes all Exchange
attributes are authoritative in AD (or all in the cloud) will display wrong
data or make dangerous writes.

---

## The Five States

```python
class ExchangeSOA(str, Enum):
    CLOUD          = "cloud"
    ON_PREM        = "on_prem"
    STALE_AD_ATTRS = "stale_ad_attrs"
    UNKNOWN        = "unknown"
    NONE           = "none"
```

### CLOUD
Exchange Online is authoritative. Graph API is the only correct data source.
Write operations: Graph API only. Never LDAP.

### ON_PREM
Exchange Server is authoritative. EWS or LDAP is the data source.
Write operations: EWS or LDAP. Graph API is read-only view.

### STALE_AD_ATTRS (The Dangerous Case)
The organization migrated from Exchange on-prem to Exchange Online.
AD still contains Exchange attributes — but they are frozen at migration
time. They are wrong. They must never be displayed as current data.

Detection: Organization has BlockExchangeProvisioningFromOnPremEnabled = True
AND the AD user object has msExch* attributes present.

Persona response: suppress all AD Exchange attributes. Show warning.
Prompt to connect Entra to get real data from Graph API.

### UNKNOWN
Cannot determine SOA without Entra connected.
Organization has BlockExchangeProvisioningFromOnPremEnabled = True but
Entra is not yet connected so Graph API cannot be queried.

Persona response: show warning, prompt to connect Entra.

### NONE
No mailbox exists for this user.

---

## Resolution Logic

```python
def resolve_exchange_soa(
    user: UnifiedUser,
    org_config: OrgConfig,
    graph_data: GraphMailboxData | None = None
) -> ExchangeSOA:

    has_legacy_ad_exchange = (
        user.msexch_recipient_type is not None
        or bool(user.proxy_addresses)
        or user.home_mdb is not None
    )

    # Layer 1 — Per-mailbox declaration (highest trust, most specific)
    if graph_data is not None:
        if graph_data.is_exchange_cloud_managed is True:
            return ExchangeSOA.CLOUD
        if graph_data.is_exchange_cloud_managed is False:
            return ExchangeSOA.ON_PREM

    # Layer 2 — Org-wide block flag
    if org_config.block_exchange_provisioning_from_onprem:
        # AD Exchange attrs present but SOA is cloud = stale/frozen
        if has_legacy_ad_exchange:
            return ExchangeSOA.STALE_AD_ATTRS
        # No AD attrs, Entra says mailbox exists = clean cloud
        if graph_data and graph_data.mailbox_exists:
            return ExchangeSOA.CLOUD
        # No AD attrs, Entra not connected = cannot determine
        if graph_data is None:
            return ExchangeSOA.UNKNOWN
        # No AD attrs, Entra says no mailbox = none
        return ExchangeSOA.NONE

    # Layer 3 — Mailbox location from AD attribute
    # msExchRecipientTypeDetails values:
    # 1          = on-premises mailbox
    # 2147483648 = remote mailbox (Exchange Online)
    if user.msexch_recipient_type == 2147483648:
        return ExchangeSOA.CLOUD
    if user.msexch_recipient_type == 1:
        return ExchangeSOA.ON_PREM

    return ExchangeSOA.NONE
```

---

## UI Behavior Per State

```
CLOUD
    Data source: Graph API
    Label: "Exchange Online"
    Attributes displayed: mail, proxyAddresses from Graph
    Phase 4 writes: Graph API only

ON_PREM
    Data source: EWS / LDAP
    Label: "Exchange Server"
    Attributes displayed: mail, proxyAddresses from AD
    Phase 4 writes: EWS / LDAP

STALE_AD_ATTRS
    Data source: None (AD data suppressed)
    Label: none — show warning instead
    Warning box:
        "⚠ Exchange data in AD is not current
         This user's mailbox was migrated to Exchange Online.
         Active Directory still contains old mailbox data that
         is no longer authoritative.
         Connect to Entra to see current mailbox details."
    Button: [Connect to Entra]

UNKNOWN
    Warning box:
        "⚠ Exchange status unknown
         This organization manages Exchange Online independently
         of Active Directory. Connect to Entra to see mailbox details."
    Button: [Connect to Entra]

NONE
    Label: "No mailbox assigned"
    Phase 4: Option to create mailbox (heavily guarded)
```

---

## Attributes to Suppress for STALE_AD_ATTRS

When STALE_AD_ATTRS is detected, never display these AD attributes:

```python
SUPPRESSED_FOR_STALE = [
    "mail",                    # may not match current primary SMTP
    "proxyAddresses",          # aliases change frequently post-migration
    "msExchHomeServerName",    # on-prem server — irrelevant
    "homeMDB",                 # on-prem database — irrelevant
    "msExchMailboxGuid",       # may be stale
    "msExchRecipientTypeDetails",  # reflects old state
    "msExchRecipientDisplayType",
]

# Still safe to display (synced by Entra Connect, not Exchange SOA)
SAFE_FOR_STALE = [
    "displayName",
    "department",
    "title",
    "telephoneNumber",
    "mobile",
    "givenName",
    "sn",
]
```

---

## Data Reliability Assessment

```python
def assess_exchange_reliability(
    user: UnifiedUser,
    soa: ExchangeSOA
) -> ExchangeDataReliability:

    if soa == ExchangeSOA.STALE_AD_ATTRS:
        return ExchangeDataReliability.STALE

    if soa == ExchangeSOA.CLOUD:
        if user.source_provider == "ad":
            # AD-only view, can't see Graph data
            return ExchangeDataReliability.INCOMPLETE
        return ExchangeDataReliability.AUTHORITATIVE

    if soa == ExchangeSOA.ON_PREM:
        return ExchangeDataReliability.AUTHORITATIVE

    return ExchangeDataReliability.UNKNOWN
```
