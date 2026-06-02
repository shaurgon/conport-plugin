---
name: conport-agent
description: Use when managing agent identity, persistent memory, and operational workspace in multi-agent systems. Must run agent_init at session start. Agent Memory v3 (sphere graph) + Workspace v1 (event-sourced entities, runs, projections).
metadata:
  version: 7.2.0
---

# ConPort Agent — Sphere Graph Memory (v3)

> ConPort is your **single memory system**. Sphere graph: every memory
> is a typed node, connected to others via typed edges. No tree, no
> parent_id, no branches. Identity and principles are node types, not
> structural roots. Communities emerge via Louvain clustering; skills
> crystallize from dense, stable communities — you decide when to promote.
>
> Without `agent_init` — no memory. Without `agent_recall` — you
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
2. `agent_init({ uuid: "<resolved_uuid>", name: "<display name>" })`

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
principles via `agent_remember`.
`continuing` → identity + principles + broadcast_facts are your context
baseline; use `agent_recall` for the rest.

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

## ANTI-PATTERNS

**Don't store structured snapshots as text memory nodes.**
Bad: `agent_remember(meta_type='fact', content='Екатеринбург: score 4.74, news 0.30, rank 1')` — loses structure, can't query by score, creates supersede chains on daily updates.
Good: `agent_entity_upsert('city', 'Екатеринбург')` + `agent_event_record('daily_rating', payload={score: 4.74, ...})` + `agent_projection_record(projection_type='overall_score', value={...})`.

**Don't use memory for workflow state.**
Bad: `agent_remember(meta_type='observation', content='Dream run started, topic: X')` — no params, no status, no outputs, no provenance.
Good: `agent_run_start('dream_explore', params={topic: 'X'})` → events → projection → `agent_run_finish(...)`.

**Migration from memory to workspace:** if you already have text nodes that should be structured entities, create workspace entities from them and link back:
```
entity_id = agent_entity_upsert('city', 'Екатеринбург', attrs={...})
agent_link_node_to_entity(node_id=<old_memory_node>, entity_id=entity_id, link_type='derived_from')
```
The memory node stays as cognitive context; the workspace entity becomes the operational record.

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
when the signal fires.** Call it before your next `agent_remember`.

### Path 2: Direct node write (code harness / explicit knowledge)

When you already know what to record (reading code, command output,
user specification):

