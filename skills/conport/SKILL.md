---
name: conport
description: "Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start."
metadata:
  version: 19.0.1
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
- Tools that can run without a project take a `team` argument: `list_projects`,
  `search` without `project`, and the graph tools (`entities`, `entity`,
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
  `/conport:epic` dispatch. They run on the session's model and start no
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

### Context assembly, gaps, semantic pass

| Trigger | Tool |
|---------|------|
| "Open task #N and brief me" | `assemble_context` with `recipe='task_briefing'`, `start_id='task-N'` |
| "Implementation status of spec doc-N?" | `assemble_context` with `recipe='spec_implementation_status'`, `start_id='doc-N'` |
| "What recipes are available?" | `list_context_recipes` |
| "Current architecture of subsystem X?" | `render_current_architecture` with `scope=[...]` |
| "Is this architecture doc safe to archive?" | `audit_doc_l1_coverage(doc_id)` |
| Init response carries `questions` | ask the user, one at a time, then `answer_question` — see *Questions from init* |
| "Show the gaps" / "how healthy is the knowledge base?" | `gap_list` (open ones by default), `gap_stats` — read-only: the server resolves gaps itself |
| "Clean up the graph" | `semantic_cleanup` (one-click; runs in background — poll `semantic_pass_stats`) |
| Run the semantic pass | `semantic_pass_run` — it settles its own proposals by rule, none waits for review; `semantic_pass_stats` |

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
| "What diagrams does this project have?" | `list_diagrams` (id, title, scope, updated_at) — `list_documents` hides diagrams unless `doc_type='diagram'` is passed |

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
| `add_task_journal_entry` | `✅ {summary}` (carries the kind, the round and the verdict) |
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
| Task hierarchy, the review cycle and the task journal | `projects/task-hierarchy` |
| Roadmap milestones | `projects/roadmap` |
| Architecture diagrams | `projects/architecture-diagrams` |
| Full per-tool parameter reference | `projects/tool-reference` |
| Tool profiles — a connection that lists only some tool groups | `projects/tool-profiles` |

**Local references** (shipped with the skill): `references/command_list.md`
(full MCP tool API), `references/documentation_graph.md` (long-form callout
reference), `references/bootstrap.md` (fresh-project onboarding).
