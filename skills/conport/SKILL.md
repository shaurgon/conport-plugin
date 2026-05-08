---
name: conport
description: Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start.
metadata:
  version: 13.9.0
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
mcp__conport__init({ name: "<detected_name>" })
```

If auto-detection did not work, ask the user.

### After init — MANDATORY:

1. **Print summary:** `[CONPORT] {summary from response}`
2. **Execute instructions** from the response (read files, apply rules)
3. **Report backlog:** `N задач в TODO, M в работе. Топ-5:` — use `backlog.top` from the response. Line format: `Pk · #id title (n subtasks)`, skipping `(n subtasks)` when zero. `Pk` is `effective_priority`. Skip the whole block if `backlog.total_todo == 0` and `backlog.total_in_progress == 0`.
4. **If the project is empty** (no decisions, no patterns, empty `product_context`) — offer the bootstrap flow from `references/bootstrap.md`.

**Without init you cannot:** answer questions about the project or work with tasks.
**Ignoring instructions is FORBIDDEN.**

---

## WORKFLOW — When to call which tool

### Planning

| Trigger | Tool |
|---------|------|
| "We need to do X" | `add_task` with priority |
| "X depends on Y" | `add_task_dep` |
| "Break it into subtasks" | `add_task` with `parent_task_id` |
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
| "What approaches do we use?" | `list_patterns` or `search` by topic |

### Search

| Trigger | Tool |
|---------|------|
| Question about the project | `search` BEFORE answering |
| "What was decided about Y?" | `search` by topic |

### Context assembly (recipe-pattern)

Structural context packages for a single node — task or spec — assembled by deterministic graph traversals. Complements `init` (whole-project, session start) and `search` (fuzzy on-ramp from free text). Use when you already know the anchor and want the neighbourhood in one call.

| Trigger | Tool |
|---------|------|
| "Open task #N and brief me" / agent opens a task | `assemble_context` with `recipe='task_briefing'`, `start_id=<task_id>` |
| "What's the implementation status of spec doc-N?" | `assemble_context` with `recipe='spec_implementation_status'`, `start_id=<doc_id>` |
| "What recipes are available?" | `list_context_recipes` |

`task_briefing` returns parent chain, motivating doc (walks up to parents if direct link missing), siblings, relevant decisions/patterns ranked by tag overlap, recent progress. `spec_implementation_status` returns implementation matrix grouped by epic, decisions taken since the spec was written, drift signals on outgoing references, recent progress on implementing tasks. Both support `format='markdown'` (default) or `format='json'`.

### Sync

| Trigger | Tool |
|---------|------|
| Technology choice | `sync_decision` |
| Trade-off with rationale | `sync_decision` |

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
| Document update | `update_document` |
| Read a doc (with rendered Wave 5 stubs) | `get_document` (pass `raw=true` for unmodified markdown) |
| "Who references this doc/section?" | `get_section_backlinks` (omit `section_anchor` for whole doc) |
| "What's similar to this section but not yet linked?" | `get_related_sections` |
| List item-graph + Wave 5 section edges for a doc | `get_linked` with `include_section_links=true` |

#### Anti-patterns: don't create a doc when an edit will do

These mistakes accumulate **synthesis drift** in the knowledge base —
readers end up with multiple half-stale documents on the same topic and
no signal about which one to trust.

**1. Meta-documents (a doc commenting on another doc).**
Never create a new `add_document` whose purpose is to *describe*, *amend*,
or *react to* an existing doc. Instead:

- Update the original via `update_document` with `replace_section_body` /
  `append_to_section`, OR
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

- `update_document` of the original (best when the original is yours and
  small), OR
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

## OUTPUT FORMAT

MCP tools return JSON with a `summary` field. Use it to inform the user.

| After | Format |
|-------|--------|
| `init` | `[CONPORT] {summary}` |
| `search` | `[ConPort: N results found for "query"] ...` |
| `update_task` | `✅ {summary}` |
| Task DONE/CANCELLED | `✅ {summary}` (progress entry was auto-logged from `resolution`) + suggest updating active_context |

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

**Full API:** `references/command_list.md`
**Fresh-project onboarding:** `references/bootstrap.md`

---

*v13.9.0 | 69 MCP tools | Auto-detection | GraphRAG enabled | Gap detection | Semantic pass | Cross-project linked tasks | Surgical document patching | Stable document_id with auto-bumped version | Document archival via status param | Priority-rollup backlog | Auto-synced current_focus | Task close with auto-logged resolution | Documentation anti-patterns guard | Documentation graph backlinks + semantically-related | Documentation graph authoring contract | Bulk gap dismissal | Recipe-pattern context assembly*