```
agent_remember(
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

### Recall (multi-strategy)

```
agent_recall(query='...', limit=10, scope={
    meta_types: ['fact', 'observation'],   # optional filter
    visibility: ['shared', 'broadcast'],   # optional filter
    community_id: 3,                       # optional filter
    since: '2026-06-01T00:00:00Z',         # optional: created_at >= since (ISO 8601)
    until: '2026-06-30T23:59:59Z',         # optional: created_at <= until
})
```

Fuses three strategies via RRF — vector (semantic), keyword/FTS (exact
terms), and graph adjacency (nodes linked to other hits get boosted) —
all respecting visibility. Use before answering any question about prior
context. `since`/`until` give precise time-range recall ("what changed
this week"), not the coarse decay tiers of the old v2.

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
   ≥3 frozen members is "mature" — surfaced in `agent_init` as
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

## WORKSPACE — operational state

Sphere graph (sections above) is **memory**: what you observed, who you
are, what principles you follow. It is NOT the place for:

- Stateful entities with numeric parameters (cities with scores)
- Workflow runs (skill executions with params and outputs)
- Event streams (news, measurements, observations with structured metadata)
- Provenance trails (what influenced this conclusion)

For that — Workspace.

### When to use what

| What | Where |
|---|---|
| "Юра предпочитает Екатеринбург" | memory (fact node) |
| "Юра спросил про переезд" | memory (observation) |
| City as entity with scores | workspace (`agent_entity_upsert`) |
| News about that city | workspace (`agent_event_record`) |
| Daily refresh skill run | workspace (`agent_run_start` / `agent_run_finish`) |
| Current city score | workspace (`agent_projection_record` / `agent_projection_current`) |
| "observation mentioned a city" | cross-link (`agent_link_node_to_entity`) |

Rule of thumb: **structured fields + history matters in order → workspace**.
Free text + embedding for recall → memory.

### Collections (entity_type IS the collection)

A collection is just an `entity_type` (`city`, `series`) — its members are the
entities of that type. The schema lives in a registry row
`agent_entity_upsert('_collection', '<type>', {description, field_hints, status_vocab})`
and is inherited by members (soft). `agent_init` returns `collections` (each
type → member count + schema).

Discipline — skip it and you get fragmentation (`serial` + `watchlist` +
`interests` for one domain, the same item filed under two types):

1. **Check `agent_init.collections` before writing.** Reuse an existing
   collection's key + `field_hints`. Do NOT invent a new `entity_type` for a
   domain that already has one.
2. **First appearance of a domain:** register it once via
   `agent_entity_upsert('_collection', key, {...})`. One canonical singular key
   (`series`, not `serial`/`shows`/`watchlist`).
3. **An item is one entity** (`entity_type=key`, `name=item`, attrs per
   `field_hints`). A list / wishlist is **not** an entity — it's the members
   filtered by a `status` attr (`agent_entity_list(key, attrs_filter={'status': ...})`).
   Do NOT append items as events on a container entity — that leaves no
   queryable current state.
4. **State transitions** = update the member's `status` attr (upsert merges) +
   optional `agent_event_record` for history.
5. **Mistake?** `agent_entity_delete(entity_type, name)` — don't leave junk and
   create a duplicate.

### Workspace primitives (12 tools)

**Entity** — typed domain object with JSONB attrs, natural key (entity_type + name):

- `agent_entity_upsert(entity_type, name, attrs?)` — create or merge attrs
- `agent_entity_get(entity_type, name)` — lookup by natural key
- `agent_entity_list(entity_type, attrs_filter?, limit?)` — list with JSONB containment filter
- `agent_entity_delete(entity_type, name)` — delete entity + cascade its events / projections / links

**Event** — append-only, immutable once written:

- `agent_event_record(event_type, payload, entity_id?, occurred_at?, run_id?)` — record event
- `agent_event_query(entity_id?, event_type?, since?, until?, run_id?, limit?)` — query with filters

**Run** — skill execution trace:

- `agent_run_start(skill_name, params?, skill_node_id?)` — start (status=running)
- `agent_run_finish(run_id, status, outputs?)` — finish (completed/failed/cancelled)

**Projection** — derived snapshots with provenance:

- `agent_projection_record(entity_id, projection_type, value, derived_from_event_ids?, derived_from_run_id?)` — record snapshot
- `agent_projection_current(entity_id, projection_type)` — latest snapshot
- `agent_projection_history(entity_id, projection_type, since?, until?, limit?)` — all snapshots over time

**Cross-link** — connect memory nodes to workspace entities:

- `agent_link_node_to_entity(node_id, entity_id, link_type?)` — 'mentions', 'about', or 'derived_from'

### Example: cities with daily scoring

```
# Setup entities once
agent_entity_upsert('city', 'Екатеринбург', attrs={'population': 1500000})
agent_entity_upsert('city', 'Новосибирск', attrs={...})

# Daily news events
agent_event_record('news_published', payload={'headline': '...', 'source': 'e1.ru',
    'impacted_aspects': ['safety']}, entity_id=<ekb_id>, occurred_at='2026-05-25T10:00Z')

# Daily refresh run
run_id = agent_run_start('daily_city_refresh', params={'date': '2026-05-25'})
# ... compute scores locally from events ...
agent_projection_record(entity_id=<ekb_id>, projection_type='overall_score',
    value={'score': 6.9, 'delta': -0.1}, derived_from_event_ids=[...], derived_from_run_id=run_id)
agent_run_finish(run_id, status='completed', outputs={'cities_processed': 3})

# Query current state
agent_projection_current(entity_id=<ekb_id>, projection_type='overall_score')
# → latest score with provenance to events
```

### Example: dream mode research

```
agent_entity_upsert('dream_topic', 'agent-memory-evolution', attrs={'first_explored': '2026-05-20'})
run_id = agent_run_start('dream_explore', params={'topic': 'agent-memory-evolution'})

