---
name: conport-agent
description: Use when managing agent identity and persistent memory in multi-agent systems. Must run agent_init at session start. Agent Memory v2 — tree-structured memory with gravity-driven consolidation and skill emergence.
metadata:
  version: 5.0.0
---

# ConPort Agent — Tree Memory & Skill Emergence (v2)

> ConPort is your **single memory system**. Tree-structured: trunk
> (identity / principles / person-knowledge) anchors agent identity;
> branches accumulate episodic experience; gravity consolidates and
> crystallizes skills over time.
>
> Without `agent_init` — no memory. Without `agent_recall` — you answer
> blindly.

For the full tool reference see [references/tools.md](./references/tools.md).
For embedding these rules in `AGENTS.md` / `HEARTBEAT.md` see
[references/integration.md](./references/integration.md).

### MCP Prefix

Tool names below are short forms. Prepend the prefix for your environment:

- **Claude Code:** `mcp__conport__`
- Other harnesses: see your MCP client config.

---

## FIRST ACTION

1. Resolve the **agent UUID**:
   1. `CONPORT_AGENT_UUID` env var (preferred), or
   2. A platform-specific env var (`PAPERCLIP_AGENT_ID`, `HERMES_AGENT_ID`,
      `OPENCLAW_AGENT_ID`), or
   3. A stable role-derived slug.
2. `agent_init({ uuid: "<resolved_uuid>", name: "<display name>" })`

The response shape is `AgentInitPayload`:

```
bootstrap_state           'new' or 'continuing'
trunk_root_id, identity_root_id, principles_root_id,
person_knowledge_root_id  reserved trunk-area roots (every agent has all 4)
current_active_node_id    where you "are" right now
trunk_context             content of the 4 reserved roots + child counts
active_branches           branches with branch_state='active' (top 20)
recently_crystallized_skills  top 5 by crystallized_at
pending_lift_candidates       count for agent_review_lift_candidates
pending_promotion_conflicts   count for agent_review_promotion_conflicts
```

`bootstrap_state='new'` → empty trunk; populate identity / principles
through subsequent `agent_remember` calls.
`continuing` → load trunk_context into your prompt prefix; use
`agent_recall` for the rest.

If `pending_lift_candidates > 0` or `pending_promotion_conflicts > 0`,
review them when convenient — they accumulate over weeks and resolution
is your job (backend never auto-merges; see decision-692 below).

---

## CORE MODEL

**Tree, not flat.** Memories form a tree per agent. The 4 reserved
trunk-area roots are anchors:

- `identity_root` — who you are
- `principles_root` — general rules and approaches
- `person_knowledge_root` — facts about the user
- `trunk_root` — single tree anchor (parent of the above)

Everything else lives in **branches**. A branch has an origin (the node
with `branch_state='active' | 'dormant' | 'closed'`) and descendants.
Argmax-routing in `agent_remember` decides where new content lands:
inherits the parent's branch, or starts a new top-level branch under
`trunk_root` if nothing is close enough.

**Gravity.** As children accumulate under a node, the node ripens.
Three signals feed the maturity formula:
- breadth (number of direct children),
- conv (semantic convergence — children clustered around origin),
- stab (content unchanged across recent consolidations),
- recall (recent recall hits).

Score ≥ 0.7 → the node **crystallizes into a skill** (`is_skill=TRUE`,
new `agent_skill_version` v1 snapshot). After that, skill content is
mutable in-place between versions; `agent_skill_note` accumulates
addenda; periodic re-crystallization folds notes into a new version.

**Cross-branch lift.** Weekly background job scans for fragments
repeated across branches with similarity ≥ 0.85. When 2+ matches and
all have `consolidation_count ≥ 3`, an `agent_lift_candidate` row
appears for your review. You synthesise the lifted content yourself
and pass it to `agent_confirm_lift` (backend never synthesises).

**Skill promotion.** A branch-local skill activated in 3+ distinct
branches over 14+ days becomes a candidate for trunk promotion. The
backend looks for similar skills / trunk-resident content; if any are
found, `promotion_status='conflict_held'` and you resolve via
`agent_resolve_promotion_conflict`. Otherwise, auto-`trunk_promoted`.

---

## DECISION-692: Backend doesn't think, you do

ConPort backend is bookkeeping + cheap pgvector / signal computation.
**It never calls an LLM** for gravity, lift synthesis, promotion
conflict resolution, or re-crystallization merges. You are the LLM —
you have the context, you decide what to merge / keep / drop.

