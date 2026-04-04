# Spec: Phase 4 — Write Operations

**Status:** Planned | **Version target:** 0.5.0
**Depends on:** Phase 2 complete

---

## Principles

Every write operation follows this pipeline without exception:

```
Initiate → Preview (what will change) → [Approval?] → Confirm → Execute → Audit
```

No write operation skips preview. No write operation skips audit logging.

---

## Account Operations

### Password Reset
- Tier 1: can reset, password expires on next login (default)
- Tier 2: can set specific password, control expiry flag
- Both: require confirmation, audit logged
- Never: log the new password

### Account Unlock
- Available to Tier 1 (no approval needed)
- Clears lockoutTime in AD
- Audit logged with before lockoutTime value

### Enable / Disable Account
- Tier 1: can disable (with confirmation)
- Tier 2: can enable or disable
- Modifies userAccountControl flag
- Audit logs the flag change with reason field

### Update Attributes
- Tier 1: telephone, mobile only
- Tier 2: telephone, mobile, title, department, company
- Never: mail (handled by name change workflow), UPN, sAMAccountName
- All changes audit logged with before/after

---

## Group Membership Writes

### Add to Group
- Tier 1: non-privileged groups only, requires Tier 2 approval
- Tier 2: non-privileged groups, no approval needed
- Neither: privileged groups (Domain Admins, etc.)
- Privileged groups: defined in tenant config, default list included

### Remove from Group
- Same tier rules as add
- Preview shows what access the user will lose

### Copy Group Membership
- Select source user → diff shown → select which to copy → preview → execute
- See ROADMAP.md Phase 2 for read part (Phase 4 adds the write)

### Import from CSV
- Upload → validate each row → preview → confirm → execute
- Validation: group exists? user already member? group is editable?
- Invalid rows shown clearly — do not execute partial imports silently

---

## Approval Workflow

```python
class ApprovalConfig:
    # Actions that always require approval
    always_requires_approval: list[str] = [
        "add_to_group",
        "issue_tap",
        "laps_retrieval",
        "bitlocker_retrieval",
    ]
    # Actions that require approval only for Tier 1
    tier1_requires_approval: list[str] = [
        "disable_account",
        "update_attributes",
    ]
    # Configured per-tenant in Settings
```

Approval flow:
1. Tier 1 initiates action → held with status "Pending Approval"
2. All Tier 2 techs for this tenant notified
3. Any Tier 2 can approve or deny with reason
4. On approval: action executes immediately
5. On denial: action cancelled, Tier 1 notified with reason
6. Auto-deny after configured timeout (default: 24 hours)
7. Full approval chain in audit log

---

## Privileged Group Protection

```python
DEFAULT_PRIVILEGED_GROUPS = [
    "Domain Admins",
    "Enterprise Admins",
    "Schema Admins",
    "Group Policy Creator Owners",
    "Backup Operators",
    "Account Operators",
    "Server Operators",
    "Print Operators",
]
# Configurable per-tenant — org can add more
```

Behavior:
- Privileged groups visible in group list (transparency)
- Checkbox visible but disabled for Tier 1
- Tier 2 can see but cannot add via Persona (by default)
- Can be configured to allow Tier 2 with operator approval
- Attempting to add via API directly returns 403 with clear message

---

## Audit Log

```python
class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: UUID
    tenant_id: UUID
    timestamp: datetime
    tech_id: UUID
    tech_display_name: str
    tech_role: str
    action_type: str         # "password_reset"|"account_unlock"|...
    target_type: str         # "user"|"group"|"device"
    target_dn: str
    target_display_name: str
    before_state: JSON       # attribute values before change
    after_state: JSON        # attribute values after change (no passwords)
    approval_required: bool
    approver_id: UUID | None
    approver_display_name: str | None
    approval_reason: str | None
    status: str              # "success"|"failed"|"rolled_back"
    error_detail: str | None
```

Audit log is append-only. No record can be modified or deleted.
Tier 1 can view their own actions. Tier 2 can view all tenant actions.
Operator can view action counts (no data) across tenants.

---

## Acceptance Criteria

- [ ] Every write operation shows preview before confirmation
- [ ] Every write operation creates audit log entry
- [ ] Tier 1 cannot write without Tier 2 approval where configured
- [ ] Privileged groups cannot be modified by Tier 1 (403)
- [ ] Password reset does not log the new password anywhere
- [ ] Account unlock correctly clears lockoutTime
- [ ] Group copy shows side-by-side diff before executing
- [ ] CSV import validates all rows before executing any
- [ ] Approval notification sent to all eligible approvers
- [ ] Auto-deny executes after configured timeout
- [ ] Audit log is immutable from HD role
