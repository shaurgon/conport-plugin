---
name: conport
description: Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start.
metadata:
  version: 15.9.0
---

# ConPort — Project Management System

> **ConPort stores everything about the project:** tasks, documents, decisions, infrastructure.
> **Without init, context is unavailable.** Without search, you are answering blindly.

### MCP Prefix

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

---

## FIRST ACTION OF THE SESSION

### Step 1: Determine the project name

**Claude Code CLI** — the env var `CONPORT_PROJECT_NAME` is already available (from `.claude/settings.local.json`).
If it's not set, fall back in this priority order:

1. **Git remote** — extract the repo name (last segment of the URL without `.git`)
2. **Directory name** — basename of the current working directory

**Claude.ai Chat** — ask the user (the file system is not available).

### Step 2: Call init

```
mcp__conport__init({
  name: "<detected_name>",
  skill_id: "conport",
  skill_version: "14.11.2",  // value of metadata.version in this SKILL.md frontmatter
  client_type: "claude-code"  // or claude-ai / cursor / openclaw / mcporter / paperclip
})
```

`skill_id` / `skill_version` / `client_type` are optional but strongly recommended — they let the server tell you when SKILL.md has been updated upstream so manual installs (Claude.ai project files, hand-copied skills) don't silently drift. Pick `client_type` from the list above; fall back to omitting it if running somewhere else.

If auto-detection of the project name did not work, ask the user.

### After init — MANDATORY:

1. **Print summary:** `[CONPORT] {summary from response}`
2. **Execute instructions** from the response (read files, apply rules)
3. **Report backlog:** `N tasks in TODO, M in progress. Top 5:` — use `backlog.top` from the response. Line format: `Pk · #id title (n subtasks)`, skipping `(n subtasks)` when zero. `Pk` is `effective_priority`. Skip the whole block if `backlog.total_todo == 0` and `backlog.total_in_progress == 0`.
4. **If the project is empty** (no decisions, no patterns, empty `product_context`) — offer the bootstrap flow from `references/bootstrap.md`.
5. **If `skill_update_available` is present in the response** — emit ONE short notice at the very start of your first reply (after the `[CONPORT]` line). Format:

   ```
   [SKILL UPDATE] {skill_id} {current} → {latest} ({severity}). Changelog: {changelog_url} · Install: {install_guide}
   ```

   - When `current == "unknown"` — phrase as `cannot determine version, see {install_guide}`.
   - When `severity == "security"` — emit a stronger line (`[SECURITY UPDATE]`) and recommend updating before proceeding.
   - Do NOT re-emit the notice in subsequent turns — once per session.

   **Never decide "is there an update" by hand-comparing version numbers.**
   The conport plugin (this skill, conport-agent, plugin.json, marketplace) is
   versioned in lockstep — one number per release. `conport-hermes` is a
   *separate* installable unit with its own number. Numbers from different units
   are NOT comparable, and a skill version is NOT comparable to a plugin
   release number. The ONLY correct signal is `skill_update_available` above:
   present → update; absent → you're current. If you catch yourself reasoning
   "my 14.x looks higher than the 12.x release, so I'm ahead" — stop, that's the
   exact mistake this signal exists to prevent (decision-808).

**Without init you cannot:** answer questions about the project or work with tasks.
**Ignoring instructions is FORBIDDEN.**

---

## WORKFLOW — When to call which tool

### Planning

| Trigger | Tool |
|---------|------|
| "We need to do X" | `add_task` with priority **and `estimated_seconds`** (priority is industry-standard 1-5 where 1=critical and 5=idle, default 3; effort in seconds — epic rows leave it NULL, sum-from-children at read time) |
| "X depends on Y" | `add_task_dep` |
| "Create an epic" / multi-step body of work | `add_task` with `kind='epic'` (replaces the legacy `EPIC:` title prefix) |
| "Break it into subtasks" | `add_task` with `parent_task_id` (parent must be `kind='epic'`) |
| "Move task X under epic Y" / re-parent an existing task | `update_task` with `parent_task_id` (target must be `kind='epic'`; use `0` to detach to root) |
| "Promote this task to an epic" | `update_task` with `kind='epic'` (task must be root — combine with `parent_task_id=0` to detach + promote atomically) |
| "Demote this epic to a task" | `update_task` with `kind='task'` (epic must have no children) |
| Need a task in another project I own (no context switch) | `add_linked_task` with `target_project` name |

