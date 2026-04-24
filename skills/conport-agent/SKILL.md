---
name: conport-agent
description: Use when managing agent identity, persistent memory, and project attachments in multi-agent systems. Must run agent_init at session start.
metadata:
  version: 3.0.1
---

# ConPort Agent — Persistent Memory & Identity

> ConPort is your **single memory system**. Identity, PARA-organized memory, decay scoring, auto-dedup, reflection.
> Without `agent_init` — no memory. Without `agent_recall` — you answer blindly.

For tool reference see [references/tools.md](./references/tools.md).
For memory types and PARA categories see [references/memory-types.md](./references/memory-types.md).
For embedding these rules into your agent system (`AGENTS.md`, `HEARTBEAT.md`) see [references/integration.md](./references/integration.md).

### MCP Prefix

**Claude Code MCP prefix** is `mcp__conport__`

All tool names below are short forms. Prepend the prefix for your environment.

---

## FIRST ACTION

1. Resolve the **agent UUID** in this priority order:
   1. `CONPORT_AGENT_UUID` env var (preferred for any multi-agent system)
   2. A system-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`, `OPENCLAW_AGENT_ID`, etc. — whichever your platform injects)
   3. Fallback: a stable role-derived slug like `"ceo@acme"` or `"builder@repo-name"`
2. `agent_init({ uuid: "<resolved_uuid>", name: "<display name, e.g. CEO>" })`
3. `agent_attach_project({ agent_uuid: "<uuid>", project: "<name>" })` if applicable
4. Review `recent_memories`, `attached_projects`, `soul` from the init response

---

## MEMORY RULES

### ⛔ NEVER store
- **Secrets, passwords, API keys, tokens** — even partially
- Bad: `"API key: 0a732108..."` → Good: `"API key is in $API_KEY env var"`

### Quality
1. **Extract the insight, not the story.** Bad: "MEO-107 completed: Added skill to 7 agents" → Good: "desiredSkills defaults to null — must call POST /api/agents/{id}/skills/sync"
2. **Dedup is automatic.** Server supersedes similar memories (>0.85). Just write.
3. **Use the right type.** feedback/pattern are searchable by type. Don't dump everything as fact.
4. **Supersede outdated memories.** Bug fixed? Config changed? Call `agent_forget`.
5. **Pin critical decisions.** Use `pinned=true` for memories that should never decay.

### Choosing type + category

| What happened | type | category |
|---------------|------|----------|
| Environment quirk | `fact` | `resource` |
| User correction | `feedback` | `area` |
| Reusable approach | `pattern` | `resource` |
| Session log / daily event | `note` | `project` |
| User preference | `tacit` | `area` |
| Architecture choice | `decision` | `area` |

---

## WORKFLOW

| Trigger | Action |
|---------|--------|
| Session start | `agent_init` |
| Working on project X | `agent_attach_project` |
| Learned something reusable | `agent_remember` (fact/pattern/feedback + category) |
| End of session | `agent_remember` (type=note, category=project) |
| User corrected behavior | `agent_remember` (type=feedback, category=area) |
| Need past context | `agent_recall` BEFORE answering |
| Memory outdated | `agent_forget` |
| Important architectural decision | `agent_remember` (type=decision, pinned=true, category=area) |
| Link two related memories | `agent_link_memories` |
| End of day / heartbeat | `agent_reflect` (scope=day) |
| Weekly cleanup | `agent_reflect` (scope=week) |

---

## CHECKLIST

- [ ] `agent_init` done?
- [ ] Project attached?
- [ ] `agent_recall` before answering questions about past context?
- [ ] New learning saved with correct type + category?
- [ ] No secrets in memory content?
- [ ] `agent_reflect(scope=day)` at end of session?

---

*v3.0.1 | 7 tools | PARA categories | Decay | Auto-dedup | Reflection | Memory links*
