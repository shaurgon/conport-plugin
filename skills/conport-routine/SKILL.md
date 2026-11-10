---
name: conport-routine
description: "Use when running one iteration of a periodic ConPort backlog cycle (daily/weekly routine) - fetch the agenda, reconcile stale work, do housekeeping, execute ready tasks per the configured autonomy level, and file a run digest. Requires the conport skill for base tool discipline."
metadata:
  version: 19.2.0
---

# ConPort Routine — Periodic Backlog Cycle

> **One invocation = one iteration.** Fetch the agenda, reconcile what's stale,
> clean up, execute what the policy allows, report, exit. The routine is
> policy-driven: the project's routine config decides how much you do — never
> exceed it, never invent work.

This skill is a parameterized runbook for a single run of a project's periodic
backlog cycle. Base ConPort discipline (init, IN_PROGRESS gate, resolution on
close, post-write verification, cross-reference grammar) comes from the
**conport** skill — it applies throughout; this skill only adds the cycle
structure on top.

(Live docs → `projects/routines` at **https://conport.app** — the reference form of this runbook and its server surface.)

### MCP Prefix

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

---

## SERVER SURFACE

| Tool | Purpose |
|------|---------|
| `get_agenda(project, ready_limit=10, delta_hours=24)` | One-call agenda: `roadmap` (current milestone with its epics, plus `next`), `epic_tails` (epics near closing, each with a prescribed `suggested_action`), `woken_tasks`, `ready_top` (ranked by `effective_priority`, only unblocked & non-snoozed; rows of the current milestone float up and every row carries `milestone_id`), `housekeeping` (`stale_in_progress`, `stale_review` — tasks in REVIEW untouched for over 24 hours, with `hours_in_review`: hours since the task in REVIEW was last touched (a journal entry or an edit) — `blocked_too_long`), `activity_delta`. Empty sections are omitted. |
| `list_milestones(project, include_closed=false)` | Roadmap view when the agenda's `roadmap` isn't enough — milestones by `sequence`, each with its epics, `ready_to_close` and the current marker. |
| `update_milestone(project, milestone_id, status=..., resolution=...)` | Close a finished milestone. Refused with `milestone_not_ready` while any of its epics is open. |
| `get_routine_config(project)` | Policy: `enabled`, `cadence` (`daily`\|`weekly`), `max_tasks_per_run`, `priority_threshold`, `autonomy_level` (0\|1\|2), `selection` (`threshold`\|`tagged`). `is_default=true` means no config row exists — run on the returned defaults. |
| `set_routine_config(project, ...)` | Accept/change the policy, `selection` included. `enabled=false` switches the cycle off entirely. |
| `routine_run_start(project)` | Opens the run journal entry → `{id, started_at, already_open}`. |
| `routine_run_finish(project, run_id, outcome, summary, task_ids)` | Closes the run. `outcome`: `completed` \| `empty` \| `aborted`. Auto-creates the progress entry. |
| `list_routine_runs(project, limit=10)` | Recent runs, newest first — the run journal. An open (running or crashed) run has `finished_at: null` and no outcome. |
| `get_estimation_stats(project, limit=50)` | Plan/actual calibration stats — call before estimating: `sample_size`, `median_ratio`, p50/p90 actual seconds, `by_priority` breakdown, `recent` samples. |
| `list_tasks(..., ready=true, order="priority", offset=N)` | Deep priority-ordered slice of ready tasks when `ready_top` isn't enough. Accepts a `routine_eligible` filter (true — only marked tasks). |
| `update_task` → IN_PROGRESS | Sets a lease on the task (auto-returns to TODO if the lease expires). Close with `resolution=...` as usual. |
| `add_task_journal_entry(project, task_id, kind, body, author=None, verdict=None)` | One entry in the task's journal: `report` (the work done), `review` (the reviewer's verdict, `approve` or `changes_requested`), `fix` (the report on the fixes), `brief` (an assignment). The server stamps the round. The entry moves the task: a `report` takes it to REVIEW (a TODO or BLOCKED task is started first), a `fix` back to REVIEW, `changes_requested` back to IN_PROGRESS for the next round — no `update_task` around it. `author` is the role or name of who wrote the entry, by default the role of the kind (`implementer`, `reviewer`, `orchestrator`): the implementer and the reviewer sign with different names, and a `review` signed like a `report` or `fix` of the same round is refused with `reviewer_is_author`. |
| `list_task_journal(project, task_id, round=None, include_body=false)` | The task's journal, oldest first — the reviewer reads the round's `brief` and `report` with `include_body=true`; a page carries `next_offset` while entries remain. |
| `get_task_journal_entry(project, task_id, kind=...)` | The latest entry of a kind with its text — the brief to work from, the report to review (or one entry by `entry_id`). |
| A task in REVIEW | Leaves it only to DONE (approved, `update_task` with `resolution`), IN_PROGRESS (a `review` with `changes_requested` does it) or CANCELLED. |
| `update_task(snooze_until=...)` | Defer a task until a date; empty string clears the snooze. |