# Each search result → event
agent_event_record('search_result', payload={'url': '...', 'summary': '...'},
    entity_id=<topic_id>, run_id=run_id)

# Synthesis → projection with provenance
agent_projection_record(entity_id=<topic_id>, projection_type='dream_conclusion',
    value={'summary': '...', 'key_insights': [...]},
    derived_from_event_ids=[<all_event_ids>], derived_from_run_id=run_id)
agent_run_finish(run_id, status='completed')
```

### Conventions

- `entity_type`, `event_type`, `projection_type` — agent-defined strings.
  Be consistent within a workflow (always `'city'`, not `'City'` / `'cities'`).
- `projection.value` is freeform JSONB. If you plan ranking, keep a
  numeric `score` field at top level.
- `event.occurred_at` is real-world time; `recorded_at` is when stored.
  Pass `occurred_at` explicitly when you know it.
- `derived_from_event_ids` — pass ALL events that actually influenced
  the projection. The junction gives full provenance trail.
- Entity `attrs` merge on upsert (new keys added, existing overwritten).
  Use for stable attributes; use events for time-varying data.

---

## SUNSET (removed in v6.0.0)

These v2 tools are **gone** in v6.0.0:

- **Tree concepts:** `parent_id`, `branch_id`, `depth`, `branch_state`,
  `trunk_root`, `identity_root`, `principles_root`,
  `person_knowledge_root` — the sphere has no tree.
- **`agent_remember` (v1/v2)** → `agent_remember` (typed nodes + edges).
- **`agent_recall` (v2)** → `agent_recall` (visibility-aware).
- **`agent_init` (v2)** → `agent_init` (anchors + communities).
- **`agent_reflect`** → extraction replaces reflection.
- **`agent_create_branch` / `agent_close_branch`** → no branches.
- **`agent_walk_branch` / `agent_list_branches`** → `agent_get_subgraph`.
- **`agent_emit_artifact`** → `agent_remember(meta_type='artifact')`.
- **`agent_confirm_lift` / `agent_review_lift_candidates`** → no lift.
- **`agent_resolve_promotion_conflict`** → Phase 2 `agent_resolve_conflict`.
- **`agent_complete_re_crystallization`** → skills are mutable nodes.
- **`agent_add_skill_note` / `agent_supersede_skill_note`** → update
  the skill node directly or create a new node with `supersedes` edge.
- **Gravity / consolidation / crystallization formula** → community
  detection + agent-driven skill promotion.

---

## CHECKLIST

- [ ] `agent_init` done?
- [ ] `bootstrap_state` checked? (new → write identity + principles; continuing → load anchors)
- [ ] Task arrived? First move = `agent_recall`, not `agent_remember`.
- [ ] `extraction_signal` fired → `agent_extract_thread` called IMMEDIATELY?
- [ ] `mature_communities` present → reviewed, decided promote or skip?
- [ ] `private` vs `shared` vs `broadcast` — chosen correctly?
- [ ] No secrets in memory or workspace content?
- [ ] Structured domain data → workspace (entity + event + projection), not memory?
- [ ] Workflow execution → `agent_run_start` / `agent_run_finish` wrapping it?
- [ ] Derived result → `agent_projection_record` with `derived_from_event_ids`?

---

*v7.2.0 | 19 tools (7 memory + 12 workspace) | Sphere graph + Event-sourced workspace | Memory: agent_init, agent_remember, agent_recall, agent_chat_turn, agent_extract_thread, agent_get_subgraph, agent_promote_skill | Multi-strategy recall (vector + FTS + graph adjacency RRF) + temporal since/until scope | Workspace: entities + events + runs + projections + delete, collections (entity_type = collection, _collection registry schema surfaced in agent_init), append-only history, provenance junction, cross-link via node_entity_link | Anti-patterns: no structured snapshots in memory, no workflow state in memory, no list-as-entity | Server-side reject of MCP tool-call XML leakage*
