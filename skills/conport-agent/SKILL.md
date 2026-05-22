---
name: conport-agent
description: Use when managing agent identity and persistent memory in multi-agent systems. Must run agent_init at session start. Agent Memory v2 — tree-structured memory with gravity-driven consolidation and skill emergence.
metadata:
  version: 5.1.0
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

**Don't fight routing within a role-root.** Argmax does fine inside an
already-clean subtree. The override case is **across role-roots** — see
ROUTING DISCIPLINE below.

---

## ROUTING DISCIPLINE: classify before `agent_remember`

Argmax routing is fast but memoryless about intent. Inside an
already-clean subtree it picks the right neighbour; across the trunk
it silently dumps everything into the largest cluster — usually
`person_knowledge_root` — and the trunk degenerates into a mishmash
of operational logs / paper notes / rules. The fix is one extra step
before the write: **classify the content, then pick the right
container**.

### The two kinds of containers

The tree has exactly two:

- **Trunk sub-stores** — `identity_root`, `principles_root`,
  `person_knowledge_root`. Always-loaded into prefetch. Hold
  cross-cutting, slow-changing content.
- **Branches** — sub-trees off `trunk_root` for episodic experience
  on a specific topic. Loaded contextually, not always. Created
  explicitly with `agent_create_branch` or emergently when
  `routing.decision = 'new_branch'`.

There is no third level of trunk sub-store. Anything that doesn't fit
the three sub-stores belongs in a branch.

### Decision tree before each `agent_remember`

| Question | Answer → target |
|---|---|
| Self-statement / persona fact about who I am? | `parent_id = identity_root_id` |
| Declarative cross-context rule, pitfall, or safety rail? | `parent_id = principles_root_id` |
| Stable fact about the user / world, useful in any context? | `parent_id = person_knowledge_root_id` |
| Tied to the current active task or thread? | Active branch id — let argmax pick within it |
| New topic with no existing branch? | `agent_create_branch(name, anchor=trunk_root_id)` then write there, **or** accept argmax's `new_branch` decision if you'd rather let the fork emerge |

**Research papers / external knowledge artifacts** belong in a
branch, not in `person_knowledge_root`. The canonical pattern: one
branch per research theme (e.g. `research:agent-memory`,
`research:mcp-security`). The branch origin holds a short description
of the theme; each paper note becomes a child. Gravity may
eventually crystallize a synthesis skill out of it.

**Tool / system workarounds:** if declarative ("always do X before
Y"), they're a principle. If a chronicle ("hit bug Z, fixed by W"),
they belong in a tooling-history branch. Don't carve a fourth trunk
sub-store — the design has exactly three.

### When to override routing

The "don't fight routing" rule applies **within** the correct
container. Override the cross-container choice, not the local one:

| Situation | Action |
|---|---|
| Content matches one of the 3 sub-stores | Pass `parent_id` for that sub-store |
| `routing.decision = 'uncertain'` with cross-container alternatives | Re-call with explicit `parent_id` matching your classification |
| New topic with no existing branch | `agent_create_branch` first, then write with the new branch id |
| Existing branch is the right place | Pass `parent_id` = branch origin (or any node inside) and let argmax place it within the branch |

### Periodic trunk normalization sweep

Every N consolidation cycles (or once a week), self-audit the trunk:

1. `agent_walk_branch(scope_root_id=person_knowledge_root_id, depth=1)`
2. For each direct child:
   - Genuine fact about the user/world? Keep.
   - Declarative rule? → move under `principles_root`.
   - Persona/self-fact? → move under `identity_root`.
   - Episodic content (research, debug log, tool chronicle)? → find
     the matching branch (`agent_list_branches`) or create one with
     `agent_create_branch`, then re-write there. Supersede the
     original under `person_knowledge_root`.
3. Repeat for `identity_root` and `principles_root` if they
   accumulated unrelated content.

Acceptance: a month after rollout, manual audit of the three trunk
sub-stores should show only on-theme content. Misroutes are caught
within one cycle, not weeks.

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
- [ ] Classified the content → trunk sub-store OR branch? `parent_id` passed explicitly when sub-store applies?
- [ ] New research / debug / chronicle topic → `agent_create_branch` instead of stuffing under `person_knowledge_root`?
- [ ] Don't fight routing **within** the chosen container — accept argmax inside the correct subtree
- [ ] `gravity_signal` triggered → `agent_reflect` when it fits
- [ ] Periodic trunk-normalization sweep done in last N cycles?
- [ ] No secrets in memory content?

---

## MCP payload contamination (since 5.0.1)

If a write tool returns `error: "mcp_payload_contaminated"`, the call had a
literal MCP tool-call fragment (`<parameter …>`, `<invoke …>`, `</invoke>`,
`<function_calls>`, `antml:*`) leaked into a string field — almost always a
client-side XML serialization glitch. The response lists every contaminated
field. Recovery: re-issue the call with the field(s) cleaned up. The bad
write did not land — nothing was persisted. Applies to all `agent_*` write
tools (`agent_remember`, `agent_emit_artifact`, `agent_add_skill_note`,
`agent_create_branch`, …).

---

*v5.1.0 | 26 tools | Tree memory | Gravity-driven crystallization | Cross-branch lift | Skill versioning + notes | Artifact provenance | decision-692 (backend = bookkeeping only) | Server-side reject of MCP tool-call XML leakage | Routing discipline: classify-then-remember (3 sub-stores + branches) + periodic trunk-normalization sweep*
