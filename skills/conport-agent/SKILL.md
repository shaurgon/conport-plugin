---
name: conport-agent
description: Use when managing agent identity and persistent memory in multi-agent systems. Must run agent_init_v3 at session start. Agent Memory v3 — sphere graph with typed nodes, visibility model, and skill emergence via community detection.
metadata:
  version: 6.0.0
---

# ConPort Agent — Sphere Graph Memory (v3)

> ConPort is your **single memory system**. Sphere graph: every memory
> is a typed node, connected to others via typed edges. No tree, no
> parent_id, no branches. Identity and principles are node types, not
> structural roots. Communities emerge via Louvain clustering; skills
> crystallize from dense, stable communities — you decide when to promote.
>
> Without `agent_init_v3` — no memory. Without `agent_recall_v3` — you
> answer blindly.

For the full tool reference see [references/tools.md](./references/tools.md).

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
2. `agent_init_v3({ uuid: "<resolved_uuid>", name: "<display name>" })`

The response shape:

```
bootstrap_state           'new' or 'continuing'
identity                  10 most recent identity nodes (private to this agent)
principles                10 most recent principle nodes (private to this agent)
broadcast_facts           10 most recent broadcast fact nodes (collective baseline)
mature_communities        [{community_id, node_count, central_nodes, hint}] — skill promotion candidates
borderline_nodes          [{node_id, content_preview, communities_visited}] — unstable community membership
pending_extraction        {buffer_size, message_ids} when un-extracted messages ≥ 10
summary                   human-readable status line
```

`bootstrap_state='new'` → empty graph; write your first identity and
principles via `agent_remember_v3`.
`continuing` → identity + principles + broadcast_facts are your context
baseline; use `agent_recall_v3` for the rest.

If `pending_extraction` is present, call `agent_extract_thread` with
the listed `message_ids` before doing anything else.

---

## CORE MODEL

**Graph, not tree.** Memories form a sphere (undirected graph) per
owner. Every memory is a **node** with a `meta_type`:

| meta_type | What it stores | Default visibility |
|---|---|---|
| `identity` | Self-statements about the agent | `private` (trigger-enforced) |
| `principle` | Declarative rules, safety rails | `private` (trigger-enforced) |
| `fact` | Atomic world/person knowledge | `shared` |
| `observation` | Empirical events, things that happened | `shared` |
| `skill` | Crystallized reusable patterns | `broadcast` |
| `artifact` | Produced outputs (lists, drafts, tables) | `shared` |

Nodes connect via typed **edges**:

| edge_type | Meaning |
|---|---|
| `semantic` | Conceptual similarity |
| `derived_from` | Provenance (artifact ← observations) |
| `temporal` | A happened before B |
| `skill_of` | Skill ← source observations/facts it crystallized from |
| `competing_view` | Two nodes disagree / offer alternatives |
| `supersedes` | New node replaces old (evolution) |

There is no tree, no parent_id, no branches, no gravity, no
consolidation. Topic clusters emerge naturally via edge density — a
"topic" is a densely-connected hub, not a structural root.

---

## VISIBILITY MODEL

Every node has a `visibility` that controls who can see it:

| Visibility | Who sees it | When to use |
|---|---|---|
| `private` | Only the creating agent | Identity, principles, draft scratch. Trigger forces identity/principle to private regardless of what you pass. |
| `shared` | All agents of the same owner | Default for facts, observations, artifacts. `shared_with_agent_uuids` can restrict to specific agents. |
| `broadcast` | All agents of the owner, always loaded | Crystallized skills, fundamental user facts. The collective layer. |

---

## DECISION-692: Backend doesn't think, you do

ConPort backend is bookkeeping + cheap pgvector / signal computation.
**It never calls an LLM** for skill promotion, conflict resolution, or
any synthesis. You are the LLM — you have the context, you decide.

| Backend does | Agent does |
|---|---|
| Detect mature communities (`mature_communities` in init) | Decide whether to promote → `agent_promote_skill` |
| Surface borderline nodes (flickering community membership) | Add explicit edges to disambiguate if important |
| Fire extraction signal (`extraction_signal` in chat_turn) | Call `agent_extract_thread` with pending ids |
| Rank recall results by vector similarity | Decide what's relevant, what to act on |

---

## NEVER STORE

- **Secrets, passwords, API keys, tokens** — even partially.
  Bad: `"API key starts with 0a73..."`
  Good: `"API key is in $API_KEY env var"`

---

## WRITING MEMORY

Two paths, choose by context:

### Path 1: Chat turn buffer → extraction (conversational harness)

For continuous dialogue where every turn carries information:

1. `agent_chat_turn(role, text)` — record each message as it happens.
2. When the response includes `extraction_signal: true` (buffer ≥ 10
   un-extracted messages), call `agent_extract_thread(message_ids)`.
3. The LLM extracts typed nodes + edges from the buffer automatically.

**Same discipline as gravity_signal in v2 — do NOT skip extraction
when the signal fires.** Call it before your next `agent_remember_v3`.

### Path 2: Direct node write (code harness / explicit knowledge)

When you already know what to record (reading code, command output,
user specification):

