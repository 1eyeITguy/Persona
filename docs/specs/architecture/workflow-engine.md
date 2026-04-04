# Architecture: Workflow Engine

---

## Overview

The workflow engine executes coordinated sequences of identity operations
across multiple providers. Workflows are YAML-defined, preview-first,
rollback-capable, and fully audit-logged.

---

## Execution Pipeline

```
YAML Definition
    │
    ▼
Parser
    Validates YAML against schema
    Resolves inputs and Jinja2 templates
    │
    ▼
Planner
    Evaluates which steps apply to this target
    Checks provider/plugin availability
    Generates ordered execution plan
    Captures before-state for rollback
    │
    ▼
Preview (shown to tech — required)
    "Here is exactly what will happen"
    Tech reads and confirms
    │
    ▼
Approval Gate (if configured)
    Request held — nothing changes
    Approver notified
    Approver confirms or denies
    │
    ▼
Executor
    Runs steps in dependency order
    Tracks result per step
    Captures after-state per step
    │
    ▼
Rollback Manager (on failure)
    Identifies completed steps
    Unwinds in reverse order
    Reports what was and was not rolled back
    │
    ▼
Audit Logger
    Writes complete record to tenant audit.db
    Immutable — cannot be modified or deleted
```

---

## YAML Schema

```yaml
# Required fields
name: string              # Human-readable workflow name
version: string           # semver: "1.0.0"
description: string       # What this workflow does and when to use it
target: user | device     # What kind of object this operates on

# Optional metadata
author: string            # GitHub handle or org
tags: [string]            # For library search/filter

# Provider requirements
requires:
  identity_providers:
    - active_directory    # "required" — workflow not available without this
    - entra_id            # "optional" — steps conditioned on this skip if absent
  service_providers:
    - exchange_online
  plugins:
    - sophos-central

# Input definitions
inputs:
  - id: string            # referenced in steps as {{ inputs.id }}
    label: string         # shown in the run dialog
    type: string          # string|boolean|enum|integer|
                          # user_lookup|device_lookup|group_lookup
    required: bool
    default: any          # optional default value
    options: [string]     # for enum type
    warning: string       # shown in UI if this input is enabled
    help_text: string     # shown below the field

# Step definitions
steps:
  - id: string            # unique within workflow
    type: string          # see Step Types below
    label: string         # shown in preview and execution status
    description: string   # optional detail shown in preview

    # Execution control
    condition: string     # Jinja2 expression — skip step if false
    required: bool        # false = warn on failure, true = stop on failure
    on_failure: stop|warn|skip
    depends_on: [string]  # step IDs that must complete first

    # Rollback
    rollback:
      restore_previous_values: bool  # capture before-state and restore on failure
      custom_action: string          # optional custom rollback step type

    # Type-specific fields (see step types)
    ...

# Audit configuration
audit:
  log_level: full|summary
  include_before_after: bool
  retention_days: integer
```

---

## Step Types

### ad_write
Write attributes to Active Directory via LDAP.

```yaml
- id: update_display_name
  type: ad_write
  label: Update display name in AD
  attributes:
    displayName: "{{ inputs.new_first_name }} {{ inputs.new_last_name }}"
    cn: "{{ inputs.new_first_name }} {{ inputs.new_last_name }}"
    sn: "{{ inputs.new_last_name }}"
  rollback:
    restore_previous_values: true
```

### graph_api
Call Microsoft Graph API.

```yaml
- id: update_primary_smtp
  type: graph_api
  label: Update primary email in Exchange Online
  action: update_user
  payload:
    mail: "{{ computed.new_email }}"
  rollback:
    restore_previous_values: true
```

### exchange_write
Write to Exchange (SOA-resolved — routes to online or on-prem automatically).

```yaml
- id: preserve_alias
  type: exchange_write
  label: Preserve old email as alias
  action: add_proxy_address
  value: "smtp:{{ user.current_mail }}"  # lowercase = secondary alias
```

### intune_api
Call Intune/Autopilot API.

```yaml
- id: retire_intune
  type: intune_api
  label: Retire device from Intune
  action: retire_device
  target_id: "{{ device.intune_device_id }}"
  required: true
  on_failure: stop
```

### plugin
Call an integration plugin.

```yaml
- id: remove_sophos
  type: plugin
  plugin_id: sophos-central
  label: Remove from Sophos Central
  action: offboard_device
  required: false
  on_failure: warn
```

### notification
Send a notification (email, Teams, Slack).

```yaml
- id: notify_user
  type: notification
  label: Notify user of name change
  channel: email
  to: "{{ user.mail }}"
  template: name-change-complete
  optional: true
```

### approval_gate
Hold execution pending Tier 2 approval.

```yaml
- id: require_approval
  type: approval_gate
  label: Requires Tier 2 approval
  approver_role: helpdesk_tier2
  reason_required: true
  timeout_hours: 24  # auto-deny after 24 hours if no response
```

---

## Jinja2 Context

Available in all condition and value expressions:

```python
context = {
    "user": UnifiedUser,        # target user object
    "device": Device | None,    # target device object
    "inputs": dict,             # tech-supplied inputs
    "computed": dict,           # values computed by previous steps
    "org": OrgConfig,           # tenant org config
    "tenant": TenantInfo,       # tenant metadata
    "tech": TechUser,           # logged-in tech identity
    "providers": {
        "ad_available": bool,
        "entra_available": bool,
        "exchange_soa": ExchangeSOA,
    },
    "plugins": {
        "sophos-central": {"available": bool},
        ...
    },
}
```

---

## Preview Format

Shown to tech before confirmation. Never skippable.

```
Name Change Workflow — Jane Doe (jdoe)

The following changes will be made:

  Active Directory
  ✓ displayName    Jane Doe → Jane Smith
  ✓ cn             Jane Doe → Jane Smith
  ✓ sn             Doe → Smith
  ✓ mail           jdoe@contoso.com → jsmith@contoso.com
  ✓ initials       JD → JS

  Exchange Online
  ✓ Primary SMTP   SMTP:jdoe@contoso.com → SMTP:jsmith@contoso.com
  ✓ Keep as alias  smtp:jdoe@contoso.com (old email preserved)

  ℹ  Not applicable (skipped):
     Exchange On-Prem — mailbox is in Exchange Online

  ⚠  Note:
     Email signature will need to be updated by the user.
     Teams display name cache may take up to 24 hours to update.

[Cancel]  [Confirm and Run]
```

---

## Execution Status

Shown in real-time during execution.

```
Executing Name Change — Jane Doe

✓  Update AD attributes          (0.3s)
✓  Update primary SMTP           (1.2s)
✓  Preserve email alias          (0.8s)
✗  Send notification email       Failed — SMTP not configured
   [Mark as acknowledged]

Workflow complete with 1 warning.
All critical steps succeeded.
[View Audit Record]
```

---

## Audit Record Structure

```python
class WorkflowAuditRecord(Base):
    __tablename__ = "workflow_executions"

    id: UUID
    tenant_id: UUID
    workflow_id: str
    workflow_version: str
    target_type: str          # "user"|"device"
    target_id: str            # DN or device ID
    target_display_name: str
    tech_id: UUID
    tech_display_name: str
    started_at: datetime
    completed_at: datetime
    status: str               # "success"|"partial"|"failed"|"rolled_back"
    inputs: dict              # JSON — what the tech entered
    steps: list[StepRecord]   # per-step results with before/after
    approval_chain: list      # approver identity + decision if applicable
```
