# Spec: Phase 3 — Exchange View

**Status:** Planned | **Version target:** 0.4.0
**Depends on:** Phase 2 complete, Entra connected

---

## Objectives

Display Exchange mailbox data correctly for any Exchange configuration.
Never display wrong data. Be honest about what Persona can and cannot see.

---

## Exchange Provider Configuration

Setup Wizard gets a new optional step — Exchange configuration:

```
Exchange Configuration (optional)

How is email managed?
  ● Exchange Online (Microsoft 365)
  ○ Exchange Server (on-premises)
  ○ Exchange Hybrid (both)
  ○ No Exchange / Not applicable
```

Exchange Online: uses Entra service principal (already configured).
Exchange On-Prem: requires Exchange Web Services (EWS) URL + credentials.
Exchange Hybrid: both, with per-user SOA resolution.

---

## SOA Resolution

Runs on every user lookup. See docs/specs/architecture/exchange-soa-resolution.md.

STALE_AD_ATTRS detection is mandatory — never skip it.

---

## Exchange Panel (User Panel — new tab)

Tab is always visible. Content adapts to SOA result.

### CLOUD state
```
Exchange Online

Primary email:     jane.smith@contoso.com
Display name:      Jane Smith
Mailbox size:      12.4 GB / 100 GB (12%)
Archive:           Enabled — 2.1 GB used
Out of office:     Off

Email addresses:
  📧 SMTP:jane.smith@contoso.com    (primary)
  📧 smtp:jsmith@contoso.com        (alias)
  📧 smtp:jane.doe@contoso.com      (alias — legacy name)
```

### STALE_AD_ATTRS state
```
⚠ Exchange data in AD is not current

This user's mailbox was migrated to Exchange Online.
Active Directory still contains old mailbox data from
before the migration. That data is no longer accurate.

Connect Entra to see current mailbox details from Exchange Online.

[Connect to Entra]
```

### UNKNOWN state
```
⚠ Exchange status unknown

This organization manages Exchange Online independently of
Active Directory. Connect Entra to see mailbox details.

[Connect to Entra]
```

### NONE state
```
No mailbox assigned
```

---

## Data Displayed (CLOUD)

From Graph API:
- mail (primary SMTP)
- proxyAddresses (all aliases, labeled primary vs secondary)
- displayName in Exchange
- mailboxSettings.archive.isEnabled + size
- mailboxSettings.automaticRepliesSetting (OOO status)
- Mailbox size (requires additional Graph call or EXO cmdlet)
- Distribution list membership (read-only)
- Shared mailbox access (read-only)

---

## API Endpoints

```
GET /api/v1/t/{slug}/exchange/user/{id}/soa
GET /api/v1/t/{slug}/exchange/user/{id}/mailbox
GET /api/v1/t/{slug}/exchange/user/{id}/addresses
GET /api/v1/t/{slug}/exchange/user/{id}/shared-access
```

---

## Acceptance Criteria

- [ ] SOA resolver correctly identifies CLOUD, ON_PREM, STALE, UNKNOWN, NONE
- [ ] STALE_AD_ATTRS never displays AD Exchange attributes as current
- [ ] STALE_AD_ATTRS warning shown with clear explanation
- [ ] CLOUD state shows accurate data from Graph API
- [ ] Proxy addresses clearly labeled (primary vs secondary)
- [ ] ON_PREM state shows EWS data (if on-prem Exchange configured)
- [ ] UNKNOWN state shown when org blocks provisioning but Entra not connected
- [ ] Tab visible for all users — content adapts to SOA result
