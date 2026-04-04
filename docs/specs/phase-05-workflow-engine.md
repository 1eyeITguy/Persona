# Spec: Phase 5 — Workflow Engine

**Status:** Planned | **Version target:** 0.6.0
**Depends on:** Phase 4 complete

---

## Objectives

Replace ad-hoc write operations with a declarative, auditable, community-extensible
workflow engine. All Phase 4 write operations are migrated to workflows.

---

## Engine Implementation

See docs/specs/architecture/workflow-engine.md for full schema and pipeline.

### New Files
```
backend/workflows/
    ├── parser.py         ← YAML → WorkflowDefinition
    ├── planner.py        ← plan steps for specific target
    ├── executor.py       ← run steps, track results
    ├── rollback.py       ← capture before-state, undo on failure
    └── library/          ← built-in workflow YAML files
          ├── name-change-standard.yaml
          ├── onboarding-standard.yaml
          └── offboarding-standard.yaml
```

---

## Built-In Workflows

### Name Change
Key requirements:
- Updates sn, displayName, cn, initials
- Updates mail and UPN if they follow a name pattern
- Exchange Online: updates primary SMTP, preserves old as alias
- Alias preservation is NOT optional for Tier 1
- sAMAccountName change: optional input with prominent warning
- Does NOT ask why the name is changing — neutral

### Employee Onboarding
Creates user in AD, assigns groups, assigns license, sends welcome notification.
Highly customizable — organizations expected to fork and modify.
Default template: creates account, adds to base groups, creates mailbox.

### Employee Offboarding
Disables AD account, removes licenses, sets OOO message, hides from GAL,
archives mailbox (if configured), removes from groups, revokes Entra tokens.
Configurable retention period before account deletion.

---

## Workflow Library UI

```
Workflows

Installed (3)
─────────────────────────────────────────────────────────
Name Change (Standard)    v1.2  built-in  [Run] [Edit] [History]
Employee Onboarding       v2.0  local     [Run] [Edit] [History]
Employee Offboarding      v1.5  built-in  [Run] [Edit] [History]

[+ Import Workflow]  [Browse Community Library →]
```

Run dialog: collects inputs → shows preview → requires confirmation.
History: shows all executions of this workflow with status and tech.

---

## Acceptance Criteria

- [ ] YAML parser validates against schema, rejects invalid workflows
- [ ] Preview generated before any step executes
- [ ] Jinja2 conditions evaluated correctly (step skipped if false)
- [ ] Failed required step stops execution (on_failure: stop)
- [ ] Failed optional step logs warning, continues (on_failure: warn)
- [ ] Rollback triggered on required step failure
- [ ] Rollback successfully restores before-state
- [ ] Partial failure (rollback fails) surfaced clearly — never hidden
- [ ] Every execution creates complete audit record
- [ ] Name change: alias preserved by default, cannot be disabled by Tier 1
- [ ] Name change: sAMAccountName change shows prominent warning
- [ ] Community workflow imported from file, validated against schema