**Relation to `init`.** The `init` response (conport skill) may include a
`routine_suggestion` — an offer to create a routine config for the project.
That suggestion is handled by the **conport** skill; this skill assumes the
decision was already made and simply runs the cycle against whatever
`get_routine_config` returns.

**Gaps are not the run's.** The server resolves knowledge-base gaps and
semantic-pass proposals itself, in a daily pass over every project. What only a
person can decide is asked as a question in an interactive session's `init` — a
run has nobody to ask, so it calls `init(questions=false)` and triages no gaps.

---

## TEAM CONTEXT

A run authenticates as its user and works in the team of its project. One API
key of the user reaches every team the user is a member of; the MCP address is
the same for all of them. See *TEAMS* in the **conport** skill.

- **One key of the user runs the routine.** A scheduled run authenticates with
  one of the user's own named keys (dashboard or `POST /api/v1/me/api-keys`).
  Name the key after the routine, so it can be revoked on its own.
- **The project is set by `CONPORT_PROJECT_NAME`, team ID included.** A team's
  project is `k7m2qx9d/<project>`; a bare `<project>` is a project of the
  user's own `Private Team`. A run without the variable does not start.
- **A run never changes team.** It does not look the project up under another
  name, does not create projects, does not create or administer teams (there
  are no MCP tools for that), and does not move projects.
- **Stop conditions.** `init` or any later call is refused with
  `project_not_found`, `project_name_in_other_team`, `team_not_found` or an
  authentication error: the project was moved to another team or deleted, the
  user left the team, or the key was revoked. **Stop:** do not call
  `create_project`, do not start or finish a run, and report the refusal as it
  came — for `project_name_in_other_team` together with its `candidates`, so the
  user can put the right name into `CONPORT_PROJECT_NAME`.

---

## AUTONOMY LEVELS

The config's `autonomy_level` caps what a run may do. Never act above the
configured level.

| Level | Name | What the run does |
|-------|------|-------------------|
| **0** | Report | Fetch the agenda, reconcile stale work, produce the digest. No changes beyond reconciliation. |
| **1** | Housekeep | Level 0 + housekeeping: weekly graph cleanup, unblocking/snoozing stuck tasks. |
| **2** | Execute | Level 1 + actually executing ready tasks, up to `max_tasks_per_run`. |

---

## RUNBOOK — one iteration

### Phase 1: Start

1. `init(questions=false)` (per the conport skill) if not already done this session — a run has no person to answer questions.
2. `get_routine_config(project)`.
   - `enabled=false` → **report that the routine is disabled and exit.** Do not
     start a run, do not touch the backlog.
   - `is_default=true` → proceed on the returned defaults (no config row is fine).
