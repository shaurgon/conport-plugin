# ConPort MCP Tools Reference

> Full reference for ConPort v7.0+ MCP tools

## Call format

The prefix depends on the environment:

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

**All examples below use the short prefix `mcp__conport__`.**
In Claude.ai Chat, replace it with `mcp__claude_ai_conport__`.

```
mcp__conport__<tool_name>({
  param1: value1,
  param2: value2
})
```

> **Identifiers:** most items are addressed by their **per-project sequential
> ID** (`task_id`, `decision_id`, `document_id`, `pattern_id`,
> `progress_id`). `project_id` is still the integer project ID.

---

## Session

### init

Initialize/load a project. Project name is required.

```
mcp__conport__init({
  name: "my-project",
  description: "Optional description"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | yes | Project name (1-50 chars, ASCII alphanumeric/hyphen/underscore) |
| description | string | no | Project description (max 2000 chars) |
| skill_id | string | no | Skill the client runs (`conport`, `conport-agent`) — only used to detect an available skill update |
| skill_version | string | no | Semver of the installed SKILL.md content (independent of the plugin release tag) |
| client_type | string | no | Calling environment: `claude-code` \| `claude-ai` \| `cursor` \| `openclaw` \| `mcporter` \| `paperclip`. Picks the install-guide URL of an update notice |

**Returns:** `project_id`, `name`, `recent_decisions`, `recent_patterns`,
`backlog` (`total_todo`, `total_in_progress`, `top` — up to 5 items with
`effective_priority` and `subtask_count`), `stats`, `active_context`
(`current_focus`, `open_questions`), `recent_progress` (last 5 `log_progress`
entries), `gaps` (`fresh` + `chronic`), `instructions` and `summary`.
Conditional sections: `reconciliation` when stale IN_PROGRESS tasks are
detected, `cleanup_hint` when the graph is worth a `semantic_cleanup`,
`routine_suggestion` for a routine-ripe project with no policy yet,
`skill_update_available` when the caller passed skill metadata and a newer
version exists, and `roadmap` (current milestone with its epics + `next`) /
`epic_tails` (epics near closing, each with a prescribed `suggested_action`)
only when the project has them; `backlog.top` rows carry `milestone_id` and the
current milestone's rows float up.
Top-5 excludes subtasks of active epics so
you see roots + orphans; `effective_priority` rolls up the most-important
priority across direct children (priority is industry-standard 1-5 where
1=critical and 5=idle, so "most important" = the smallest number).

**Refusals:** `name_required` when `name` is empty — the project is never
guessed.

### list_projects

List the projects you own — use it to discover project IDs before calling
project-scoped tools.

```
mcp__conport__list_projects({
  limit: 100
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | integer | no | Max projects (default: 100, clamped to 1..500) |
| offset | integer | no | Pagination offset (default: 0) |

**Returns:** `projects` (`id`, `name`, `description`, `created_at`,
`updated_at`) and `total`.

---

## Context

### update_product_context

Update a single product context field (vision, goals, architecture, etc.)

```
mcp__conport__update_product_context({
  project_id: 11,
  field: "vision",
  value: "AI-powered knowledge base"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| field | string | yes | vision \| goals \| features \| architecture \| tech_stack \| constraints |
| value | string/array | yes | New value |

**Returns:** a slim echo — the context row `id` plus the new `version`.

### update_active_context

Update a single active context field. `current_focus` is usually managed
automatically — it snaps to the task you move to IN_PROGRESS and clears when
that task leaves IN_PROGRESS, so manual writes are rarely needed.
`open_questions` is the free-form human field for pending questions.

```
mcp__conport__update_active_context({
  project_id: 11,
  field: "open_questions",
  value: ["How should we handle rate limits?"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| field | string | yes | current_focus \| open_questions |
| value | string/array | yes | New value |

**Returns:** a slim echo — the context row `id` plus the new `version`.

### context_history

Context version history

```
mcp__conport__context_history({
  project_id: 11,
  context_type: "product",
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| context_type | string | yes | "product" or "active" |
| limit | integer | no | Max versions (default: 10) |

**Returns:** `versions` (newest `version` first, each with `id`, `content`,
`version`, `created_at`, `updated_at`) and `total`.

---

## Decisions

### sync_decision

Create an architectural decision. Triggers pattern-emergence check in the
background (cluster of similar decisions may auto-generate a pattern).

```
mcp__conport__sync_decision({
  project_id: 11,
  summary: "Use PostgreSQL",
  rationale: "ACID compliance",
  tags: ["database", "arch"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| summary | string | yes | Short summary (max 200 chars) |
| rationale | string/object | no | Rationale (max 2000 chars). JSON string or object. |
| tags | array | no | Tags |

**Returns:** a slim echo — `id`, `tags`, `summary`. May include
`_hint`, `_similar_decisions`, `_hint_message` when a cluster is detected.

### update_decision

Amend an existing decision. Partial — only the fields you pass change.
Refreshes the embedding and re-runs the auto-mention links, so canonical
references in the updated text become graph edges. Read the current body with
`get_decision` first: `tags` is replaced wholesale, not merged.

```
mcp__conport__update_decision({
  project_id: 11,
  decision_id: 5,
  summary: "Use PostgreSQL with pgvector",
  tags: ["database", "arch", "search"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID to update |
| summary | string | no | New summary (max 200 chars) |
| rationale | string/object | no | New rationale. JSON string or object. |
| implementation_details | string | no | New implementation details |
| tags | array | no | New tag list — replaces the existing tags entirely |

**Returns:** a slim echo — `id`, `tags`, `summary`. An unknown decision is
rejected as not found.

### deprecate_decision

Retire a decision whose premise no longer holds and that has **no**
replacement — sets `currency` to `deprecated`. When there *is* a replacement,
create the new decision instead and connect the two with
`link_items` using `link_type: "supersedes"`; that path annotates the old one
as `superseded` and keeps the trail readable.

```
mcp__conport__deprecate_decision({
  project_id: 11,
  decision_id: 5,
  reason: "The external tooling this assumed no longer exists"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID |
| reason | string | yes | Why it is retired |

**Returns:** a slim echo — `id`, `tags`, `summary` — plus `currency`
(`deprecated`), `deprecated_at` and `deprecation_reason`.

**Refusals:** `not_found` for an unknown decision, `invalid_request` when
`reason` is empty.

### reactivate_decision

Clear the deprecation marker set by `deprecate_decision`. `currency` is
recomputed from scratch — the decision goes back to `current`, or to
`superseded` if another decision now supersedes it.

```
mcp__conport__reactivate_decision({
  project_id: 11,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** a slim echo — `id`, `tags`, `summary` — plus the recomputed
`currency` and `deprecated_at` (now `null`).

**Refusals:** `not_found` for an unknown decision.

### list_decisions

List architectural decisions

```
mcp__conport__list_decisions({
  project_id: 11,
  tags: ["database"],
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 20) |
| offset | integer | no | Pagination offset (default: 0) |
| tags | array | no | Filter by tags |
| source | string | no | Filter by provenance: `manual` (hand-written) \| `progress_extraction` (auto-extracted from progress; candidates are staged as semantic proposals and only become decisions after approval) |
| only_current | boolean | no | Drop superseded and deprecated decisions, leaving only what still holds (default: false) |

**Returns:** `decisions` (newest first — `id`, `summary`, `rationale`,
`implementation_details`, `tags`, `source`, `extracted_from_progress_id`,
`deprecated_at`, `deprecation_reason`, timestamps, plus the lifecycle
annotation `currency` / `superseded_by` / `age_days`) and `total`. Decisions
absorbed into a pattern are left out; `only_current` filters after the count,
so `total` still reports the pre-filter number.

**Refusals:** `invalid_source` for a `source` value outside the vocabulary.

### get_decision

Full body of one decision by id. Use it before `update_decision` to read the
current tags — `update_decision` replaces the tag list wholesale.

```
mcp__conport__get_decision({
  project_id: 11,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** `summary`, `rationale`, `implementation_details`, `tags`,
`source`, timestamps and the lifecycle annotation — `currency`, `age_days`,
`deprecated_at`, `deprecation_reason`, `superseded_by`. An unknown decision is
an error.

### delete_decision

Delete a decision by per-project ID

```
mcp__conport__delete_decision({
  project_id: 11,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** `deleted: true` and the `decision_id`.

**Refusals:** `not_found` for an unknown decision.

---

## Progress (Activity Log)

Progress entries are a pure activity log without workflow statuses.
For tasks with statuses, use **Tasks**.

### log_progress

Create an activity log entry. Optionally links to a task/decision/pattern
(linked target referenced by its per-project ID).

```
mcp__conport__log_progress({
  project_id: 11,
  description: "Started work on auth module",
  title: "Auth update",
  linked_item_type: "task",
  linked_item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| description | string | yes | Description (max 2000 chars) |
| title | string | no | Title (max 200 chars) |
| parent_id | integer | no | Per-project ID of parent progress entry (threading) |
| linked_item_type | string | no | task \| decision \| pattern |
| linked_item_id | integer | no | Per-project ID of the linked item |

**Returns:** a slim echo — the new entry `id`. Canonical references in the text
become graph edges on the write itself; decision extraction from the text runs
afterwards in the background.

### update_progress

Update an activity entry

```
mcp__conport__update_progress({
  project_id: 11,
  progress_id: 45,
  description: "Updated implementation notes"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| progress_id | integer | yes | Per-project progress entry ID |
| title | string | no | New title |
| description | string | no | New description |

**Returns:** a slim echo — the entry `id`. Changing `description` re-embeds the
entry.

### list_progress

List progress entries

```
mcp__conport__list_progress({
  project_id: 11,
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 50) |
| offset | integer | no | Pagination offset (default: 0) |

**Returns:** `entries` (newest first — `id`, `title`, `description`,
`parent_id`, `linked_item_type`, `linked_item_id`, timestamps) and `total`.

### delete_progress

Delete a progress entry

```
mcp__conport__delete_progress({
  project_id: 11,
  progress_id: 8
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| progress_id | integer | yes | Per-project progress entry ID |

**Returns:** `deleted: true` and the `progress_id`.

**Refusals:** `not_found` for an unknown entry.

---

## Tasks

### add_task

Create a task or an epic, with optional hierarchy and priority

```
mcp__conport__add_task({
  project_id: 11,
  title: "Implement auth",
  status: "TODO",
  priority: 2,
  estimated_seconds: 5400
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| title | string | yes | Title (max 200 chars) |
| description | string | no | Description (max 2000 chars) |
| status | string | no | TODO \| IN_PROGRESS \| BLOCKED \| DONE \| CANCELLED (default: TODO) |
| priority | integer | no | 1-5 (1=critical, 5=idle, default: 3) |
| parent_task_id | integer | no | Per-project ID of parent task. The parent must be `kind='epic'` |
| kind | string | no | `task` (default, leaf) or `epic` (root container). Tasks attach under epics; an epic can never have a parent |
| estimated_seconds | integer | no | Estimated effort in seconds. Epic rows reject it (`epic_does_not_carry_time_fields`) — an epic's effort is summed from its children |
| routine_eligible | boolean | no | Opt-in marker for the autonomous routine cycle: `true` lets an agent pick the task up on its own (`selection='tagged'`). Orthogonal to priority (default: false) |
| milestone_id | integer | no | Per-project ID of the roadmap milestone this epic belongs to. Only `kind='epic'` rows may carry one (`milestone_on_non_epic`); an unknown milestone is rejected with `milestone_not_found`. `0` means no milestone — exactly the same as omitting it (there is nothing to detach on create) |

**Returns:** a slim echo — `id`, `tags`, `summary` — plus the applied `kind`,
`estimated_seconds` and `milestone_id`. Creating a task under an epic also
returns `epic_progress`, the parent epic's children rollup: `epic_id`,
`epic_title`, `open_children`, `total_children`, `closable` (no open children
left and the epic itself still open) and `grew_after_start: true` when the
append landed on an epic somebody had already started — a growing tail. The
`summary` spells the rollup out; the field stays machine-readable. A task
created at root level carries no `epic_progress`.

**Refusals:** the hierarchy invariants come back as structured errors:
`parent_not_epic` (with `suggestions` naming the promote / attach call to make
next), `epic_with_parent`, `epic_does_not_carry_time_fields`,
`milestone_on_non_epic`, `milestone_not_found`.

### update_task

Update a task. Closing it (`status: "DONE"` / `"CANCELLED"`) always carries a
`resolution`.

```
mcp__conport__update_task({
  project_id: 11,
  task_id: 5,
  status: "DONE",
  resolution: "Auth shipped behind a feature flag"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |
| title | string | no | New title |
| description | string | no | New description |
| status | string | no | New status. On an epic, `DONE` requires every child to be closed first (`epic_not_ready`); `CANCELLED` is allowed in any state |
| priority | integer | no | New priority 1-5 (1=critical, 5=idle) |
| parent_task_id | integer | no | Re-parent the task. Positive per-project task id attaches under that parent (must be `kind='epic'`), `0` detaches to root level, omit to leave unchanged. A parent from another project is rejected as not-found, and so is any move that would attach the task under one of its own descendants (cycle) |
| resolution | string | no | Verdict recorded on close — applied only when `status` moves to DONE or CANCELLED, ignored otherwise. Upserted as a `## Resolution` section of the description (the original body is preserved) and logged as a linked progress entry |
| kind | string | no | Promote `task` → `epic` (the task must be root — combine with `parent_task_id: 0` to detach and promote in one call) or demote `epic` → `task` (the epic must have no children) |
| estimated_seconds | integer | no | Estimated effort in seconds. Epic rows reject it (`epic_does_not_carry_time_fields`) |
| snooze_until | string | no | ISO 8601 timestamp — hide the task from default listings until then (status unchanged, it wakes on its own when the time passes). A timestamp without a timezone is read as UTC. Empty string clears the snooze, omit to leave unchanged |
| routine_eligible | boolean | no | Autonomous-cycle opt-in marker (see `add_task`). Pass `true`/`false` to set, omit to leave unchanged |
| milestone_id | integer | no | Attach this epic to a roadmap milestone. Positive id attaches, `0` detaches, omit to leave unchanged. Epics only (`milestone_on_non_epic`); unknown milestone → `milestone_not_found`; an epic must be detached before it can be demoted to a task (`epic_has_milestone`) |

**Returns:** a slim echo — `id`, `tags`, `summary`, `resolution_applied` (true
when the close upserted the `## Resolution` section) and, for post-write
verification, the applied `status`, `kind`, `estimated_seconds`,
`routine_eligible`, `snooze_until`, `milestone_id`. Plus the rollups that save
a follow-up read: `parent_epic_ready_to_close` (`id` + `title` of the parent
epic when this close left it with no open children — close it next; `null`
otherwise), `started_at` / `completed_at` (stamped on the first entry into
IN_PROGRESS and on DONE), `claim_expires_at` (the IN_PROGRESS lease — renewed
on every touch while the task is IN_PROGRESS, cleared when it leaves that
status) and `estimate_drift` (`estimated_seconds`, `actual_seconds`, `ratio`),
present only when a task that carried an estimate actually transitions to DONE.
A write that moves the parent epic's tail — a status change or a re-parent —
also returns `epic_progress` (same shape as under `add_task`, without
`grew_after_start`); an edit that leaves the tail alone (title, description,
priority, …) carries none. On a detach (`parent_task_id: 0`) the rollup
describes the epic the task **left** — that is the tail that just changed. A
move between epics (A → B) echoes only the **new** parent B, so when you need
A's tail after the move, read it with `list_tasks(parent_task_id=A)`.

**Refusals:** closing an epic (`status: "DONE"`) while any of its children is
still open comes back as a structured `epic_not_ready` with
`context.open_children` (`id`, `title`, `status`) naming exactly what to close
first — a snoozed child counts as open, a snooze hides a task, it does not
close it. `CANCELLED` is never gated: dropping the work is an explicit act.
The hierarchy invariants come back the same way: `parent_not_epic` (with
`suggestions`), `epic_with_parent`, `task_has_parent`, `epic_has_children`,
`milestone_on_non_epic`, `milestone_not_found`, `epic_has_milestone`.

### list_tasks

List tasks with filters. Defaults to active tasks (TODO + IN_PROGRESS).
Pass `status: "ALL"` for all statuses, or a comma-separated list.

```
mcp__conport__list_tasks({
  project_id: 11,
  status: "IN_PROGRESS"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| status | string | no | Filter by status. Comma-separated or "ALL" (default: "TODO,IN_PROGRESS") |
| priority | integer | no | Filter by priority 1-5 (1=critical, 5=idle) |
| parent_task_id | integer | no | Filter by parent per-project ID (0 = root tasks only) |
| kind | string | no | Filter by hierarchy role: `task` or `epic`. Omit to include both |
| ready | boolean | no | Only tasks with no open blocking dependency — a `blocks`/`requires` dependency on a task in TODO/IN_PROGRESS/BLOCKED excludes it; `suggests` and DONE/CANCELLED targets never block (default: false) |
| include_snoozed | boolean | no | Include tasks snoozed into the future (`snooze_until` > now). Default false — snoozed tasks stay hidden from the list and the count until their snooze elapses |
| routine_eligible | boolean | no | Filter by the autonomous-cycle opt-in marker: `true` — only marked tasks, `false` — only unmarked. Omit for no filter |
| order | string | no | `created_at` (default, newest first) or `priority` — rank by effective priority (the smallest of the task's own priority and the priorities of its active TODO/IN_PROGRESS direct children; ties broken by newest first). With `priority` each task carries `effective_priority` |
| limit | integer | no | Max results (default: 50) |
| offset | integer | no | Pagination offset — page deeper than the first `limit` tasks (default: 0) |
| include_description | boolean | no | Include task descriptions (default: false) |

**Returns:** `tasks` (`id`, `title`, `status`, `priority`, `parent_task_id`,
`kind`, `estimated_seconds`, `actual_seconds`, `started_at`, `completed_at`,
`snooze_until`, `claim_expires_at`, `routine_eligible`, `milestone_id`,
timestamps — plus `effective_priority` with `order: "priority"`), `total` and a
one-line `summary`. Epic rows carry the time sums of their children.

### get_task

Task details with dependencies and subtasks

```
mcp__conport__get_task({
  project_id: 11,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |

**Returns:** the full task row (description always included) plus
`dependencies`, `dependents` and `subtasks_count`. An epic reports the
`estimated_seconds` / `actual_seconds` summed across its children.

### add_task_dep

Add a dependency between two tasks

```
mcp__conport__add_task_dep({
  project_id: 11,
  task_id: 5,
  depends_on_task_id: 3,
  dependency_type: "blocks"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project ID of the dependent task |
| depends_on_task_id | integer | yes | Per-project ID of the task it depends on |
| dependency_type | string | no | blocks \| requires \| suggests (default: blocks) |

**Returns:** `task_id`, `depends_on_task_id`, `dependency_type`, `created_at`
and the target's `depends_on_title` / `depends_on_status`. A self-dependency, a
duplicate edge or an unknown task on either side is an error.

### delete_task

Delete a task (also removes its dependencies)

```
mcp__conport__delete_task({
  project_id: 11,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |

**Returns:** a `message` confirming the deletion plus `deleted: true` and the
`id` that was removed; deleting a child of an epic also returns `epic_progress`
— the shrunk epic's rollup (same shape as under `add_task`, without
`grew_after_start`), so a delete that empties a tail says so on the spot.
Dependencies and graph mentions of the task are removed with it; an unknown
task is an error.

### add_linked_task

Create a task in **another** project you own without switching context, and
record the backref in the current project. Note the parameter names here differ
from the rest of the Tasks section: the current project is `source_project_id`
and the target is addressed by **name**.

```
mcp__conport__add_linked_task({
  source_project_id: 11,
  target_project: "other-project",
  title: "Expose the new endpoint in the SDK",
  priority: 2
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| source_project_id | integer | yes | ID of the project you are working in — the "from" side of the link |
| target_project | string | yes | **Name** of the project the task is created in. Must belong to you — anything else is not found |
| title | string | yes | Task title (max 200 chars) |
| description | string | no | Task description (max 2000 chars) |
| priority | integer | no | 1-5 (1=critical, 5=idle, default: 3) |
| status | string | no | TODO \| IN_PROGRESS \| BLOCKED \| DONE \| CANCELLED (default: TODO) |

**Returns:** `target_task` (the created task, full body — this one is not
slimmed), `source_progress` (the log entry written in the source project),
`link_id` and `summary`.

**Errors:** passing the same project on both sides fails with 400 — use
`add_task` for a task in the project you are already in.

---

## Milestones (roadmap)

A milestone is an ordered per-project group of epics. Epics attach through
`add_task` / `update_task` with `milestone_id` — there is no separate attach
tool. The **current** milestone is the OPEN one with the smallest `sequence`.

### add_milestone

Create a milestone. Omit `sequence` to append after the last one.

```
mcp__conport__add_milestone({
  project_id: 11,
  title: "MVP stabilisation",
  is_release: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| title | string | yes | Milestone title |
| description | string | no | What this milestone delivers |
| sequence | integer | no | Position on the roadmap. Omitted = append after the last milestone; an explicit value inserts at that position and shifts the milestones at or after it one down. Clamped to the existing range (1 … last+1) |
| is_release | boolean | no | Mark it as a release point — its closing resolution should confirm the actual release (default: false) |

**Returns (slim):** `id`, `summary`, `sequence`, `is_release`, `status`. `title`
is deliberately not echoed — `sequence` / `is_release` are the post-write
verification channel.

### update_milestone

Edit fields, move the milestone (`sequence`) or close it (`status` + `resolution`).

```
mcp__conport__update_milestone({
  project_id: 11,
  milestone_id: 2,
  status: "DONE",
  resolution: "v1.3 released"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| milestone_id | integer | yes | Per-project milestone ID |
| title | string | no | New title |
| description | string | no | New description |
| sequence | integer | no | Move to this position; the milestones it jumps over shift one place the other way. Clamped to the existing roadmap range |
| is_release | boolean | no | Set / clear the release marker |
| status | string | no | OPEN \| DONE \| CANCELLED. DONE requires every epic of the milestone to be closed; CANCELLED is allowed in any state |
| resolution | string | no | Required when closing — what was delivered (DONE) or why it was dropped (CANCELLED). The close also logs a progress entry carrying it |

**Returns (slim):** `id`, `summary`, `sequence`, `is_release`, `status` — same
post-write verification channel as `add_milestone`.

**Refusals:** `milestone_not_ready` when DONE is asked for while epics are still
open — `context.open_epics` lists what to close first (an empty milestone with
no epics attached is refused too). `validation_error` on an unknown status or a
close without `resolution`. `not_found` for an unknown milestone.

### list_milestones

Roadmap view: milestones by `sequence`, each with its epics.

```
mcp__conport__list_milestones({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| include_closed | boolean | no | Include DONE/CANCELLED milestones (default: false — the roadmap shows what is still ahead) |

**Returns:** `milestones` (each with `id`, `title`, `description`, `sequence`,
`is_release`, `status`, `resolution`, `closed_at`, `ready_to_close`,
`is_current`, `summary`, and `epics` — per epic `task_id`, `title`, `status`,
`open_children`, `total_children`, plus the tail signals `is_tail` (open epic
with at least one closed child and at most 3 open ones) and `closable` (its
zero-open case — close it with a resolution)) and `total`.

---

## Documents

### add_document

Create a document

```
mcp__conport__add_document({
  project_id: 11,
  title: "API Spec",
  content: "# API\n...",
  doc_type: "api_docs"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| title | string | yes | Title (max 200 chars) |
| content | string | yes | Content (max 50000 chars) |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| other |
| author | string | no | Author (max 100 chars) |
| tags | array | no | Tags |
| parent_document_id | integer | no | Per-project ID of parent document |

**Returns:** a slim echo — `id`, `tags` and `version` (1 for a fresh document),
so you can confirm where the body landed. The body is split into blocks on the
write itself; their embeddings and entity extraction follow in the background.

### update_document

Replace the document body and/or update metadata. Body changes go through the block reconciliation engine (unchanged blocks keep ULIDs + embeddings, changed blocks re-embed, deleted blocks are dropped).

```
mcp__conport__update_document({
  project_id: 11,
  document_id: 5,
  content: "# Auth Design\n\nFull markdown body — replaces the document content.\n\n## API\n..."
})
```

The body is parsed into blocks server-side via the block reconciliation algorithm — unchanged blocks keep their ULIDs (and their embeddings/entity mentions), changed blocks get re-embedded, deleted blocks are dropped. Cheaper than naive replace because only the dirty parts hit Mistral.

Metadata-only updates work without a `content` field — pass just `title`, `doc_type`, `tags`, etc. and the body is untouched.

For surgical single-block edits, prefer `update_block` (skips the parse/reconcile round-trip).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| content | string | no | Full markdown body. Omit for metadata-only update. |
| title | string | no | New title |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| other |
| tags | array | no | New tag list |
| author | string | no | New author |
| status | string | no | Lifecycle status — `active` (default) or `archived`. Archived documents drop out of default listings and search but stay readable by id. |
| change_kind | string | no | `amend` \| `substantive` — required to change the **body** of a `doc_type='spec'` document. `substantive` is always rejected: author a new spec with `add_document` and emit a `supersedes` edge instead |
| reason | string | no | Why the amendment was made. Required with `change_kind: "amend"`, recorded in the spec amendment log |

**Returns:** a slim echo — `id`, `tags` and the auto-bumped `version`.

**Refusals:** a `doc_role='derived_view'` document rejects any body change (it
is regenerated by the recipe runner); a spec body edit without `change_kind`,
with `change_kind: "substantive"`, or with `change_kind: "amend"` and no
`reason`, is rejected as well.

### list_blocks

List a document's blocks in order with their ULIDs — the discovery step before
`get_block` / `update_block` / `insert_block` / `delete_block`.

```
mcp__conport__list_blocks({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

**Returns:** `blocks` (`ulid`, `type`, `ord`, `text_preview` — truncated at 200
chars, `content_hash`) and `total`. Use `get_block` for a full block body.

### get_block

Read one block by ULID.

```
mcp__conport__get_block({
  project_id: 11,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to read |

**Returns:** the block JSON — `{ulid, type, ord, text, attrs, content_hash,
created_at, updated_at}`. An unknown ULID is an error, not an empty result.

### update_block

Replace one block's markdown without touching the rest of the document. Surgical — only this block re-embeds.

```
mcp__conport__update_block({
  project_id: 11,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF",
  markdown: "## API Endpoints\n\nNew content for just this heading-block."
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to update |
| markdown | string | yes | New markdown for this block. Must parse to **exactly one** block — a multi-block payload is rejected |

**Returns:** `ulid`, `type`, `content_hash` and `changed_block_ids` (the blocks
queued for re-embedding).

### insert_block

Insert a new block. Pass `after=<ulid>` or `before=<ulid>` to position it; omit
both to append at the end. `after` wins when both are given.

```
mcp__conport__insert_block({
  project_id: 11,
  document_id: 5,
  markdown: "## New Section\n\nFresh paragraph.",
  after: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| markdown | string | yes | Markdown for the new block. Must parse to **exactly one** block |
| after | string | no | ULID to insert after (takes precedence over `before`) |
| before | string | no | ULID to insert before (ignored when `after` is given) |

**Returns:** `ulid`, `type`, `ord`, `content_hash` and `changed_block_ids`.

### delete_block

Delete one block by ULID. Its mentions go with it and the document
re-serializes; an unknown ULID is an error.

```
mcp__conport__delete_block({
  project_id: 11,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to delete |

**Returns:** a confirmation `message` and `changed_block_ids`.

### list_documents

List documents

```
mcp__conport__list_documents({
  project_id: 11,
  doc_type: "spec"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| doc_type | string | no | Filter by type |
| limit | integer | no | Max results (default: 50) |

**Returns:** `documents` (newest update first — `id`, `title`, `doc_type`,
`doc_role`, `version`, `is_current`, `status`, `author`, `tags`, timestamps,
`content_preview` truncated at 200 chars, `content_length`) and `total`. Only
current, non-archived versions are listed.

### get_document

Get a document. By default the response carries Wave 5 render-time stubs
injected for sections with incoming `supersedes` / `resolves` / `extends`
edges (when the server-side `DOC_GRAPH_RENDER_STUBS` flag is on). Pass
`raw=true` for the unmodified markdown — useful for parser tests, raw
exports, and version history reads.

```
mcp__conport__get_document({
  project_id: 11,
  document_id: 5,
  raw: false
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| raw | boolean | no | If true, bypass stub injection. Default false. |

**Returns:** the full document — `id`, `title`, `content`, `doc_type`,
`doc_role`, `version`, `is_current`, `status`, `previous_version_id`,
`parent_document_id`, `author`, `external_url`, `tags`, `children_count`,
timestamps. An unknown document is an error.

### get_block_backlinks

Incoming Wave 6 edges (`document_links`) pointing at this document or one
of its blocks. Surfaces *authored* references — the markdown callout/
wikilink that produced each edge sits in `source_text`.

```
mcp__conport__get_block_backlinks({
  project_id: 11,
  document_id: 12,
  block_ulid: "01HZ...",   // omit for whole-doc + all blocks
  edge_types: ["supersedes", "resolves"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Document targeted by incoming edges |
| block_ulid | string | no | Restrict to one block's incoming edges |
| edge_types | string[] | no | Filter: `supersedes`, `resolves`, `relates_to`, `extends`, `wikilink`. Unknown values raise 400. |
| limit | integer | no | 1..200 (default 50) |
| offset | integer | no | Pagination offset |

**Returns:** `backlinks` (`link_id`, `from_doc_id`, `from_doc_title`,
`from_block_ulid`, `to_block_ulid`, `edge_type`, `source_text`, `weight`,
`source_offset`, `created_at`) and `total`.

### get_semantically_related_blocks

Top-N semantically related blocks by embedding similarity. Excludes the
source block itself and any blocks already linked to/from it via
`document_links` — surfaces *discovered* relationships, not already-
authored ones. Companion to `get_block_backlinks`.

```
mcp__conport__get_semantically_related_blocks({
  project_id: 11,
  document_id: 12,
  block_ulid: "01HZ...",
  limit: 5,
  threshold: 0.7
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Source document |
| block_ulid | string | yes | Source block ULID (must exist and have an embedding) |
| limit | integer | no | 1..50 (default 10) |
| threshold | number | no | Min cosine similarity in [0, 1] (default 0.8) |

**Returns:** `related` (`doc_id`, `doc_title`, `block_ulid`, `block_preview`,
`similarity`) and `total`. A source block whose embedding has not been computed
yet is an error, not an empty result.

### document_versions

Document version history

```
mcp__conport__document_versions({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

**Returns:** `document_id`, `title`, `versions` (every version of that title —
`id`, `version`, `is_current`, `author`, `created_at`) and `total`.

### delete_document

Delete a document

```
mcp__conport__delete_document({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

**Returns:** a confirmation `message`. An unknown document is an error.

---

## Patterns

### log_pattern

Create a system pattern

```
mcp__conport__log_pattern({
  project_id: 11,
  name: "Repository Pattern",
  description: "Data access abstraction",
  tags: ["architecture", "data"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| name | string | yes | Name (max 200 chars) |
| description | string | yes | Description (max 2000 chars) |
| tags | array | no | Tags |

**Returns:** a slim echo — `id` and the stored `tags`.

### update_pattern

Amend an existing pattern. Partial — only the fields you pass change.
Refreshes the embedding and re-runs the auto-mention links, so canonical
references in the updated text become graph edges. `tags` is replaced
wholesale, not merged.

```
mcp__conport__update_pattern({
  project_id: 11,
  pattern_id: 3,
  description: "Data access abstraction, one repository per aggregate",
  tags: ["architecture", "data"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| pattern_id | integer | yes | Per-project pattern ID to update |
| name | string | no | New name (max 200 chars) |
| description | string | no | New description |
| tags | array | no | New tag list — replaces the existing tags entirely |

**Returns:** a slim echo — `id` and the stored `tags`.

### list_patterns

List architectural patterns

```
mcp__conport__list_patterns({
  project_id: 11,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 20) |
| offset | integer | no | Pagination offset (default: 0) |
| tags | array | no | Filter by tags — a pattern matches when it carries any of them |

**Returns:** `patterns` (newest first — `id`, `name`, `description`, `tags`,
timestamps) and `total`.

---

## Knowledge Graph Links

### link_items

Create a link between two items. Both source and target are referenced by
their **per-project IDs** (sequential within the project).

```
mcp__conport__link_items({
  project_id: 11,
  source_type: "decision",
  source_id: 7,
  target_type: "pattern",
  target_id: 3,
  relationship: "implements",
  description: "Decision implements this pattern"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| source_type | string | yes | decision \| progress \| pattern \| task \| **doc** (documents are `doc` here, not `document`) |
| source_id | integer | yes | Per-project ID of source item |
| target_type | string | yes | decision \| progress \| pattern \| task \| doc |
| target_id | integer | yes | Per-project ID of target item |
| relationship | string | no | Link type (default: relates_to) |
| description | string | no | Link description |

**Link types:** relates_to, implements, depends_on, supersedes, references, blocks, clarifies

**Returns:** the created edge — `id`, both endpoints, `link_type`,
`description`, `weight`, the `created_by*` attribution fields and `created_at`.

### get_linked

Get items linked to a specific item. By default returns rows from the
`item_links` graph (manually authored item-graph edges). When
`item_type='doc'` and `include_section_links=true`, the response also
includes `section_links: { incoming, outgoing }` — Wave 5 `document_links`
rows where this document is either source or target. Default is `false`
for backwards-compat.

```
mcp__conport__get_linked({
  project_id: 11,
  item_type: "doc",
  item_id: 12,
  include_section_links: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| item_type | string | yes | decision \| progress \| pattern \| task \| **doc** (documents are `doc` here, not `document`) |
| item_id | integer | yes | Per-project ID of the item |
| relationship | string | no | Link type from the `link_items` vocabulary. Accepted, but **not applied today** — every link type comes back |
| direction | string | no | outgoing \| incoming \| both (default: both). Accepted, but **not applied today** — both directions come back |
| include_section_links | boolean | no | `item_type: "doc"` only — also return Wave 5 `document_links`. Default false. |

**Returns:** `links` (`id`, both endpoints, `link_type`, `description`,
`weight`, the `created_by*` attribution fields, `created_at`) and `total`; with
`include_section_links` also `section_links` (`incoming`, `outgoing` —
`document_links` rows with `edge_type`, `source_text`, block ULIDs). Filter
client-side while `relationship` / `direction` are inert.

---

## Project Links

### link_project

Create a cross-project link

```
mcp__conport__link_project({
  project_id: 11,
  target_project: 15,
  link_type: "depends_on",
  description: "Uses for authentication"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Source project ID |
| target_project | integer | yes | Target project ID |
| link_type | string | yes | Link type |
| description | string | no | Link description |

**Link types:** depends_on, part_of, calls, shares_data, extends, deployed_with, shares_database, related_to

**Returns:** the created link — `id`, both project IDs **and names**,
`link_type`, `description`, `metadata`, `created_by`, `created_at`. Both
projects must be yours, and they must differ.

### get_project_links

Get cross-project links

```
mcp__conport__get_project_links({
  project_id: 11,
  direction: "both"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| direction | string | no | outgoing \| incoming \| both (default: both) |

**Returns:** `outgoing` and `incoming` (each link with `id`, both project IDs
and names, `link_type`, `description`, `metadata`, `created_by`, `created_at`)
plus `total` across both lists. Unlike `get_linked`, this `direction` really
filters.

### unlink_project

Delete a cross-project link

```
mcp__conport__unlink_project({
  project_id: 11,
  link_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| link_id | integer | yes | ID of the project-link row |

**Returns:** `success: true` and the `link_id`. A link that does not touch this
project is an error.

---

## Search

### search

Unified search across all project data with GraphRAG.

Automatically combines:
- **Semantic search** (vector similarity)
- **Full-text search** (FTS)
- **GraphRAG** (entity and community traversal)

Results are merged via **Reciprocal Rank Fusion (RRF)**.

```
mcp__conport__search({
  project_id: 11,
  query: "caching performance",
  types: ["decision", "task"],
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | yes | Search query |
| project_id | integer | no | Scope to one project. Omit to search every project you own — handy when you don't know where a fact lives |
| types | array | no | Filter by item type. **Singular vocabulary**: `decision`, `task`, `pattern`, `document`, `progress_entry`, `context`, `custom_data`; the cross-reference short forms `progress` and `doc` are accepted as aliases. Values outside it are dropped, so a typo (`tasks`, `docs`) silently narrows the search to nothing |
| limit | integer | no | Max results, capped at 100 (default: 20) |

**Returns:** `results` (ranked) and `total`, plus a rendered `_summary`.
Each hit carries:
- `item_type`, `item_id` — the per-project ID, so pair it with `project_id`
- `project_id` / `project_name` — which project the hit came from
- `content` — the item blob. GraphRAG hits carry `via_entity` /
  `via_community` inside it; decision hits are annotated with `currency`
  (current \| superseded \| deprecated), `superseded_by` and `age_days`
- `score` — RRF score, `created_at`
- `_source` — only on pattern/decision hits related through a `derived_from`
  edge: `aggregated_pattern` (with `_aggregated_from`) or
  `covered_by_pattern` (with `_pattern_id`)

An empty result set adds `_hint: "knowledge_gap_detected"` with a
`_hint_message` telling you to save the answer once you have it.

---

## GraphRAG & Entities

> GraphRAG tools work **globally** (without `project_id`) but are scoped to
> the current owner.

### entities

Search/list entities

```
mcp__conport__entities({
  query: "redis",
  entity_type: "technology",
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | no | Search query (ILIKE match on canonical_name) |
| entity_type | string | no | Exact match on the stored type. Extraction emits: technology \| component \| service \| pattern \| standard \| person \| team |
| limit | integer | no | Max results (default: 20) |

**Returns:** `entities` (`id`, `canonical_name`, `entity_type`, `description`,
`mention_count`, `project_count`) and `total`.

### entity

Entity details (cross-project statistics)

```
mcp__conport__entity({
  entity_id: 42
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| entity_id | integer | yes | Canonical entity ID |

**Returns:** `id`, `canonical_name`, `entity_type`, `description`,
`mention_count`, `project_count`, `projects` (`project_id`, `project_name`,
`decision_count`) and `related_entities` (`entity_id`, `canonical_name`,
`entity_type`, `relation_type`, `direction`). An unknown entity is an error.

### entity_related

Related items via graph traversal

```
mcp__conport__entity_related({
  entity_id: 42,
  max_depth: 2,
  relation_types: "USES"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| entity_id | integer | yes | Canonical entity ID |
| max_depth | integer | no | Traversal depth (default: 2) |
| relation_types | string | no | Comma-separated relation types to filter |

**Returns:** `entity_id`, `related_entities` (walked over the in-memory graph
up to `max_depth`) and `total`. An entity that is not in the graph is an error.

### communities

List communities (knowledge clusters)

```
mcp__conport__communities({
  min_size: 3,
  include_summaries: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| min_size | integer | no | Minimum cluster size (default: 2) |
| include_summaries | boolean | no | Include summaries (default: true) |

**Returns:** `communities` (`community_id`, `level`, `entity_count`,
`entity_names`, `keywords`, plus `summary` when asked for) and `total`.

### community

Community details with member entities and summary

```
mcp__conport__community({
  community_id: "community_0"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| community_id | string | yes | Community ID (string) |

**Returns:** `community_id`, `level`, `summary`, `keywords`, `entities`
(`entity_id`, `canonical_name`, `entity_type`), `relationships` (`source_id`,
`target_id`, `relation_type`, `weight`), `entity_count` and
`relationship_count`.

### graph_stats

Knowledge-graph statistics across all your projects

```
mcp__conport__graph_stats()
```

No parameters.

**Returns:** `nodes_count`, `edges_count`, `density`, `is_directed`,
`entity_type_distribution`, `relation_type_distribution`, `is_dirty` and
`last_save` — computed over your own graph only.

---

## History & Activity

### recent_activity

Recent activity in the project

```
mcp__conport__recent_activity({
  project_id: 11,
  hours: 24,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| hours | integer | no | Over the last N hours (default: 24) |
| limit | integer | no | Max rows **per entity type** (default: 10) — the merged list can be longer |

**Returns:** `activity` — decisions, progress entries, patterns and custom data
merged and sorted by `timestamp` descending, each row `type` + `timestamp` +
a rendered `description`. Tasks and documents are not part of this feed.

### item_history

Version history of a specific item (by per-project ID)

```
mcp__conport__item_history({
  project_id: 11,
  item_type: "decision",
  item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| item_type | string | yes | decision \| progress \| pattern \| custom_data \| context |
| item_id | integer | yes | Per-project item ID (for `custom_data`/`context` the raw ID is used) |

**Returns:** `item_type`, `item_id` and `history`. Only the current version is
tracked for these types, so `history` holds a single entry (`version`,
`timestamp`, `changes`, `changed_by`). Real version chains live in
`context_history` (contexts) and `document_versions` (documents).

---

## Context assembly

Deterministic graph traversals that build a ready-to-read package instead of
making you stitch several reads together.

### assemble_context

Run a registered recipe from a start node.

```
mcp__conport__assemble_context({
  project_id: 11,
  recipe: "task_briefing",
  start_id: "task-271"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| recipe | string | yes | Registered recipe name — `task_briefing` (starts from a task) or `spec_implementation_status` (starts from a document). `list_context_recipes` is the live list |
| start_id | integer/string | yes | Start node. Prefer the prefix form `"<type>-<id>"` (`"task-271"`, `"doc-76"`); the wikilink form `"[[task-271]]"` works too. A bare integer is the legacy fallback and is resolved as the recipe's own type. Prefixes: `task`, `doc`, `decision`, `pattern`, `progress` |
| format | string | no | `markdown` (default) or `json` |
| depth | integer | no | Override the recipe's own traversal depth. Omit for the recipe default |

**Returns:** `recipe`, `recipe_version`, `start_id`, `format`, `content` (the
rendered markdown, or the structured payload with `format: "json"`) and
`generated_at`.

**Refusals:** an unknown `recipe` name, a `start_id` whose declared type does
not match the recipe (the message names the recipe to use instead), and a
start node that exists in another table (the message names the prefix form to
retry with) or nowhere at all.

### list_context_recipes

List the registered recipes — use it to discover valid `recipe` values.

```
mcp__conport__list_context_recipes()
```

No parameters.

**Returns:** `recipes` — per recipe `name`, `version`, `start_node_type`,
`description`.

### render_current_architecture

Synthesise the current architecture of a subsystem from decisions, patterns and
authored spec documents whose tags intersect `scope`. Superseded predecessors
are walked out, so the render shows what holds *now*. Tag-scoped rather than
start-node-based, which is why it is not an `assemble_context` recipe.

```
mcp__conport__render_current_architecture({
  project_id: 11,
  scope: ["embedding", "graph"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| scope | array | yes | Non-empty list of subsystem tags. Order matters — the first tag is the primary bucket for items matching several |
| format | string | no | `markdown` (default) or `json` |

**Returns:** `recipe` (`current_architecture`), `scope`, `format`, `content`
(markdown) or `data` (json), `totals` and `generated_at`.

### audit_doc_l1_coverage

Check whether a document's claims are already captured in L1 records (decisions,
patterns, authored specs) before archiving it. Read-only — you decide what to
promote.

```
mcp__conport__audit_doc_l1_coverage({
  project_id: 11,
  doc_id: 7,
  threshold: 0.7
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| doc_id | integer | yes | Per-project document ID to audit |
| threshold | number | no | Cosine-similarity cutoff for "covered", in [0, 1] (default: 0.7) |
| top_k | integer | no | Matches surfaced per block (default: 3, max 20) |

**Returns:** `doc`, `threshold`, `top_k`, `block_count`, `covered_count`,
`uncovered_count`, `blocks`, plus `recommendation`
(`ready_to_archive` \| `promote_capture_gaps` \| `no_blocks`) and `reason`.

---

## Knowledge-base gaps

Gaps are detected server-side (`init` returns the fresh ones). These tools are
the review loop: acknowledge what you have seen, dismiss what is not real.

### gap_list

List gaps. Defaults to the active ones (detected + acknowledged).

```
mcp__conport__gap_list({
  project_id: 11,
  category: "coverage"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| category | string | no | structural \| temporal \| coverage \| dependency \| doc_drift |
| state | string | no | detected \| acknowledged \| dismissed \| resolved. Comma-separated for several (default: `detected,acknowledged`) |
| limit | integer | no | Max results (default: 50) |

**Returns:** `gaps` (`hash`, `category`, `gap_type`, `subject`, `state`,
`details`, `first_detected_at`, `last_detected_at`, `dismissed_reason`),
`total` and `summary`.

### gap_ack

Acknowledge a gap — seen, not acting on it now (`detected` → `acknowledged`).
The acknowledgement is sticky: if the detector loses and re-finds the gap, it
comes back acknowledged rather than fresh.

```
mcp__conport__gap_ack({
  project_id: 11,
  gap_hash: "a1b2c3d4"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| gap_hash | string | yes | Gap hash from `gap_list` |

**Returns:** a one-line `summary` of the transition.

**Refusals:** `not_found` when no *detected* gap carries that hash.

### gap_dismiss

Dismiss a gap permanently — it is not a real gap. The reason is mandatory and
kept for audit; dismissal outranks acknowledgement.

```
mcp__conport__gap_dismiss({
  project_id: 11,
  gap_hash: "a1b2c3d4",
  reason: "Both documents are canonical on their own layer"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| gap_hash | string | yes | Gap hash from `gap_list` |
| reason | string | yes | Why this is not a gap |

**Returns:** a one-line `summary` carrying the reason.

**Refusals:** `not_found` when no active (detected/acknowledged) gap carries
that hash.

### gap_dismiss_bulk

Dismiss a whole cluster of gaps with one shared reason. At least one filter is
required — a filterless call would wipe the backlog.

```
mcp__conport__gap_dismiss_bulk({
  project_id: 11,
  category: "doc_drift",
  reason: "Layered docs, drift is expected between them"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| reason | string | yes | Shared dismiss reason, applied to every affected gap |
| category | string | no | Filter by category |
| gap_type | string | no | Filter by gap type, e.g. `unmarked_supersession`, `dangling_wikilink` |
| subject_type | string | no | Filter by subject type, e.g. `doc-pair`, `tag`, `decision` |

**Returns:** `dismissed_count`, `gap_hashes`, `summary`.

**Refusals:** `missing_filter` when none of `category` / `gap_type` /
`subject_type` is given.

### gap_undismiss

Re-open a dismissed gap (`dismissed` → `detected`).

```
mcp__conport__gap_undismiss({
  project_id: 11,
  gap_hash: "a1b2c3d4"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| gap_hash | string | yes | Gap hash from `gap_list` |

**Returns:** a one-line `summary`. The dismiss reason is cleared with the
re-open.

**Refusals:** `not_found` when no *dismissed* gap carries that hash.

### gap_stats

Aggregated counts by state × category plus what was resolved recently.

```
mcp__conport__gap_stats({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |

**Returns:** `breakdown` (state → category → count), `resolved_last_30d`,
`summary`.

---

## Semantic pass

LLM analysis of the knowledge graph. It never mutates silently: a pass produces
**proposals**, you review them, and only approved ones are applied.

### semantic_cleanup

One-click cleanup: run the pass, auto-reject noise, auto-apply informational
proposals and high-confidence mutations, leave the rest for manual review.
Returns immediately and runs in the background.

```
mcp__conport__semantic_cleanup({
  project_id: 11,
  dry_run: false
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| confidence_threshold | number | no | Auto-approve mutations above this confidence (default: 0.85) |
| dry_run | boolean | no | Preview only — **default true**. Pass `false` explicitly to actually apply |

**Returns:** `started`, `run_id`, `dry_run`, `poll` and `summary`. Poll
`semantic_pass_stats`: the run is done once its `recent_runs` entry for
`run_id` has `completed_at`, then review the remainder with
`semantic_proposals_list`.

**Refusals:** `already_running` (with the live `run_id`) when a pass or cleanup
is already open for the project, and `rate_limited` (with
`retry_after_seconds`) for a non-dry run inside the per-owner cooldown.

### semantic_pass_run

Run the pass manually and inspect proposals before anything is stored.

```
mcp__conport__semantic_pass_run({
  project_id: 11,
  dry_run: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| scope | string | no | `full` (default, all communities) or `communities` |
| community_ids | string | no | Comma-separated community IDs, used with `scope: "communities"` |
| dry_run | boolean | no | Return proposals without saving them (default: false). Previews are not rate-limited |

**Returns:** `pass_run_id`, `proposals` and `residuals` (populated on a dry
run), `stats` and `summary`.

**Refusals:** `rate_limited` (with `retry_after_seconds`) for a real run inside
the per-owner cooldown.

### semantic_proposals_list

Review queue. Defaults to what is waiting for you.

```
mcp__conport__semantic_proposals_list({
  project_id: 11,
  status: "pending_review"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| status | string | no | Filter by status, comma-separated for several (default: `pending_review`) |
| proposal_type | string | no | Filter by proposal type |
| pass_run_id | integer | no | Only proposals from one pass run |
| limit | integer | no | Max results (default: 50) |
| include_off_domain | boolean | no | Include proposals whose subject entities are not mentioned in this project — leftovers of an earlier owner-wide pass. Audit/debug only (default: false) |

**Returns:** `proposals` (`id`, `proposal_type`, `subject_entity_ids`,
`target_entity_ids`, `payload`, `rationale`, `confidence`, `evidence_refs`,
`status`, `pass_run_id`, `created_at`), `total` and `summary`. Ordered by
confidence.

### semantic_proposal_approve

Approve a proposal for later execution by `semantic_proposals_apply`.

```
mcp__conport__semantic_proposal_approve({
  project_id: 11,
  proposal_id: 42
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| proposal_id | integer | yes | Proposal ID |
| reviewer_note | string | no | Note kept with the review |

**Returns:** a one-line `summary`. Approval only queues the proposal —
`semantic_proposals_apply` executes it.

**Refusals:** `not_found` when the proposal is not pending review.

### semantic_proposal_reject

Reject a proposal. The reason is mandatory — it trains later passes.

```
mcp__conport__semantic_proposal_reject({
  project_id: 11,
  proposal_id: 42,
  reason: "The two entities are genuinely different services"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| proposal_id | integer | yes | Proposal ID |
| reason | string | yes | Why it is rejected |

**Returns:** a one-line `summary` carrying the reason.

**Refusals:** `not_found` when the proposal is neither pending nor deferred.

### semantic_proposal_defer

Park a proposal for a later review round.

```
mcp__conport__semantic_proposal_defer({
  project_id: 11,
  proposal_id: 42
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| proposal_id | integer | yes | Proposal ID |
| note | string | no | Note kept with the review |

**Returns:** a one-line `summary`. A deferred proposal can still be rejected;
`semantic_proposal_approve` accepts only proposals still in `pending_review`.

**Refusals:** `not_found` when the proposal is not pending review.

### semantic_proposals_apply

Execute the approved proposals. Informational types are just marked applied.

```
mcp__conport__semantic_proposals_apply({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| proposal_ids | string | no | Comma-separated proposal IDs. Omit to apply every approved proposal |

**Returns:** `applied`, `errors`, `errors_detail`, `summary`.

### semantic_pass_stats

Pass health: proposal counts, approval rate and the recent runs — also the way
to poll a background `semantic_cleanup`.

```
mcp__conport__semantic_pass_stats({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |

**Returns:** `status_counts`, `type_counts`, `total_proposals`,
`approval_rate`, `recent_runs` (`id`, `started_at`, `completed_at`, `stats` —
last 5) and `summary`.

---

## Routine cycle

Per-project policy and journal for periodic agent cycles, plus the single-call
briefing a cycle starts from.

### get_agenda

One call that opens a cycle: what woke up, what is ready, what needs
housekeeping, what changed. Pure read. Empty sections are omitted entirely.

```
mcp__conport__get_agenda({
  project_id: 11,
  ready_limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| ready_limit | integer | no | Max tasks in `ready_top` (default: 10) |
| delta_hours | integer | no | Window for `activity_delta`, in hours (default: 24) |

**Returns:** `woken_tasks`, `roadmap` (current / next milestone), `epic_tails`
(epics near closing), `ready_top`, `housekeeping` (`stale_in_progress`,
`blocked_too_long`, `fresh_gaps`, `cleanup_hint`), `activity_delta` and a
one-line `summary`.

### get_routine_config

Read the project's routine policy.

```
mcp__conport__get_routine_config({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |

**Returns:** the stored policy, or the defaults with `is_default: true` when the
project has none yet (`enabled` true, `cadence` daily, `max_tasks_per_run` 2,
`priority_threshold` 3, `autonomy_level` 1, `selection` threshold).

### set_routine_config

Set the policy. Partial — omitted fields keep their current value (on the first
call they take the defaults).

```
mcp__conport__set_routine_config({
  project_id: 11,
  cadence: "weekly",
  autonomy_level: 2
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| enabled | boolean | no | Whether the periodic cycle runs at all |
| cadence | string | no | `daily` or `weekly` |
| max_tasks_per_run | integer | no | Backlog tasks one run may execute (1-20) |
| priority_threshold | integer | no | The run picks tasks with priority ≤ this (1-5, smaller = more important) |
| autonomy_level | integer | no | `0` agenda + report only, `1` plus housekeeping and briefings, `2` plus executing backlog tasks up to `priority_threshold` |
| selection | string | no | `threshold` (default — any ready task within the priority threshold) or `tagged` (only tasks marked `routine_eligible`, still within the threshold) |

**Returns:** `project_id` plus an echo of exactly the fields you passed — the
post-write verification channel.

### routine_run_start

Open the run journal entry — once, at the start of every cycle, right before
`get_agenda`.

```
mcp__conport__routine_run_start({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |

**Returns:** `id` (pass it to `routine_run_finish`), `started_at` and
`already_open`. An open run from a crashed cycle is returned with
`already_open: true` instead of an error — finish it (`outcome: "aborted"`) or
keep working under it.

### routine_run_finish

Close the run journal entry — once, at the end of the cycle. Also logs a
progress entry, so do **not** call `log_progress` separately for the finish.

```
mcp__conport__routine_run_finish({
  project_id: 11,
  run_id: 7,
  outcome: "completed",
  summary: "Closed two tail epics, acknowledged three gaps",
  task_ids: [271, 284]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| run_id | integer | yes | Run id from `routine_run_start` |
| outcome | string | yes | `completed` (did work) \| `empty` (nothing to do) \| `aborted` (stopped early / recovered crash) |
| summary | string | no | One-paragraph summary of the run |
| task_ids | array | no | Per-project IDs of the tasks the run picked up |

**Returns:** `run_id`, `outcome`, `task_ids`. Finishing an already-finished or
unknown run is an error — do not retry it blindly.

### list_routine_runs

The run journal, newest first. An open (running or crashed) run has
`finished_at: null` and no outcome.

```
mcp__conport__list_routine_runs({
  project_id: 11,
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max runs (default: 10) |

**Returns:** `runs` (`id`, `started_at`, `finished_at`, `outcome`, `summary`,
`task_ids`) and `count`.

### get_estimation_stats

Plan/actual calibration — call it **before** estimating new tasks and scale your
gut estimate by the project's historical drift.

```
mcp__conport__get_estimation_stats({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Closed tasks in the sample, freshest first (default: 50) |

**Returns:** `sample_size`, `median_ratio` (actual/plan), `p50_actual_seconds`,
`p90_actual_seconds`, `by_priority` (only priorities with 3+ samples), `recent`
(the sampled tasks with their own ratios) and a readable `summary`.
`sample_size: 0` means no history yet — the ratios come back `null`, so start
setting `estimated_seconds` when creating tasks.

---

## Guardrails

Command conventions and known error solutions. Both are stored as tagged
decisions, so they also show up in `list_decisions` and search.

### add_convention

Record a deny-list rule: this command shape is wrong, use that one instead.

```
mcp__conport__add_convention({
  project_id: 11,
  pattern: "^pytest",
  replacement: "uv run pytest",
  reason: "The project runs Python through uv"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| pattern | string | yes | Regex matched against commands |
| replacement | string | yes | The command to use instead |
| reason | string | yes | Why the convention exists |

**Returns:** `id`, `summary` (`Convention: <reason>`) and `status` (`created`).
Stored as a decision tagged `convention` + `deny-list`, with the rule itself as
JSON in the rationale.

### add_error_solution

Record a known fix for a recurring error signature.

```
mcp__conport__add_error_solution({
  project_id: 11,
  error_signature: "ModuleNotFoundError pytest",
  solution: "Run the suite through uv run pytest"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| error_signature | string | yes | Normalized error signature |
| solution | string | yes | How to fix it |
| confidence | number | no | Confidence 0-1 (default: 0.8). Accepted, but **not stored today** — nothing reads it back |

**Returns:** `id`, `summary` (`Error solution: <signature>`) and `status`
(`created`). Stored as a decision tagged `error-solution`, with the solution as
its rationale.

### list_conventions

List the project's conventions.

```
mcp__conport__list_conventions({
  project_id: 11
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |

**Returns:** `conventions` (`pattern`, `replacement`, `reason`, `decision_id`)
and `total`.

### list_error_solutions

List the known error solutions, newest first.

```
mcp__conport__list_error_solutions({
  project_id: 11,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 20) |

**Returns:** `solutions` (`id`, `error_signature`, `solution`, `tags`) and
`total`.

---

## Quick Reference

| Category | Tools |
|----------|-------|
| Session | `init`, `list_projects` |
| Context | `update_product_context`, `update_active_context`, `context_history` |
| Tasks | `add_task`, `update_task`, `list_tasks`, `get_task`, `add_task_dep`, `delete_task`, `add_linked_task` |
| Milestones | `add_milestone`, `update_milestone`, `list_milestones` |
| Documents | `add_document`, `update_document`, `list_documents`, `get_document`, `delete_document`, `document_versions`, `get_block_backlinks`, `get_semantically_related_blocks`, `list_blocks`, `get_block`, `update_block`, `insert_block`, `delete_block` |
| Decisions | `sync_decision`, `list_decisions`, `get_decision`, `update_decision`, `deprecate_decision`, `reactivate_decision`, `delete_decision` |
| Progress | `log_progress`, `update_progress`, `list_progress`, `delete_progress` |
| Patterns | `log_pattern`, `update_pattern`, `list_patterns` |
| Search | `search` |
| Linking | `link_items`, `get_linked`, `link_project`, `get_project_links`, `unlink_project` |
| GraphRAG | `entities`, `entity`, `entity_related`, `communities`, `community`, `graph_stats` |
| History | `recent_activity`, `item_history`, `context_history` |
| Context assembly | `assemble_context`, `list_context_recipes`, `render_current_architecture`, `audit_doc_l1_coverage` |
| Gaps | `gap_list`, `gap_ack`, `gap_dismiss`, `gap_dismiss_bulk`, `gap_undismiss`, `gap_stats` |
| Semantic pass | `semantic_cleanup`, `semantic_pass_run`, `semantic_proposals_list`, `semantic_proposal_approve`, `semantic_proposal_reject`, `semantic_proposal_defer`, `semantic_proposals_apply`, `semantic_pass_stats` |
| Routine cycle | `get_agenda`, `get_routine_config`, `set_routine_config`, `routine_run_start`, `routine_run_finish`, `list_routine_runs`, `get_estimation_stats` |
| Guardrails | `add_convention`, `add_error_solution`, `list_conventions`, `list_error_solutions` |

**Prefix:** `mcp__conport__` (CLI) or `mcp__claude_ai_conport__` (Chat)

---

*Version: ConPort MCP v7.0*
*API: ConPort REST API v2.2*