### Execution

| Trigger | Tool |
|---------|------|
| Starting work | `update_task` → IN_PROGRESS |
| Done / Finished | `update_task` → DONE **with `resolution=...`** (see below) |
| Cancelled | `update_task` → CANCELLED **with `resolution=...`** (why dropped) |
| Blocked | `update_task` → BLOCKED |

**Closing tasks — always pass `resolution`:**
On `status=DONE` or `CANCELLED`, pass a `resolution` argument with the verdict
(what was done / why cancelled). The server will:

1. Append a `## Resolution` section to the task's description (preserves the
   original spec verbatim).
2. Auto-create a linked `progress_entry` so the close shows up in
   `recent_activity`, `list_progress`, and search.

**Do NOT call `log_progress` separately for task closes** — that would
duplicate the entry. `log_progress` is for progress events that don't belong
to a single closing task (e.g. mid-implementation notes, infra changes).

### Patterns

| Trigger | Tool |
|---------|------|
| "Show me the patterns" | `list_patterns` |
| "Record a pattern" | `log_pattern` with name, description, tags |
| "Update / rename / re-tag a pattern" | `update_pattern` |
| "What approaches do we use?" | `list_patterns` or `search` by topic |

### Search

| Trigger | Tool |
|---------|------|
| Question about the project | `search` BEFORE answering |
| "What was decided about Y?" | `search` by topic |
| "Which projects do I own?" / routine bootstrapping without known project_id | `list_projects` |

### Context assembly (recipe-pattern)

Structural context packages for a single node — task or spec — assembled by deterministic graph traversals. Complements `init` (whole-project, session start) and `search` (fuzzy on-ramp from free text). Use when you already know the anchor and want the neighbourhood in one call.

| Trigger | Tool |
|---------|------|
| "Open task #N and brief me" / agent opens a task | `assemble_context` with `recipe='task_briefing'`, `start_id='task-N'` |
| "What's the implementation status of spec doc-N?" | `assemble_context` with `recipe='spec_implementation_status'`, `start_id='doc-N'` |
| User pasted a wikilink like `[[task-271]]` | `assemble_context` with `start_id='[[task-271]]'` (wikilink accepted verbatim) |
| "What recipes are available?" | `list_context_recipes` |
| "What's the current architecture of subsystem X?" | `render_current_architecture` with `scope=["X", ...]` — L1 synthesis (decisions + patterns + specs) with supersession-walk and provenance |
| "Is this architecture doc safe to archive?" | `audit_doc_l1_coverage(doc_id)` — per-block coverage report; promote capture-gaps via `sync_decision` / `log_pattern` before archiving |