3. `routine_run_start(project)`.
   - `already_open=true` → the previous run never finished. **Deal with it
     first:** check what it left behind (stale IN_PROGRESS tasks from that run
     surface in Phase 2). If the run is dead — no live work attached — close it
     with `routine_run_finish(outcome='aborted')` and a one-line summary, then
     start your run.
4. `get_agenda(project)` — this single call feeds Phases 2–4.

### Phase 2: Reconcile (all autonomy levels)

Go through `housekeeping.stale_in_progress` from the agenda. For **each** stale
task decide explicitly:

- **Continue** — the work is genuinely still in flight → keep IN_PROGRESS
  (re-touching via `update_task` refreshes the lease).
- **Return** — nobody is working on it → `update_task` → TODO.
- **Close** — it's actually finished → `update_task` → DONE with `resolution`.

**Nothing is dropped silently.** Every stale task gets one of the three verdicts
and a mention in the digest.

**Tasks waiting in REVIEW** (`housekeeping.stale_review` lists the ones
nobody touched for over 24 hours; `init` lists the ones not snoozed in `review_tasks`) are
not stale work to return: they wait for a reviewer. At autonomy 2
they are reviewed in Phase 4 before any new work, and each review counts
against `max_tasks_per_run` as one taken item, the same way epic tails do;
below that, name them in the digest. Never move one to TODO or BLOCKED — the server refuses it
(`review_exit_not_allowed`); the only ways out are the review itself or a
cancellation with a resolution.

**`woken_tasks`** need no separate handling — a woken task is simply back in
the general ready pool and competes on priority like any other. Mention the
wake-ups in the digest. One exception: when the snooze was set as "re-check X
by this date", the re-check itself **is** the task's work.

### Phase 3: Housekeeping (autonomy_level >= 1)

Skip this phase entirely at level 0.

- **Graph cleanup** (weekly cadence) — start `semantic_cleanup(project,
  dry_run=false)` once per weekly run: it runs the semantic pass and settles
  every proposal by rule, so nothing is left to review. It returns at once and
  runs in the background; do not wait for it. A `rate_limited` answer means a
  cleanup ran recently — skip it and name it in the digest.
- **`blocked_too_long`** — for each chronically blocked task pick one:
  **unblock** (the blocker is resolved → status back to TODO), **decompose**
  (split out the unblocked part as a new task), or **snooze with a concrete
  date** (`update_task(snooze_until=...)`) when the blocker has a known ETA.

### Phase 4: Execute (autonomy_level == 2 only)

Skip this phase entirely at levels 0–1.

**Finish tails before starting anything new.** Work `epic_tails` from the
agenda first, in the order returned, and only then move on to `ready_top` — an
epic one task away from closing is worth more than a fresh start, and the
roadmap only advances when epics actually close.

- For each tail, do what its `suggested_action` prescribes: `closable=true` →
  `update_task` → DONE with `resolution` on the epic itself; otherwise finish
  its `open_tasks` (each through the normal IN_PROGRESS → verify → DONE cycle;
  a child in REVIEW is reviewed, as in the review step below, not worked
  again), then close the epic.
- Tails count against `max_tasks_per_run` like any other taken item, and so
  does each review of a task waiting in REVIEW. When the limit runs out inside
  a tail or the reviews, stop there and name what remains in the digest —
  don't start `ready_top` work on top of it.
- Closing the last epic of a milestone makes it `ready_to_close`
  (`roadmap.current.ready_to_close`). Close a non-release milestone with
  `update_milestone(status='DONE', resolution=...)`. A **release** milestone
  (`is_release=true`) is not the run's to close — a release closes after the
  release actually shipped, which is the owner's call; report it in the digest
  instead.

Then the ready pool:

- Candidate pool: `ready_top` from the agenda, filtered to
  `priority <= priority_threshold`. If the pool is thinner than
  `max_tasks_per_run`, you may extend it with
  `list_tasks(ready=true, order="priority", offset=N)` — same threshold filter.
