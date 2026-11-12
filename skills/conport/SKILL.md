---
name: conport
description: "Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start."
metadata:
  version: 22.0.0
---

# ConPort — Project Management System

> **ConPort stores everything about the project:** tasks, documents, decisions, infrastructure.
> **Without init, context is unavailable.** Without search, you are answering blindly.

This skill carries the **always-on discipline** — what you must do every session
regardless of topic. Deep, situational reference (recipe semantics, the gap
system, the full per-tool parameter tables, the block model,
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
The project's handle (`prk7m2qx9d`) works as the value too, in any team.

`CONPORT_PROJECT_ID` is no longer read. While it is set, the session-start hook
shows the user the line
`CONPORT_PROJECT_ID is no longer read — set CONPORT_PROJECT_NAME to the project's handle or name`
itself; do not repeat it. If the user asks, the fix is: the project's handle or
name goes into `CONPORT_PROJECT_NAME` and `CONPORT_PROJECT_ID` is removed.

**Cursor, Codex and other agents with a shell** — the variable is an environment
variable of the agent's process. If it is not set — stop, do not call `init`,
and ask the user to export `CONPORT_PROJECT_NAME` and restart the agent.

**Claude.ai Chat** — there are no environment variables; the user names the
project (its handle, `<project>`, or `k7m2qx9d/<project>` for a team's project).
Ask for it.

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

**No person at the session → `init(questions=false)`.** A subagent, a scheduled
routine run or any other run nobody answers passes `questions: false`: the
response then carries no questions and none is marked as asked. A question
handed to a run that cannot ask it is lost — handed out twice without an
answer, it is settled by its default. When you dispatch a subagent that works
with ConPort, tell it to call `init(questions=false)`.

`init` only finds a project — it never creates one. Each refusal
(`project_not_found`, `project_name_in_other_team`, `team_not_found`,
`invalid_project_name`) has one prescribed action — see *TEAMS → Refusals* below. Do not answer a refusal by
trying another name.

### After init — MANDATORY:

1. **Print summary:** `[CONPORT] {summary from response}`
2. **Execute instructions** from the response (read files, apply rules)
3. **Report backlog:** `N tasks in TODO, M in progress, K in review. Top 5:` — use `backlog.top` from the response; `K` is `backlog.total_review`, and `, K in review` is dropped when it is zero. Line format: `Pk · #id title (n subtasks)`, skipping `(n subtasks)` when zero. `Pk` is `effective_priority`. Skip the whole block if `backlog.total_todo == 0`, `backlog.total_in_progress == 0` and `backlog.total_review == 0`. Tasks waiting in REVIEW need a reviewer, not more work: when the response carries `review_tasks` (`id`, `title`, `priority`; present only when some task waits), print them as `In review: #id title, …` and follow the instruction that comes with them — have them reviewed before taking new work.
4. **Report the roadmap:** when the response carries `roadmap` and/or `epic_tails`, print them in the format given under *OUTPUT FORMAT → Roadmap sections*. Both sections are omitted when the project has nothing to show — then print nothing.
5. **If the response carries `questions`** — ask them before starting the user's work. See *Questions from init* below.
6. **If the project is empty** (no decisions, no patterns, empty `product_context`) — offer the bootstrap flow from `references/bootstrap.md`. An empty project is one that was created explicitly: `init` does not create projects, so a missing name is refused with `project_not_found` instead of showing up here as a new, empty one.
7. **If `routine_suggestion` is present in the response** — surface it to the user and offer to accept (`set_routine_config(...)`, e.g. with the `suggested_config`) or dismiss permanently (`set_routine_config(enabled=false)`).
8. **If `skill_update_available` is present in the response** — emit ONE short notice at the very start of your first reply (after the `[CONPORT]` line). Format:

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
9. **If the response carries `arch`** — the project model owes work. Print it
   and take the action of each debt; see *PROJECT MODEL → Debts of the model
   in init* below.

### Questions from init

The server resolves knowledge-base gaps and semantic-pass proposals on its own,
every day. What only a person can decide reaches you as a question: `init`
returns up to three in `questions`, each with `id`, `gap_type`, `text`,
`options` (`key`, `label`, `effect` — what the server does on that answer) and
`default` (the `key` taken when nobody answers).

1. **Ask before the work starts, one question at a time,** in your own words
   and in the user's language — `text` is English with the names filled in.
   Offer the options by their `label` and `effect` and say which one is the
   default.
2. **Pass the user's choice** with
   `answer_question(project, question_id, option)` — `question_id` is the
   question's `id`, `option` the chosen `key`.
3. **Silence is not an answer.** A question the user skips or leaves unanswered
   gets no call — never answer it yourself, not even with the default. The
   server asks it again later.
4. **Read the outcome.** `outcome` is `resolved` (the server did what the
   option says), `dismissed` (left as it is for good), `deferred` (asked again
   in 30 days) or `cleared` (what it was about is gone; nothing was done). An
   `instruction` in the answer is one step for you — carry it out as part of
   this session.

| Refusal | Do exactly this |
|---|---|
| `question_closed` | The question was already answered or closed: do nothing, go on |
| `unknown_option` | Ask the user the same question again with the options in `context.options`; never pick a key yourself |
| `question_not_found` | The id is not a question of this project: go on |
| `epic_not_ready` | The epic gained an open task while it was being closed: tell the user, go on |

`answer_question` can also return a refusal of the task cycle — for example
`done_needs_review` when the chosen option closes a task. Such a refusal carries
its own `message`; follow it.

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

**A project is addressed by its handle or as `<team ID>/<project>`.**

| Name | Means |
|---|---|
| `prk7m2qx9d` | the project whose handle this is, in whichever of the user's teams it lives |
| `k7m2qx9d/<project>` | the project in the shared team whose team ID is `k7m2qx9d` |
| `pers/<project>` | the project in the user's own `Private Team` |
| `<project>` | the same as `pers/<project>` |

The handle is `pr` and eight characters, fixed for the project's life — a
rename or a move to another team keeps it. `init`, `list_projects` and the
projects page of the dashboard show it. A string of digits addresses no
project: it answers like a project that does not exist.

The team ID is the eight-character identifier shown on the team's settings
page. `pers` is always the caller's own `Private Team`, so `pers/<project>` is
a different project for every user — a team's repository must carry the team ID
in `CONPORT_PROJECT_NAME`.

**The team of a call comes from the project, or from the `team` argument.**

- A tool that takes `project` works in that project's team — nothing else to
  pass. Pass the `project` that `init` returned: the project's handle.
- `init` returns `team` (`handle`, `name`, `kind`) next to `project` (the
  project's handle), and `canonical_name` — the full `<team ID>/<project>` form.
- Tools that can run without a project take a `team` argument: `list_projects`
  and `search` without `project`. Pass the `handle` that `init` returned as
  `team`.
- **Without `team`, `search` covers the `Private Team` only**, and its
  response names the `team` it ran in. An empty result from a call without
  `team` says nothing about a shared team — repeat it with `team` before
  concluding that the knowledge is not there. `list_projects`
  without `team` lists the projects of all your teams.

### Refusals — one action each

| Refusal | What it means | Do exactly this |
|---|---|---|
| `project_not_found` | No project of that name in the team the name points at. `init` created nothing. | Tell the user. Call `create_project` **only when the user says so**, then repeat `init`. Never create a project on your own after this refusal. |
| `project_name_in_other_team` | The name has no project in the `Private Team`, but one or more of the user's shared teams hold a project of that name. The answer lists them in `candidates` — the full names and the name of each team. | Show `candidates` to the user and ask them to put the chosen name into `CONPORT_PROJECT_NAME`. Do not pick one yourself, do not create a second project. |
| `team_not_found` | The team ID in the name or in `team` is not a team the user is a member of (a team that does not exist answers the same). | Ask the user to check the team ID on the team's settings page and their membership in that team. |
| `invalid_project_name` | The name is malformed: more than one `/`, an empty part, a project part made of digits only after a team prefix (`pers/11`), or a prefix that is neither `pers` nor a team ID (the prefix is case-sensitive). | Show the user the name as it is set and ask them to correct `CONPORT_PROJECT_NAME` to the project's handle, `<project>`, `pers/<project>` or `k7m2qx9d/<project>`. Do not retry with a name of your own. |
| `invalid_team_id` | The team was named by something that is not a team ID: a team's display name, a wrong-case `PERS`, or any other string in the name prefix or in `team`. | Use the short team ID from the team's settings page (for example `k7m2qx9d`) or `pers`. If it came from `CONPORT_PROJECT_NAME`, ask the user to correct it. Do not retry with a name of your own. |
| `team_context_conflict` | Two parts of one call name two different teams of the user (for example the name prefix and the `team` argument). | Name the team once and repeat the call. |
| `cross_team_link_not_supported` | A link or a linked task was requested between projects of two different teams. | Tell the user it is not supported. Do not retry. |

`create_project(name, description?)` takes the same name forms as `init` and
creates the project in the team the name points at. It is called on the user's
word only. When Superpowers skills are available in the session, offer the
Superpowers overlay once the project exists (see *Superpowers overlay* under
*Execution*).

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
| Move a project to another team | Dashboard, or `POST /api/v1/projects/{project}/transfer` — see below |

From the `conport` CLI: `conport api teams <operation>`; `--project` takes the
full `k7m2qx9d/<project>` name and `--team-id` takes a team ID.

**Moving a project to another team.** An admin of the source team who is also a
member of the target team (a regular member is enough) moves it from the
dashboard, or over REST: `POST /api/v1/projects/{project}/transfer` with
`{"target_team_id": "<uuid>"}` (optionally `"name"` for a new name there) and an
`Idempotency-Key` header. The project's handle in the path names the source
team by itself; the server checks the caller's admin role in the source and
membership in the target. The answer names the project by its handle
(`project`). Repeating the request with the same `Idempotency-Key` returns
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
way ask the user to put the new name into `CONPORT_PROJECT_NAME`. The handle
moves with the project: a `CONPORT_PROJECT_NAME` holding the handle needs no
change.

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
| Work that needs a design, before the design | `add_task` (`kind='task'`) — one task and no epic yet; never an epic of design tasks before the spec |
| The spec is approved | `add_task` with `kind='epic'` (description: the goal and the acceptance criterion from the spec; `milestone_id` by the project's roadmap rules), then `link_items` from the spec (`source_type='doc'`) to the epic (`target_type='task'`) with `relationship='clarifies'` — one spec per epic; close the task the design started from with a `resolution` naming the spec and the epic. An epic with no plan and no tasks is a normal state |
| The plan is approved | the plan's tasks go into that epic: `add_task` with `parent_task_id`, or with the Superpowers overlay `plan import <draft> --spec doc-N --epic <id>` — the epic is not created again |
| "Move task X under epic Y" / re-parent | `update_task` with `parent_task_id` (target must be `kind='epic'`; `0` detaches to root) |
| Taking a task into work, filing or moving an epic or a task, calling a task waiting, closing an epic or a milestone, talking about a release, a bump or a deploy, reporting open work to the user | the **conport-roadmap** skill first — its rules decide the milestone, the epic and what may be said about the release |
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
| Brief for whoever executes or reviews the task | `add_task_journal_entry` with `kind='brief'` |
| Work finished and it needs a check | `add_task_journal_entry` with `kind='report'` — it moves the task to REVIEW (a TODO or BLOCKED task is started first); no `update_task` around it |
| Reviewing a task in REVIEW | read the round with `list_task_journal` (`include_body=true`), then `add_task_journal_entry` with `kind='review'` and `verdict='approve'` or `verdict='changes_requested'` — changes requested return the task to IN_PROGRESS for the next round by themselves |
| Review approved | `update_task` → DONE **with `resolution=...`** |
| Changes requested | the task is already back in IN_PROGRESS (the next round): fix, then `add_task_journal_entry` with `kind='fix'` — it moves the task to REVIEW |
| "What happened on this task?" | `list_task_journal` (`round` filters one round; texts only with `include_body=true`, a page carries `next_offset` while entries remain), one entry in full with `get_task_journal_entry` (`entry_id`, or `kind` for the latest of a kind) |
| Done / Finished | `update_task` → DONE **with `resolution=...`** (see below) |
| Cancelled | `update_task` → CANCELLED **with `resolution=...`** (why dropped; allowed from REVIEW too) |
| Blocked | `update_task` → BLOCKED (never from REVIEW) |
| Milestone finished | `update_milestone` → DONE **with `resolution=...`** (all its epics must be closed first) |
| Milestone dropped | `update_milestone` → CANCELLED **with `resolution=...`** (why it left the roadmap) |

**IN_PROGRESS gate.** Before your first ConPort write against a task, move it to
IN_PROGRESS. This keeps `current_focus` accurate and the backlog honest. A
`brief` is the one write that may come first: it is written while the task is
still TODO, before anyone starts.

**The review cycle.** A task whose work must be checked goes through REVIEW,
and every step of the way is an entry in the task's journal:

```
brief → IN_PROGRESS → work → report → REVIEW → review
    approve           → DONE with resolution
    changes_requested → IN_PROGRESS (round + 1) → fix → REVIEW → review → …
```

- **An entry moves the task.** A `report` takes the task to REVIEW (a TODO
  or BLOCKED task is started first), a `fix` takes it back to REVIEW, a
  `review` with `changes_requested` returns it to IN_PROGRESS; a `brief` and an
  approval move nothing. `update_task` is not needed around an entry — only the
  close after an approval is one.
- **The reviewer is never the executor.** Whoever did the work writes the
  `report` or `fix`; someone else reads it and writes the `review`. The two
  sign their entries with different names in `author` (an agent role or a
  person): a `review` signed like a `report` or `fix` of the same round —
  ignoring case and surrounding spaces — is refused. Without `author` an entry
  is signed by its role — `orchestrator`, `implementer` or `reviewer` — so the
  defaults never collide.
- **Rounds are the server's.** Every entry gets the task's current
  `review_round`; you never pass it. The round grows by one when the task goes
  back from REVIEW to IN_PROGRESS and when a DONE or CANCELLED task is reopened,
  so a verdict of an earlier round never opens REVIEW or DONE again.
- **Which entry fits which status:**

  | `kind` | Task status | What it is |
  |---|---|---|
  | `brief` | TODO, IN_PROGRESS, BLOCKED, REVIEW | The assignment: for the executor, or in REVIEW for the reviewer |
  | `report` | IN_PROGRESS | The executor's report — the first round by convention |
  | `fix` | IN_PROGRESS | The report on the fixes — the second round and later by convention |
  | `review` | REVIEW | The verdict, `verdict` required: `approve` or `changes_requested` |

- **The journal only grows.** An entry is never edited or deleted — a
  correction is a new entry. `get_task` shows the task's `review_round` and a
  `journal` summary (`counts` per kind, `last_verdict` and its round
  `last_verdict_round` — a round below `review_round` is an earlier round's verdict).
- **Review is opt-in, then binding.** A task nobody reviews still goes
  IN_PROGRESS → DONE. Once a task has a `report`, `fix` or `review` entry, it
  closes only through REVIEW — cancelling and reopening it, or closing it as an
  epic and demoting it, does not get around that. A `brief` alone binds nothing.
  An epic never enters REVIEW and takes no new journal entries, but keeps the
  journal of the task it was promoted from; that journal binds it only when it
  has no child tasks (it then closes only as a task) or when it is demoted.
- **REVIEW is open work.** A task in REVIEW blocks the tasks that depend on it
  (`ready`), keeps its epic and milestone open, and leaves REVIEW only to DONE
  (approved), to IN_PROGRESS (changes requested) or to CANCELLED. An epic tail
  with a child in REVIEW prescribes `Review task-N` (`review task-N` after a
  `Finish …` step); a task left in REVIEW
  is listed in `review_tasks` of `init` and in `stale_review` of `get_agenda`
  until a separate reviewer writes its `review` entry.

**Review refusals — one action each.** A refused write changes nothing. The
answer carries `error`, a `message` that prescribes the action, and `context`
(`task_id`, `status`, `review_round`, and the last verdict where it matters).

| Refusal | What it means | Do exactly this |
|---|---|---|
| `review_from_in_progress_only` | REVIEW was asked from a status other than IN_PROGRESS, or on a new task | Move the task to IN_PROGRESS, finish the work and the `report`, then REVIEW. Create tasks in TODO |
| `review_on_epic` | An epic was sent to REVIEW, or a task in REVIEW was promoted to an epic | Review the epic's children; close the epic with a `resolution` once they are closed |
| `review_needs_report` | No `report` or `fix` in the current round | Add a `report` (first round) or `fix` entry for the round in `context`, then REVIEW again |
| `done_needs_review` | DONE was asked outside REVIEW for a task with a `report`, `fix` or `review` entry, a closed epic with one was demoted to a task, or a childless epic with one was closed | Do what the `message` names for the starting state: from IN_PROGRESS move to REVIEW; from TODO, BLOCKED or CANCELLED move to IN_PROGRESS, then REVIEW; a closed epic is demoted in the write that reopens it to IN_PROGRESS; a childless epic gets child tasks or is demoted the same way. Then get an `approve` |
| `done_needs_approval` | The current round has no `approve` as its last verdict | A reviewer adds a `review` with `verdict='approve'` in this round, then DONE. Never write your own approval for your own work |
| `done_needs_resolution` | REVIEW → DONE without a `resolution` | Repeat the call with `resolution` |
| `return_needs_review` | REVIEW → IN_PROGRESS without `changes_requested` in this round | A reviewer adds a `review` with `verdict='changes_requested'` first |
| `review_exit_not_allowed` | REVIEW → TODO, BLOCKED or PARKED | Finish the review (approve → DONE, changes requested → IN_PROGRESS) or CANCEL with a `resolution` |
| `journal_on_epic` | A journal entry on an epic | Write it on the child task the work belongs to |
| `journal_task_closed` | A journal entry on a DONE or CANCELLED task | Reopen the task to IN_PROGRESS only if there is new work; otherwise write nothing |
| `journal_kind_not_allowed` | The `kind` does not fit the task's status; `context` lists the kinds that do | Write one of those kinds, or first move the task to the status the entry needs |
| `reviewer_is_author` | A `review` signed with the `author` of a `report` or `fix` of the current round | The reviewer adds the `review` under its own name; never review your own work |
| `invalid_verdict` (422 over REST) | `verdict` on an entry that is not `review`, or a `review` without one | Pass `verdict` on `review` only, `approve` or `changes_requested` |

**Epic in its own branch.** An epic whose tasks are worked in parallel, or
whose tasks take more than one review round, gets an integration branch
`epic-<id>` with its own git worktree (a small epic may run its tasks straight
off main), and the agent coordinating the epic (the orchestrator) works in
that worktree, not in the main checkout.

- **A task** gets its own branch from the epic branch and merges back into the
  epic branch only after its review is approved and its checks pass.
- **Release:** merge the local main into the epic branch, run the checks there,
  leave for the main checkout, merge the epic branch into main, push main.
- **Database migrations** are applied before that push, on the owner's
  command.
- **No workarounds:** never push from a worktree into main, never override
  `core.hooksPath`, never script around the sandbox.

ConPort does not track git — this is a rule of the skill, not a server check.

**Superpowers overlay.** In a project that works with the Superpowers skills
(brainstorming, writing-plans, subagent-driven development), the overlay keeps
the spec and the plan in ConPort instead of git: the spec is a `spec`
document, the plan a `plan` document, and each task of the epic is tied to its
section of the plan. Files on disk are drafts and caches only. Off unless the
project turns it on.

- **The switch** is `.superpowers/config.json` holding
  `{ "conport": { "superpowers": true } }`. It is looked up at the root of the
  current worktree (`git rev-parse --show-toplevel`); only when that worktree
  has no such file, at the root of the main worktree (the parent of
  `git rev-parse --git-common-dir`); outside git, in the current directory
  only. A file in the current worktree decides on its own: `false` or
  unreadable JSON there means off even if the main worktree says `true`. A
  missing file, any other value or unreadable JSON means the overlay is off —
  say nothing about it.
- **Turning it on takes two writes, each only with the user's consent:** write
  that file at the root of the main worktree (the parent of
  `git rev-parse --git-common-dir`), and add one line to the project's
  instructions (`CLAUDE.md` or `AGENTS.md`):
  `Specs and plans of this project live in ConPort — follow the ConPort Superpowers overlay`.
  The line is needed because Superpowers ranks the user's instructions above
  its own skills, and text injected by a plugin hook is not one of them.
  Turning it off: remove the key; the `plan` documents stay in ConPort.
- **The rules** are `references/superpowers-overlay.md` of this skill — the
  only text of them. Claude Code's session-start hook injects them. An agent
  without hooks checks the switch at the start of the session and, when it is
  on, reads that file before any spec or plan work.
- **SDD's subagents** are the plugin's agent types in Claude Code:
  `conport:sdd-implementer`, `conport:sdd-task-reviewer`, `conport:sdd-fixer`
  and `conport:sdd-gap-hunter` — the same ones `/conport:task` and
  `/conport:epic` dispatch — and `conport:sdd-final-reviewer` for the final
  review of the whole branch. They run on the session's model and start no
  subagents of their own.
- **Visibility.** When the overlay is on, print one line at the start of the
  session: `[CONPORT] Superpowers overlay: on`.
- **On `create_project`.** When Superpowers skills are available in the
  session, offer the overlay once the project exists; on the user's yes, make
  the two writes above.

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

A task in REVIEW closes as DONE only after an `approve` of its current round,
and there `resolution` is required, not just expected (`done_needs_resolution`).
The verdict and the reports stay in the journal; the `resolution` says what
was delivered.

**Do NOT call `log_progress` separately for task closes** — that would
duplicate the entry. `log_progress` is for progress events that don't belong
to a single closing task (e.g. mid-implementation notes, infra changes).

**Roadmap discipline.** A milestone is an ordered group of epics; the **current**
milestone is the open one with the smallest `sequence`, and `init` / `get_agenda`
return it in the `roadmap` section.

- **Work the current milestone.** Exception: an open Bug (`kind='bug'`,
  status TODO, IN_PROGRESS, REVIEW or BLOCKED) from any milestone comes before
  an ordinary task of the current milestone. Follow `backlog.top`: open Bugs
  and their epics come first; readiness and review gates still apply.
  In an interactive session, picking up ordinary work
  that belongs to a **later** milestone needs an **explicit decision by the
  owner** — say which milestone the work sits in and ask before starting; never
  silently pull work forward because it looked convenient. Work attached to no
  milestone (`milestone_id: null`) is not off-limits, but say so when you take
  it. Every epic is attached to a milestone — its release, the waiting list or
  the backlog without a date; an epic without one is an attachment error, so
  attach it by the **conport-roadmap** rules, never leave it aside. (An
  autonomous routine run has no owner to ask: the
  **conport-routine** skill overrides this rule with its own — unattached rows
  are fair game; later-milestone ordinary rows are not.)
- **Closing a milestone always carries `resolution`** — what was delivered
  (DONE) or why it was dropped (CANCELLED). The server logs a progress entry
  from it.
- **A release milestone (`is_release=true`) closes only after the release
  actually happened.** "Every epic is DONE" is not a release; the resolution
  names the shipped version/artifact. If the release hasn't shipped, leave the
  milestone open and say so.
- **A release milestone holds the epics that ship in it.** Create it with
  `is_release=true` and attach those epics to it; an ordinary milestone
  followed by an empty release point is used only when the user asks for that
  shape. The full rules are the **conport-roadmap** skill.
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
| "Which projects do I own?" / bootstrapping without a known project handle | `list_projects` |

### Sync

| Trigger | Tool |
|---------|------|
| Technology choice | `sync_decision` |
| Trade-off with rationale | `sync_decision` |
| Read one decision's full body (id → tags + currency) before amending | `get_decision` |
| Amend / re-tag an existing decision | `update_decision` |
| Decision no longer holds, NO replacement | `deprecate_decision` (reason required) |
| Un-retire a decision | `reactivate_decision` |
| "Which decisions were written by hand?" | `list_decisions` with `source` (`manual` \| `progress_extraction` — the latter only for decisions extracted from progress entries before that extraction was removed; nothing is extracted from `log_progress` now) |

### Progress

| Trigger | Tool |
|---------|------|
| Standalone progress note (not a task close) | `log_progress` (a link is refused unless `linked_item_type` and `linked_item_id` are both given and name an existing item of this project) |
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
A block edit is refused when the body it leaves would read back as other
blocks than the rows hold — a block set under a list that the list would take
in, for example. The refusal names the one call to make instead: `update_block`
on the list (`block_joins_list`) or `update_document` with the whole body
(`block_edit_changes_blocks`).

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

### Context assembly and gaps

| Trigger | Tool |
|---------|------|
| "Open task #N and brief me" | `assemble_context` with `recipe='task_briefing'`, `start_id='task-N'` |
| "Implementation status of spec doc-N?" | `assemble_context` with `recipe='spec_implementation_status'`, `start_id='doc-N'` |
| "What recipes are available?" | `list_context_recipes` |
| "Current architecture of subsystem X?" | `render_current_architecture` with `scope=[...]` |
| "Is this architecture doc safe to archive?" | `audit_doc_l1_coverage(doc_id)` |
| Init response carries `questions` | ask the user, one at a time, then `answer_question` — see *Questions from init* |
| "Show the gaps" / "how healthy is the knowledge base?" | `gap_list` (open ones by default), `gap_stats` — read-only: the server resolves gaps itself |

**`start_id` convention.** Prefer the prefix form `'<type>-<id>'` (`'task-<id>'`,
`'doc-<id>'`); type vocabulary `task` / `doc` / `decision` / `pattern` /
`progress`. The wikilink form `'[[task-<id>]]'` is also accepted verbatim. Plain
integers work as a legacy fallback but the prefix form gives a clean 400 on type
mismatch.

→ Deep detail: live docs `projects/context-recipes`, `projects/gaps`.

---

## BACKLOG DISCIPLINE

One line per rule; the full text with the reasons is
`references/backlog-discipline.md` — read it before filing findings, growing an
epic or reporting an epic's progress.

- **Record** the decision and why, the options rejected, numbers with their
  method — never a chronology, a retelling or a duplicate.
- **A decision with a list of work** spawns one task per item in the same
  message, and their numbers go into the decision.
- **A question from the user** is not an instruction, a decision or a task:
  answer it first, checked; file a task only when the answer showed a defect;
  record a decision as the user's only for what the user stated.
- **Two or more related tasks** — an epic first; work before a design is one
  task (the Planning rows above).
- **A finding** becomes a task after it is checked, not instead. File a defect
  (a review's Critical or Important, a gap hunt's Blocker or Should-fix, or a
  confirmed behaviour defect) with `kind='bug'`; polish and new work use
  `kind='task'`. Every finding
  not fixed in the same pass is a task of the current epic, done before the
  epic is declared ready: a gap hunt's Blocker, Should-fix and Note, a review's
  Critical, Important and Minor, a confirmed behaviour defect. A behaviour
  defect always stays in this epic; an ordinary finding past the growth ceiling
  goes to the tails epic of the release, and readiness does not wait for it. A
  Note only the user can answer is asked at once; the answer becomes the task.
  A filed
  finding goes to an executor as the next action; the epic is not ready while
  one is open. The report names the task numbers, never a list of findings: a
  report "after the epic I found N problems" as text, with no task numbers and
  no work started, is forbidden.
- **Depth is one level:** the review of a task filed from a finding reports
  every severity, and its author fixes all of it before the merge — nothing
  from it is filed anew or dropped; only a behaviour defect outside that task's
  diff becomes a new task.
- **A change to behaviour a spec describes** changes the spec in the same task,
  by blocks (`update_block`, `insert_block`), before the task is closed — "the
  epic is closed" is no reason to skip it.
- **Epic growth ceiling:** an epic takes max(3, floor(0.3 × plan tasks))
  ordinary tasks added after the plan; the next ordinary task goes to the
  tails epic of the release (the one of the freeze line below) — not into this
  epic, not dropped; ask for its milestone only when no next release is
  available. A defect never counts and always stays in this epic: a review's
  Critical and Important, a gap hunt's Blocker and Should-fix, a confirmed
  behaviour defect. Polish from findings counts: a review's Minor left after
  the pass, a task from a Note's answer — and so does new scope. A progress
  report names the ordinary tasks added (counted) and the defect fixes (not
  counted) as two numbers. File defects with `kind='bug'`, polish and new work
  with `kind='task'`: `kind` determines which count applies, not the task's
  origin. The server counts the ceiling itself. On `epic_growth_ceiling`, take
  one action: execute the call in `suggestions[].call`, using the tails epic
  the server names. Do not recalculate the ceiling or choose another epic.
  Read `epic_progress.plan_tasks`, `ordinary_added`, `bugs` and
  `growth_ceiling`; the ceiling is `epic_progress.growth_ceiling`, and `null`
  means no ceiling (the epic is outside its scope), never a fallback count.
  With a ceiling, the server summary is "ordinary after plan N of C, bugs B".
  The workflow run summary is "ordinary tasks added N of ceiling C; bug fixes B"
  or "ordinary tasks added N (no ceiling); bug fixes B" outside that scope.
  Execute the ordered calls from `suggestions` on a refusal; do not count locally.
  `ask_user_milestone` asks where the target tails epic belongs whenever it has
  no milestone, whether that epic was found or created.
- **Epic progress** is its open children in ConPort, not a plan file's list;
  recount after every close; a report gives both numbers.
- **An epic does not bump a version:** it writes its changes under
  `## Unreleased`; the version is bumped once, at the release step, after
  every epic of the release milestone has merged.
- **A release epic is frozen at the version bump:** a later finding, and work
  that can be done right after the push (a live check after the deploy), go to
  the tails epic of the release — one per release, attached to the milestone
  right after the release, taken first after the push, never holding waiting
  work. Its title is `Tails of release <title of the release milestone>`,
  written literally and never translated: look for an epic with that title
  before filing one. It is filed with priority 1. Inspect the next open
  milestone after the release: if it is a release, find the oldest open tails
  epic with the exact title in that milestone, or create it there; otherwise
  find or create it without a milestone, file the work, and ask the user which
  milestone it goes to. Work that cannot be finished before the push for an
  outside reason (another party's service, a date, a measurement window) goes
  to the waiting milestone. A defect in this release's code is closed before
  the push.
- **At session start** a task in IN_PROGRESS with no live executor and no
  commit is an interrupted attempt: tell the user, then continue it from what
  it left or return it to TODO.

---

## PROJECT MODEL

The project model is the graph of what the system is made of: entities and
the relations between them, each of a closed set of types. You write it, the
server checks it, and the Architecture section of the dashboard draws its views
from it. The model is made of **portions**: what one source says about the
system. A source is a `spec` or `architecture` document (`doc-N`), a document
of any type the backfill inventory gave the role `structure` or `history`, or
a part of the code (`code:<label>`, as many labels as you need); a document
with the role `none` is never a source. A new submission of a
source replaces its earlier portion as a whole and leaves the other sources
alone. A portion also carries the **scenarios** of its source — how the system
behaves, drawn from entities of the model: see *Scenarios* below.

| Trigger | Tool |
|---------|------|
| "What is the system made of?" | `arch_get` with `view='composition'` (`expand` opens units) |
| "What touches X?" / one entity and its neighbours | `arch_get` with `view='neighbourhood'`, then `arch_entity` for the card |
| "What did these specs bring in?" | `arch_get` with `view='contribution'` (one to three `documents`) |
| "Which part of the model is this file or symbol?" | `arch_lookup` |
| Before extracting a portion | `arch_names` (every page), `list_blocks` of the document |
| Submit or replace a portion | `arch_submit` (or `npx -y conport@^0.8.0 arch submit <file.json>`) |
| Change a portion | `arch_source` (or `npx -y conport@^0.8.0 arch source <source>`), edit, `arch_submit` |
| Take a source out of the model | `arch_withdraw` (or `npx -y conport@^0.8.0 arch withdraw <source>`) |
| "Which behaviour scenarios does the project have?" | `arch_scenarios` |
| One scenario with its participants, states or nodes and steps | `arch_scenario` |
| "What does the model owe?" | `arch_status` |
| Check the anchors against the code | `npx -y conport@^0.8.0 arch check` in the repository root |
| Fill the model of a project that lived before it | the procedure `references/model-backfill.md` |
| Start, complete or decline the backfill | `arch_backfill(project, state)` — `in_progress`, `completed`, `declined` |
| The role of a document in the model | `update_document` with `model_role` — `structure`, `history`, `none` |

### What goes into the model

| Entity type | What it is |
|---|---|
| `person` | The role of a person in the system |
| `external_system` | Something not ours that the system calls; runs as a separate process |
| `unit` | Versioned and released on its own |
| `component` | A module inside a unit |
| `interface` | A command, a route, a tool, a hook, a signal, an event, a messenger channel |
| `store` | A database, a file, a queue |
| `data` | A table or a record with fields |
| `setting` | An environment variable, a flag, a threshold, a secret (its name, never its value) |

Relation types: `contains`, `calls`, `starts`, `reads`, `writes`,
`derived_from`, `replaces`, `references`. `contains` goes from a `unit` to a
`component`, `interface`, `store`, `data` or `setting`, from a `component` to a
`component`, `interface`, `data` or `setting`, and from a `store` to `data`; an
entity has at most one owner. `references` goes only from `data` to `data`.
`replaces` joins two entities of one type. The others join any types.

**Which type a thing takes:**

| Thing | Type |
|---|---|
| A messenger channel, a signal, an event, a metric | `interface` |
| A queue, a prompt file, a reference catalogue | `store` |
| An LLM | `external_system` |
| A library, the contents of a reference catalogue | not written into the model |

**The rules:**

1. The sets of types are closed. A type outside them is refused; a thing that
   fits none of them is mapped by the table above or stays out of the model.
   When the work needs a type the sets lack, file a `missing` report:
   *REPORTING TO THE SERVICE DEVELOPERS*.
2. An entity points at a thing: it has an anchor in the code, or a block of a
   document that introduces it as planned. A notion without a thing — an
   approach, a principle — stays in the document.
3. Libraries, the contents of reference catalogues, functions and classes do
   not go into the model.
4. The model belongs to one project. A neighbouring project is an
   `external_system`.
5. A secret is written by its name and its carrier; its value never goes into
   the model.

**The fields.** The name is in the user's language and unique in the project,
case ignored; aliases count in the same check. An anchor is a `kind` — `path`
(a file or a directory from the repository root, no line number), `symbol`,
`command`, `route` or `table` — and a `value`; an entity without anchors is
planned. `technologies` is a list of names, `properties` are name–value pairs
for modes, `constraints` are the text of a rule, a threshold or a schedule
with the block that states it.

### When to submit a portion

- **A spec gets its plan.** Once the plan of a `spec` document is imported,
  submit the spec's portion. A spec still changes while it is written and
  checked; it settles when its plan is imported, so the portion comes then,
  before the implementation. Its scenarios go in the same portion. In the
  Superpowers overlay this is the step right after `plan import`; without the
  overlay the rule is the same.
- **A spec is amended after its plan.** Read its portion (`arch_source`),
  bring it in line with the document and submit it again.
- **An `architecture` document** has no plan: submit its portion whenever it
  is written or changed.
- **The code.** Write the skeleton yourself, reading the code through
  `codegraph` or the files: one unit per source `code:<label>`. Submitting one
  label leaves the others as they are; to add to a skeleton, read its portion,
  edit it and submit it again. Then run `npx -y conport@^0.8.0 arch check`.

The model is on in a project once it has one portion, or while its backfill
runs or after it is completed; before that it owes nothing.

### How to submit a portion

1. **Read the names** of the model with `arch_names`, every page
   (`next_offset`), and name an existing entity by its name or an alias. Any
   other name makes a new entity; a rename carries the old name in
   `renamed_from`.
2. **Read the blocks** of the document with `list_blocks`: each claim of a
   document portion carries the ULID of the block it comes from in `block`.
3. **Write the portion**: `source`, `entities`, `relations` and, when the
   source describes behaviour, `scenarios` (*Scenarios* below). Each entity
   carries `name`, `type` (for a new one), `action`, `block` or `anchors`, and
   `note`; it may carry `description`, `aliases`, `technologies`,
   `properties`, `constraints`, `renamed_from`, `replaced_by` and `decisions`.
   The action is `introduced` (new in this source), `changed`, `removed`,
   `replaced` (with `replaced_by`) or `mentioned`. A relation carries `type`,
   `source`, `target` (names or aliases), `action` and `block`. A `code`
   portion takes only `introduced` and carries anchors, not blocks.
4. **Submit it** with `arch_submit(project, portion)`, or write it to a file
   and run `npx -y conport@^0.8.0 arch submit <file.json>`.
5. **A refusal** is `portion_rejected` with every error at once, each with its
   `code`, `subject` and `action`; nothing was written. Take the action of each
   error and submit again. `portion_invalid` is a portion off the schema: its
   message names the field.
6. **The background check.** A document portion is checked against the text
   of its document by an LLM after the answer: what the document names and the
   portion misses, and what the portion holds and the document does not. Open
   findings come back as the debt `mismatch`. A finding you judge wrong goes
   into `dismissed` of the next submission — `subject` (`entity`, the default,
   or `scenario`), `kind` (`missing` or `invented`), `name`, `where` (for a
   scenario: the text of the step, or `whole_scenario`) and `reason` — and is
   not raised again. A finding about a relation is a finding about an entity
   named `Source type Target`: dismiss it without `subject` or with `entity`;
   `relation` is no subject and makes the portion `portion_invalid`. The server
   drops a later finding of the same `subject` and `kind` under another
   spelling of a dismissed name: arrows and colons aside (`FACT :Entity →
   :Entity` is `FACT Entity → Entity`), and an entity written `X (y)` with `y`
   as code (it holds `_`, `/`, `.` or `{}`) taken for the whole `X` or the
   whole `y` — `agent_event` goes with `Agent event (agent_event)`. A plain
   word in brackets makes another thing (`API_HOST (agent)` is not
   `API_HOST`), as do two wrapped names sharing only a part, a word more or
   less and another end of a relation; a relation — `Source type Target` or
   `Source → Target` — is never unwrapped. `X (y)` is unwrapped, on either
   side, for a `missing` finding only. An `invented` finding and its
   dismissal both name entities the portion holds, so they are compared by
   their whole names: a dismissal of `Точка входа (cli/conport)` takes
   `missing: cli/conport` but not `invented: cli/conport`, and a dismissal of
   `cli/conport` does not take `invented: Точка входа (cli/conport)`. The next check shows the model your dismissals with
   their reasons and tells it to raise none of them under another name, nor
   another finding a reason covers just as well. So write the reason as the
   class the finding belongs to — "a function, smaller than the model", "a
   file", "a reference to a ConPort record" — and one reason keeps away the
   other findings of that class too. A finding the model still raises under
   another name goes into `dismissed` like any other.

A decision about an entity is linked by its number in `decisions` of the
entity, or with `link_items` (`decision` → `entity`, `clarifies`). A
submission only adds such links; it removes none.

### Scenarios

A scenario is how the system behaves, and the Architecture section draws it as
a diagram: who sends what to whom and in which order, which states a thing
goes through, how a process runs with its branches and waits. Its
participants are entities of the model; a scenario has none of its own.
Scenarios travel in `scenarios` of the portion of their source, next to its
entities and relations: the portion of a spec submitted right after
`plan import` carries them, and so may a `code:` portion. A runbook is not a
source of scenarios. A document with the role `history` submits no scenarios,
and the background check raises no whole-scenario finding for it: its claims
set no current state, and a scenario is one.

- No field `scenarios` in the portion: the scenarios of the source stay as
  they are. An empty list deletes them. A list replaces them as a whole.
- A scenario submitted under the same name keeps its number; under a new name
  it keeps it only with `renamed_from` (its earlier name in this source). A
  new name without it is a new scenario, and the earlier one is deleted.
- An entity a scenario names stays in the model while the scenario names it,
  even when no claim of any source does.
- `arch_source` gives the scenarios back in the form of a submission: read the
  portion, edit it, submit it again.

**Which kind:**

| What the document shows | Kind |
|---|---|
| Messages exchanged between participants: requests, replies, events | `sequence` |
| The life of one thing: its statuses and the moves between them | `states` |
| A process with branches, parallel paths and waits | `activity` |
| A process that must end in one of a set of values — an outcome, a verdict | `states`, the values as its final states |
| A set of values without moves between them | no scenario: a property of the `data` entity that holds them |

An enumeration is a `states` scenario only when the document says how one
value turns into another; a list of values alone is a property of its entity.

When no kind fits what the project needs to show, do not submit the scenario
and do not bend it into another kind: file a `missing` report as the section
*REPORTING TO THE SERVICE DEVELOPERS* says, and dismiss the whole-scenario
finding of the background check about it (below).

**The fields.** Every scenario has `name` (in the user's language, unique in
the project case aside, apart from the names of entities), `kind`,
`description` and one ground: `block` (the ULID of the block it comes from) in
a document portion, `anchor` (`path` or `symbol`) in a `code:` portion. It may
carry `renamed_from` and `takes_over`. Then the fields of its kind:

- `sequence`: `participants` — `key`, `entity` (a name or an alias), `role`;
  one entity may take part twice under two keys. `steps` in their order —
  `from` and `to` (keys of participants), `kind` (`call` — a request,
  `reply`, `async` — a message nobody waits for), `text`, and optionally
  `via` (the `interface` entity the call goes through) and `branch` — `label`
  and `type` (`alt` — one of the alternatives, `opt` — on a condition,
  `loop` — repeated). Neighbouring steps with one label form a band; bands do
  not nest. A step from a participant to itself is allowed.
- `states`: `subject` (the entity whose states these are), `states` — `name`
  as in the code (`IN_PROGRESS`), `description`, `initial`, `final`;
  `transitions` — `from`, `to`, `text` (required), `performer` (an entity).
- `activity`: `nodes` — `key`, `kind` (`start`, `end`, `action`, `decision`,
  `fork`, `join`, `wait` — for a signal or a timer), `text`, `performer` (an
  entity; each performer has its own lane), and on an `action` `scenario` —
  the name of another scenario it runs as a nested process; `transitions` —
  `from`, `to`, `condition`.

**The rules of a kind** — `scenario_malformed` names the one broken and where:

- `sequence`: at least one step; every participant takes part in a step;
  `via` is an `interface`.
- `states`: exactly one initial state; every transition has a text; every
  state is reachable from the initial one; no transition leaves a final state;
  when there are final states, one is reachable from every state.
- `activity`: one `start` without entries and with one exit, at least one
  `end` without exits; every node is reachable from `start`, and an `end` from
  every node; an `action` and a `wait` have one exit; a `decision` has two
  exits or more, each with a condition of its own, and no other transition
  has a condition; a `fork` has one entry and two exits or more, a `join` two
  entries or more and one exit, and a `join` is reachable from every exit of a
  `fork`; every cycle passes through a `decision`; no transition repeats
  another or leads a node to itself; only an `action` names a `scenario`.
- A scenario carries its ground and the fields of its kind only: a `block` in
  a document portion, an `anchor` in a `code:` portion, no field of another
  kind, no `condition` on a transition of `states` and no `text` or
  `performer` on a transition of an `activity`.
- The keys of participants and nodes, the names of states and the names of the
  scenarios of a portion are each used once.

**The limits:** a `sequence` has at most 40 steps, 10 participants and 300
characters in the text of a step; `states` 30 states and 60 transitions; an
`activity` 60 nodes and 90 transitions; a portion 30 scenarios. A scenario
over a limit is split into parts within it: the parts of an activity are
linked by an `action` whose `scenario` names the next part; the next part of
another kind is named after the first with (part 2) at the end — `Charge a
card` and `Charge a card (part 2)`. A step text over 300 characters is
shortened, not split.

**Behaviour another source already submitted.** Read the scenarios with
`arch_scenarios` before writing yours, and never make a second scenario of the
same behaviour under a similar name. When the new document changes that
behaviour, submit the scenario with `takes_over` naming the earlier one: it
leaves its old source and keeps its number, and the name may stay the same.
When the document only repeats it, leave it out of the portion. A name another
source holds, without `takes_over`, is refused with `scenario_name_taken`.

**A document portion with a scenario of each kind** — a request refused and
retried, an outcome whose final states are the verdicts, a process with a
decision:

```json
{
  "source": "doc-N",
  "entities": [
    {"name": "Shop front", "type": "component", "action": "introduced", "block": "<block ULID>",
     "note": "Starts a payment"},
    {"name": "Payment service", "type": "component", "action": "introduced", "block": "<block ULID>",
     "note": "Charges the card and keeps the payment"},
    {"name": "Payment API", "type": "interface", "action": "introduced", "block": "<block ULID>",
     "note": "POST /payments"},
    {"name": "Payment provider", "type": "external_system", "action": "introduced", "block": "<block ULID>",
     "note": "Charges the cards"},
    {"name": "Payment events", "type": "store", "action": "introduced", "block": "<block ULID>",
     "note": "Queue of settled payments"},
    {"name": "Payment", "type": "data", "action": "introduced", "block": "<block ULID>",
     "note": "One row per payment"},
    {"name": "Support agent", "type": "person", "action": "introduced", "block": "<block ULID>",
     "note": "Handles refund claims"}
  ],
  "relations": [
    {"type": "contains", "source": "Payment service", "target": "Payment API", "action": "introduced", "block": "<block ULID>"},
    {"type": "calls", "source": "Shop front", "target": "Payment service", "action": "introduced", "block": "<block ULID>"},
    {"type": "calls", "source": "Payment service", "target": "Payment provider", "action": "introduced", "block": "<block ULID>"},
    {"type": "writes", "source": "Payment service", "target": "Payment events", "action": "introduced", "block": "<block ULID>"},
    {"type": "writes", "source": "Payment service", "target": "Payment", "action": "introduced", "block": "<block ULID>"}
  ],
  "scenarios": [
    {"name": "Charge a card", "kind": "sequence", "block": "<block ULID>",
     "description": "A payment from the order to the verdict, with retries on a refusal",
     "participants": [
       {"key": "front", "entity": "Shop front"},
       {"key": "payments", "entity": "Payment service"},
       {"key": "provider", "entity": "Payment provider"},
       {"key": "events", "entity": "Payment events"}
     ],
     "steps": [
       {"from": "front", "to": "payments", "kind": "call", "text": "Create a payment: the order and the card token", "via": "Payment API"},
       {"from": "payments", "to": "provider", "kind": "call", "text": "Charge the card",
        "branch": {"label": "retry, at most three tries", "type": "loop"}},
       {"from": "provider", "to": "payments", "kind": "reply", "text": "Refused: rate limit, retry after a pause",
        "branch": {"label": "retry, at most three tries", "type": "loop"}},
       {"from": "provider", "to": "payments", "kind": "reply", "text": "Charged",
        "branch": {"label": "charged", "type": "alt"}},
       {"from": "payments", "to": "events", "kind": "async", "text": "payment.settled",
        "branch": {"label": "charged", "type": "alt"}},
       {"from": "payments", "to": "front", "kind": "reply", "text": "Paid",
        "branch": {"label": "charged", "type": "alt"}},
       {"from": "payments", "to": "front", "kind": "reply", "text": "Declined",
        "branch": {"label": "refused three times", "type": "alt"}}
     ]},
    {"name": "Payment outcome", "kind": "states", "block": "<block ULID>", "subject": "Payment",
     "description": "Every payment ends in one of two verdicts",
     "states": [
       {"name": "PENDING", "initial": true},
       {"name": "CHARGING"},
       {"name": "RETRY_WAIT"},
       {"name": "PAID", "final": true, "description": "Verdict: the money is taken"},
       {"name": "DECLINED", "final": true, "description": "Verdict: refused for good"}
     ],
     "transitions": [
       {"from": "PENDING", "to": "CHARGING", "text": "charge starts", "performer": "Payment service"},
       {"from": "CHARGING", "to": "PAID", "text": "charged", "performer": "Payment provider"},
       {"from": "CHARGING", "to": "RETRY_WAIT", "text": "refused for now", "performer": "Payment provider"},
       {"from": "RETRY_WAIT", "to": "CHARGING", "text": "pause over, fewer than three tries", "performer": "Payment service"},
       {"from": "RETRY_WAIT", "to": "DECLINED", "text": "third refusal", "performer": "Payment service"}
     ]},
    {"name": "Refund a payment", "kind": "activity", "block": "<block ULID>",
     "description": "A refund claim from the check to the answer",
     "nodes": [
       {"key": "start", "kind": "start"},
       {"key": "check", "kind": "action", "text": "Check the claim", "performer": "Support agent"},
       {"key": "valid", "kind": "decision", "text": "Is the claim valid?", "performer": "Support agent"},
       {"key": "refund", "kind": "action", "text": "Send the refund", "performer": "Payment service"},
       {"key": "confirm", "kind": "wait", "text": "The provider confirms the refund", "performer": "Payment provider"},
       {"key": "notify", "kind": "action", "text": "Tell the customer", "performer": "Payment service"},
       {"key": "refuse", "kind": "action", "text": "Answer with the refusal", "performer": "Support agent"},
       {"key": "end", "kind": "end"}
     ],
     "transitions": [
       {"from": "start", "to": "check"},
       {"from": "check", "to": "valid"},
       {"from": "valid", "to": "refund", "condition": "valid"},
       {"from": "valid", "to": "refuse", "condition": "not valid"},
       {"from": "refund", "to": "confirm"},
       {"from": "confirm", "to": "notify"},
       {"from": "notify", "to": "end"},
       {"from": "refuse", "to": "end"}
     ]}
  ]
}
```

A `code:` portion grounds each scenario in an anchor instead of a block: see
*A code portion for one unit* below.

**Refusals of a scenario** are rows of the table below, from
`unknown_scenario_kind` to `scenario_too_large`, each with its action. Their
`subject` is the name of the scenario and their `message` the rule broken and
where. A few codes the entities share prescribe another action for a scenario:

- `portion_too_large` (more than 30 scenarios): Submit at most 30 scenarios in the portion and the others in the portion of another source that describes them.
- `entity_without_ground`: Give the scenario the ULID of its block in a document portion, or an anchor of the kind path or symbol in a code portion.
- `anchor_malformed`: Write the anchor of the scenario as the kind path or symbol with a non-empty value, a path relative to the repository root and without a line number.
- `scenario_too_large` for the text of a step: Shorten the text of each step the message names to at most 300 characters.
- `scenario_participant_missing` for an entity only this source held and the portion dropped: Return entity <name> to `entities` of the portion.
- `scenario_ref_unknown` for an action that names its own scenario: Name in `scenario` of the action another scenario of the portion or of another source, never the scenario the action belongs to.
- `scenario_malformed` by the rule `history_source` (a scenario in the portion of a document with the role `history`): Submit the portion of a document with the role history again without the field `scenarios`.

**Debts of a scenario** are rows of the table of debts below; each carries the
`scenario_id` of its scenario.

- `step_without_relation` — a step of a `sequence` joins two entities the
  model does not relate. A step is matched when an active relation other than
  `contains`, `replaces` or `derived_from` joins its sender or any owner of the
  sender by `contains` with its receiver or any owner of the receiver, in
  either direction; or when its `via` belongs to the receiver or an owner of
  the receiver and such a relation joins the sender or an owner of the sender
  with `via`. A step from an entity to itself is matched; `states` and
  `activity` owe no such debt.
  One debt per scenario, `detail` names the steps by number. Add the relation
  to the portion, or correct the step. When the step is right and the
  relation does not belong in the model, dismiss the debt with a reason in
  `dismissed` of the next submission:

  ```json
  {"dismissed": [
    {"subject": "scenario", "kind": "step_without_relation", "name": "Charge a card",
     "reason": "The front reaches the provider through a redirect page the model leaves out"}
  ]}
  ```

  The dismissal is kept on the scenario with the steps unmatched at that
  moment, in a document portion and a `code:` portion alike, and holds while
  no other step is unmatched: a new one brings the whole debt back. The record
  is one-off: once the submission is accepted, remove the record from
  `dismissed` of your file. `arch_source` does not give it back, and
  `arch_scenario` shows it under `debt_dismissal`. The same record with the
  same reason sent again does not widen the dismissal to new steps; the steps
  unmatched now can be dismissed only with a new reason.
- `scenario_participant_gone` — an entity the scenario names was removed or
  replaced after the submission, or the scenario an action runs was deleted.
  Resubmit the scenario without the removed entity or with the one that
  replaced it.
- `anchor_missing` with a scenario as its subject — the anchor check did not
  find the anchor of a scenario of a `code:` portion. Correct the anchor and
  submit that portion again.

**The background check** compares the scenarios of a document portion with the
document too; those of a `code:` portion are not checked. A finding about a
scenario has `subject: "scenario"`: `missing` — the document has a step the
scenario lacks (`name` is the scenario, `where` the text of the step);
`invented` — the other way round; `missing` with `where: "whole_scenario"` —
the document describes an order or states and the portion has no scenario of
them (`name` is the heading of the section of the document). Fix the portion,
or dismiss the finding with its `subject`, `kind`, `name` and `where` and a
reason. When no scenario kind fits that behaviour, dismiss the whole-scenario
finding for that reason:

```json
{"dismissed": [
  {"subject": "scenario", "kind": "missing", "name": "Nightly reconciliation", "where": "whole_scenario",
   "reason": "No scenario kind fits: the section is a timing chart; reported to the service developers"}
]}
```

### Refusals of a portion

| Code | When | Do exactly this |
|---|---|---|
| `unknown_entity_type` | The entity type is not one of the eight | Give the entity one of the types person, external_system, unit, component, interface, store, data, setting. |
| `unknown_relation_type` | The relation type is not one of the eight | Give the relation one of the types contains, calls, starts, reads, writes, derived_from, replaces, references. |
| `relation_endpoint_missing` | A relation names an entity neither the portion nor the model has | Name each end of the relation by a name or an alias of an entity of the portion or of `arch_names`. |
| `relation_endpoint_removed` | A relation names a removed or replaced entity | Claim the relation with the action `removed`, since an end of it is gone. |
| `relation_pair_not_allowed` | The types of the two ends are not a pair the relation allows | Join the types the relation allows: `contains` from a unit to a component, interface, store, data or setting, from a component to a component, interface, data or setting, from a store to data; `references` from data to data; `replaces` within one type. |
| `second_owner` | A second `contains` onto the same entity | Keep one `contains` relation onto the entity and claim the others `removed`. |
| `block_not_found` | The source document has no block with that ULID | Take the block ULID from `list_blocks` of the source document. |
| `entity_without_ground` | The entity has neither an anchor nor a block | Give the entity an anchor, or in a document portion the ULID of the block that introduces it. |
| `name_collision` | A name or an alias is the name of an entity of another type | Rename the entity so that its name and aliases name one entity of its type and no other. |
| `anchor_malformed` | An anchor of an unknown kind, an absolute path or a path with a line number | Write the anchor as one of the kinds path, symbol, command, route, table with a non-empty value, a path relative to the repository root and without a line number. |
| `source_not_found` | The project has no such document, or the document is no source: its role in the model is `none`, or it has no role and is neither `spec` nor `architecture` | Name a document that is a source of the model: type spec or architecture, or a document the backfill inventory gave a role. |
| `decision_not_found` | The project has no decision of that number | Name the decision by a number `list_decisions` returns for the project. |
| `portion_too_large` | More than 150 entities for a document, more than 400 for one `code:` label | Move whole units, each with the entities it contains, or the components of a unit over 150 entities, each with what it contains, into a new `architecture` document that describes them and submit its portion first, with the blocks `list_blocks` returns for that document; then submit this portion without those entities but with all their relations, and with them in `dismissed` as `missing` for the reason that the `architecture` document holds them, so that it carries at most 150 entities. |
| `entity_reference_missing` | `renamed_from` or `replaced_by` names no entity | Name in `renamed_from` a name of `arch_names` and in `replaced_by` an entity of the portion or of `arch_names`. |
| `unknown_scenario_kind` | The kind of a scenario, a step or a branch is not one of its set | Give the scenario one of the kinds sequence, states, activity, a step one of call, reply, async and a branch one of alt, opt, loop. |
| `unknown_node_kind` | The kind of a node of an activity is not one of the seven | Give the node one of the kinds start, end, action, decision, fork, join, wait. |
| `scenario_participant_missing` | A participant, the subject, a performer or `via` names an entity neither the portion nor the model has | Name the participant, subject, performer or `via` by a name or an alias of an entity of the portion or of `arch_names`. |
| `scenario_participant_removed` | A participant, the subject, a performer or `via` names a removed or replaced entity | Drop the removed entity from the scenario or name the entity that replaced it. |
| `scenario_ref_unknown` | A step or a transition names a key or a state the scenario lacks, or `scenario`, `takes_over`, `renamed_from` or a dismissal names no scenario | Name only the keys and states the scenario declares, the scenarios of the portion or of `arch_scenarios`, and in `renamed_from` a scenario of this source. |
| `scenario_malformed` | A rule of the scenario's kind is broken; the message names the rule and the place | Correct the scenario at the place its message names so that it keeps the rule. |
| `scenario_name_taken` | The name is the name of a scenario of another source | Submit the scenario with `takes_over` naming it when this source changes that behaviour, or leave it out when the source repeats it. |
| `scenario_too_large` | A limit of the scenario is passed | Split the scenario into parts within the limit, linked by an `action` whose `scenario` names the next part or by the name of the next part ending in (part 2). |

When the end a relation names is an entity only the submitted source held and the portion no longer carries, `relation_endpoint_missing` prescribes instead: Return entity <name> to `entities` of the portion.

For a `code:` portion `portion_too_large` prescribes instead: Split the portion into one `code:` label per unit, or per component of a unit, at most 400 entities each.

### A code portion for one unit

```json
{
  "source": "code:billing",
  "entities": [
    {"name": "Billing service", "type": "unit", "action": "introduced",
     "note": "Released on its own", "technologies": ["Python", "FastAPI"],
     "anchors": [{"kind": "path", "value": "services/billing"}]},
    {"name": "Invoice API", "type": "interface", "action": "introduced",
     "note": "The invoice routes",
     "anchors": [{"kind": "route", "value": "/invoices"}]},
    {"name": "Invoice builder", "type": "component", "action": "introduced",
     "note": "Builds an invoice from the usage of a month",
     "anchors": [{"kind": "path", "value": "services/billing/invoices"}]},
    {"name": "Billing database", "type": "store", "action": "introduced",
     "note": "Postgres of the service",
     "anchors": [{"kind": "path", "value": "services/billing/migrations"}]},
    {"name": "Invoices", "type": "data", "action": "introduced",
     "note": "One row per invoice",
     "anchors": [{"kind": "table", "value": "invoices"}]},
    {"name": "Payment provider key", "type": "setting", "action": "introduced",
     "note": "Secret; its value is not written",
     "properties": [{"name": "carrier", "value": "environment variable PAYMENT_API_KEY"}],
     "anchors": [{"kind": "symbol", "value": "PAYMENT_API_KEY"}]},
    {"name": "Payment provider", "type": "external_system", "action": "introduced",
     "note": "Charges the cards",
     "anchors": [{"kind": "path", "value": "services/billing/payments"}]}
  ],
  "relations": [
    {"type": "contains", "source": "Billing service", "target": "Invoice API", "action": "introduced"},
    {"type": "contains", "source": "Billing service", "target": "Invoice builder", "action": "introduced"},
    {"type": "contains", "source": "Billing service", "target": "Billing database", "action": "introduced"},
    {"type": "contains", "source": "Billing service", "target": "Payment provider key", "action": "introduced"},
    {"type": "contains", "source": "Billing database", "target": "Invoices", "action": "introduced"},
    {"type": "calls", "source": "Invoice API", "target": "Invoice builder", "action": "introduced"},
    {"type": "writes", "source": "Invoice builder", "target": "Invoices", "action": "introduced"},
    {"type": "calls", "source": "Invoice builder", "target": "Payment provider", "action": "introduced"},
    {"type": "reads", "source": "Invoice builder", "target": "Payment provider key", "action": "introduced"}
  ],
  "scenarios": [
    {"name": "Invoice status", "kind": "states", "subject": "Invoices",
     "anchor": {"kind": "symbol", "value": "InvoiceStatus"},
     "description": "The statuses of an invoice as the code names them",
     "states": [
       {"name": "DRAFT", "initial": true},
       {"name": "ISSUED"},
       {"name": "PAID", "final": true},
       {"name": "VOID", "final": true}
     ],
     "transitions": [
       {"from": "DRAFT", "to": "ISSUED", "text": "issued at the end of the month", "performer": "Invoice builder"},
       {"from": "ISSUED", "to": "PAID", "text": "the charge went through", "performer": "Payment provider"},
       {"from": "ISSUED", "to": "VOID", "text": "cancelled before payment"},
       {"from": "DRAFT", "to": "VOID", "text": "cancelled as a draft"}
     ]}
  ]
}
```

A scenario of a `code:` portion is grounded in an anchor of the kind `path` or
`symbol`, never a block. Save it as a file and run
`npx -y conport@^0.8.0 arch submit <file.json>`, then
`npx -y conport@^0.8.0 arch check`.

### The anchor check

`npx -y conport@^0.8.0 arch check` in the repository root reads the anchors of
the model — of its entities and of the scenarios of `code:` portions — checks
`path` anchors on the file system and `symbol` anchors through the `codegraph`
index when the repository has one (without it they are left unchecked, as are
the other kinds), and sends the outcome with the commit
it checked. The code never leaves the machine. Run it **after an epic is
merged into the main branch** and **after submitting a `code` portion**.
`/conport:epic` runs it itself after its merges and reports it under
`anchor_check`; run it by hand otherwise, or when that report carries an
`action`.

The check decides what an entity looks like: **planned** — no anchors;
**declared** — anchors, none of them found by the latest check, or no check
yet; **built** — the latest check found a `path` or `symbol` anchor.

### Debts of the model in init

`init` returns the section `arch` when the model owes work, when its backfill
has started, completed or been declined, or when the project is offered the
backfill: `total` and up to five `debts`, each with `kind`, `subject`,
`detail` and `action`, and `backfill` (below). When the model owes work,
`instructions` gains a line that opens with `Model debts: N`. Print the
section after the backlog:

```
[MODEL] {total} debts of the project model
· {kind} {subject} — {action}
```

The debts are your work, not questions for the user: take the action of each
one. When `total` is above five, `arch_status` lists them all.

| Kind | When | Do exactly this |
|---|---|---|
| `no_portion` | A `spec` whose plan was imported after the model was on has no portion; while the backfill runs or after it is completed, also a document with the role `structure` or `history` and no portion, whatever its type | Extract the portion of the document and submit it with `arch_submit`. |
| `portion_stale` | The document changed after its portion was submitted | Read the portion with `arch_source`, bring it in line with the document and submit it again. |
| `mismatch` | The latest background check of the document's portion has findings nobody dismissed | Submit the portion again with the findings fixed or listed in `dismissed` with a reason. |
| `anchor_missing` | The latest anchor check did not find an anchor | Correct the anchor in the portion that claims it and submit that portion again. |
| `check_stale` | The model has anchors and the latest anchor check is older than the latest portion with anchors, or there was none | Run `npx -y conport@^0.8.0 arch check` in the repository root. |
| `removed_but_present` | A removed entity whose anchor the latest anchor check found | Delete the code the anchors of the removed entity point to, then run `npx -y conport@^0.8.0 arch check`. |
| `step_without_relation` | A step of a sequence scenario joins two entities the model does not relate; `detail` gives the step numbers | Add the missing relation to the portion or correct the step. |
| `scenario_participant_gone` | An entity a scenario names was removed or replaced, or the scenario an action runs was deleted | Resubmit the scenario: drop the removed entity or name the one that replaced it. |

`arch_status` also lists the background checks that were `skipped` or
`failed`, each with its `reason`. They are not debts: the portion stands, it
was only not checked. Under `retries` it lists the checks whose attempt failed
(`reason`: `model_error` or `answer_off_schema`) and that the nightly run
checks again at `retry_at`. Such a check is not hung: leave it, and read
`arch_status` again after `retry_at`. A check `failed` with
`answer_truncated` — the LLM's answer ran past its limit — is not retried:
its entry carries the one `action` to take, which splits the document.

### Filling the model of an existing project

A project that lived before its model is filled by the procedure
`references/model-backfill.md` of this skill: six steps — skeleton,
inventory, pass, what is gone, decisions, debts. Read it before the first
step and follow it; one session runs the backfill of a project, and the user
of the project approves what it asks to approve.

The key `backfill` of the section `arch` of `init` carries `state`
(`not_started`, `in_progress`, `completed`, `declined`), `completed_at`,
`documents` and `submitted` (the documents with the role `structure` or
`history`, and those of them with a portion) and `offer`.

- **While the backfill runs**, the debts `no_portion` by the role of a document
  are not listed one by one: `instructions` carries the line
  `Backfill: K of M documents submitted` instead. In a session that does not
  run the backfill the line is a notice, not a task: print it and go on with
  the session's own work. The other debts stay listed, each with its action.
- **An offer.** When the project has documents older than its model and the
  backfill has not started, `offer` is true. Only a session with a person —
  `init` called with `questions=true` — gets the line in `instructions` that
  offers it; a routine or a subagent (`questions=false`) gets the key `offer`
  alone and leaves it: it has nobody to offer it to. Show the offer to the
  user once. When the user accepts,
  follow the procedure. Call `arch_backfill(project, state='declined')` only
  after the user declines it; the offer is not shown again.
- **A rollback** of the backfill is never your own step: it runs only on the
  user's word, as the procedure's part *Rollback* says.

→ Deep detail: live docs `projects/architecture-model`; parameters in
`references/command_list.md` → *Project model*.

---

## TASK HIERARCHY (2 levels, schema-enforced)

The task tree is **two levels** and the database enforces it:

- `kind='task'` — ordinary work (the default), a leaf node. May have `parent_task_id` pointing to an epic. Cannot have children.
- `kind='bug'` — a defect: a review's Critical or Important, a gap hunt's
  Blocker or Should-fix, or a confirmed behaviour defect. It is a leaf with
  the same parent rules as an ordinary task; it cannot have children and never counts toward
  the epic's ordinary-task growth ceiling.
- `kind='epic'` — root container. Always `parent_task_id=NULL`. Other tasks attach under it.

The three kinds are exactly `task | bug | epic`; a leaf has `kind != 'epic'`.
No third level. Trying to attach a leaf under another leaf is **rejected at the DB level**. The MCP/REST layer maps the rejection to a structured `parent_not_epic` payload with two recovery options.

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
| `add_task_journal_entry` | `✅ {summary}` (carries the kind, the round and the verdict) |
| Task DONE/CANCELLED | `✅ {summary}` (progress entry was auto-logged from `resolution`) + suggest updating active_context |
| `add_milestone` / `update_milestone` | `✅ {summary}` (carries `milestone-<id>`, title, `[release]`, epics-closed rollup; never the roadmap position) |
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
`deprecated`) and `age_days`; the card of an entity (`arch_entity`) gives its
decisions the same `currency`, `superseded_by` and `superseded_by_patterns`. Before citing a decision as authoritative, check
`currency`: if `superseded`, follow `superseded_by` to the decision that
replaced it — or, for a decision absorbed into a pattern, follow
`superseded_by_patterns` to that pattern: the pattern replaced it, and a
decision absorbed into a pattern is never current. A `superseded` decision with
both `superseded_by` and `superseded_by_patterns` null was absorbed into a
pattern that is no longer linked to it — look the pattern up with `search`. If `deprecated`, treat it as retired (see
`deprecation_reason`) and do not present it as current. A high `age_days` on a
`current` decision is a prompt to verify it still holds, not proof that it's
stale.

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
| `kind` / `verdict` on a journal entry | Response `kind` and `verdict` match intent; `round` is the task's current round |
| `milestone_id=N` / `milestone_id=0` on a task | Response `milestone_id` is `N` (or `null` after a detach) |
| `sequence` / `is_release` on a milestone | Response `sequence` / `is_release` match intent — milestone writes echo `sequence`, `is_release`, `status` (not `title`), so those are the verification channel |

**On mismatch.** Re-issue the call with the field re-stated (often one retry
fixes the XML glitch). If a second attempt still loses it, flag the mismatch to
the user verbatim ("graph integrity: tags lost on decision N, please re-run")
rather than silently moving on — the damage is mute graph drift, easy to miss.

Applies to: `sync_decision`, `add_task`, `update_task`, `add_task_journal_entry`, `add_milestone`,
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
| `task_id` | `"4"` → `4` |
| `tags` | `"tag"` → `["tag"]` |
| `priority` | `"3"` → `3` |

A refusal that does not say what to do, or whose action did not help after you
took it → file a report: *REPORTING TO THE SERVICE DEVELOPERS*.

---

## REPORTING TO THE SERVICE DEVELOPERS

A problem of the service itself goes to the conport service developers as a
GitHub issue in the public repository `shaurgon/conport-plugin`. The issue is
**public** and is read by the service developers — not by the team and not by
the project owner.

**When to file:**

| Case | Kind |
|---|---|
| No scenario kind fits what the project needs to show — do not submit the scenario | `missing` |
| An entity type or a link type the work needs does not exist | `missing` |
| A refusal does not say what to do, or its action did not help | `unclear-refusal` |
| A tool behaves differently from its description | `defect` |
| A call fails again on a database or server error after the one retry the error asks for | `defect` |

**What goes in.** Describe the service's behaviour: what was called, what was
expected, what came back. Never put project content (texts of decisions,
documents, code, task titles), client or person names, or secrets into it —
replace them with placeholders (`<handle>`, `<task id>`, `<title>`).

**How:**

Every report's title starts with `[agent-report] `: the title, not a label,
marks an agent report — GitHub drops labels an outside author sets. One
problem — one issue.

1. **Write it.** The title `[agent-report] <tool>: <what went wrong>`, the body
   laid out by the form's fields:

   ```
   ### Kind
   <defect | missing | unclear-refusal>
   ### What was called
   <tool or command and its parameters, project content replaced>
   ### What was expected
   …
   ### What came back
   <the answer, or the refusal code and its text>
   ### Refusal code
   <code, or _No response_>
   ### Skill version and client
   <e.g. conport 20.4.0, claude-code>
   ```

2. **No person at the run** (a routine, a subagent, a scheduled run) → never file and never comment: put the report's title and body into the run's summary and stop.
   A session with a person that finds such a report in a subagent's or a run's summary → takes it through steps 3–5.
3. **Ask.** Show the user the title and the body; file or comment only after the user agrees.
4. **With `gh`.** Search the open agent reports:
   `gh issue list -R shaurgon/conport-plugin --state open --search "[agent-report] <words> in:title"`.
   A match → `gh issue comment <number> -R shaurgon/conport-plugin --body "…"`;
   no match → `gh issue create -R shaurgon/conport-plugin --title "[agent-report] <tool>: <what went wrong>" --body "…"`.
   Tell the user in one line the issue you filed or commented on, with its URL.
   `gh` refuses — not logged in, no network or a sandbox block, `403`, a rate limit → do not retry the call; take the path without `gh` (step 5).
5. **Without `gh`.** First the search link of the open agent reports:
   `https://github.com/shaurgon/conport-plugin/issues?q=is%3Aissue+is%3Aopen+in%3Atitle+%22%5Bagent-report%5D%22+<url-encoded words>`.
   You can read the web → open it yourself; otherwise give it to the user. A
   match you found → give the user its URL and the body to add there as a
   comment; never claim the comment was posted. A match the user found → they
   comment on it with the body instead of filing. No match →
   give the user the link with every field of the form filled, each value
   URL-encoded:
   `https://github.com/shaurgon/conport-plugin/issues/new?template=agent-report.yml&title=<title>&kind=<kind>&called=<call>&expected=<expectation>&returned=<answer>&refusal_code=<code>&client=<version-and-client>`
   A link too long to open → the link with `template` and `title` only, and
   the text of each field to paste into it. Tell the user the report is not
   sent until they submit it; never claim the report was sent.

**A slip.** GitHub keeps an edited text's earlier version in its edit history,
visible to every reader, and only its web page deletes a revision: an edit
alone removes nothing, and `gh` cannot remove it. A secret got into an issue or
a comment → tell the user to revoke and rotate it at once, then to take it out
as below. Project content in a comment posted for the report → tell the user to
delete the comment. Project content in an issue filed for the report → tell the
user to edit it out and delete the earlier revision in the issue's edit history
on its web page; they cannot → ask for its deletion. Project content in someone
else's issue → ask for its removal; the repository's owner removes it. To ask:
write a comment that asks for it, never repeating the content, show it to the
user and post it only after they agree — with `gh`:
`gh issue comment <issue URL> --body "…"`; without `gh`, or when `gh` refuses
(do not retry it), give the user the issue's URL and the text to post; never
claim it was posted.

---

## CHECKLIST

- [ ] Has `init` been run — with `questions=false` in a subagent or any run with no person at it?
- [ ] `init` returned `questions` → asked the user one at a time before the work, answered each with `answer_question`, and made no call for a question left unanswered?
- [ ] `CONPORT_PROJECT_NAME` not set → stopped and showed the `settings.local.json` line instead of guessing a name?
- [ ] `init` answered `project_not_found` → told the user and waited for their word before `create_project`? Answered `project_name_in_other_team` → showed `candidates` instead of creating a second project?
- [ ] Question about the project → has `search` been done?
- [ ] Starting work on a task → moved to IN_PROGRESS before the first write?
- [ ] New work → task created/updated?
- [ ] Work finished → task = DONE **with `resolution`**?
- [ ] Work that needs a check → `report` before REVIEW, the `review` written by someone other than the executor, DONE only after `approve`?
- [ ] Closing a task → did NOT call `log_progress` separately (it's auto-logged)?
- [ ] Interactive session, work from a later milestone → owner explicitly agreed to it?
- [ ] Milestone finished → `update_milestone` with `resolution` (and, if `is_release`, only after the release actually shipped)?
- [ ] Decision made → `sync_decision`?
- [ ] Important information → document created?
- [ ] A spec got its plan imported → its portion submitted with `arch_submit`? An epic merged into the main branch or a `code` portion submitted → `npx -y conport@^0.8.0 arch check` run (after `/conport:epic`, only when its `anchor_check` carries an `action`)? `init` returned `arch` → the action of each debt taken?
- [ ] After every write → response echo verified (tags / description / priority match intent)?
- [ ] Cross-references in write payload → all in canonical `<type>-<number>` form (no `#N`, no `decision #N`)?
- [ ] A problem of the service itself → showed the user the title and body and posted only after they agreed (a run with no person: the report in its summary, nothing posted), searched the open `[agent-report]` issues first, no project content, and told the user the URL — or gave the search and form links and said the report is not sent until they submit it?
- [ ] Deep topic (recipes / gaps / block model / tool params) → fetched the live-docs page before acting?

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
| Spec append-only invariant | `projects/spec-append-only` |
| Block-level document model | `projects/block-model` |
| Task hierarchy, the review cycle and the task journal | `projects/task-hierarchy` |
| Roadmap milestones | `projects/roadmap` |
| Full per-tool parameter reference | `projects/tool-reference` |
| Tool profiles — a connection that lists only some tool groups | `projects/tool-profiles` |
| The project model — portions, checks, views, debts | `projects/architecture-model` |

**Local references** (shipped with the skill): `references/command_list.md`
(full MCP tool API), `references/documentation_graph.md` (long-form callout
reference), `references/bootstrap.md` (fresh-project onboarding),
`references/backlog-discipline.md` (the backlog rules in full).
