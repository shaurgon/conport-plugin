---
name: conport
description: "Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start."
metadata:
  version: 16.1.0
---

# ConPort — Project Management System

> **ConPort stores everything about the project:** tasks, documents, decisions, infrastructure.
> **Without init, context is unavailable.** Without search, you are answering blindly.

This skill carries the **always-on discipline** — what you must do every session
regardless of topic. Deep, situational reference (recipe semantics, the gap
system, the semantic pass, the full per-tool parameter tables, the block model,
the documentation-graph callout reference, the spec append-only rationale) lives
in the **live docs** — see the *Live docs* section below. Fetch the relevant
page before acting on one of those topics; don't act from memory.

### MCP Prefix

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

---

## FIRST ACTION OF THE SESSION

### Step 1: Determine the project name

The project name comes from the env var `CONPORT_PROJECT_NAME` and from nowhere
else. Never derive it from the repository, the working directory or a guess.

**Claude Code CLI** — the variable is set in `.claude/settings.local.json`.
**If it is not set — stop.** Do not call `init`. Show the user the line to add
to `.claude/settings.local.json` and ask them to restart the session:

```json
"env": { "CONPORT_PROJECT_NAME": "<project>" }
```

For a repository that a team works on, the value carries the team ID:
`k7m2qx9d/<project>` (the team ID is on the team's settings page). A bare
`<project>` is a project of the user's own `Private Team` — see *TEAMS* below.

**Cursor, Codex and other agents with a shell** — the variable is an environment
variable of the agent's process. If it is not set — stop, do not call `init`,
and ask the user to export `CONPORT_PROJECT_NAME` and restart the agent.

**Claude.ai Chat** — there are no environment variables; the user names the
project (`<project>`, or `k7m2qx9d/<project>` for a team's project). Ask for it.

### Step 2: Call init

```
mcp__conport__init({
  name: "<CONPORT_PROJECT_NAME>",  // exactly as set, team ID included
  skill_id: "conport",
  skill_version: "<metadata.version from this SKILL.md frontmatter>",  // substitute the real value; never send this placeholder
  client_type: "claude-code"  // or claude-ai / cursor / codex
})
```

`skill_id` / `skill_version` / `client_type` are optional but strongly recommended — they let the server tell you when SKILL.md has been updated upstream so manual installs (Claude.ai project files, hand-copied skills) don't silently drift. Pick `client_type` from the list above; fall back to omitting it if running somewhere else.

`init` only finds a project — it never creates one. Each refusal
(`project_not_found`, `project_name_in_other_team`, `team_not_found`,
`invalid_project_name`) has one prescribed action — see *TEAMS → Refusals* below. Do not answer a refusal by
trying another name.

### After init — MANDATORY:

1. **Print summary:** `[CONPORT] {summary from response}`
2. **Execute instructions** from the response (read files, apply rules)
3. **Report backlog:** `N tasks in TODO, M in progress. Top 5:` — use `backlog.top` from the response. Line format: `Pk · #id title (n subtasks)`, skipping `(n subtasks)` when zero. `Pk` is `effective_priority`. Skip the whole block if `backlog.total_todo == 0` and `backlog.total_in_progress == 0`.
4. **Report the roadmap:** when the response carries `roadmap` and/or `epic_tails`, print them in the format given under *OUTPUT FORMAT → Roadmap sections*. Both sections are omitted when the project has nothing to show — then print nothing.
5. **If the project is empty** (no decisions, no patterns, empty `product_context`) — offer the bootstrap flow from `references/bootstrap.md`. An empty project is one that was created explicitly: `init` does not create projects, so a missing name is refused with `project_not_found` instead of showing up here as a new, empty one.
6. **If `routine_suggestion` is present in the response** — surface it to the user and offer to accept (`set_routine_config(...)`, e.g. with the `suggested_config`) or dismiss permanently (`set_routine_config(enabled=false)`).
7. **If `skill_update_available` is present in the response** — emit ONE short notice at the very start of your first reply (after the `[CONPORT]` line). Format:

   ```
   [SKILL UPDATE] {skill_id} {current} → {latest} ({severity}). Changelog: {changelog_url} · Install: {install_guide}
   ```

   - When `current == "unknown"` — phrase as `cannot determine version, see {install_guide}`.
   - When `severity == "security"` — emit a stronger line (`[SECURITY UPDATE]`) and recommend updating before proceeding.
   - Do NOT re-emit the notice in subsequent turns — once per session.

   **Never decide "is there an update" by hand-comparing version numbers.**
   The conport plugin (this skill + superpowers-conport + plugin.json +
   marketplace) versions independently from `conport-agent`, which is a
   separate privately-distributed unit with its own version line. Numbers from
   different units are NOT comparable. The ONLY correct signal is
   `skill_update_available` above: present → update; absent → you're current.
   If you catch yourself reasoning "my number looks higher than that other
   unit's, so I'm ahead" — stop, that's the exact mistake this signal prevents.

**Save-first.** Save decisions (`sync_decision`) and progress (`log_progress`)
as they happen, not in a batch at the end of the session. The moment a choice is
made or a step is finished, persist it — saving at the end loses rationale and
an interrupted session leaves nothing behind. (Live docs → `core/save-first`.)

**Without init you cannot:** answer questions about the project or work with tasks.
**Ignoring instructions is FORBIDDEN.**

---

## TEAMS — one key, every team

Every project belongs to exactly one team, and every member of a team sees all
of its projects. Each user has a **`Private Team`** — personal, with the user
as its only member; nobody can be invited into it — and may create or join
shared teams. Project names are unique within a team.

**One key and one address work in all of the user's teams.** An API key belongs
to its user and identifies only that user; access to a team comes from the
user's membership, not from the key. The MCP address is always
`https://api.conport.app/mcp/` — the same for a key and for OAuth, for the
`Private Team` and for every shared team.

**A project is addressed as `<team ID>/<project>`.**

| Name | Means |
|---|---|
| `k7m2qx9d/<project>` | the project in the shared team whose team ID is `k7m2qx9d` |
| `pers/<project>` | the project in the user's own `Private Team` |
| `<project>` | the same as `pers/<project>` |

The team ID is the eight-character identifier shown on the team's settings
page. `pers` is always the caller's own `Private Team`, so `pers/<project>` is
a different project for every user — a team's repository must carry the team ID
in `CONPORT_PROJECT_NAME`.

**The team of a call comes from the project, or from the `team` argument.**

- A tool that takes `project_id` works in that project's team — nothing else to
  pass.
- `init` returns `team` (`handle`, `name`, `kind`) next to `project_id`, and
  `canonical_name` — the full `<team ID>/<project>` form.
- Tools that can run without a project take a `team` argument: `list_projects`,
  `search` without `project_id`, and the graph tools (`entities`, `entity`,
  `entity_related`, `communities`, `community`, `graph_stats`). Pass the
  `handle` that `init` returned as `team`.
- **Without `team`, `search` and the graph tools cover the `Private Team`
  only**, and their response names the `team` they ran in. An empty result from
  a call without `team` says nothing about a shared team — repeat it with
  `team` before concluding that the knowledge is not there. `list_projects`
  without `team` lists the projects of all your teams.

### Refusals — one action each

| Refusal | What it means | Do exactly this |
|---|---|---|
| `project_not_found` | No project of that name in the team the name points at. `init` created nothing. | Tell the user. Call `create_project` **only when the user says so**, then repeat `init`. Never create a project on your own after this refusal. |
| `project_name_in_other_team` | The name has no project in the `Private Team`, but one or more of the user's shared teams hold a project of that name. The answer lists them in `candidates` — the full names and the name of each team. | Show `candidates` to the user and ask them to put the chosen name into `CONPORT_PROJECT_NAME`. Do not pick one yourself, do not create a second project. |
| `team_not_found` | The team ID in the name or in `team` is not a team the user is a member of (a team that does not exist answers the same). | Ask the user to check the team ID on the team's settings page and their membership in that team. |
| `invalid_project_name` | The name is malformed: more than one `/`, an empty part, a project name made of digits only, or a prefix that is neither `pers` nor a team ID (the prefix is case-sensitive). | Show the user the name as it is set and ask them to correct `CONPORT_PROJECT_NAME` to `<project>`, `pers/<project>` or `k7m2qx9d/<project>`. Do not retry with a name of your own. |
| `invalid_team_id` | The team was named by something that is not a team ID: a team's display name, a wrong-case `PERS`, or any other string in the name prefix or in `team`. | Use the short team ID from the team's settings page (for example `k7m2qx9d`) or `pers`. If it came from `CONPORT_PROJECT_NAME`, ask the user to correct it. Do not retry with a name of your own. |
| `team_context_conflict` | Two parts of one call name two different teams of the user (for example the name prefix and the `team` argument). | Name the team once and repeat the call. |
| `cross_team_link_not_supported` | A link or a linked task was requested between projects of two different teams. | Tell the user it is not supported. Do not retry. |

`create_project(name, description?)` takes the same name forms as `init` and
creates the project in the team the name points at. It is called on the user's
word only.

**Access changes apply on the next call.** A revoked key, a removed member or a
demoted admin loses access on the very next request — reconnecting is not
needed and does not restore anything. Leaving a team or being removed from it
does not revoke the user's keys: a key keeps working in the user's other teams;
calls that name that team answer `team_not_found`, its projects answer as if
they did not exist, and rejoining restores access with the same key.

**Team administration is REST and dashboard only — there are no MCP tools for
it.** Do not look for one. Point the user at the dashboard
(`https://me.conport.app`) or the REST routes under `/api/v1`:

| Action | Where |
|---|---|
| Create a shared team | Dashboard `Create New`, or `POST /api/v1/teams` with an `Idempotency-Key` header — needs a signed-in user, not an API key. A server setting can keep shared-team creation closed until team isolation is verified: `shared_teams_not_open` (403) is that state, not an error to work around — keep working in `Private Team`, do not retry |
| List your teams | `GET /api/v1/teams` — all teams of the user, with an API key as well as signed in |
| Members, roles, invitations | `/api/v1/teams/{team_id}/members`, `/api/v1/teams/{team_id}/invitations` — admins invite, remove and promote; `Private Team` refuses invitations |
| Plan and billing | `GET /api/v1/teams/{team_id}/plan` — any member; `POST /api/v1/teams/{team_id}/billing/...` (checkout, cancel, resume) — admins only |
| Your own keys | Dashboard, or `GET/POST/DELETE /api/v1/me/api-keys` — a key is the user's own and carries no team |
| Move a project to another team | Dashboard, or `POST /api/v1/projects/{project_id}/transfer` — see below |

From the `conport` CLI: `conport api teams <operation>`; `--project` takes the
full `k7m2qx9d/<project>` name and `--team-id` takes a team ID.

**Moving a project to another team.** An admin of the source team who is also a
member of the target team (a regular member is enough) moves it from the
dashboard, or over REST: `POST /api/v1/projects/{project_id}/transfer` with
`{"target_team_id": "<uuid>"}` (optionally `"name"` for a new name there) and an
`Idempotency-Key` header. The numeric `project_id` names the source team by
itself; the server checks the caller's admin role in the source and membership
in the target. Repeating the request with the same `Idempotency-Key` returns
the first receipt instead of a second move. Refusals move nothing:
`project_name_taken` (409, send a `name`), `project_limit_reached` (402, the
target's plan is full), `project_busy` (409, retry later),
`transfer_source_admin_required` (403). The project keeps its id, items,
documents and history; links to projects that stay behind in the source team
are removed; subscription and past usage stay with the source team. For a while
graph functions may answer `graph_rebuilding`; project data stays readable.

**After the move the previous name no longer finds the project.** A name
without a team ID (`<project>` or `pers/<project>`) answers
`project_name_in_other_team`, and `candidates` carries the new name. A name
that carried the source team's ID answers `project_not_found` — do not create
the project again: the new name is `<target team ID>/<project>`, and the
transfer receipt carries the target's team ID as `target_team_handle`. Either
way ask the user to put the new name into `CONPORT_PROJECT_NAME`.

---

## WORKFLOW — When to call which tool

The at-a-glance trigger → tool map. Each table is navigational; for the deep
semantics of a surface, fetch the live-docs page named in the table.

### Planning

| Trigger | Tool |
|---------|------|
| "We need to do X" | `add_task` with priority **and `estimated_seconds`** (priority 1-5 where 1=critical and 5=idle, default 3; epic rows leave effort NULL, sum-from-children at read time) |
| "X depends on Y" | `add_task_dep` |
| "Create an epic" / multi-step body of work | `add_task` with `kind='epic'` |
| "Break it into subtasks" | `add_task` with `parent_task_id` (parent must be `kind='epic'`) |
| "Move task X under epic Y" / re-parent | `update_task` with `parent_task_id` (target must be `kind='epic'`; `0` detaches to root) |
| "Roadmap" / "milestones" / "what ships in the release" | `list_milestones` (roadmap view, `include_closed=true` for history) |
| "Plan a milestone / a release" | `add_milestone` with `title` (+ `sequence` to insert at a position, `is_release=true` for a release point) |
| "Rename / move / close a milestone" | `update_milestone` (`sequence` moves it, `status`+`resolution` closes it) |
| "This epic belongs to milestone M" | `update_task` with `milestone_id` (epics only; `0` detaches from its milestone) |
| "Promote this task to an epic" | `update_task` with `kind='epic'` (task must be root — combine with `parent_task_id=0` to detach + promote atomically) |
| "Demote this epic to a task" | `update_task` with `kind='task'` (epic must have no children) |
| Need a task in another project I own (no context switch) | `add_linked_task` with `target_project` name |

### Execution

| Trigger | Tool |
|---------|------|
| Starting work | `update_task` → IN_PROGRESS (**before the first write on a task**) |
| Done / Finished | `update_task` → DONE **with `resolution=...`** (see below) |
| Cancelled | `update_task` → CANCELLED **with `resolution=...`** (why dropped) |
| Blocked | `update_task` → BLOCKED |
| Milestone finished | `update_milestone` → DONE **with `resolution=...`** (all its epics must be closed first) |
| Milestone dropped | `update_milestone` → CANCELLED **with `resolution=...`** (why it left the roadmap) |

**IN_PROGRESS gate.** Before your first ConPort write against a task, move it to
IN_PROGRESS. This keeps `current_focus` accurate and the backlog honest.

**An epic closes only with its children closed** — the server refuses
`update_task(status='DONE')` on an epic that still has open children with
`epic_not_ready`, listing them. A snoozed child counts as open.

**Epic progress is counted ONLY from `epic_progress` /
`list_tasks(parent_task_id=…)` — never from a plan file's task list.** A plan
document is a snapshot of the intent; the epic's children are the state. Every
write that touches a child (`add_task` under an epic, `update_task` status or
re-parent, `delete_task`) echoes `epic_progress` — read that rollup, print it
per *OUTPUT FORMAT*, and when it says `closable`, close the epic with a
`resolution` right then instead of leaving the tail to rot.

**Closing tasks — always pass `resolution`:**
On `status=DONE` or `CANCELLED`, pass a `resolution` argument with the verdict
(what was done / why cancelled). The server:

1. Appends a `## Resolution` section to the task's description (preserves the
   original spec verbatim).
2. Auto-creates a linked `progress_entry` so the close shows up in
   `recent_activity`, `list_progress`, and search.

**Do NOT call `log_progress` separately for task closes** — that would
duplicate the entry. `log_progress` is for progress events that don't belong
to a single closing task (e.g. mid-implementation notes, infra changes).

**Roadmap discipline.** A milestone is an ordered group of epics; the **current**
milestone is the open one with the smallest `sequence`, and `init` / `get_agenda`
return it in the `roadmap` section.

- **Work the current milestone.** In an interactive session, picking up work
  that belongs to a **later** milestone needs an **explicit decision by the
  owner** — say which milestone the work sits in and ask before starting; never
  silently pull work forward because it looked convenient. Work attached to no
  milestone (`milestone_id: null`) is not off-limits, but say so when you take
  it, so the owner can attach its epic to the roadmap or leave it aside
  deliberately. (An autonomous routine run has no owner to ask: the
  **conport-routine** skill overrides this rule with its own — unattached rows
  are fair game, later-milestone rows are not.)
- **Closing a milestone always carries `resolution`** — what was delivered
  (DONE) or why it was dropped (CANCELLED). The server logs a progress entry
  from it.
- **A release milestone (`is_release=true`) closes only after the release
  actually happened.** "Every epic is DONE" is not a release; the resolution
  names the shipped version/artifact. If the release hasn't shipped, leave the
  milestone open and say so.
- **A release milestone is a point, not a container.** Keep the work in
  ordinary milestones before (and, when needed, after) the release point; an
  empty release milestone is legal and closes with the resolution naming the
  shipped artifact. Attaching epics to it stays legal as a compact form.
- **`milestone_not_ready` is a prescription, not an error to route around.**
  `update_milestone(status='DONE')` is refused while any epic of the milestone
  is open; `context.open_epics` lists exactly what to close first (an empty
  NON-release milestone is refused too — attach the epic that carries the
  work). A release milestone is also refused while any EARLIER milestone is
  still open — `context.open_milestones` lists them: close those first, or
  move their remaining epics to a later milestone. Do the prescribed closes,
  then retry. Never CANCEL a milestone just to get past the refusal.

→ Deep detail: live docs `projects/roadmap`.

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
| "Which projects do I own?" / bootstrapping without a known project_id | `list_projects` |

### Sync

| Trigger | Tool |
|---------|------|
| Technology choice | `sync_decision` |
| Trade-off with rationale | `sync_decision` |
| Read one decision's full body (id → tags + currency) before amending | `get_decision` |
| Amend / re-tag an existing decision | `update_decision` |
| Decision no longer holds, NO replacement | `deprecate_decision` (reason required) |
| Un-retire a decision | `reactivate_decision` |
| Decision candidates auto-extracted from `log_progress` | never committed directly — they wait in the proposals queue: `semantic_proposals_list` → approve/reject/defer; `list_decisions` filters provenance via `source` (`manual` \| `progress_extraction`) |

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
| Wholesale body / metadata update | `update_document(content=<full markdown>, ...)` |
| List a doc's blocks (pick ulids before a surgical edit) | `list_blocks(document_id)` |
| Read / edit / insert / delete one block | `get_block` / `update_block` / `insert_block` / `delete_block` |
| Read a doc (with rendered Wave 5 stubs) | `get_document` (`raw=true` for unmodified markdown) |
| "Who references this doc/block?" | `get_block_backlinks` (omit `block_ulid` for whole doc) |
| "What's similar to this block but not yet linked?" | `get_semantically_related_blocks` |
| Overlapping content / linking two docs | author one callout — `[!supersedes]` / `[!resolves]` / `[!extends]` / `[!relates-to]` |

**Block-level editing is the default for any narrow change** — including specs.
Use `update_block` / `insert_block` / `delete_block` for surgical edits; only one
block re-embeds and the spec append-only invariant doesn't engage.
`update_document(content=...)` is the **wholesale-rewrite** channel.

**Spec append-only invariant.** `update_document` on a `doc_type='spec'` body
requires `change_kind`: `amend` (clarification/typo — allowed, logged with a
mandatory `reason`) or `substantive` (a meaningful claim change — **rejected**;
author a new spec and link the old one with `link_items(relationship='supersedes')`).
Don't chain block edits to rewrite a spec's claims either.

**Don't create a doc when an edit will do.** Never `add_document` whose purpose
is to *describe / amend / react to* an existing doc — that accumulates synthesis
drift. Edit the original, or author an addendum with an explicit callout
(`> [!extends] [[doc-N]]` / `> [!supersedes] [[doc-N]]`); default to
`> [!relates-to]` when unsure.

→ Deep detail: live docs `projects/block-model`, `projects/spec-append-only`,
`core/documentation-callouts`; full agent reference in
`references/documentation_graph.md`.

### Routines (periodic backlog cycles)

| Trigger | Tool |
|---------|------|
| Starting a periodic cycle run | `get_agenda` (single-call briefing), `routine_run_start` |
| "Set up / tune the cycle policy" | `get_routine_config` / `set_routine_config` (cadence, run limits, autonomy 0-2, selection `threshold`\|`tagged`) |
| Mark a task as agent-executable | `update_task` with `routine_eligible=true` (opt-in pool for `selection='tagged'` cycles) |
| Finishing a run | `routine_run_finish` with `outcome` (auto-logs progress — no separate `log_progress`) |
| "Show recent runs" | `list_routine_runs` |
| Calibrating before estimating tasks | `get_estimation_stats` (median ratio, p50/p90 actuals) |
| Picking unblocked work deep in the backlog | `list_tasks` with `ready=true`, `order="priority"`, `offset` |
| Deferring a task to a date | `update_task` with `snooze_until` (empty string clears) |

→ Full runbook: the **conport-routine** skill; live docs `projects/routines`.

### Context assembly, gaps, semantic pass

| Trigger | Tool |
|---------|------|
| "Open task #N and brief me" | `assemble_context` with `recipe='task_briefing'`, `start_id='task-N'` |
| "Implementation status of spec doc-N?" | `assemble_context` with `recipe='spec_implementation_status'`, `start_id='doc-N'` |
| "What recipes are available?" | `list_context_recipes` |
| "Current architecture of subsystem X?" | `render_current_architecture` with `scope=[...]` |
| "Is this architecture doc safe to archive?" | `audit_doc_l1_coverage(doc_id)` |
| Init response shows gaps / "show all gaps" | review `gaps.fresh`; `gap_list`, `gap_ack`, `gap_dismiss` (reason), `gap_dismiss_bulk`, `gap_undismiss`, `gap_stats` |
| "Clean up the graph" | `semantic_cleanup` (one-click; runs in background — poll `semantic_pass_stats`) |
| Manual semantic flow | `semantic_pass_run(dry_run=true)` → `semantic_proposals_list` → approve/reject/defer → `semantic_proposals_apply`; `semantic_pass_stats` |

**`start_id` convention.** Prefer the prefix form `'<type>-<id>'` (`'task-<id>'`,
`'doc-<id>'`); type vocabulary `task` / `doc` / `decision` / `pattern` /
`progress`. The wikilink form `'[[task-<id>]]'` is also accepted verbatim. Plain
integers work as a legacy fallback but the prefix form gives a clean 400 on type
mismatch.

→ Deep detail: live docs `projects/context-recipes`, `projects/gaps`,
`projects/semantic-pass`.

---

## ARCHITECTURE DIAGRAMS

| Trigger | Tool |
|---------|------|
| "Draw / visualize subsystem X", "architecture diagram of X" | author the flow below, then `add_document(doc_type='diagram', content=<the JSON spec>)` |
| "Update the diagram", gap `diagram_stale` | same flow from step 2; `update_document` with the rewritten spec |
| "What diagrams does this project have?" | `list_diagrams` (id, title, scope, version, updated_at) — `list_documents` hides diagrams unless `doc_type='diagram'` is passed |

A diagram is a document whose body is a **JSON spec**, not markdown. The
dashboard draws it itself — there is no picture to render or upload, so what is
on screen is exactly as current as the body.

**The flow.** Scope (the owner's subsystem tags) → topology from the code (a
code-graph tool if the project has one) → semantics from
`render_current_architecture(scope, format='json')`, which is where the *why*
and the provenance ids come from → write the spec → `add_document`. Four steps;
nothing to draw.

**The spec is a contract**, checked on every write, one violation named at a
time. **You place every box** — the dashboard does cell math and orthogonal
routing, it does not lay out for you.
- `schema_version: 1`, `diagram_type: "architecture"`, `meta.title`.
- `layout: {mode: "grid", cols, cellW?, cellH?, gapX?, gapY?, origin?}` and, on every
  component, a cell `row`/`col` (or an absolute `pos: [x, y]` with `size`).
  Place all or none — a half-placed spec is refused. Put connected boxes in the
  same column across rows so their arrows run straight.
- `components` — non-empty, unique `id`, `label`, `sublabel` (file path, role),
  `type` for the colour family (`backend`, `frontend`, `database`, `cloud`,
  `external`, `messagebus`, `security`), optional `note`.
- `boundaries` — zones: `{kind, label, wraps: [component ids]}`; the frame is
  drawn around exactly the boxes it wraps. Name them the way the owner names
  parts of the system.
- `connections` — `{from, to, label?, variant?, fromSide?, toSide?, via?}`;
  both ends must name a component; sides are `top | right | bottom | left`;
  `variant` is `emphasis | dashed | security`; `via` lists `[x, y]` waypoints,
  used as given, for the rare line the automatic bridge would run through
  something — keep them axis-aligned. Unknown keys are ignored.
- `conport.scope` — non-empty subsystem tags, the tie to the decisions behind
  the picture; `conport.provenance` — component id → canonical references
  (`decision-<id>`, `doc-<id>`, `task-<id>`, `pattern-<id>`, `progress-<id>`; the wikilink
  form accepted elsewhere is not accepted here); `conport.source_commit`.

**Discipline.**
- A component that exists because of a decision names that decision in
  `provenance`. A component drawn from the code alone gets an empty list, never
  a plausible-looking id.
- Composition is your job: aligned columns, one zone per part of the system,
  arrows that do not cross boxes. Read the picture back through `list_diagrams`
  and the dashboard before calling it done.
- Regenerate on the `diagram_stale` gap rather than on a schedule: it fires when
  a decision or spec lands in the diagram's scope after the spec was last
  written. Regenerating is rewriting the body — nothing else moves the anchor.

→ Deep detail: live docs `projects/architecture-diagrams`.

---

## TASK HIERARCHY (2 levels, schema-enforced)

The task tree is **two levels** and the database enforces it:

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
`<type>-<number>`. In the examples below `<id>` stands for the item's own
number — write the digits, without the angle brackets.

**Type vocabulary (lowercase):** `decision`, `task`, `doc`, `pattern`,
`progress`. No aliases (no `document`, no `tasks`, no `dec`).

**Forms accepted by the parser:**
- Plain prose: `decision-<id>`, `task-<id>`, `doc-<id>`.
- Wikilink: `[[decision-<id>]]`, `[[task-<id>]]`, `[[doc-<id>]]` — preferred inside
  document bodies; the autolinker reifies them as item-graph edges.
- Block anchor (documents only): `[[doc-<id>#<block_ulid>]]` — link to a
  specific block (Wave 6).

**Anti-patterns** (silently break tag/graph navigation):

| ❌ Don't write | ✅ Write |
|---|---|
| `decision #<id>` (typed legacy with `#`) | `decision-<id>` |
| `Task #<a>, #<b>, #<c>` (untyped continuation) | `task-<a>, task-<b>, task-<c>` |
| `#<id>` (untyped, ambiguous) | `decision-<id>` (or the correct type) |
| `decision #<old id>` (pre-migration global id) | drop — autolinker can't resolve; cite the new per-project id |

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
| `add_milestone` / `update_milestone` | `✅ {summary}` (carries id, title, `seq N`, `[release]`, epics-closed rollup) |
| Any write response carrying `epic_progress` | `[EPIC] task-{epic_id}: {open_children} of {total_children} children open` — when `closable` is true, print `[EPIC] task-{epic_id} ready to close — close it with a resolution now` instead, and do it. Print this line only when the summary you already printed doesn't carry the rollup itself: `add_task` / `update_task` summaries end with either `— epic task-N: K of M children open` or, on the closable branch, `— epic task-N ready to close: update_task(...)` — either way the count/prescription is already on screen; `delete_task` and the REST responses need the explicit `[EPIC]` line |

**Roadmap sections.** `init` and `get_agenda` return `roadmap` and `epic_tails`
**only when the project has them** — a missing section means "nothing to show",
print nothing. When present:

```
[ROADMAP] milestone-{current.milestone_id} «{current.title}»{ [release]}{ · ready to close} · {open_milestones_total} milestones open
· task-{task_id} {title} — {open_children}/{total_children} subtasks open
Next: milestone-{next.milestone_id} «{next.title}»
```

One `·` line per entry of `current.epics` (only the **open** epics of the
current milestone are listed — a closed one is already delivered); add
` [release]` only when `current.is_release` is true and ` · ready to close`
only when `current.ready_to_close` is true; drop the `Next:` line entirely when
`next` is `null`.

```
[TAILS] task-{epic_id} {title} — {suggested_action}
```

One line per entry of `epic_tails`, in the order returned (closest to closing
first; `closable=true` means nothing is left but the close itself).
`suggested_action` is prescribed by the server — print it and follow it, don't
substitute your own plan.

MCP create / update tools return a **slim** payload (not the full entity body) to
save agent context — `id`, `tags` (echoed even as `[]`), `summary`, and
context-specific fields (`version`, `status`, `kind`, …). Need the full body? Use
the matching read tool (`get_task`, `get_document`, `list_decisions`, …). The
slim `tags` / `kind` echo is your POST-WRITE verification channel.
(Live docs → `core/post-write-verification`.)

**Decision currency.** Read surfaces (`get_decision`, `list_decisions`,
`search`) annotate each decision with `currency` (`current` / `superseded` /
`deprecated`) and `age_days`. Before citing a decision as authoritative, check
`currency`: if `superseded`, follow `superseded_by` to the current decision; if
`deprecated`, treat it as retired (see `deprecation_reason`) and do not present
it as current. A high `age_days` on a `current` decision is a prompt to verify
it still holds, not proof that it's stale.

---

## POST-WRITE VERIFICATION

Some MCP clients silently drop an optional parameter when the surrounding
tool-call XML is malformed — the dropped value folds into the previous string
field and the call returns 200 OK with a truncated payload. A real incident lost
a `sync_decision`'s `tags` array (they ended up inside `rationale`); the decision
landed untagged and broke graph navigation.

The server now **rejects** any write whose string field contains literal
tool-call fragments (`<parameter …>`, `<invoke …>`, `</invoke>`,
`<function_calls>`, `antml:*`) with a structured `mcp_payload_contaminated`
error — the bad write does not land; re-issue with the field cleaned. That guard
catches the worst class; the echo check below still catches the subtler cases.

After **every** create/update call that took optional fields, verify the response
echo against intent:

| You passed | Check on the response |
|---|---|
| `tags=[...]` | Response `tags` is non-empty and matches intent (count + values) |
| `description=...` | `description` length ≈ what you sent (not visibly truncated) |
| `priority=N` | `priority` equals `N` |
| `parent_task_id`, links | Field is present and equal to intent |
| `kind='epic'` / `kind='task'` | Response `kind` matches the promote/demote you asked for |
| `milestone_id=N` / `milestone_id=0` on a task | Response `milestone_id` is `N` (or `null` after a detach) |
| `sequence` / `is_release` on a milestone | Response `sequence` / `is_release` match intent — milestone writes echo `sequence`, `is_release`, `status` (not `title`), so those are the verification channel |

**On mismatch.** Re-issue the call with the field re-stated (often one retry
fixes the XML glitch). If a second attempt still loses it, flag the mismatch to
the user verbatim ("graph integrity: tags lost on decision N, please re-run")
rather than silently moving on — the damage is mute graph drift, easy to miss.

Applies to: `sync_decision`, `add_task`, `update_task`, `add_milestone`,
`update_milestone`, `log_progress`,
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
- [ ] `CONPORT_PROJECT_NAME` not set → stopped and showed the `settings.local.json` line instead of guessing a name?
- [ ] `init` answered `project_not_found` → told the user and waited for their word before `create_project`? Answered `project_name_in_other_team` → showed `candidates` instead of creating a second project?
- [ ] Question about the project → has `search` been done?
- [ ] Starting work on a task → moved to IN_PROGRESS before the first write?
- [ ] New work → task created/updated?
- [ ] Work finished → task = DONE **with `resolution`**?
- [ ] Closing a task → did NOT call `log_progress` separately (it's auto-logged)?
- [ ] Interactive session, work from a later milestone → owner explicitly agreed to it?
- [ ] Milestone finished → `update_milestone` with `resolution` (and, if `is_release`, only after the release actually shipped)?
- [ ] Decision made → `sync_decision`?
- [ ] Important information → document created?
- [ ] After every write → response echo verified (tags / description / priority match intent)?
- [ ] Cross-references in write payload → all in canonical `<type>-<number>` form (no `#N`, no `decision #N`)?
- [ ] Deep topic (recipes / gaps / semantic pass / block model / tool params) → fetched the live-docs page before acting?

---

## Live docs

The deep, situational reference lives at **https://conport.app** and is the
single source of truth. **Before acting on a deep topic, fetch the relevant
page.** Public index: **https://conport.app/llms.txt**. (No web fetch? Use the
`conport docs <topic>` CLI.)

| Topic | Page |
|---|---|
| Save-first discipline | `core/save-first` |
| Knowledge-graph model (item links + GraphRAG) | `core/graph-model` |
| Cross-reference grammar | `core/cross-references` |
| Documentation-graph callouts (full reference) | `core/documentation-callouts` |
| Post-write verification / slim responses | `core/post-write-verification` |
| `assemble_context` recipes / `render_current_architecture` | `projects/context-recipes` |
| Knowledge-base gaps | `projects/gaps` |
| Semantic pass | `projects/semantic-pass` |
| Spec append-only invariant | `projects/spec-append-only` |
| Block-level document model | `projects/block-model` |
| Task hierarchy | `projects/task-hierarchy` |
| Roadmap milestones | `projects/roadmap` |
| Architecture diagrams | `projects/architecture-diagrams` |
| Full per-tool parameter reference | `projects/tool-reference` |

**Local references** (shipped with the skill): `references/command_list.md`
(full MCP tool API), `references/documentation_graph.md` (long-form callout
reference), `references/bootstrap.md` (fresh-project onboarding).