- **Stay on the current milestone — but don't starve on it.** The server
  already floats its rows to the top of `ready_top`, and every row carries
  `milestone_id`. Two cases, decided by that field alone:
  - `milestone_id` of a **later** milestone → leave the row and name it in the
    digest. Pulling work forward off the roadmap is the owner's decision, not
    the run's.
  - `milestone_id: null` (attached to no milestone) → **legitimate work for the
    run.** Most projects keep a large unattached pool; skipping it would leave
    the cycle idle in the name of a roadmap the row isn't on. Take it on
    priority like any other ready row and name its epic in the digest, so the
    owner can attach it to the roadmap if it belongs there.

  This overrides the conport skill's "ask the owner" phrasing for
  unattached work — a run has no owner to ask, and the roadmap governs the
  order of milestones, not the right to touch anything outside them.
- **Selection mode.** With `selection='tagged'` in the config, only tasks
  explicitly marked `routine_eligible=true` may be executed. `ready_top` is
  already filtered by the server in this mode; when extending the pool, add
  `routine_eligible=true` to the `list_tasks` call. The priority threshold
  applies in **both** modes. Two semantics to keep straight:
  - Eligibility gates **presence, not ranking**: a marked epic's
    `effective_priority` and `subtask_count` still roll up from ALL of its
    active children, including unmarked ones.
  - Mark the exact row the agent may pick up: an unmarked epic is excluded
    even if its children are marked (and children of an active epic are
    hidden behind it anyway) — when the whole epic is agent-executable,
    mark the epic itself.
- Marking is a triage act, not a run act: mark tasks for autonomous execution
  when creating or triaging them (`update_task` with `routine_eligible=true`).
  Never down-prioritize a task or park it behind a permanent snooze just to
  keep it away from the agent — importance and agent-executability are
  separate dimensions.
- Take at most **`max_tasks_per_run`** tasks, **one at a time** (no parallel
  claims). The limit counts **pool items you take**, not tasks you close — a
  taken item that ends in decomposition (below) still counts as one:
  1. `update_task` → IN_PROGRESS (the gate; also takes the lease).
  2. Do the work.
  3. Verify the result (run the matching validation before claiming done).
  4. **Review** — when the task needs a check, and always when its journal
     has a `report`, `fix` or `review` entry (the server then refuses a direct
     DONE with `done_needs_review`):
     - `add_task_journal_entry(kind='report')` with what was done and how it
       was verified — the entry moves the task to REVIEW.
     - A **separate** reviewer — another agent given only the task, its brief
       and the report, never the run that did the work — reads the round
       (`list_task_journal(include_body=true)`) and writes
       `add_task_journal_entry(kind='review', verdict=...)` under its own
       `author`, never the name the round's report or fix was signed with.
     - `approve` → step 5. `changes_requested` → the entry has returned the
       task to IN_PROGRESS (the next round): fix, then
       `add_task_journal_entry(kind='fix')`, which moves it to REVIEW again, and
       the reviewer looks once more.
     - No separate reviewer can run → leave the task in REVIEW and name it in
       the digest; a later run or the owner reviews it. A fix that does not fit
       this run → the `changes_requested` review has already returned the task to
       IN_PROGRESS; move it to TODO with a note.
  5. `update_task` → DONE with `resolution=...`. If it can't be finished this
     run — set BLOCKED with a note, or return to TODO; never leave it silently
     IN_PROGRESS.
- A task that turns out bigger than one run: stop, record where you got to in
  the task, return it to TODO (or BLOCKED), and count it in the digest as
  attempted-not-finished.
- A picked task that turns out to be a **body of work, not a leaf** — working it
  reveals it should be an epic: the iteration's work on that item **is the
  decomposition**. Promote it (`update_task` with `kind='epic'`), create its
  subtasks (`add_task`) and their dependencies (`add_task_dep`), and **stop
  there**. Decomposition *completes* the run's work on that pool item — do not
  then also execute one of the new subtasks in
  the same run. Executing those subtasks belongs to *later* iterations: each run
  picks up one, competing on priority like any other ready task. (This keeps
  "one item per run" honest — a single item that fans out into an epic is still
  one taken item, not a licence to drain the whole new subtree.)

