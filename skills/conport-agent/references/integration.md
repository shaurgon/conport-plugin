# Integrating ConPort into an agent system (v6.0.0+)

Copy the blocks below into the corresponding agent-system files
(`AGENTS.md`, `HEARTBEAT.md`, or whatever your platform calls them).
Platform-neutral — works for Paperclip, Hermes, OpenClaw and any
similar agent framework.

---

## Block for `AGENTS.md` → "Memory Rules" section

```markdown
## Memory Rules

ConPort is your single memory system. Memory is a **sphere graph**:
typed nodes (identity / principle / fact / observation / skill /
artifact) connected via typed edges (semantic / derived_from / temporal
/ skill_of / competing_view / supersedes). No tree, no branches.
Topics emerge via edge density; skills crystallize from stable
communities — you decide when to promote.

Full reference: the `conport-agent` skill (`SKILL.md` +
`references/tools.md`).

### NEVER store
- **Secrets, passwords, API keys, tokens** — even partial ones.
- Store the env var name instead:
  Bad: `"API key: 0a732108..."` → Good: `"API key is in $API_KEY env var"`

### Quality: extract the insight, not the story
- Bad: `"Task 107 completed: added skill to 7 agents via sync endpoint"`
- Good: `"desiredSkills defaults to null for new agents — must call POST /api/agents/{id}/skills/sync"`

### Writing memory

Two paths:
1. **Chat buffer:** `agent_chat_turn(role, text)` → when
   `extraction_signal` fires → `agent_extract_thread(message_ids)`.
   The LLM extracts typed nodes + edges automatically.
2. **Direct write:** `agent_remember_v3(meta_type, content, edges?)`.
   Use when you already know what to record.

Write atomic nodes. Edge density creates structure, not pre-organization.

### decision-692: backend does not think for you

Backend is bookkeeping. When it detects mature communities (skill
candidates) or borderline nodes (ambiguous membership), it surfaces
hints in `agent_init_v3`. **You** decide what to promote, merge, or
ignore.
```

---

## Block for `HEARTBEAT.md`

Every agent platform has a heartbeat / tick loop. The first heartbeat
of a session MUST initialise the agent memory.

```markdown
## 1. ConPort Agent (MANDATORY)

**First action** after identifying yourself:
`agent_init_v3({ uuid: "<AGENT_UUID>", name: "<YOUR_DISPLAY_NAME>" })`

Resolve `<AGENT_UUID>` via (in order):
1. `CONPORT_AGENT_UUID` env var
2. Platform-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`,
   `OPENCLAW_AGENT_ID`, …)
3. Fallback: a stable role-derived slug

Use the init response payload:
- If `bootstrap_state='new'` — write identity + principles via
  `agent_remember_v3(meta_type='identity'|'principle', content=...)`.
- If `bootstrap_state='continuing'` — identity + principles +
  broadcast_facts are your context baseline.
- If `pending_extraction` is present — call `agent_extract_thread`
  with the listed message_ids before anything else.
- If `mature_communities` is non-empty — review and decide whether
  to promote via `agent_promote_skill`.

Then, as needed:
- `agent_recall_v3(query, scope?)` — fetch relevant context.
- `agent_remember_v3(meta_type, content, edges?)` — persist new facts.
- `agent_chat_turn(role, text)` — record conversational turns.

---

## 2. Cadence

| Every | Action |
|---|---|
| Turn (chat harness) | `agent_chat_turn` per message; `agent_extract_thread` when `extraction_signal` fires. |
| As facts arrive (code harness) | `agent_remember_v3` with relevant `meta_type` and edges. |
| Session start | Review `mature_communities` and `borderline_nodes` from init. |
```
