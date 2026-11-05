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
> `progress_id`). A project is addressed by `project`: its **handle** — `pr`
> and 8 characters, e.g. `prk7m2qx9d`, fixed for the project's life — or its
> name (`<project>`, `pers/<project>`, `<team id>/<project>`). `init`,
> `list_projects` and the projects page of the dashboard show the handle. A
> string of digits addresses no project.

> **Failure answers:** a section's **Refusals** are returned by a call that
> itself succeeds — a dict with an `error` code, and whatever the section
> names next to it. Its **Errors** fail the call: there is no result to read,
> only the error message.

---

## Session

### init

Load a project. Project name is required. `init` only finds a project and
never creates one — a missing project is made with `create_project`, on the
user's word only.

```
mcp__conport__init({
  name: "my-project"
})
```

A project of a shared team is addressed by its team id, and any project by its
handle:

```
mcp__conport__init({
  name: "k7m2qx9d/my-project"
})

mcp__conport__init({
  name: "prk7m2qx9d"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | yes | The project's handle, or its name: "<project>" for your Private Team, "<team id>/<project>" for a shared team. The project part is at most 255 characters. |
| description | string | no | Deprecated, ignored: init no longer creates projects. |
| skill_id | string | no | Skill the client runs (`conport`, `conport-agent`) — only used to detect an available skill update |
| skill_version | string | no | Semver of the installed SKILL.md content (independent of the plugin release tag) |
| client_type | string | no | Calling environment: `claude-code` \| `claude-ai` \| `cursor` \| `openclaw` \| `mcporter` \| `paperclip`. Picks the install-guide URL of an update notice |
| questions | boolean | no | `true` (default) when a person is at the session: up to three questions are returned and marked as asked. Pass `false` for a run with no person — a subagent, a routine cycle: no question is returned or marked |

**Returns:** `project` (the project's handle — pass it as `project` to every
other tool), `name` (the short name), `canonical_name`
(`<team id>/<project>`; `pers/<project>` in your Private Team), `team`
(`handle`, `name`, `kind` — `handle` is `pers` for your Private Team),
`recent_decisions`, `recent_patterns`,
`summary` opens with `Project <name> (<handle>) loaded`;
`backlog` (`total_todo`, `total_in_progress`, `total_review`, `top` — up to 5
items with `effective_priority` and `subtask_count`; built over TODO,
IN_PROGRESS and REVIEW), `stats` (`tasks_todo`, `tasks_in_progress`,
`tasks_review` among them), `active_context`
(`current_focus`, `open_questions`), `recent_progress` (last 5 `log_progress`
entries), `instructions` and `summary`.
Conditional sections: `questions` (with `questions=true`, up to three — see
below), `reconciliation` when stale IN_PROGRESS tasks are
detected, `routine_suggestion` for a routine-ripe project with no policy yet,
`skill_update_available` when the caller passed skill metadata and a newer
version exists, and `roadmap` (current milestone with its epics + `next`) /
`epic_tails` (epics near closing, each with a prescribed `suggested_action` —
`Review task-N` for a child in REVIEW, `review task-N` after a `Finish …`
step) only when the project has them;
`review_tasks` (`id`, `title`, `priority` of the tasks waiting in REVIEW, most
recently updated first, snoozed ones left out) only when some task waits — and
then `instructions` carries "Review: N task(s) await a reviewer — have them
reviewed before taking new work"; `backlog.top` rows carry `milestone_id` and the
current milestone's rows float up.
Top-5 excludes subtasks of active epics so
you see roots + orphans; `effective_priority` rolls up the most-important
priority across direct children (priority is industry-standard 1-5 where
1=critical and 5=idle, so "most important" = the smallest number).

**`questions`.** Knowledge-base gaps and semantic-pass proposals are resolved
by the server's daily pass; a gap only a person can decide becomes a question.
Each one carries `id`, `gap_type`, `text` (English, with the names filled in),
`options` (2–3, each `key`, `label` and `effect` — what the server does on that
answer) and `default` (the `key` taken when nobody answers). Ask the user each
one, in their language, before the work starts, and pass the choice to
`answer_question`; a question left unanswered gets no call. A question handed
out twice without an answer is settled by its default.

**Refusals** (a dict with `error`):

- `name_required` — `name` is empty; the project is never guessed.
- `project_not_found` (with `canonical_name` and `message`) — no such project
  in the team the name addresses. Nothing is created. Ask the user whether to
  create it; call `create_project` only on their word, then call `init` again.
- `project_name_in_other_team` (with `candidates` and `message`) — a short
  name that is not in your Private Team but is the name of a project in your
  shared teams. Each candidate carries `canonical_name` (`<team id>/<project>`)
  and `team_name`. Ask the user which of them they mean and to set its
  `canonical_name` as `CONPORT_PROJECT_NAME`; do not retry `init` with
  another name yourself.

A string of digits addresses no project: it is answered `project_not_found`,
exactly like a project that does not exist.

**Errors:** `invalid_project_name` — the name has more than
one `/`, an empty part, a project part made of digits only after a team prefix
(`pers/11`), a project part longer than 255 characters, or a prefix
that is neither `pers` nor a team id; `team_not_found` — the prefix names no
team you are a member of; `team_context_conflict` — the connection's address
pins one of your teams and the prefix names another.

### create_project

Create a project. Call it only when the user asks for a new project — never on
your own after `project_not_found`.

```
mcp__conport__create_project({
  name: "k7m2qx9d/my-project",
  description: "Optional description"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | yes | Project name: "<project>" for your Private Team, "<team id>/<project>" for a shared team. The project part is at most 255 characters. |
| description | string | no | Project description |

**Returns:** `handle` (the new project's handle), `name` (the short name),
`canonical_name` and `team` (`handle`, `name`, `kind`). Call `init` with the
same name or the handle afterwards.

**Refusals** (a dict with `error`):

- `project_name_taken` (with `canonical_name`) — the team already has a
  project of this name.
- `project_limit_reached` (with `plan`, `limit`, `current`) — the team's plan
  allows no more projects.

**Errors:** `invalid_project_name`, `team_not_found` and `team_context_conflict`,
as for `init`; a name of digits only, or one shaped like a handle, is an
`invalid_project_name` here.

### list_projects

List the projects of your teams — use it to discover project handles before
calling project-scoped tools.

```
mcp__conport__list_projects({
  limit: 100
})

mcp__conport__list_projects({
  team: "k7m2qx9d"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | integer | no | Max projects (default: 100, clamped to 1..500) |
| offset | integer | no | Pagination offset (default: 0) |
| team | string | no | Team to list — `"pers"` or a shared team's ID. Omitted: every active team you are a member of |

**Returns:** `projects` (`handle`, `name`, `canonical_name`, `team`,
`description`, `created_at`, `updated_at`) and `total`. `canonical_name` is
`<team>/<name>` and `team` is the project's team — `pers` for your Private
Team, otherwise the shared team's ID.

Without `team` the list spans all your active teams — your Private Team
first, then the shared teams from the oldest, the projects of a team ordered
by name — and
`limit` / `offset` page over that merged list. A team that is being deleted
is left out. With `team` it is that one team, and the reply names it in a
top-level `team`.

**Errors:** `team_not_found` when `team` is not a team of yours.

---

## Context

### update_product_context

Update a single product context field (vision, goals, architecture, etc.)

```
mcp__conport__update_product_context({
  project: <project>,
  field: "vision",
  value: "AI-powered knowledge base"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| field | string | yes | vision \| goals \| features \| architecture \| tech_stack \| constraints |
| value | string/array | yes | New value |

**Returns:** a slim echo — the context row `id` plus the new `version`.

### update_active_context

Update a single active context field. `current_focus` is usually managed
automatically — it snaps to the task you move to IN_PROGRESS and clears when
that task leaves IN_PROGRESS (for REVIEW too), so manual writes are rarely needed.
`open_questions` is the free-form human field for pending questions.

```
mcp__conport__update_active_context({
  project: <project>,
  field: "open_questions",
  value: ["How should we handle rate limits?"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| field | string | yes | current_focus \| open_questions |
| value | string/array | yes | New value |

**Returns:** a slim echo — the context row `id` plus the new `version`.

### context_history

Context version history

```
mcp__conport__context_history({
  project: <project>,
  context_type: "product",
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  summary: "Use PostgreSQL",
  rationale: "ACID compliance",
  tags: ["database", "arch"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  decision_id: 5,
  summary: "Use PostgreSQL with pgvector",
  tags: ["database", "arch", "search"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  decision_id: 5,
  reason: "The external tooling this assumed no longer exists"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** a slim echo — `id`, `tags`, `summary` — plus the recomputed
`currency` and `deprecated_at` (now `null`).

**Refusals:** `not_found` for an unknown decision.

### list_decisions

List architectural decisions

```
mcp__conport__list_decisions({
  project: <project>,
  tags: ["database"],
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| limit | integer | no | Max results (default: 20) |
| offset | integer | no | Pagination offset (default: 0) |
| tags | array | no | Filter by tags |
| source | string | no | Filter by provenance: `manual` (hand-written) \| `progress_extraction` (extracted from progress entries before that extraction was removed; no new ones appear) |
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
  project: <project>,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** `summary`, `rationale`, `implementation_details`, `tags`,
`source`, timestamps and the lifecycle annotation — `currency`, `age_days`,
`deprecated_at`, `deprecation_reason`, `superseded_by`. An unknown decision is
an error.

### delete_decision

Delete a decision by per-project ID

```
mcp__conport__delete_decision({
  project: <project>,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| decision_id | integer | yes | Per-project decision ID |

**Returns:** `deleted: true` and the `decision_id`.

**Refusals:** `not_found` for an unknown decision.

---

## Progress (Activity Log)

Progress entries are a pure activity log without workflow statuses.
For tasks with statuses, use **Tasks**.

### log_progress

Create an activity log entry. Optionally links to one item of the project
(linked target referenced by its type and its per-project ID).

```
mcp__conport__log_progress({
  project: <project>,
  description: "Started work on auth module",
  title: "Auth update",
  linked_item_type: "task",
  linked_item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| description | string | yes | Description (max 2000 chars) |
| title | string | no | Title (max 200 chars) |
| parent_id | integer | no | Per-project ID of parent progress entry (threading) |
| linked_item_type | string | no | task \| decision \| pattern \| progress \| doc (or document) \| routine_run — only together with `linked_item_id` |
| linked_item_id | integer | no | Per-project ID of the linked item — only together with `linked_item_type` |

A link is refused unless both parameters are given and name an existing item of this project: name one, or send neither.

**Returns:** a slim echo — the new entry `id`. Canonical references in the text
become graph edges on the write itself; decision extraction from the text runs
afterwards in the background.

### update_progress

Update an activity entry

```
mcp__conport__update_progress({
  project: <project>,
  progress_id: 45,
  description: "Updated implementation notes"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| progress_id | integer | yes | Per-project progress entry ID |
| title | string | no | New title |
| description | string | no | New description |

**Returns:** a slim echo — the entry `id`. Changing `description` re-embeds the
entry.

### list_progress

List progress entries

```
mcp__conport__list_progress({
  project: <project>,
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| limit | integer | no | Max results (default: 50) |
| offset | integer | no | Pagination offset (default: 0) |

**Returns:** `entries` (newest first — `id`, `title`, `description`,
`parent_id`, `linked_item_type`, `linked_item_id`, timestamps) and `total`.

### delete_progress

Delete a progress entry

```
mcp__conport__delete_progress({
  project: <project>,
  progress_id: 8
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| progress_id | integer | yes | Per-project progress entry ID |

**Returns:** `deleted: true` and the `progress_id`.

**Refusals:** `not_found` for an unknown entry.

---

## Tasks

### add_task

Create a task or an epic, with optional hierarchy and priority

```
mcp__conport__add_task({
  project: <project>,
  title: "Implement auth",
  status: "TODO",
  priority: 2,
  estimated_seconds: 5400
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| title | string | yes | Title (max 200 chars) |
| description | string | no | Description (max 2000 chars) |
| status | string | no | TODO \| IN_PROGRESS \| BLOCKED \| REVIEW \| DONE \| CANCELLED (default: TODO). A new task is never created in REVIEW (`review_from_in_progress_only`): a task enters REVIEW from IN_PROGRESS |
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
`milestone_on_non_epic`, `milestone_not_found`; `status: "REVIEW"` on create
comes back as `review_from_in_progress_only`.

### update_task

Update a task. Closing it (`status: "DONE"` / `"CANCELLED"`) always carries a
`resolution`.

```
mcp__conport__update_task({
  project: <project>,
  task_id: 5,
  status: "DONE",
  resolution: "Auth shipped behind a feature flag"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID |
| title | string | no | New title |
| description | string | no | New description |
| status | string | no | New status: TODO \| IN_PROGRESS \| BLOCKED \| REVIEW \| DONE \| CANCELLED. On an epic, `DONE` requires every child to be closed first (`epic_not_ready`) and `REVIEW` is refused; `CANCELLED` is allowed in any state. The review cycle gates REVIEW, DONE and the way back to IN_PROGRESS — see *Review cycle* below |
| priority | integer | no | New priority 1-5 (1=critical, 5=idle) |
| parent_task_id | integer | no | Re-parent the task. Positive per-project task id attaches under that parent (must be `kind='epic'`), `0` detaches to root level, omit to leave unchanged. A parent from another project is rejected as not-found, and so is any move that would attach the task under one of its own descendants (cycle) |
| resolution | string | no | Verdict recorded on close — applied only when `status` moves to DONE or CANCELLED, ignored otherwise. Upserted as a `## Resolution` section of the description (the original body is preserved) and logged as a linked progress entry. Required on REVIEW → DONE (`done_needs_resolution`) |
| kind | string | no | Promote `task` → `epic` (the task must be root — combine with `parent_task_id: 0` to detach and promote in one call) or demote `epic` → `task` (the epic must have no children) |
| estimated_seconds | integer | no | Estimated effort in seconds. Epic rows reject it (`epic_does_not_carry_time_fields`) |
| snooze_until | string | no | ISO 8601 timestamp — hide the task from default listings until then (status unchanged, it wakes on its own when the time passes). A timestamp without a timezone is read as UTC. Empty string clears the snooze, omit to leave unchanged |
| routine_eligible | boolean | no | Autonomous-cycle opt-in marker (see `add_task`). Pass `true`/`false` to set, omit to leave unchanged |
| milestone_id | integer | no | Attach this epic to a roadmap milestone. Positive id attaches, `0` detaches, omit to leave unchanged. Epics only (`milestone_on_non_epic`); unknown milestone → `milestone_not_found`; an epic must be detached before it can be demoted to a task (`epic_has_milestone`) |

**Returns:** a slim echo — `id`, `tags`, `summary`, `resolution_applied` (true
when the close upserted the `## Resolution` section) and, for post-write
verification, the applied `status`, `review_round`, `kind`, `estimated_seconds`,
`routine_eligible`, `snooze_until`, `milestone_id`. Plus the rollups that save
a follow-up read: `parent_epic_ready_to_close` (`id` + `title` of the parent
epic when this close left it with no open children — close it next; `null`
otherwise), `started_at` / `completed_at` (stamped on the first entry into
IN_PROGRESS and on DONE), `claim_expires_at` (the IN_PROGRESS lease — renewed
on every touch while the task is IN_PROGRESS, cleared when it leaves that
status — a task in REVIEW holds no lease and is never returned to TODO by it) and `estimate_drift` (`estimated_seconds`, `actual_seconds`, `ratio`),
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

**Review cycle.** A task whose work is checked goes IN_PROGRESS → REVIEW →
DONE, or back from REVIEW to IN_PROGRESS for another round; every step is
gated by the task's journal (`add_task_journal_entry`). Writing the status the
task already has is not a transition and is never refused. The refusals carry
`error`, a `message` with one action and `context` (`task_id`, `status`,
`review_round`, and the last verdict for `done_needs_approval` and
`return_needs_review`); a refused write changes nothing:

| Refusal | Raised when | Next call |
|---|---|---|
| `review_from_in_progress_only` | REVIEW from any status but IN_PROGRESS | From TODO or BLOCKED: the `report` entry, which starts the task and moves it to REVIEW; otherwise `update_task` → IN_PROGRESS first |
| `review_on_epic` | REVIEW on an epic, or `kind: "epic"` on a task in REVIEW | Review the children instead |
| `review_needs_report` | IN_PROGRESS → REVIEW with no `report` or `fix` in the current round | `add_task_journal_entry` with `kind: "report"` or `"fix"` |
| `done_needs_review` | DONE from a status other than REVIEW on a task with a `report`, `fix` or `review` entry, a closed epic with one demoted to a task, or a childless epic with one closed | The action in `message`: IN_PROGRESS → REVIEW; from TODO, BLOCKED or CANCELLED → IN_PROGRESS, then REVIEW; demote an epic together with `status: "IN_PROGRESS"`, or give a childless epic child tasks |
| `done_needs_approval` | REVIEW → DONE when the last `review` of the round is not `approve` | A reviewer's `review` with `verdict: "approve"` |
| `done_needs_resolution` | REVIEW → DONE without `resolution` | Repeat with `resolution` |
| `return_needs_review` | REVIEW → IN_PROGRESS when the last `review` of the round is not `changes_requested` | A reviewer's `review` with `verdict: "changes_requested"` |
| `review_exit_not_allowed` | REVIEW → TODO, BLOCKED or PARKED | Finish the review, or CANCELLED with `resolution` |

REVIEW → IN_PROGRESS raises `review_round` by one, and so does reopening a
DONE or CANCELLED task, so the reports and verdicts of an earlier round never
count again. A task without any `report`, `fix` or `review` entry (a `brief`
alone included) still goes IN_PROGRESS → DONE directly.

### list_tasks

List tasks with filters. Defaults to active tasks (TODO + IN_PROGRESS + REVIEW).
Pass `status: "ALL"` for all statuses, or a comma-separated list.

```
mcp__conport__list_tasks({
  project: <project>,
  status: "IN_PROGRESS"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| status | string | no | Filter by status. Comma-separated or "ALL" (default: "TODO,IN_PROGRESS,REVIEW") |
| priority | integer | no | Filter by priority 1-5 (1=critical, 5=idle) |
| parent_task_id | integer | no | Filter by parent per-project ID (0 = root tasks only) |
| kind | string | no | Filter by hierarchy role: `task` or `epic`. Omit to include both |
| ready | boolean | no | Only tasks with no open blocking dependency — a `blocks`/`requires` dependency on a task in TODO/IN_PROGRESS/BLOCKED/REVIEW excludes it; `suggests` and DONE/CANCELLED targets never block (default: false) |
| include_snoozed | boolean | no | Include tasks snoozed into the future (`snooze_until` > now). Default false — snoozed tasks stay hidden from the list and the count until their snooze elapses |
| routine_eligible | boolean | no | Filter by the autonomous-cycle opt-in marker: `true` — only marked tasks, `false` — only unmarked. Omit for no filter |
| order | string | no | `created_at` (default, newest first) or `priority` — rank by effective priority (the smallest of the task's own priority and the priorities of its active TODO/IN_PROGRESS/REVIEW direct children; ties broken by newest first). With `priority` each task carries `effective_priority` |
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
  project: <project>,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID |

**Returns:** the full task row (description always included, with
`review_round`) plus `dependencies`, `dependents`, `subtasks_count` and
`journal` — the summary of the task's journal: `counts` per kind (`brief`,
`report`, `review`, `fix`), `last_verdict` and `last_verdict_round` — the
round of that verdict (both `null` before the first review; a round below
`review_round` means the verdict belongs to an earlier round). The entries themselves come
from `list_task_journal`. An epic reports the `estimated_seconds` /
`actual_seconds` summed across its children.

### add_task_dep

Add a dependency between two tasks

```
mcp__conport__add_task_dep({
  project: <project>,
  task_id: 5,
  depends_on_task_id: 3,
  dependency_type: "blocks"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID |

**Returns:** a `message` confirming the deletion plus `deleted: true` and the
`id` that was removed; deleting a child of an epic also returns `epic_progress`
— the shrunk epic's rollup (same shape as under `add_task`, without
`grew_after_start`), so a delete that empties a tail says so on the spot.
Dependencies and graph mentions of the task are removed with it; an unknown
task is an error.

### add_linked_task

Create a task in **another** project of the same team without switching
context, and record the backref in the current project. The current project
is `project`, as everywhere, and the target is `target_project`. The team is
the one of the source project: a linked task never crosses a team boundary.

```
mcp__conport__add_linked_task({
  project: <project>,
  target_project: "other-project",
  title: "Expose the new endpoint in the SDK",
  priority: 2
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Handle or name of the project you are working in — the "from" side of the link |
| target_project | string | yes | The project the task is created in: its handle, its short name, or `team/project` (`k7m2qx9d/other-project`) naming the team of the source project. Anything outside that team is not found |
| title | string | yes | Task title (max 200 chars) |
| description | string | no | Task description (max 2000 chars) |
| priority | integer | no | 1-5 (1=critical, 5=idle, default: 3) |
| status | string | no | TODO \| IN_PROGRESS \| BLOCKED \| REVIEW \| DONE \| CANCELLED (default: TODO). A new task is never created in REVIEW (`review_from_in_progress_only`): a task enters REVIEW from IN_PROGRESS |

**Returns:** `target_task` (the created task, full body — this one is not
slimmed), `source_progress` (the log entry written in the source project),
`link_id` and `summary`.

**Errors:** passing the same project on both sides fails with 400 — use
`add_task` for a task in the project you are already in. A `team/` prefix of a
team you are not a member of fails with `team_not_found` (404), whether that
team exists or not; a prefix of another team of yours fails with
`cross_team_link_not_supported` (422). A malformed target fails with
`invalid_project_name` (422): rewrite it as `<team ID>/<project>`
(`k7m2qx9d/other-project`), `pers/<project>`, or a name without `/`.

### add_task_journal_entry

Add an entry to a task's journal — the history of its review cycle: the
assignments, the reports, the verdicts and the reports on fixes, by round. The
journal only grows: an entry is never edited or deleted. The entry also moves
the task's status the way the review cycle needs, so no `update_task` call
goes before or after it (table below).

```
mcp__conport__add_task_journal_entry({
  project: <project>,
  task_id: <task_id>,
  kind: "report",
  body: "Implemented the endpoint; tests: 12 passed."
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID (a task, never an epic) |
| kind | string | yes | `brief` \| `report` \| `review` \| `fix` — which one fits depends on the task's status (table below) |
| body | string | yes | The text, Markdown, up to 200000 chars |
| author | string | no | Who writes the entry: a role or an agent name, 1-100 chars. Default: the role of the kind — `orchestrator` for a brief, `implementer` for a report or a fix, `reviewer` for a review |
| verdict | string | no | `approve` \| `changes_requested` — required on `review`, refused on every other kind |

| `kind` | Task status | What it is | How it moves the task |
|---|---|---|---|
| `brief` | TODO, IN_PROGRESS, BLOCKED, REVIEW | The assignment: for the executor, or in REVIEW for the reviewer | No move |
| `report` | IN_PROGRESS (TODO and BLOCKED are started first) | The executor's report — the first round by convention | A TODO or BLOCKED task is moved to IN_PROGRESS before the entry; after it the task goes to REVIEW |
| `fix` | IN_PROGRESS | The report on the fixes — the second round and later by convention | To REVIEW |
| `review` | REVIEW | The reviewer's verdict | `changes_requested`: back to IN_PROGRESS, the next round; `approve`: no move — close the task with `update_task` (DONE with a `resolution`) |

The server stamps the entry with the task's current `review_round`, its own
`id` and `created_at`; a round is never passed. The implementer and the
reviewer sign with different names: a `review` signed like a `report` or `fix`
of the same round is refused (`reviewer_is_author`) — the default authors never
are.

**Returns:** a slim echo — `id`, `task_id`, `kind`, `round`, `verdict` and
`summary`, plus `status` (the status the task is in now) when the entry moved
it. When the entry is written but the move after it is refused, the answer
carries the refusal under `move_refused`, and the task keeps its status.

**Refusals** (a dict with `error`, `message`, `context`; nothing is written):
`journal_on_epic` (write on the child task instead), `journal_task_closed`
(the task is DONE or CANCELLED — reopen the task, then write the entry),
`journal_kind_not_allowed` (`context` carries `kind`, `status` and the kinds
that fit), `invalid_verdict` (`verdict` missing on `review` or present on
another kind; 422 over REST), `reviewer_is_author`, a refusal of the move
before a report (the transition's own code) and `not_found`
(`context.task_id` — the task is not in the project, a task of another team
included; check the id with `list_tasks`).

### list_task_journal

The journal of one task, oldest entry first. Texts are left out unless asked
for, so a long history stays cheap to scan.

```
mcp__conport__list_task_journal({
  project: <project>,
  task_id: <task_id>,
  round: 2,
  include_body: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID |
| round | integer | no | Only the entries of this review round |
| include_body | boolean | no | Include each entry's text (default: false). One answer holds at most 200000 characters of text: the page stops before the entry that would pass it |
| limit | integer | no | Max entries (default: 50, at most 200) |
| offset | integer | no | Pagination offset (default: 0) |

**Returns:** `entries` — `id`, `task_id`, `kind`, `round`, `verdict`,
`author`, `created_at` and `body_length`, plus `body` with
`include_body: true` — and `total`, plus `next_offset` whenever entries remain
after the page: call again with `offset: next_offset` to read the journal in
full.

**Refusals:** `not_found` (`context.task_id`) when the task is not in the
project.

### get_task_journal_entry

One journal entry with its text: the entry `entry_id`, or the latest entry of
a `kind` — the brief an agent is handed, the report or the review to answer.

```
mcp__conport__get_task_journal_entry({
  project: <project>,
  task_id: <task_id>,
  kind: "brief"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| task_id | integer | yes | Per-project task ID |
| entry_id | integer | one of the two | Per-project ID of the journal entry |
| kind | string | one of the two | `brief` \| `report` \| `review` \| `fix` — the latest entry of this kind |

**Returns:** the entry — `id`, `task_id`, `kind`, `round`, `verdict`,
`author`, `body`, `created_at`.

**Refusals:** `validation_error` when neither or both of `entry_id` and `kind`
are passed; `not_found` — for a task not in the project (`context.task_id`),
for an entry that is not in this task's journal (`context.task_id`,
`context.entry_id`) and for a task with no entry of that kind yet
(`context.task_id`, `context.kind`); `list_task_journal` shows the entries.

---

## Milestones (roadmap)

A milestone is an ordered per-project group of epics. Epics attach through
`add_task` / `update_task` with `milestone_id` — there is no separate attach
tool. The **current** milestone is the OPEN one with the smallest `sequence`.

### add_milestone

Create a milestone. Omit `sequence` to append after the last one.

```
mcp__conport__add_milestone({
  project: <project>,
  title: "MVP stabilisation",
  is_release: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  milestone_id: 2,
  status: "DONE",
  resolution: "v1.3 released"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
no epics attached is refused too). A release milestone held back by earlier
open milestones is refused with the same code: `context.open_milestones`
(`id`, `title`, `sequence`) lists them, and the `message` says to close them
first. `validation_error` on an
unknown status or a close without `resolution`. `not_found` for an unknown
milestone.

### list_milestones

Roadmap view: milestones by `sequence`, each with its epics.

```
mcp__conport__list_milestones({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  title: "API Spec",
  content: "# API\n...",
  doc_type: "api_docs"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| title | string | yes | Title (max 200 chars) |
| content | string | yes | Content (max 50000 chars) |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| diagram \| plan \| other. For `diagram`, `content` is the JSON spec |
| author | string | no | Author (max 100 chars) |
| tags | array | no | Tags |
| parent_document_id | integer | no | Per-project ID of parent document |

**Returns:** a slim echo — `id` and `tags`, so you can confirm where the body
landed. The body is split into blocks on the
write itself; their embeddings and entity extraction follow in the background.

### update_document

Replace the document body and/or update metadata. Body changes go through the block reconciliation engine (unchanged blocks keep ULIDs + embeddings, changed blocks re-embed, deleted blocks are dropped).

```
mcp__conport__update_document({
  project: <project>,
  document_id: 5,
  content: "# Auth Design\n\nFull markdown body — replaces the document content.\n\n## API\n..."
})
```

The body is parsed into blocks server-side via the block reconciliation algorithm — unchanged blocks keep their ULIDs (and their embeddings/entity mentions), changed blocks get re-embedded, deleted blocks are dropped. Cheaper than naive replace because only the dirty parts hit Mistral.

Metadata-only updates work without a `content` field — pass just `title`, `doc_type`, `tags`, etc. The body and its blocks stay as they are, unless `doc_type` changes to or from `diagram`:

- **To `diagram`** — the body (`content` of this call, else the stored one) must be a diagram spec. Otherwise the call is rejected and nothing is written: create the diagram as a new document instead, with `add_document`, `doc_type: "diagram"` and the spec as `content`. An accepted change removes the document's blocks, the links its blocks wrote, its entity mentions and its embedding — a diagram keeps none.
- **From `diagram`** to any other type — blocks are built from the stored body. They get new ids, so a link to a block the document had before it became a diagram no longer resolves. A new markdown `content` in the same call is rejected: change `doc_type` first, then send `content` in a second call. When the new type is `spec`, that second call is a spec body edit: it needs `change_kind: "amend"` and a `reason` (see `change_kind` below).

For surgical single-block edits, prefer `update_block` (skips the parse/reconcile round-trip).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| content | string | no | Full markdown body. Omit for metadata-only update. |
| title | string | no | New title |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| diagram \| plan \| other. A change to or from `diagram` is more than metadata — see above |
| tags | array | no | New tag list |
| author | string | no | New author |
| status | string | no | Lifecycle status — `active` (default) or `archived`. Archived documents drop out of default listings and search but stay readable by id. |
| change_kind | string | no | `amend` \| `substantive` — required to change the **body** of a `doc_type='spec'` document. `substantive` is always rejected: author a new spec with `add_document` and emit a `supersedes` edge instead |
| reason | string | no | Why the amendment was made. Required with `change_kind: "amend"`, recorded in the spec amendment log |

**Returns:** a slim echo — `id` and `tags`.

**Errors:** a `doc_role='derived_view'` document rejects any body change (it
is regenerated by the recipe runner); a spec body edit without `change_kind`,
with `change_kind: "substantive"`, or with `change_kind: "amend"` and no
`reason`, is rejected as well. So is a change of `doc_type` to `diagram` over
a body that is not a diagram spec, and a markdown `content` sent together with
a change of `doc_type` away from `diagram`.

### list_blocks

List a document's blocks in order with their ULIDs — the discovery step before
`get_block` / `update_block` / `insert_block` / `delete_block`.

```
mcp__conport__list_blocks({
  project: <project>,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |

**Returns:** `blocks` (`ulid`, `type`, `ord`, `text_preview` — truncated at 200
chars, `content_hash`) and `total`. Use `get_block` for a full block body.

### get_block

Read one block by ULID.

```
mcp__conport__get_block({
  project: <project>,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to read |

**Returns:** the block JSON — `{ulid, type, ord, text, attrs, content_hash,
created_at, updated_at}`. An unknown ULID is an error, not an empty result.

### update_block

Replace one block's markdown without touching the rest of the document. Surgical — only this block re-embeds.

```
mcp__conport__update_block({
  project: <project>,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF",
  markdown: "## API Endpoints\n\nNew content for just this heading-block."
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to update |
| markdown | string | yes | New markdown for this block. Must parse to **exactly one** block — a multi-block payload is rejected |

**Returns:** `ulid`, `type`, `content_hash` and `changed_block_ids` (the blocks
queued for re-embedding).

**Refused when it would change the blocks of the document.** The edit is checked
against the body it would leave: if that body reads back as other blocks than
the ones stored, nothing is written and the error names the one call to make.
`block_joins_list` — a block set under a list that the list would take in:
change that list with `update_block`. `block_edit_changes_blocks` — any other
case (a block below an unclosed HTML comment, for example): write the whole body
with `update_document`.

### insert_block

Insert a new block. Pass `after=<ulid>` or `before=<ulid>` to position it; omit
both to append at the end. `after` wins when both are given.

```
mcp__conport__insert_block({
  project: <project>,
  document_id: 5,
  markdown: "## New Section\n\nFresh paragraph.",
  after: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| markdown | string | yes | Markdown for the new block. Must parse to **exactly one** block |
| after | string | no | ULID to insert after (takes precedence over `before`) |
| before | string | no | ULID to insert before (ignored when `after` is given) |

**Returns:** `ulid`, `type`, `ord`, `content_hash` and `changed_block_ids`.

**Refused when it would change the blocks of the document.** The edit is checked
against the body it would leave: if that body reads back as other blocks than
the ones stored, nothing is written and the error names the one call to make.
`block_joins_list` — a block set under a list that the list would take in:
change that list with `update_block`. `block_edit_changes_blocks` — any other
case (a block below an unclosed HTML comment, for example): write the whole body
with `update_document`.

### delete_block

Delete one block by ULID. Its mentions go with it and the document
re-serializes; an unknown ULID is an error.

```
mcp__conport__delete_block({
  project: <project>,
  document_id: 5,
  block_ulid: "01HZ8XR3VKQM6T7B9YJK5R2WPF"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| block_ulid | string | yes | ULID of the block to delete |

**Returns:** a confirmation `message` and `changed_block_ids`.

**Refused when it would change the blocks of the document.** The edit is checked
against the body it would leave: if that body reads back as other blocks than
the ones stored, nothing is written and the error names the one call to make.
`block_joins_list` — a block set under a list that the list would take in:
change that list with `update_block`. `block_edit_changes_blocks` — any other
case (a block below an unclosed HTML comment, for example): write the whole body
with `update_document`.

### list_documents

List documents

```
mcp__conport__list_documents({
  project: <project>,
  doc_type: "spec"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| doc_type | string | no | Filter by type |
| limit | integer | no | Max results (default: 50) |

**Returns:** `documents` (newest update first — `id`, `title`, `doc_type`,
`doc_role`, `status`, `author`, `tags`, timestamps, `content_preview` truncated
at 200 chars, `content_length`) and `total`. Archived documents are not listed.

### get_document

Get a document. By default the response carries Wave 5 render-time stubs
injected for sections with incoming `supersedes` / `resolves` / `extends`
edges (when the server-side `DOC_GRAPH_RENDER_STUBS` flag is on). Pass
`raw=true` for the unmodified markdown — useful for parser tests and raw
exports.

```
mcp__conport__get_document({
  project: <project>,
  document_id: 5,
  raw: false
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |
| raw | boolean | no | If true, bypass stub injection. Default false. |

**Returns:** the full document — `id`, `title`, `content`, `doc_type`,
`doc_role`, `status`, `parent_document_id`, `author`, `external_url`, `tags`,
`children_count`, timestamps. An unknown document is an error.

### get_block_backlinks

Incoming Wave 6 document links pointing at this document or one of its
blocks. Surfaces *authored* references — the markdown callout/wikilink
that produced each edge sits in `source_text`.

```
mcp__conport__get_block_backlinks({
  project: <project>,
  document_id: 12,
  block_ulid: "01HZ...",   // omit for whole-doc + all blocks
  edge_types: ["supersedes", "resolves"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
source block itself and any blocks already linked to/from it by an
authored document link — surfaces *discovered* relationships, not
already-authored ones. Companion to `get_block_backlinks`.

```
mcp__conport__get_semantically_related_blocks({
  project: <project>,
  document_id: 12,
  block_ulid: "01HZ...",
  limit: 5,
  threshold: 0.7
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Source document |
| block_ulid | string | yes | Source block ULID (must exist and have an embedding) |
| limit | integer | no | 1..50 (default 10) |
| threshold | number | no | Min cosine similarity in [0, 1] (default 0.8) |

**Returns:** `related` (`doc_id`, `doc_title`, `block_ulid`, `block_preview`,
`similarity`) and `total`. A source block whose embedding has not been computed
yet is an error, not an empty result.

### delete_document

Delete a document

```
mcp__conport__delete_document({
  project: <project>,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| document_id | integer | yes | Per-project document ID |

**Returns:** a confirmation `message`. An unknown document is an error.

---

## Architecture diagrams

A diagram is a document (`doc_type='diagram'`) whose body is a JSON spec the
dashboard draws itself. The body is written through `add_document` /
`update_document` and read through `get_document`. The one tool of its own is
the list.

An existing document becomes a diagram, or stops being one, through
`update_document` with a new `doc_type` — only over a body that is a diagram
spec in the first case, and without a new markdown body in the second. See
`update_document` for what each change does to the document's blocks.

### list_diagrams

List a project's diagrams with the scope each was drawn for.

```
mcp__conport__list_diagrams({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

**Returns:** `diagrams` (`id`, `title`, `scope` from the stored spec,
`updated_at`) and `total`.

---

## Patterns

### log_pattern

Create a system pattern

```
mcp__conport__log_pattern({
  project: <project>,
  name: "Repository Pattern",
  description: "Data access abstraction",
  tags: ["architecture", "data"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  pattern_id: 3,
  description: "Data access abstraction, one repository per aggregate",
  tags: ["architecture", "data"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| pattern_id | integer | yes | Per-project pattern ID to update |
| name | string | no | New name (max 200 chars) |
| description | string | no | New description |
| tags | array | no | New tag list — replaces the existing tags entirely |

**Returns:** a slim echo — `id` and the stored `tags`.

### list_patterns

List architectural patterns

```
mcp__conport__list_patterns({
  project: <project>,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
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
| project | string | yes | Project handle or name |
| source_type | string | yes | decision \| progress \| pattern \| task \| **doc** (documents are `doc` here, not `document`) |
| source_id | integer | yes | Per-project ID of source item |
| target_type | string | yes | decision \| progress \| pattern \| task \| doc |
| target_id | integer | yes | Per-project ID of target item |
| relationship | string | no | Link type (default: relates_to) |
| description | string | no | Link description |

**Link types:** mentions, implements, derived_from, references, clarifies, relates_to, supersedes, blocks, depends_on

These nine are the whole vocabulary: the server refuses any other value, and
the links it creates on its own (`mentions`, `implements`, `derived_from`,
`relates_to`) use the same types.

**Returns:** the created edge — `id`, both endpoints, `link_type`,
`description`, `weight`, the `created_by*` attribution fields and `created_at`.

### get_linked

Get items linked to a specific item: the item-graph edges the item is an end
of, authored by hand or created automatically — the 100 newest of them.
`direction` keeps the edges the item is the source of, the target of or either
end of; `relationship` keeps one link type; the two narrow together. When
`item_type='doc'` and
`include_section_links=true`, the response also includes
`section_links: { incoming, outgoing }` — the block-level document links where
this document is either source or target. Default is `false`.

```
mcp__conport__get_linked({
  project: <project>,
  item_type: "doc",
  item_id: 12,
  include_section_links: true
})

mcp__conport__get_linked({
  project: <project>,
  item_type: "task",
  item_id: 5,
  direction: "incoming",
  relationship: "blocks"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| item_type | string | yes | decision \| progress \| pattern \| task \| **doc** (documents are `doc` here, not `document`) |
| item_id | integer | yes | Per-project ID of the item |
| relationship | string | no | Keep the edges of one link type: mentions \| implements \| derived_from \| references \| clarifies \| relates_to \| supersedes \| blocks \| depends_on. Left out, every link type comes back |
| direction | string | no | outgoing (the item is the source) \| incoming (the item is the target) \| both (default: both) |
| include_section_links | boolean | no | `item_type: "doc"` only — also return the block-level document links. Default false. |

**Returns:** `links` (`id`, both endpoints, `link_type`, `description`,
`weight`, the `created_by*` attribution fields, `created_at`) — at most 100,
newest first — and `total`, the full number of the edges that pass
`direction` and `relationship`, so `total` above 100 means older ones were
left out; with `include_section_links` also `section_links` (`incoming`,
`outgoing` — document links with `edge_type`, `source_text`, block ULIDs),
which `direction` and `relationship` do not narrow.

**Errors:** a `direction` or a `relationship` outside its list is refused, and
the message names the values to pass.

---

## Project Links

### link_project

Create a cross-project link between two projects of one team. The team is the
one of the source project (`project`); links never cross a team boundary.

```
mcp__conport__link_project({
  project: <project>,
  target_project: "billing",
  link_type: "depends_on",
  description: "Uses for authentication"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Source project: its handle or name |
| target_project | string | yes | Target project: its handle, its short name, or `team/project` (`k7m2qx9d/billing`) naming the team of the source project |
| link_type | string | yes | Link type |
| description | string | no | Link description |

**Link types:** depends_on, part_of, calls, shares_data, extends, deployed_with, shares_database, related_to

**Returns:** the created link — `id`, `source_project` and `target_project`
(handles) with the `canonical_name` of both, `link_type`, `description`,
`metadata`, `created_by`, `created_at`. Both projects must be in the team of
the source project, and they must differ.

**Errors:** a target outside that team is not found (404), by handle and by
name alike. A `team/` prefix of a team you are not a member of fails with
`team_not_found` (404), whether that team exists or not; a prefix of another
team of yours fails with `cross_team_link_not_supported` (422). A malformed
target fails with `invalid_project_name` (422): rewrite it as
`<team ID>/<project>` (`k7m2qx9d/billing`), `pers/<project>`, or a name without `/`.

### get_project_links

Get cross-project links

```
mcp__conport__get_project_links({
  project: <project>,
  direction: "both"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| direction | string | no | outgoing \| incoming \| both (default: both) |

**Returns:** `outgoing` and `incoming` (each link with `id`, `source_project`
and `target_project` (handles) with the `canonical_name` of both, `link_type`,
`description`, `metadata`, `created_by`, `created_at`) plus `total` across both
lists.

### unlink_project

Delete a cross-project link

```
mcp__conport__unlink_project({
  project: <project>,
  link_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  query: "caching performance",
  types: ["decision", "task"],
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | yes | Search query |
| project | string | no | Scope to one project, by handle or name; the search runs in that project's team. Omit to search every project of one team (`team`, or your Private Team) — handy when you don't know where a fact lives |
| types | array | no | Filter by item type. **Singular vocabulary**: `decision`, `task`, `pattern`, `document`, `progress_entry`, `context`, `custom_data`; the cross-reference short forms `progress` and `doc` are accepted as aliases. Values outside it are dropped, so a typo (`tasks`, `docs`) silently narrows the search to nothing |
| limit | integer | no | Max results, capped at 100 (default: 20) |
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `results` (ranked) and `total`, plus a rendered `_summary` and
`team` — the team the search ran in (`pers` for your Private Team, otherwise
the shared team's ID). A search never crosses teams: an empty result is about
that team only, so before concluding the knowledge is missing, repeat the
search with the `team` of the project you work in. A `project` that is not a
project of the team the call names is an error (`Project '<project>' not
found`), the same for a project of another team and for one that does not
exist.
Each hit carries:
- `item_type`, `item_id` — the per-project ID, so pair it with `project`
- `project` (the handle) / `project_name` — which project the hit came from
- `content` — the item blob. GraphRAG hits carry `via_entity` /
  `via_community` inside it; decision hits are annotated with `currency`
  (current \| superseded \| deprecated), `superseded_by` and `age_days`
- `score` — RRF score, `created_at`
- `_source` — only on pattern/decision hits related through a `derived_from`
  edge: `aggregated_pattern` (with `_aggregated_from`) or
  `covered_by_pattern` (with `_pattern_id`)

An empty result set adds `_hint: "knowledge_gap_detected"` with a
`_hint_message` that names the team searched and gives one next step. When
nothing named the team — no `project`, no `team`, and a connection that is
not a team's own address — the search ran in your Private Team by default:
repeat it with the `team` of the project you work in if that project belongs
to another team. Otherwise — save the answer once you have it. Only when the
search itself was healthy.

**Incomplete searches.** Search fuses several sources; if one of them cannot
run, the rest still answer and the reply says so:

- `degraded: true` and `failed_sources` (e.g. `["fts:document"]`) name the
  sources that failed;
- `_summary` ends with `WARNING: search is incomplete — ...`;
- `_hint` is `search_degraded`, not `knowledge_gap_detected`, whether the
  result set is empty or not.

A degraded result set is missing whatever those sources hold, so **a missing
answer does not prove the knowledge base lacks it**. Retry the search; do not
record a new decision or document on the strength of what a degraded search
failed to return.

---

## GraphRAG & Entities

> GraphRAG tools work **without `project`**: each reads the graph of one
> team — `team`, or your Private Team when it is omitted — and names that team
> in the reply's `team` (`pers` or the shared team's ID). The graph of a
> project in a shared team is reached only with that team's `team`.

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
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `entities` (`id`, `canonical_name`, `entity_type`, `description`,
`mention_count`, `project_count`), `total` and `team`.

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
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `id`, `canonical_name`, `entity_type`, `description`,
`mention_count`, `project_count`, `projects` (`project` — the handle, `project_name`,
`decision_count`), `related_entities` (`entity_id`, `canonical_name`,
`entity_type`, `relation_type`, `direction`) and `team`. An entity unknown in
that team is an error.

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
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `entity_id`, `related_entities` (walked over the in-memory graph
up to `max_depth`), `total` and `team`. An entity that is not in that team's
graph is an error.

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
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `communities` (`community_id`, `level`, `entity_count`,
`entity_names`, `keywords`, plus `summary`, `summary_generated_at` and
`summary_stale` when summaries are asked for), `total` and `team`. A summary is
rewritten only when its cluster's membership changed or its text has aged, so
`summary_stale: true` means the prose describes a different set of entities
than the one listed — treat it as a hint, not as fact.

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
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `community_id`, `level`, `summary`, `summary_generated_at`,
`summary_stale`, `keywords`, `entities` (`entity_id`, `canonical_name`,
`entity_type`), `relationships` (`source_id`, `target_id`, `relation_type`,
`weight`), `entity_count`, `relationship_count` and `team`.

### graph_stats

Knowledge-graph statistics across all the projects of one team

```
mcp__conport__graph_stats()
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| team | string | no | Team to act in — `"pers"` or a shared team's ID. Omitted: your Private Team. Working in a project of a shared team: pass the `team.handle` that `init` returned for that project |

**Returns:** `nodes_count`, `edges_count`, `density`, `is_directed`,
`entity_type_distribution`, `relation_type_distribution`, `is_dirty`,
`last_save` and `team` — computed over that team's graph only.

---

## History & Activity

### recent_activity

Recent activity in the project

```
mcp__conport__recent_activity({
  project: <project>,
  hours: 24,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| hours | integer | no | Over the last N hours (default: 24) |
| limit | integer | no | Max rows **per entity type** (default: 10) — the merged list can be longer |

**Returns:** `activity` — decisions, progress entries, patterns and custom data
merged and sorted by `timestamp` descending, each row `type` + `timestamp` +
a rendered `description`. Tasks and documents are not part of this feed.

### item_history

Version history of a specific item (by per-project ID)

```
mcp__conport__item_history({
  project: <project>,
  item_type: "decision",
  item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| item_type | string | yes | decision \| progress \| pattern \| custom_data \| context |
| item_id | integer | yes | Per-project item ID (for `custom_data`/`context` the raw ID is used) |

**Returns:** `item_type`, `item_id` and `history`. Only the current version is
tracked for these types, so `history` holds a single entry (`version`,
`timestamp`, `changes`, `changed_by`). Real version chains of contexts live in
`context_history`.

---

## Context assembly

Deterministic graph traversals that build a ready-to-read package instead of
making you stitch several reads together.

### assemble_context

Run a registered recipe from a start node.

```
mcp__conport__assemble_context({
  project: <project>,
  recipe: "task_briefing",
  start_id: "task-<id>"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| recipe | string | yes | Registered recipe name — `task_briefing` (starts from a task) or `spec_implementation_status` (starts from a document). `list_context_recipes` is the live list |
| start_id | integer/string | yes | Start node. Prefer the prefix form `"<type>-<id>"` (`"task-<id>"`, `"doc-<id>"`); the wikilink form `"[[task-<id>]]"` works too. A bare integer is the legacy fallback and is resolved as the recipe's own type. Prefixes: `task`, `doc`, `decision`, `pattern`, `progress` |
| format | string | no | `markdown` (default) or `json` |
| depth | integer | no | Override the recipe's own traversal depth. Omit for the recipe default |

**Returns:** `recipe`, `recipe_version`, `start_id`, `format`, `content` (the
rendered markdown, or the structured payload with `format: "json"`) and
`generated_at`.

**Errors:** an unknown `recipe` name, a `start_id` whose declared type does
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
  project: <project>,
  scope: ["embedding", "graph"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  doc_id: 7,
  threshold: 0.7
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| doc_id | integer | yes | Per-project document ID to audit |
| threshold | number | no | Cosine-similarity cutoff for "covered", in [0, 1] (default: 0.7) |
| top_k | integer | no | Matches surfaced per block (default: 3, max 20) |

**Returns:** `doc`, `threshold`, `top_k`, `block_count`, `covered_count`,
`uncovered_count`, `blocks`, plus `recommendation`
(`ready_to_archive` \| `promote_capture_gaps` \| `no_blocks`) and `reason`.

---

## Knowledge-base gaps

Gaps are detected and resolved server-side. A daily pass fixes what the server
can fix on its own and closes what has lost its cause; a gap only a person can
decide reaches the agent as a question in `init`, answered with
`answer_question`. These tools read the gaps and answer the questions — there is
no manual review queue.

### gap_list

List gaps. Defaults to the open ones (`detected`).

```
mcp__conport__gap_list({
  project: <project>,
  category: "coverage"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| category | string | no | structural \| temporal \| coverage \| dependency \| doc_drift \| routine |
| state | string | no | detected \| acknowledged \| dismissed \| resolved. Comma-separated for several (default: `detected`). No gap is in `acknowledged` any more: every acknowledged gap was reopened as `detected`, or closed when its type was retired |
| limit | integer | no | Max results (default: 50) |

**Returns:** `gaps` (`hash`, `category`, `gap_type`, `subject`, `state`,
`details`, `first_detected_at`, `last_detected_at`, `dismissed_reason`),
`total` and `summary`.

### gap_stats

Aggregated counts by state × category plus what was resolved recently.

```
mcp__conport__gap_stats({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

**Returns:** `breakdown` (state → category → count), `resolved_last_30d`,
`summary`.

### answer_question

Answer a question from `init`: pass its `id` and the `key` of the option the
user chose. Ask the user first — silence is not an answer, and no call is made
without one.

```
mcp__conport__answer_question({
  project: <project>,
  question_id: "a1b2c3d4e5f6a7b8",
  option: "keep"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| question_id | string | yes | The `id` of a question `init` returned |
| option | string | yes | The `key` of the chosen option |

**Returns:** `question_id`, `option`, `outcome` (`resolved` — the server did
what the option says; `dismissed` — left as it is; `deferred` — asked again
later; `cleared` — what the question was about is gone, nothing was done),
`instruction` (one line to carry out now, for an option you perform yourself)
and `action` (what was recorded).

**Refusals:** `question_closed` — the question is already answered or closed,
go on; `question_not_found`; `unknown_option` — `context.options` lists the
valid keys: ask the user again with them, never pick one yourself;
`epic_not_ready` — the epic gained an open task while it was being closed. An
option that closes a task can also return a refusal of the task cycle (such as
`done_needs_review`); follow its `message`.

---

## Semantic pass

LLM analysis of the knowledge graph. A pass produces **proposals**, and a rule
settles every one of them without a manual review: graph mutations at or above
the confidence threshold are applied, those below it and noise are rejected.
The server applies the rule daily to every project and at the end of each pass,
so no proposal waits for review.

### semantic_cleanup

One-click cleanup: run the pass, then settle every waiting proposal by the
rule — reject noise, approve mutations at or above `confidence_threshold` and
reject those below it, apply what was approved. Returns immediately and runs in
the background.

```
mcp__conport__semantic_cleanup({
  project: <project>,
  dry_run: false
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| confidence_threshold | number | no | Approve mutations at or above this confidence (default: 0.85) |
| dry_run | boolean | no | **Default true** — applies nothing in this call, but stores the proposals and approves those at or above `confidence_threshold`; the next daily run (within a day) or any `semantic_pass_run` applies what it approved. Not a preview: with a lowered threshold it approves what the rule would reject. Pass `false` to apply in this call |

**Returns:** `started`, `run_id`, `dry_run`, `poll` and `summary`. Poll
`semantic_pass_stats`: the run is done once its `recent_runs` entry for
`run_id` has `completed_at`.

**Already running:** when a pass or cleanup is already open for the project
the answer is `already_running: true` with the live `run_id` and a `summary` —
no `error` key; poll that run instead of starting another.

**Refusals:** `rate_limited` (with `retry_after_seconds`) for a non-dry run
inside the per-owner cooldown.

### semantic_pass_run

Run the pass manually. A real run stores the proposals and then settles every
waiting one by the rule; a dry run returns them without storing anything.

```
mcp__conport__semantic_pass_run({
  project: <project>,
  dry_run: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| scope | string | no | `full` (default, all communities) or `communities` |
| community_ids | string | no | Comma-separated community IDs, used with `scope: "communities"` |
| dry_run | boolean | no | Return proposals without saving them (default: false). Previews are not rate-limited |

**Returns:** `pass_run_id`, `proposals` and `residuals` (populated on a dry
run), `stats` (with `proposal_rules` — what the rule applied and rejected) and
`summary`.

**Refusals:** `rate_limited` (with `retry_after_seconds`) for a real run inside
the per-owner cooldown.

### semantic_pass_stats

Pass health: proposal counts, approval rate and the recent runs — also the way
to poll a background `semantic_cleanup`.

```
mcp__conport__semantic_pass_stats({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

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
  project: <project>,
  ready_limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| ready_limit | integer | no | Max tasks in `ready_top` (default: 10) |
| delta_hours | integer | no | Window for `activity_delta`, in hours (default: 24) |

**Returns:** `woken_tasks`, `roadmap` (current / next milestone), `epic_tails`
(epics near closing), `ready_top`, `housekeeping` (`stale_in_progress`,
`stale_review` — tasks in REVIEW untouched for over 24 hours, each with `id`,
`title`, `hours_in_review` (hours since the task in REVIEW was last touched, by a journal entry or an edit) — `blocked_too_long`),
`activity_delta` and a one-line `summary` (which counts
"N stale in review").

### get_routine_config

Read the project's routine policy.

```
mcp__conport__get_routine_config({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

**Returns:** the stored policy, or the defaults with `is_default: true` when the
project has none yet (`enabled` true, `cadence` daily, `max_tasks_per_run` 2,
`priority_threshold` 3, `autonomy_level` 1, `selection` threshold).

### set_routine_config

Set the policy. Partial — omitted fields keep their current value (on the first
call they take the defaults).

```
mcp__conport__set_routine_config({
  project: <project>,
  cadence: "weekly",
  autonomy_level: 2
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| enabled | boolean | no | Whether the periodic cycle runs at all |
| cadence | string | no | `daily` or `weekly` |
| max_tasks_per_run | integer | no | Backlog tasks one run may execute (1-20) |
| priority_threshold | integer | no | The run picks tasks with priority ≤ this (1-5, smaller = more important) |
| autonomy_level | integer | no | `0` agenda + report only, `1` plus housekeeping and briefings, `2` plus executing backlog tasks up to `priority_threshold` |
| selection | string | no | `threshold` (default — any ready task within the priority threshold) or `tagged` (only tasks marked `routine_eligible`, still within the threshold) |

**Returns:** `project` (the handle) plus an echo of exactly the fields you passed — the
post-write verification channel.

### routine_run_start

Open the run journal entry — once, at the start of every cycle, right before
`get_agenda`.

```
mcp__conport__routine_run_start({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

**Returns:** `id` (pass it to `routine_run_finish`), `started_at` and
`already_open`. An open run from a crashed cycle is returned with
`already_open: true` instead of an error — finish it (`outcome: "aborted"`) or
keep working under it.

### routine_run_finish

Close the run journal entry — once, at the end of the cycle. Also logs a
progress entry, so do **not** call `log_progress` separately for the finish.

```
mcp__conport__routine_run_finish({
  project: <project>,
  run_id: 7,
  outcome: "completed",
  summary: "Closed two tail epics, returned one stale task to TODO",
  task_ids: [12, 14]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| limit | integer | no | Max runs (default: 10) |

**Returns:** `runs` (`id`, `started_at`, `finished_at`, `outcome`, `summary`,
`task_ids`) and `count`.

### get_estimation_stats

Plan/actual calibration — call it **before** estimating new tasks and scale your
gut estimate by the project's historical drift.

```
mcp__conport__get_estimation_stats({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  pattern: "^pytest",
  replacement: "uv run pytest",
  reason: "The project runs Python through uv"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
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
  project: <project>,
  error_signature: "ModuleNotFoundError pytest",
  solution: "Run the suite through uv run pytest",
  confidence: 0.9
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| error_signature | string | yes | Normalized error signature |
| solution | string | yes | How to fix it |
| confidence | number | no | How sure the fix is, from 0 to 1 (default: 0.8). Stored with the solution; `list_error_solutions` returns it |

**Returns:** `id`, `summary` (`Error solution: <signature>`) and `status`
(`created`). Stored as a decision tagged `error-solution`, with the solution as
its rationale and the confidence as JSON (`{"confidence": 0.9}`) in its
implementation details. `update_decision(implementation_details=…)` on that
decision overwrites the value, which then reads as `null`.

**Errors:** a `confidence` below 0 or above 1 is refused — pass a number from
0 to 1 — and nothing is stored.

### list_conventions

List the project's conventions.

```
mcp__conport__list_conventions({
  project: <project>
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |

**Returns:** `conventions` (`pattern`, `replacement`, `reason`, `decision_id`)
and `total`.

### list_error_solutions

List the known error solutions, newest first.

```
mcp__conport__list_error_solutions({
  project: <project>,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project | string | yes | Project handle or name |
| limit | integer | no | Max results (default: 20) |

**Returns:** `solutions` (`id`, `error_signature`, `solution`, `confidence`,
`tags`) and `total`. A solution added without `confidence` stores 0.8; `null`
marks a solution that stores no value — one recorded before the value was
kept, or a decision tagged `error-solution` by hand.

---

## Quick Reference

| Category | Tools |
|----------|-------|
| Session | `init`, `create_project`, `list_projects` |
| Context | `update_product_context`, `update_active_context`, `context_history` |
| Tasks | `add_task`, `update_task`, `list_tasks`, `get_task`, `add_task_dep`, `delete_task`, `add_linked_task`, `add_task_journal_entry`, `list_task_journal`, `get_task_journal_entry` |
| Milestones | `add_milestone`, `update_milestone`, `list_milestones` |
| Documents | `add_document`, `update_document`, `list_documents`, `get_document`, `delete_document`, `get_block_backlinks`, `get_semantically_related_blocks`, `list_blocks`, `get_block`, `update_block`, `insert_block`, `delete_block` |
| Decisions | `sync_decision`, `list_decisions`, `get_decision`, `update_decision`, `deprecate_decision`, `reactivate_decision`, `delete_decision` |
| Progress | `log_progress`, `update_progress`, `list_progress`, `delete_progress` |
| Patterns | `log_pattern`, `update_pattern`, `list_patterns` |
| Search | `search` |
| Linking | `link_items`, `get_linked`, `link_project`, `get_project_links`, `unlink_project` |
| GraphRAG | `entities`, `entity`, `entity_related`, `communities`, `community`, `graph_stats` |
| History | `recent_activity`, `item_history`, `context_history` |
| Context assembly | `assemble_context`, `list_context_recipes`, `render_current_architecture`, `audit_doc_l1_coverage` |
| Architecture diagrams | `list_diagrams` |
| Gaps | `gap_list`, `gap_stats`, `answer_question` |
| Semantic pass | `semantic_cleanup`, `semantic_pass_run`, `semantic_pass_stats` |
| Routine cycle | `get_agenda`, `get_routine_config`, `set_routine_config`, `routine_run_start`, `routine_run_finish`, `list_routine_runs`, `get_estimation_stats` |
| Guardrails | `add_convention`, `add_error_solution`, `list_conventions`, `list_error_solutions` |

**Prefix:** `mcp__conport__` (CLI) or `mcp__claude_ai_conport__` (Chat)

---

*Version: ConPort MCP v7.0*
*API: ConPort REST API v2.2*