### Phase 5: Digest

1. `routine_run_finish(project, run_id, outcome, summary, task_ids)`:
   - `outcome='completed'` when anything was done (including reconcile-only or
     housekeeping-only runs); `outcome='empty'` per the empty-day protocol below.
   - `summary` — what was done, what's blocked and why, verdicts for stale
     tasks. Short and factual. Open it with the **current milestone** from the
     agenda's `roadmap` (`milestone-{id} «{title}»`, plus `ready to close` or
     the tails still standing between it and the close) so every digest says
     where the roadmap stands. No `roadmap` section → say the project has no
     open milestone.
   - `task_ids` — every task the run touched.
2. **Do NOT call `log_progress` separately** — `routine_run_finish` creates the
   progress entry itself; a manual call would duplicate it.
3. If the run changed the project's focus (finished the current focus task,
   started a new front) → `update_active_context`.

---

## EMPTY-DAY PROTOCOL (hard rule)

When `epic_tails` and `ready_top` are empty **and** `housekeeping` is empty (or
none of them contains anything actionable at your autonomy level):

1. `routine_run_finish(outcome='empty')` with a one-line summary
   ("nothing ready, no housekeeping").
2. **Exit.**

Explicitly forbidden on an empty day:

- **Do not invent work.** No "while I'm here" refactors, doc polishing, or
  speculative tasks.
- **Do not "improve" the backlog on your own initiative.** No re-prioritizing,
  re-tagging, or re-writing task descriptions nobody asked for.
- **Do not expand scope.** An empty agenda is a valid, healthy outcome — the
  correct result is a truthful `empty` record, not manufactured activity.

---

## WEEKLY REFLECTION (cadence = weekly)

A weekly run is the **same runbook** plus one extra reflection block between
Phase 4 and the digest:

- **Estimate vs actual** — call `get_estimation_stats(project)` and compare
  `estimated_seconds` against actual durations on tasks closed this week; note
  systematic drift (`median_ratio` far from 1) in the digest so future
  estimates calibrate.
- **BLOCKED review** — walk every BLOCKED task (not just `blocked_too_long`):
  is the blocker still real? Unblock, decompose, snooze with a date, or cancel
  with a resolution.

Fold the reflection findings into the same `routine_run_finish` summary — no
separate report entity.

---

## CHECKLIST

- [ ] The run reached the project in its own team — and stopped, instead of working in a new empty project, when it did not?
- [ ] `get_routine_config` checked — and exited immediately if `enabled=false`?
- [ ] `routine_run_start` called — and an `already_open` run resolved first?
- [ ] Every `stale_in_progress` task got an explicit verdict (continue / return / close)?
- [ ] Housekeeping done only at autonomy >= 1; execution only at autonomy == 2?
- [ ] Execute phase worked `epic_tails` first (closable epics closed with `resolution`), and only then `ready_top`?
- [ ] Executed at most `max_tasks_per_run` tasks, one at a time, each through IN_PROGRESS → verify → DONE with `resolution`?
- [ ] A task that needed a check went through `report` → REVIEW → a `review` by a separate reviewer — and tasks waiting in REVIEW were reviewed or named in the digest, never moved back to TODO or BLOCKED?
- [ ] Digest names the current milestone — and a release milestone was left for the owner to close?
- [ ] Empty agenda → `routine_run_finish(outcome='empty')` and exit, no invented work?
- [ ] `routine_run_finish` called exactly once — and no separate `log_progress` for the run?
- [ ] `init` called with `questions=false`, and no gap triaged — the server resolves gaps itself?
- [ ] Weekly cadence → reflection block (estimate/actual, BLOCKED review) included?
