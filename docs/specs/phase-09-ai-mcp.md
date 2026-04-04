# Spec: Phase 9 — AI Assistant + MCP Server

**Status:** Planned | **Version target:** 1.0.0
**Depends on:** Phase 6 complete (good data foundation)

---

## AI Assistant (Built-In)

### Configuration
API key configured per tenant in Settings → AI.
Model: claude-sonnet (configurable, defaults to latest Sonnet).
Key stored encrypted in data/tenants/{id}/config.json.

### Context Injection
Every AI message includes (no secrets, no raw credentials):

```python
ai_context = {
    "current_user": UnifiedUser.dict(exclude_secrets=True),
    "exchange_soa": str(exchange_soa),
    "audit_history": last_30_days_audit_for_user,
    "rule_violations": current_violations_for_user,
    "group_memberships": user_groups,
    "tenant_config_summary": {
        "identity_provider": "hybrid",
        "exchange_provider": "online",
        "plugins_enabled": ["sophos-central", "anydesk"],
    },
    "tech_role": tech.role,
}
```

### Guardrails — Hard Limits

```python
AI_CANNOT = [
    "execute any write operation directly",
    "access data outside tech's tenant",
    "see data tech's role cannot see",
    "see credentials or secrets from config",
    "be instructed to bypass Persona's permission model",
    "be used as a jailbreak vector for any Persona system",
]

AI_CAN = [
    "answer questions about directory data in context",
    "explain why something might be happening",
    "suggest what to check or do next",
    "summarize audit history",
    "identify patterns in lockouts, group changes, etc.",
    "draft ticket notes based on the current user's state",
    "explain what a workflow will do before the tech runs it",
    "suggest which rule violations to prioritize and why",
]
```

### UI — Chat Panel

```
AI Assistant — Jane Smith context         [×]
──────────────────────────────────────────
AI  Looking at Jane's account, I can see
    she's been locked out 8 times this
    month. Want me to analyze the pattern?

You  Yes, also check if she has scheduled
     tasks or mapped drives.

AI  [Checking audit history...]

    Found a likely cause: Jane is a member
    of "Scheduled Task Accounts" group.
    Her password changed 32 days ago —
    there are likely services or scheduled
    tasks still using the old credential.

    Suggested next steps:
    1. Check FILESERVER01 for scheduled
       tasks running as jsmith
    2. Check for mapped drives on her
       workstations
    3. After fixing, run Account Unlock

[Ask anything about Jane Smith...]
```

---

## MCP Server

Exposes Persona as an MCP server for use with Claude Desktop,
Claude.ai Projects, or any MCP-compatible client.

### Authentication
MCP tokens are issued per-tenant with a specific role.
Generated in Settings → Integrations → MCP Access.
Scoped — a Contoso MCP token cannot access Fabrikam data.

### MCP Tools

```python
# Read tools (no confirmation needed)
persona_get_user(username: str) -> UnifiedUser
persona_search_users(query: str, limit: int) -> list[UserSummary]
persona_get_user_groups(username: str) -> list[Group]
persona_get_audit_log(username: str, days: int) -> list[AuditEntry]
persona_get_rule_violations(rule_id: str | None) -> list[Violation]
persona_run_report(report_id: str) -> ReportResult
persona_get_device(identifier: str) -> Device | None
persona_get_tenant_health() -> TenantHealth  # operator scope only

# Action tools (confirmation required before execution)
persona_run_workflow(
    workflow_id: str,
    target: str,
    inputs: dict,
    confirmation_token: str  # must be obtained via separate confirm call
) -> WorkflowResult
```

### MSP Morning Briefing (Example)

```
Operator opens Claude Desktop
Connected to Persona MCP (operator scope)

"Give me a morning briefing across all clients"

Claude: [calls persona_get_tenant_health for each client]

"Morning briefing — 12 clients:

🔴 Needs attention:
   Adventure Works — AD unreachable since 6:14 AM
   Contoso — 3 simultaneous lockouts (possible credential stuffing)

🟡 Review today:
   Fabrikam — 47 rule violations, up from 12 last week

🟢 All clear: 9 other clients"
```

---

## Acceptance Criteria

- [ ] AI API key configured per tenant, stored encrypted
- [ ] AI chat panel opens in context of current user/device view
- [ ] Context injected correctly — no secrets, no excess data
- [ ] AI cannot trigger write operations directly
- [ ] AI respects tech's role — cannot surface data the role cannot see
- [ ] MCP server starts and accepts connections
- [ ] MCP read tools return correct tenant-scoped data
- [ ] MCP action tools require confirmation token
- [ ] MCP tokens are tenant-scoped (cannot cross tenants)
- [ ] Operator MCP scope returns aggregate health only (no tenant data)