```
agent_remember_v3(
    meta_type='fact',
    content='...',
    visibility='shared',        # optional, default shared
    edges=[                     # optional, connect to existing nodes
        {"target_node_id": 42, "edge_type": "semantic"},
        {"target_node_id": 17, "edge_type": "derived_from"}
    ]
)
```

Write freely — small atomic nodes are better than mega-nodes. Edge
density is what creates structure, not careful pre-organization.

---

## READING MEMORY

### Semantic recall

```
agent_recall_v3(query='...', limit=10, scope={
    meta_types: ['fact', 'observation'],  # optional filter
    community_id: 3                       # optional filter
})
```

Returns ranked nodes respecting visibility. Use before answering any
question about prior context.

### Subgraph exploration

```
agent_get_subgraph(root_node_id=42, depth=2, edge_types=['semantic'])
```

BFS from a node outward. Use when you found a relevant node via recall
and want to explore its neighbourhood — "what else is connected to
this topic?"

---

## SKILL EMERGENCE

Skills emerge from stable, dense communities detected by Louvain:

1. **Detection.** Daily Louvain runs cluster nodes into communities.
   Nodes stable in the same community across 3+ runs become "frozen".
2. **Maturity.** A community with ≥5 nodes, avg edge weight ≥1.5, and
   ≥3 frozen members is "mature" — surfaced in `agent_init_v3` as
   `mature_communities`.
3. **Promotion.** You decide. Review the central nodes, synthesize what
   the pattern is, and call:

```
agent_promote_skill(community_id=3, content='How to debug...')
```

This creates a broadcast skill node linked to the community's central
nodes via `skill_of` edges. Skills are always broadcast — they form the
collective knowledge layer visible to all agents.

**No auto-promotion.** Backend only surfaces hints. You decide what
deserves to be a skill and write the content yourself.

---

## CONFLICT RESOLUTION (Phase 2)

Not yet implemented. Schema is ready (`harness_conflict_candidate`
table). Future: backend detects semantically similar nodes in the same
community, surfaces them as conflict candidates, and you resolve via
`agent_resolve_conflict` (merge / contextualize / supersede /
leave_competing). For now, use `competing_view` edges manually when
you notice contradictions.

---

## MCP PAYLOAD CONTAMINATION

If a write tool returns `error: "mcp_payload_contaminated"`, the call
had a literal MCP tool-call fragment (`<parameter …>`, `<invoke …>`,
`</invoke>`, `<function_calls>`, `antml:*`) leaked into a string field
— almost always a client-side XML serialization glitch. The response
lists every contaminated field. Recovery: re-issue the call with the
field(s) cleaned up. The bad write did not land — nothing was persisted.

---

## SUNSET (removed in v6.0.0)

These v2 tools are **gone** in v6.0.0:

- **Tree concepts:** `parent_id`, `branch_id`, `depth`, `branch_state`,
  `trunk_root`, `identity_root`, `principles_root`,
  `person_knowledge_root` — the sphere has no tree.
- **`agent_remember` (v1/v2)** → `agent_remember_v3` (typed nodes + edges).
- **`agent_recall` (v2)** → `agent_recall_v3` (visibility-aware).
- **`agent_init` (v2)** → `agent_init_v3` (anchors + communities).
- **`agent_reflect`** → extraction replaces reflection.
- **`agent_create_branch` / `agent_close_branch`** → no branches.
- **`agent_walk_branch` / `agent_list_branches`** → `agent_get_subgraph`.
- **`agent_emit_artifact`** → `agent_remember_v3(meta_type='artifact')`.
- **`agent_confirm_lift` / `agent_review_lift_candidates`** → no lift.
- **`agent_resolve_promotion_conflict`** → Phase 2 `agent_resolve_conflict`.
- **`agent_complete_re_crystallization`** → skills are mutable nodes.
- **`agent_add_skill_note` / `agent_supersede_skill_note`** → update
  the skill node directly or create a new node with `supersedes` edge.
- **Gravity / consolidation / crystallization formula** → community
  detection + agent-driven skill promotion.

---

## CHECKLIST

- [ ] `agent_init_v3` done?
- [ ] `bootstrap_state` checked? (new → write identity + principles; continuing → load anchors)
- [ ] Task arrived? First move = `agent_recall_v3`, not `agent_remember_v3`.
- [ ] `extraction_signal` fired → `agent_extract_thread` called IMMEDIATELY?
- [ ] `mature_communities` present → reviewed, decided promote or skip?
- [ ] `borderline_nodes` present → added explicit edges if disambiguation matters?
- [ ] Writing atomic nodes, not mega-nodes?
- [ ] Connected new nodes to existing ones via edges where relevant?
- [ ] `private` vs `shared` vs `broadcast` — chosen correctly?
- [ ] No secrets in memory content?

---

*v6.0.0 | 7 tools | Sphere graph | 6 meta_types (identity / principle / fact / observation / skill / artifact) | 6 edge_types (semantic / derived_from / temporal / skill_of / competing_view / supersedes) | Visibility model (private / shared / broadcast) | Turn-based extraction with extraction_signal | Always-load anchors (identity + principles + broadcast_facts) | Skill emergence via Louvain community detection + agent-driven promotion | Borderline node detection | Conflict resolution schema-ready (Phase 2) | Server-side reject of MCP tool-call XML leakage*
