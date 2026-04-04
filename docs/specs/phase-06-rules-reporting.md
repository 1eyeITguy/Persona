# Spec: Phase 6 — Rules Engine + Reporting

**Status:** Planned | **Version target:** 0.7.0
**Depends on:** Phase 5 complete

---

## Rules Engine

### Implementation
```
backend/rules/
    ├── parser.py        ← YAML → RuleDefinition
    ├── scanner.py       ← evaluate all users against all rules
    ├── scheduler.py     ← run scans on schedule
    └── library/         ← built-in rule YAML files
```

### Scan Schedule
Configurable per tenant. Default: daily at 6 AM.
Manual scan trigger available from Rules dashboard.
Scan results cached — dashboard loads instantly.

### Violation Dashboard
```
Policy Compliance — Last scan: Today 6:00 AM  [Scan Now]

┌────────────────────────────────┬────────┬────────┬──────────┐
│ Rule                           │ Scope  │ Pass   │ Violations│
├────────────────────────────────┼────────┼────────┼──────────┤
│ Teams Phone Format             │ 847    │ 821    │ 26  ⚠   │
│ AD Email Field Policy          │ 847    │ 843    │ 4   ⚠   │
│ Stale Account Policy (90d)     │ 847    │ 801    │ 46  ⚠   │
│ Privileged Group Review        │ 12     │ 12     │ 0   ✓   │
└────────────────────────────────┴────────┴────────┴──────────┘
```

Clicking violation count → list of affected users → guided fix per user.

### Built-In Rules
- Teams Phone license → telephoneNumber required in (xxx) xxx-xxxx format
- Exchange Online license → mail attribute required and non-empty
- Disabled accounts with active licenses (waste)
- Accounts not logged in for 90 days
- Password last set > 365 days (if password expiry not enforced)

---

## Reporting Engine

### Implementation
```
backend/reports/
    ├── engine.py        ← execute report definition against data
    ├── scheduler.py     ← run reports on schedule
    └── library/         ← built-in report YAML files
```

### Built-In Reports
- User Population Summary (AD / Entra-only / hybrid / disabled totals)
- License Assignment (per SKU, unused licenses, licenses on disabled accounts)
- Exchange Status (cloud / on-prem / no mailbox breakdown)
- Group Inventory (empty groups, single-member, privileged members)
- Stale Accounts (no login in configurable N days)
- Password Age Distribution
- Accounts Expiring in 30 Days
- MFA Registration Status (requires Entra connected)

### Custom Report Builder
Filter conditions (AND/OR), column selector, sort, export.
Saved reports appear in sidebar.
Report history: compare this week vs last week.

### Alerting
Webhook delivery to Teams or Slack.
Built-in alert triggers:
- Privileged group membership change
- N accounts locked out within M minutes (credential stuffing detection)
- Service account password changed outside Settings
- Account created outside onboarding workflow

---

## Acceptance Criteria

- [ ] Rules scan runs on schedule without manual intervention
- [ ] Violations correctly identified for built-in rules
- [ ] Violation drill-down shows affected users with guidance
- [ ] Guided fix links to correct remediation workflow
- [ ] Built-in reports return accurate data
- [ ] Custom report builder produces correct results
- [ ] Report export produces valid CSV
- [ ] Alert fires when privileged group membership changes
- [ ] Teams/Slack webhook delivers alert within 60 seconds of trigger
