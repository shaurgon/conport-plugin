# Integrating ConPort into an agent system

Copy the blocks below into the corresponding agent-system files
(`AGENTS.md`, `HEARTBEAT.md`, or whatever your platform calls them).
They are platform-neutral — works for Paperclip, Hermes, OpenClaw and any
similar agent framework.

---

## Block for `AGENTS.md` → "Memory Rules" section

```markdown
## Memory Rules

ConPort is your single memory system. All memory flows through `agent_remember` / `agent_recall`.
Full reference: see the `conport-agent` skill (`SKILL.md` + `references/memory-types.md`).

### ⛔ NEVER store
- **Secrets, passwords, API keys, tokens** — even partial ones.
- When you need to reference them, store the env var name instead:
  Bad: `"API key: 0a732108..."` → Good: `"API key is in $API_KEY env var"`

### Quality: extract the insight, not the story
- Bad: `"Task 107 completed: added skill to 7 agents via sync endpoint"`
- Good: `"desiredSkills defaults to null for new agents — must call POST /api/agents/{id}/skills/sync"`

### Pick the right type + category

| When… | type | category |
|---|---|---|
| Environment quirk | `fact` | `resource` |
| User/orchestrator correction | `feedback` | `area` |
| Reusable approach | `pattern` | `resource` |
| Session log / daily event | `note` | `project` |
| Stable user preference | `tacit` | `area` |

### Automatic server-side behaviour (no action needed)
- **Dedup** — similar memories are superseded on write (cosine ≥ 0.85).
- **Decay** — recent + frequently accessed memories rank higher in `agent_recall`.
- **Supersede** — `agent_forget` marks items as superseded by default, not deleted.
```

---

## Block for `HEARTBEAT.md`

Every agent platform has a heartbeat / tick loop. The first heartbeat of
a session MUST initialise the agent memory; later heartbeats can use
`agent_reflect` to housekeep.

```markdown
## 1. ConPort Agent (MANDATORY)

**First action** after identifying yourself: `agent_init({ uuid: "<AGENT_UUID>", name: "<YOUR_DISPLAY_NAME>" })`

Resolve `<AGENT_UUID>` via (in order):
1. `CONPORT_AGENT_UUID` env var
2. Platform-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`, `OPENCLAW_AGENT_ID`, …)
3. Fallback: a stable role-derived slug like `ceo@acme` or `builder@repo-name`

Then, as needed:
- `agent_recall` — fetch relevant memories before a task
- `agent_remember` — persist new facts as you learn them

---

## 2. Fact extraction (per heartbeat)

1. Check for new conversation turns since the last extraction.
2. Extract durable facts into the appropriate entity (see `conport-agent` skill).
3. Append timeline entries to the agent's local session log (if your platform keeps one).
4. Update access metadata (timestamp, access count) for any memories you used.

---

## 3. Cadence

| Every | Call |
|---|---|
| Heartbeat | `agent_reflect({ scope: "day" })` — surface promotable notes |
| Daily | Review the `day` reflection; promote valuable notes to `fact`/`pattern` |
| Weekly (e.g. Monday) | `agent_reflect({ scope: "week" })` — cleanup & synthesis; `agent_forget` for cold items that are no longer relevant |
```
