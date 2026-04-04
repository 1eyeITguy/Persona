# Spec: Phase 7 — Device Management

**Status:** Planned | **Version target:** 0.8.0
**Depends on:** Phase 5 (workflow engine), Phase 2 (Entra connected)

---

## Device as a First-Class Object

Devices get their own section in the sidebar alongside Users.
Device detail panel mirrors user detail panel in structure.

---

## Device Identity Map

Every device is represented as a unified object across all systems:

```python
class DeviceIdentityMap:
    # Core
    hostname: str
    serial_number: str | None
    operating_system: str | None
    os_version: str | None
    assigned_user_dn: str | None
    assigned_user_display_name: str | None

    # Microsoft
    intune_device_id: str | None
    autopilot_id: str | None
    entra_device_object_id: str | None
    ad_computer_dn: str | None         # on-prem computer object
    intune_compliance_state: str | None
    last_intune_checkin: str | None

    # Plugin-discovered (populated at lookup time)
    plugin_ids: dict[str, str | None]
    # { "sophos-central": "ep-xyz",
    #   "cisco-umbrella": None,  ← not found in this system
    #   "anydesk": "123456" }

    tenant_id: UUID
```

---

## Device Offboarding Workflow

Built-in workflow: `device-offboard-standard.yaml`

### Preview
```
Device Offboard — DESKTOP-ABC123
Serial: 5CG1234XYZ  |  Last user: jsmith (Jane Smith)

The following actions will be performed:

  Microsoft (required — stops if any fail)
  ✓ Retire from Intune
  ✓ Remove from Autopilot  ← prevents auto re-enrollment
  ✓ Delete Entra ID device object

  Security (optional — warns if fail, continues)
  ✓ Remove from Sophos Central   (found: ep-abc123)
  ✓ Remove from AnyDesk          (found: client 123456)

  ⚠ Not found in these systems:
    Cisco Umbrella — device not registered (may have been removed already)

[Cancel]  [Confirm Offboard]
```

### Execution Order
1. Intune retire (required, stop on failure — do not orphan)
2. Autopilot removal (required, depends on step 1)
3. Entra device delete (required)
4. Plugin steps in parallel (optional)

Step 1 MUST complete before step 2. This order is enforced in the workflow YAML.

### LAPS and BitLocker

Available before offboarding (Tier 2 only, reason required):

```
LAPS Password — DESKTOP-ABC123

Reason for retrieval: [________________________________] (required)

[Retrieve LAPS Password]
```

Password displayed once, masked, copied to clipboard.
Audit log records: tech, timestamp, device, reason entered.
Never stored in Persona — fetched live from Graph API.

---

## Additional Device Workflows

### Device Transfer (User to User)
- Reassign Autopilot/Intune to new user
- Update device name/tag if naming convention uses username
- Update plugin records

### Lost / Stolen
1. Remote lock via Intune (immediate)
2. Flag as compromised in EDR (Sophos/CrowdStrike/etc.)
3. Revoke assigned user's Entra refresh tokens
4. Generate incident summary for audit
5. Notify tech's manager (if configured)

### Device Wipe
- Trigger Intune wipe
- Confirm wipe completion (poll Intune status, timeout 30min)
- Remove from Autopilot
- Keep in EDR (device will re-appear after imaging)
- Prominent warning: this erases all data

---

## Plugin Configuration

Settings → Integrations

```
Add Integration — Sophos Central

API Region:     [US ▼]
Client ID:      [________________________]
Client Secret:  [________________________]

[Test Connection]
"✓ Connected. Found 847 endpoints."

[Save]
```

Each plugin tests connection before saving.
Credentials encrypted at rest. Never returned in API responses.

---

## Computer Objects (AD)

Device view includes AD computer objects:

```
Computer: DESKTOP-ABC123
  DN: CN=DESKTOP-ABC123,OU=Workstations,DC=contoso,DC=com
  OS: Windows 11 Pro 23H2
  Last logon: 2 hours ago
  Enabled: ✓
  Description: Jane Smith - Finance
```

---

## Acceptance Criteria

- [ ] Device search returns results from Intune + AD computer objects
- [ ] Device identity map populated at lookup time (not cached stale)
- [ ] Plugin not-found is informational, not an error
- [ ] Offboard preview accurately shows found/not-found per system
- [ ] Intune retire failure stops workflow (does not proceed to Autopilot)
- [ ] Autopilot removal follows Intune retire (dependency enforced)
- [ ] Plugin steps run after Microsoft steps complete
- [ ] Plugin failure warns and continues (does not stop workflow)
- [ ] LAPS retrieval requires reason and is audit logged
- [ ] BitLocker key retrieval requires reason and is audit logged
- [ ] Lost/stolen workflow revokes user tokens via Graph API
- [ ] Full audit record created for every device action