**`start_id` convention.** Prefer the prefix form `'<type>-<id>'` (`'task-271'`, `'doc-76'`). Type vocabulary: `task`, `doc`, `decision`, `pattern`, `progress`. The wikilink form `'[[task-271]]'` is also accepted so a recipe response can be copy-pasted into the next call without translation. Plain integers still work as legacy fallback (resolved against the recipe's expected type), but the prefix form gives a clean 400 on type mismatch with an inverse-recipe suggestion — preferred when the type matters. Per-project ids autoincrement per table, so the same numeric id often exists across multiple namespaces; the prefix removes the guesswork.

`task_briefing` returns parent chain, motivating doc (walks up to parents if direct link missing), siblings, relevant decisions/patterns ranked by tag overlap, recent progress. `spec_implementation_status` returns implementation matrix grouped by epic, decisions taken since the spec was written, drift signals on outgoing references, recent progress on implementing tasks. Both support `format='markdown'` (default) or `format='json'`.

### Sync

| Trigger | Tool |
|---------|------|
| Technology choice | `sync_decision` |
| Trade-off with rationale | `sync_decision` |
| Amend / re-tag an existing decision | `update_decision` |

### Progress

| Trigger | Tool |
|---------|------|
| Standalone progress note (not a task close) | `log_progress` |
| **Closing a task** | `update_task` with `resolution=...` (auto-creates progress; do **not** also call `log_progress`) |
| Context has changed | `update_active_context` |

### Documentation

| Trigger | Tool |
|---------|------|
| Spec / API docs | `add_document` |
| Document body / metadata update | `update_document(content=<full markdown>, ...)` |
| List a doc's blocks (pick ulids before surgical edit) | `list_blocks(document_id)` |
| Read one block | `get_block(document_id, block_ulid)` |
| Edit one block (surgical) | `update_block(document_id, block_ulid, markdown)` |
| Insert a block | `insert_block(document_id, markdown, after?\|before?)` |
| Delete a block | `delete_block(document_id, block_ulid)` |
| Read a doc (with rendered Wave 5 stubs) | `get_document` (pass `raw=true` for unmodified markdown) |
| "Who references this doc/block?" | `get_block_backlinks` (omit `block_ulid` for whole doc) |
| "What's similar to this block but not yet linked?" | `get_semantically_related_blocks` |
| List item-graph + Wave 5 section edges for a doc | `get_linked` with `include_section_links=true` |

**Block-level editing is the default for any narrow change** — including specs. Use `update_block` / `insert_block` / `delete_block` for surgical edits; only one block re-embeds per call, structure is preserved, and the spec append-only invariant below doesn't engage. `update_document(content=...)` is the **wholesale-rewrite** channel: use it only when you really mean to replace most of the body at once.

**Spec append-only invariant (epic-296).** The invariant guards the **wholesale-rewrite path**. When `update_document` is called on a `doc_type='spec'` body it requires `change_kind`:

- `change_kind='amend'` — clarification / typo / formatting fix. Allowed; logged into `spec_amendments` with a mandatory `reason`.
- `change_kind='substantive'` — meaningful claim change. **Rejected.** Author a new spec via `add_document` and link the old one with `link_items(relationship='supersedes')`.

Block tools are not subject to `change_kind` (they're surgical by construction) — but the same rule applies in spirit: don't use a chain of block edits to rewrite a spec's claims. Substantive claim changes → new spec with `supersedes`. Accumulating `spec_amendments` rows on a single spec is almost always a signal the author was bouncing between block tools and `update_document` to repair structure, not a real spec evolution.

`doc_role='derived_view'` documents (synthesised from L1 by recipes like `current_architecture`) reject any body edit — regenerate via the recipe runner, don't hand-edit.

#### Anti-patterns: don't create a doc when an edit will do

These mistakes accumulate **synthesis drift** in the knowledge base —
readers end up with multiple half-stale documents on the same topic and
no signal about which one to trust.

**1. Meta-documents (a doc commenting on another doc).**
Never create a new `add_document` whose purpose is to *describe*, *amend*,
or *react to* an existing doc. Instead:

- Update the original via `update_document(content=...)` OR a surgical `update_block` / `insert_block` on the relevant block, OR
- Create an addendum doc with an explicit Wave 5 callout that links it to
  the source:

  ```markdown
  > [!extends] [[doc-12]]
  > Adds detail on the JWT validation pipeline.
  ```

  Supported callout types: `[!supersedes]`, `[!resolves]`, `[!extends]`,
  `[!relates-to]`.

**2. Clarifications / addenda / FAQ as a standalone doc with no edge.**
Same shape as the meta-doc anti-pattern: the reader has no way to find
the addendum from the original, and the original keeps showing the stale
answer. Choose:

- `update_document(content=...)` of the original (best when the original is yours and small), OR
- a new doc with `> [!extends] [[doc-N]]` for additive material, or
  `> [!supersedes] [[doc-N]]` if you're replacing the original's claim.

When in doubt, default to `> [!relates-to]` — Wave 5 drift detection will
surface real supersessions later.

#### Documentation Graph: callout decision

Before `add_document` with longer-form content, `search` first. If you find
overlapping material, pick one callout:

| If… | Use | Place callout in |
|---|---|---|
| New replaces old wholesale | `[!supersedes]` | **newer** doc |
| New answers an open question stated elsewhere | `[!resolves]` | **answering** doc |
| New adds detail; both stay canonical for their layer | `[!extends]` | **extension** |
| Cross-cutting concern; both authoritative | `[!relates-to]` | **either** (doc-level, one edge per pair) |

Default to `[!relates-to]` when unsure. Pin critical anchors with `^id`
(`## Auth Flow ^auth-flow`) — protects wikilinks across heading renames.
Full agent reference in `references/documentation_graph.md` (decision
flow, examples per callout, anchor mechanics, gap-resolution paths).

### Gaps (Knowledge Base Health)

| Trigger | Tool |
|---------|------|
| Init response shows gaps | Review `gaps.fresh` in init response |
| "Show all gaps" | `gap_list` with optional category/state filters |
| Seen a gap, will fix later | `gap_ack` (acknowledged, still visible) |
| "This is not a real gap" | `gap_dismiss` with mandatory reason |
| "Dismiss a whole cluster of gaps" | `gap_dismiss_bulk` with shared reason + filter (category/gap_type/subject_type) |
| Re-open dismissed gap | `gap_undismiss` |
| "How healthy is the KB?" | `gap_stats` |

### Semantic Pass (LLM-driven graph analysis)

| Trigger | Tool |
|---------|------|
| "Clean up the graph" | `semantic_cleanup` — one-click: run pass → reject noise → apply safe mutations → show remainder |
| "Run semantic analysis" | `semantic_pass_run` (dry_run=true first) |
| "Show proposals" | `semantic_proposals_list` |
| Approve a proposal | `semantic_proposal_approve` |
| Reject a proposal | `semantic_proposal_reject` with reason |
| Defer for later | `semantic_proposal_defer` |
| Apply approved proposals | `semantic_proposals_apply` |
| "Pass stats" | `semantic_pass_stats` |

---

## TASK HIERARCHY (2 levels, schema-enforced)

The task tree is **two levels** and the database enforces it (decision-683, migration 030):

- `kind='task'` — leaf node. May have `parent_task_id` pointing to an epic. Cannot have children.
- `kind='epic'` — root container. Always `parent_task_id=NULL`. Other tasks attach under it.

No third level. Trying to attach a task under another task (kind=task with kind=task parent) is **rejected at the DB level**. The MCP/REST layer maps the rejection to a structured `parent_not_epic` payload with two recovery options.

### Recovery: `parent_not_epic` error

When `add_task(parent_task_id=X)` or `update_task(parent_task_id=X)` returns:

```json
{
  "error": "parent_not_epic",
  "message": "Cannot attach a task under task-X — a task can only have an epic as parent.",
  "context": {
    "intended_parent": {"id": X, "kind": "task", "title": "..."},
    "resolved_epic":   {"id": Y, "kind": "epic", "title": "..."}
  },
  "suggestions": [
    {"action": "promote_parent",  "call": "update_task(task_id=X, kind='epic')"},
    {"action": "attach_to_epic",  "call": "add_task(..., parent_task_id=Y)"}
  ]
}
```

Decide by local context:

- **promote_parent** when X is itself a substantial body of work and the new task is a subtask of it → make X an epic, attach the new task under it.
- **attach_to_epic** when X is just another leaf inside an epic Y → attach the new task to Y as a sibling of X.

If `resolved_epic` is `null`, only `promote_parent` is offered — there's no ancestor epic in the chain.

### Promote / demote rules

- **Promote `task` → `epic`**: task must be root (no parent). Combine `kind='epic'` with `parent_task_id=0` in one `update_task` call to atomically detach + promote.
- **Demote `epic` → `task`**: epic must have no children. Close or reparent subtasks first.

Cross-references stay `task-N` for both kinds — epic is a subtype, not a separate namespace.

---

## CROSS-REFERENCE FORMAT (canonical grammar)

Every reference to another ConPort item — in `summary`, `rationale`,
`description`, document body, commit messages — uses the canonical form
`<type>-<number>`.

**Type vocabulary (lowercase):** `decision`, `task`, `doc`, `pattern`,
`progress`. No aliases (no `document`, no `tasks`, no `dec`).

**Forms accepted by the parser:**
- Plain prose: `decision-321`, `task-271`, `doc-76`.
- Wikilink: `[[decision-321]]`, `[[task-271]]`, `[[doc-76]]` — preferred inside
  document bodies; the autolinker reifies them as `item_links` rows.
- Block anchor (documents only): `[[doc-89#<block_ulid>]]` — link to a
  specific block (Wave 6).

**Anti-patterns** (silently break tag/graph navigation):

| ❌ Don't write | ✅ Write |
|---|---|
| `decision #321` (typed legacy with `#`) | `decision-321` |
| `Task #123, #124, #125` (untyped continuation) | `task-123, task-124, task-125` |
| `#634` (untyped, ambiguous) | `decision-634` (or the correct type) |
| `decision #1155` (pre-migration global id) | drop — autolinker can't resolve; cite the new per-project id |

**Microcheck (extends POST-WRITE VERIFICATION):**
Before the write call, scan your `summary` / `rationale` / `description`
payload for `#\d+`. If you find one:
1. Replace with `<type>-<number>` if you know the type.
2. Untyped or pre-migration id → either drop, or flag explicitly ("legacy id
   #N, not resolvable") so a reader knows it's intentional, not an oversight.

The parser currently accepts both legacy `#N` and canonical `<type>-N` so
older corpus stays linked; emit canonical-only in new writes.

---

## OUTPUT FORMAT

MCP tools return JSON with a `summary` field. Use it to inform the user.

| After | Format |
|-------|--------|
| `init` | `[CONPORT] {summary}` |
| `search` | `[ConPort: N results found for "query"] ...` |
| `update_task` | `✅ {summary}` |
| Task DONE/CANCELLED | `✅ {summary}` (progress entry was auto-logged from `resolution`) + suggest updating active_context |

### Slim create/update responses

MCP create / update tools (`sync_decision`, `add_task`, `update_task`,
`log_progress`, `update_progress`, `log_pattern`, `add_document`,
`update_document`, `update_active_context`, `update_product_context`) do
**not** echo the full entity body back. They return a slim payload to save
agent context:

| Field | Always present | Notes |
|---|---|---|
| `id` | yes | The created / updated row id |
| `tags` | when entity has tags | Echoed even as `[]` — verification channel for POST-WRITE VERIFICATION |
| `summary` | when computed | Short server-side confirmation string |
| `version` | for `add_document`, `update_document`, context updates | Auto-bumped revision number |
| `status`, `parent_epic_ready_to_close` | `update_task` only | Closing-batch signals |
| `kind` | `add_task` / `update_task` | Echoed for POST-WRITE verification on promote/demote |
| `_hint*` | when present | Server-side emergence signals (pattern candidates, etc.) |

Need the full entity body? Use the matching read tool — `get_task`,
`get_document`, `list_decisions`, etc. The REST API still returns full
bodies; only MCP write responses are slimmed.

---

## POST-WRITE VERIFICATION (Claude.ai XML quirk)

Claude.ai's MCP client occasionally drops optional parameters silently when
the surrounding XML is malformed (most often a missing `antml:` prefix on a
closing tag). The next parameter gets folded into the previous string field
and the tool returns 200 OK with the truncated payload — the write happened,
just not the way you intended. Real incident: a `sync_decision` call lost its
`tags` array because the tags ended up inside `rationale` text; the decision
landed without tags and broke tag-based graph navigation.

**Server-side reject (since 14.11.1).** The ConPort server now rejects any
write whose string field contains literal MCP tool-call fragments
(`<parameter …>`, `<invoke …>`, `</invoke>`, `<function_calls>`, `antml:*`).
The response is a structured error with `error: "mcp_payload_contaminated"`
listing the contaminated fields. Recovery: re-issue the call with the field
cleaned up. The bad write does not land. This catches the worst class of
XML-leak corruption automatically; the verification table below still applies
to the subtler quirks (silently dropped fields, truncated descriptions).

After **every** create/update call that took optional fields, verify the
response echo against intent:

| You passed | Check on the response |
|---|---|
| `tags=[...]` | Response `tags` is non-empty and matches intent (count + values) |
| `description=...` | `description` length ≈ what you sent (not visibly truncated) |
| `priority=N` | `priority` equals `N` |
| `parent_task_id`, `tag_kinds`, links | Field is present and equal to intent |
| `kind='epic'` / `kind='task'` on `add_task` / `update_task` | Response `kind` matches; on promote/demote the slim echo includes the new value |

**On mismatch.** Re-issue the call with the field re-stated explicitly (often a
single retry fixes XML-parse glitches). If the second attempt still loses the
field, flag the mismatch to the user verbatim ("graph integrity: tags lost on
decision N, please re-run") rather than silently moving on — the damage is
mute graph drift, easy to miss.

Applies to: `sync_decision`, `add_task`, `update_task`, `log_progress`,
`log_pattern`, `add_document`, `update_document`, `update_active_context`,
`update_product_context`, block ops (`update_block`, `insert_block`,
`delete_block`).

---

## MCP ERROR HANDLING

On an `Invalid arguments for tool` error:

1. **READ `path`** — the name of the broken parameter
2. **READ `expected`** — the required type
3. **FIX ONLY THAT PARAMETER**
4. **DO NOT TOUCH OTHER PARAMETERS**

| `path` | Fix |
|--------|-----|
| `project_id` | `"4"` → `4` |
| `tags` | `"tag"` → `["tag"]` |
| `priority` | `"3"` → `3` |

---

## CHECKLIST

- [ ] Has `init` been run?
- [ ] Question about the project → has `search` been done?
- [ ] New work → task created/updated?
- [ ] Work finished → task = DONE **with `resolution`**?
- [ ] Closing a task → did NOT call `log_progress` separately (it's auto-logged)?
- [ ] Decision made → `sync_decision`?
- [ ] Important information → document created?
- [ ] After every write → response echo verified (tags / description / priority match intent)?
- [ ] Cross-references in write payload → all in canonical `<type>-<number>` form (no `#N`, no `decision #321`)?

**Full API:** `references/command_list.md`
**Fresh-project onboarding:** `references/bootstrap.md`

---

*v15.9.0 | 83 MCP tools | Auto-detection | GraphRAG enabled | Gap detection | Semantic pass | Cross-project linked tasks | Block-level document model with per-block embeddings | Stable document_id with auto-bumped version | Document archival via status param | Priority-rollup backlog | Auto-synced current_focus | Task close with auto-logged resolution | Documentation anti-patterns guard | Documentation graph backlinks + semantically-related | Documentation graph authoring contract | Bulk gap dismissal | Recipe-pattern context assembly | Prefix-id convention | Skill version notification | Block-level document tools (list_blocks / get_block / update_block / insert_block / delete_block) | Post-write payload verification | Slim MCP write responses | Task reparenting via update_task | Canonical cross-reference grammar | Spec append-only enforcement (change_kind + spec_amendments audit) | Block-level callout edges in document_links | current_architecture recipe + L1 capture-gap audit | Task hierarchy schema invariant (kind='task'|'epic', 2-level enforced) | Per-task time tracking (estimated_seconds + started_at + completed_at + project rollups) | Server-side reject of MCP tool-call XML leakage*
