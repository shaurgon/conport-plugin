# Integrating ConPort into an agent system (v5.0.0+)

Copy the blocks below into the corresponding agent-system files
(`AGENTS.md`, `HEARTBEAT.md`, or whatever your platform calls them).
Platform-neutral — works for Paperclip, Hermes, OpenClaw and any
similar agent framework.

---

## Block for `AGENTS.md` → "Memory Rules" section

```markdown
## Memory Rules

ConPort is your single memory system. Memory is **tree-structured**:
trunk roots (identity / principles / person_knowledge) anchor agent
identity; branches accumulate episodic experience; gravity consolidates
nodes and crystallizes skills over time.

Full reference: the `conport-agent` skill (`SKILL.md` +
`references/tools.md`).

### ⛔ NEVER store
- **Secrets, passwords, API keys, tokens** — even partial ones.
- Store the env var name instead:
  Bad: `"API key: 0a732108..."` → Good: `"API key is in $API_KEY env var"`

### Quality: extract the insight, not the story
- Bad: `"Task 107 completed: added skill to 7 agents via sync endpoint"`
- Good: `"desiredSkills defaults to null for new agents — must call POST /api/agents/{id}/skills/sync"`

### Just call agent_remember — routing is automatic

Don't classify upfront. `agent_remember(content)` runs argmax similarity
routing and attaches the new node next to its semantic neighbours, or
opens a new top-level branch if nothing is close enough. The response
tells you what happened via `routing.decision`:

- `linear` — attached silently to the nearest node.
- `uncertain` — attached but the routing is ambiguous; alternatives
  are returned so you can re-call with an explicit `parent_id` if the
  routing was wrong.
- `new_branch` — opened a new top-level branch under `trunk_root`.

`gravity_signal=true` in the response means the parent has accumulated
enough children that a consolidation pass is overdue. Call
`agent_reflect(parent_node_id)` when it fits the flow.

### decision-692: backend does not think for you

Backend is bookkeeping. When it detects a lift candidate / promotion
conflict / re-crystallization opportunity, it surfaces the situation
and waits. **You** synthesise the merged content and pass it back via
`agent_confirm_lift` / `agent_resolve_promotion_conflict` /
`agent_complete_re_crystallization`.

### Automatic server-side behaviour (no action needed)

- **Routing on write** — argmax similarity decides parent/branch.
- **Counter maintenance** — direct_children_count, content_hash,
  depth, etc. via triggers.
- **Recall scoring** — composite (similarity + recall_factor +
  foundational_boost). Top-K hits bump recall_count_7d.
- **Nightly recall decay** — sliding-window approximation.
- **Weekly lift scan** — emits `agent_lift_candidate` rows for review.
- **Weekly promotion check** — auto-promotes or marks `conflict_held`.
```

---

## Block for `HEARTBEAT.md`

Every agent platform has a heartbeat / tick loop. The first heartbeat
of a session MUST initialise the agent memory; later heartbeats can
call `agent_reflect` and review pending counts.

```markdown
## 1. ConPort Agent (MANDATORY)

**First action** after identifying yourself:
`agent_init({ uuid: "<AGENT_UUID>", name: "<YOUR_DISPLAY_NAME>" })`

Resolve `<AGENT_UUID>` via (in order):
1. `CONPORT_AGENT_UUID` env var
2. Platform-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`,
   `OPENCLAW_AGENT_ID`, …)
3. Fallback: a stable role-derived slug like `ceo@acme` or
   `builder@repo-name`

Use the init response payload:
- If `bootstrap_state='new'` — populate trunk via subsequent
  `agent_remember` calls (identity / principles / person facts).
- If `bootstrap_state='continuing'` — load `trunk_context` into your
  prompt prefix.
- If `pending_lift_candidates > 0` or `pending_promotion_conflicts > 0`
  — review when convenient via the respective `agent_review_*` tools.

Then, as needed:
- `agent_recall(query, scope_root_id?)` — fetch relevant context.
  Pass `scope_root_id=identity_root_id` for identity-only,
  `branch_origin_id` for one branch's subtree, etc.
- `agent_remember(content)` — persist new facts.

---

## 2. Cadence

| Every | Action |
|---|---|
| Heartbeat | If a `gravity_signal=true` response surfaced in a recent `agent_remember`, call `agent_reflect(parent_node_id)`. |
| Daily | Review `agent_review_re_crystallization()` if you're maintaining skills — fold accumulated notes into a new version via `agent_complete_re_crystallization`. |
| Weekly | Review `agent_review_lift_candidates()` and `agent_review_promotion_conflicts()`. Synthesise content and resolve. |
```
