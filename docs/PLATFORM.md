# Platform Architecture — Persona

This document describes how the four extensible platform layers work together.

---

## The Four Layers

### 1. Identity Providers

Abstracts where user identity lives. Configured in Setup Wizard.

```python
class IdentityProvider(ABC):
    provider_id: str
    display_name: str

    def authenticate(self, username: str, password: str) -> AuthResult
    def get_user(self, identifier: UserIdentifier) -> UnifiedUser
    def search_users(self, query: str) -> list[UnifiedUser]
    def get_tree(self, dn: str) -> TreeNode

class ADIdentityProvider(IdentityProvider): ...     # ldap3
class EntraIdentityProvider(IdentityProvider): ...  # Graph API
class HybridIdentityProvider(IdentityProvider): ... # both, merged
```

The UnifiedUser object is provider-agnostic. The UI never needs to know
which provider returned the data.

### 2. Service Providers

Abstracts where services like Exchange live and who owns their attributes.

```python
class ExchangeProvider(ABC):
    def get_soa(self, user: UnifiedUser) -> ExchangeSOA
    def get_mailbox(self, user: UnifiedUser) -> Mailbox | None
    # Phase 4+:
    def update_primary_smtp(self, user, new_address: str) -> ActionResult
    def add_alias(self, user, alias: str) -> ActionResult

class ExchangeOnlineProvider(ExchangeProvider): ...   # Graph API
class ExchangeOnPremProvider(ExchangeProvider): ...   # EWS
class ExchangeHybridProvider(ExchangeProvider): ...   # SOA-resolved routing
```

### 3. Integration Plugins

Third-party system connectors. Python packages following a defined interface.
Credentials stored per-tenant. Installed per-tenant.

```python
class DevicePlugin(PersonaPlugin):
    """For systems that track devices: EDR, RMM, MDM, remote access"""
    def find_device(self, identifier: DeviceIdentifier) -> Device | None
    def offboard_device(self, device: Device) -> ActionResult
    def onboard_device(self, device: Device) -> ActionResult
    def get_device_status(self, device: Device) -> DeviceStatus

class UserPlugin(PersonaPlugin):
    """For systems that track users: ticketing, ITSM, HR"""
    def find_user(self, identifier: UserIdentifier) -> PluginUser | None
    def offboard_user(self, user: PluginUser) -> ActionResult
```

Plugin discovery: plugins register in backend/plugins/{plugin_id}/__init__.py
Plugin credentials: stored in data/tenants/{id}/config.json under plugins.{id}
Community plugins: installable Python packages

### 4. Workflow Engine

Declarative YAML sequences of cross-provider operations.

```
Workflow YAML → Parser → Planner → Preview → [Approval?] → Executor → Audit

Parser:   validates YAML against schema, resolves inputs
Planner:  evaluates conditions, checks provider availability,
          generates ordered execution plan with rollback info
Preview:  shows tech exactly what will happen — required before execution
Approval: optional step, holds execution until Tier 2 approves
Executor: runs steps, captures before-state, tracks per-step result
Audit:    writes complete record — who, what, before, after, timestamp
```

---

## How They Compose

### Example: Name Change

```
Tech initiates "Name Change" workflow for Jane Doe

1. Planner evaluates:
   - Identity: HybridIdentityProvider
   - Exchange SOA: ExchangeSOA.CLOUD (IsExchangeCloudManaged=True)
   - Steps that apply: AD write, Exchange Online write (skip on-prem steps)

2. Preview shown:
   AD:              sn Doe→Smith, displayName Jane Doe→Jane Smith,
                    cn Jane Doe→Jane Smith, mail jdoe@→jsmith@
   Exchange Online: Primary SMTP jdoe@→jsmith@, alias jdoe@ preserved

3. Tech confirms

4. Executor:
   Step 1: ADIdentityProvider.write(sn, displayName, cn, mail) → ✓
   Step 2: ExchangeOnlineProvider.update_primary_smtp() → ✓
   Step 3: ExchangeOnlineProvider.add_alias(old address) → ✓

5. Audit: complete record written to tenant audit.db
```