Where backend stops, agent picks up:

| Backend does | Agent does |
|---|---|
| Detect lift candidates (`agent_lift_candidate`) | Synthesise lifted content → `agent_confirm_lift` |
| Detect promotion conflicts (`conflict_held`) | Decide merge / keep / supersede → `agent_resolve_promotion_conflict` |
| Detect re-crystallization hysteresis | Merge content + notes → `agent_complete_re_crystallization` |
| Reset counters in `agent_reflect` (bookkeeping) | Provide `new_content` if you want backend to persist a merge |

---

## ⛔ NEVER STORE

- **Secrets, passwords, API keys, tokens** — even partially.
  Bad: `"API key starts with 0a73..."`
  Good: `"API key is in $API_KEY env var"`

---

## WRITE / READ MENTAL MODEL

**Write** (almost always `agent_remember`):

- Just call it with the content. Routing is automatic. The response
  tells you where it landed via `routing.decision`:
  - `linear` (sim ≥ 0.7) — silent attach to nearest node
  - `uncertain` (0.4 ≤ sim < 0.7) — attached, plus alternatives so
    you can `agent_remember` again with explicit `parent_id` if the
    routing was wrong
  - `new_branch` (sim < 0.4) — new top-level branch under trunk
- `gravity_signal=true` in the response means the parent has
  accumulated enough children that a consolidation pass is overdue.
  Call `agent_reflect(parent_node_id)` when it fits the flow.

**Read** (`agent_recall`):

- Composite score = 0.6·sim + 0.2·recall_factor + 0.2·foundational_boost.
  Trunk-resident content gets a boost — your identity / principles
  surface alongside semantically similar branch content.
- Use `scope_root_id` when you want to scope: branch origin id for a
  branch subtree, `identity_root_id` for identity only, any node id
  for its subtree.

**Don't fight routing.** If you keep overriding with explicit
`parent_id`, the tree never finds its own shape. Only override when
the routing alternatives in `uncertain` are clearly wrong for your
intent.

---

## TOOL SURFACE (26 tools, see references/tools.md for signatures)

**Identity & lifecycle:** `agent_init`, `agent_activate_node`,
`agent_activate_branch`

**Memory write & branches:** `agent_remember`, `agent_create_branch`,
`agent_close_branch`

**Memory read:** `agent_recall`, `agent_get_node`, `agent_walk_branch`,
`agent_list_branches`

**Reflection / gravity:** `agent_reflect`

**Artifacts (branch outputs, NOT experience):**
`agent_emit_artifact`, `agent_list_artifacts`, `agent_get_artifact`,
`agent_artifact_provenance`, `agent_node_artifacts`

**Lift workflow:** `agent_review_lift_candidates`,
`agent_confirm_lift`, `agent_request_synthesis_assistance`

**Promotion / cross-load:** `agent_review_promotion_conflicts`,
`agent_resolve_promotion_conflict`, `agent_load_skill`

**Skill versioning & notes:** `agent_skill_versions`,
`agent_get_skill_version`, `agent_get_skill_md`,
`agent_add_skill_note`, `agent_supersede_skill_note`,
`agent_complete_re_crystallization`, `agent_review_re_crystallization`

---

## SUNSET (removed in v5.0.0)

These v1 tools are **gone**. Plugin version 5.0.0+ won't have them:

- `agent_attach_project` — agent layer is separated from project layer.
  If you need project memory (decisions / tasks / docs), use the
  `conport` skill's project tools directly.
- `agent_forget` — the v2 model is non-destructive; nothing "forgets".
  Use `agent_supersede_skill_note` for skill notes; for experience
  nodes, future supersession will be a separate tool.
- `agent_link_memories` — tree edges (`parent_id`) + lift back-refs
  + artifact provenance edges replace it. Cross-edges may return as a
  separate concept if a real use case appears.

---

## CHECKLIST

- [ ] `agent_init` done?
- [ ] `bootstrap_state` checked? (new → populate trunk; continuing → load context)
- [ ] `pending_lift_candidates` / `pending_promotion_conflicts` reviewed?
- [ ] `agent_recall` before answering past-context questions?
- [ ] Don't fight routing — accept argmax suggestions unless clearly wrong
- [ ] `gravity_signal` triggered → `agent_reflect` when it fits
- [ ] No secrets in memory content?

---

*v5.0.0 | 26 tools | Tree memory | Gravity-driven crystallization | Cross-branch lift | Skill versioning + notes | Artifact provenance | decision-692 (backend = bookkeeping only)*