### Example: Device Offboarding

```
Tech initiates "Offboard Device" for DESKTOP-ABC123

1. Planner evaluates:
   - Device lookup across all configured plugins
   - Builds DeviceIdentityMap:
     intune_id: "abc-123"
     autopilot_id: "xyz-456"
     entra_device_id: "def-789"
     plugins: { sophos: "ep-111", umbrella: not_found, anydesk: "123456" }

2. Preview shown:
   Required:  Retire Intune ✓, Remove Autopilot ✓, Delete Entra device ✓
   Optional:  Remove Sophos ✓, Remove AnyDesk ✓
   Not found: Cisco Umbrella (may have been removed already)

3. Tech confirms

4. Executor (ordered):
   Intune retire → required, stop if fails
   Autopilot remove → required, depends on Intune success
   Entra device delete → required
   Sophos remove → optional, warn if fails, continue
   AnyDesk remove → optional, warn if fails, continue

5. Audit: per-step result logged
```

---

## Community Library Structure

```
github.com/persona-community/
    ├── workflows/
    │     ├── schema/workflow-v1.schema.json
    │     ├── identity/
    │     │     ├── name-change-standard.yaml
    │     │     ├── onboarding-standard.yaml
    │     │     └── offboarding-standard.yaml
    │     ├── hr/
    │     │     └── department-transfer.yaml
    │     └── devices/
    │           ├── device-offboard-standard.yaml
    │           └── device-transfer.yaml
    │
    ├── rules/
    │     ├── schema/rule-v1.schema.json
    │     ├── licensing/
    │     │     ├── teams-phone-format.yaml
    │     │     └── exchange-email-field.yaml
    │     ├── account-hygiene/
    │     │     └── stale-account-policy.yaml
    │     └── group-hygiene/
    │           └── empty-group-policy.yaml
    │
    ├── reports/
    │     ├── schema/report-v1.schema.json
    │     ├── population/
    │     │     └── user-population-summary.yaml
    │     ├── licensing/
    │     │     └── license-assignment.yaml
    │     └── compliance/
    │           └── sox-user-access.yaml
    │
    └── integrations/
          ├── sophos-central/
          ├── cisco-umbrella/
          ├── crowdstrike/
          ├── anydesk/
          └── jamf/
```

---

## Writing a Community Workflow

Minimal valid workflow:

```yaml
name: Example Workflow
version: 1.0.0
description: What this does and when to use it
author: your-github-handle
target: user  # or: device

requires:
  identity_providers:
    - active_directory  # required
  service_providers:
    - exchange_online   # optional — steps conditioned on this skip if absent

inputs:
  - id: example_input
    label: Human-readable label
    type: string  # string | boolean | enum | user_lookup | device_lookup
    required: true

steps:
  - id: step_one
    type: ad_write
    label: What this step does
    condition: "{{ some_condition }}"    # optional Jinja2
    required: true
    on_failure: stop  # stop | warn | skip
    attributes:
      attributeName: "{{ inputs.example_input }}"
    rollback:
      restore_previous_values: true

audit:
  log_level: full
  include_before_after: true
  retention_days: 365
```

## Writing a Community Rule

```yaml
name: Example Policy Rule
version: 1.0.0
description: What this rule enforces
author: your-github-handle

scope:
  all_enabled_ad_users: true  # or: ou | group | license_sku

conditions:
  - id: condition_id
    when:
      field: licenses
      operator: contains
      value: "Some License SKU"
    expect:
      someAttribute:
        not_blank: true
        matches_pattern: '^\(\d{3}\) \d{3}-\d{4}$'
    violation_message: >
      Clear description of what is wrong and how to fix it.

remediation:
  allow_manual: true
  allow_bulk: true
  allow_auto: false
  guidance: >
    Step-by-step guidance for the help desk tech.
```
