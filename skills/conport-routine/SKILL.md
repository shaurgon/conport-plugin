---
name: conport-routine
description: "Use when running one iteration of a periodic ConPort backlog cycle (daily/weekly routine) - fetch the agenda, reconcile stale work, do housekeeping, execute ready tasks per the configured autonomy level, and file a run digest. Requires the conport skill for base tool discipline."
metadata:
  version: 15.25.0
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
| `get_agenda(project_id, ready_limit=10, delta_hours=24)` | One-call agenda: `woken_tasks`, `ready_top` (ranked by `effective_priority`, only unblocked & non-snoozed), `housekeeping` (`stale_in_progress`, `blocked_too_long`, `fresh_gaps`, `cleanup_hint`), `activity_delta`. Empty sections are omitted. |
| `get_routine_config(project_id)` | Policy: `enabled`, `cadence` (`daily`\|`weekly`), `max_tasks_per_run`, `priority_threshold`, `autonomy_level` (0\|1\|2), `selection` (`threshold`\|`tagged`). `is_default=true` means no config row exists — run on the returned defaults. |
| `set_routine_config(project_id, ...)` | Accept/change the policy, `selection` included. `enabled=false` switches the cycle off entirely. |
| `routine_run_start(project_id)` | Opens the run journal entry → `{id, started_at, already_open}`. |
| `routine_run_finish(project_id, run_id, outcome, summary, task_ids)` | Closes the run. `outcome`: `completed` \| `empty` \| `aborted`. Auto-creates the progress entry. |
| `list_routine_runs(project_id, limit=10)` | Recent runs, newest first — the run journal. An open (running or crashed) run has `finished_at: null` and no outcome. |
| `get_estimation_stats(project_id, limit=50)` | Plan/actual calibration stats — call before estimating: `sample_size`, `median_ratio`, p50/p90 actual seconds, `by_priority` breakdown, `recent` samples. |
| `list_tasks(..., ready=true, order="priority", offset=N)` | Deep priority-ordered slice of ready tasks when `ready_top` isn't enough. Accepts a `routine_eligible` filter (true — only marked tasks). |
| `update_task` → IN_PROGRESS | Sets a lease on the task (auto-returns to TODO if the lease expires). Close with `resolution=...` as usual. |
| `update_task(snooze_until=...)` | Defer a task until a date; empty string clears the snooze. |

**Relation to `init`.** The `init` response (conport skill) may include a
`routine_suggestion` — an offer to create a routine config for the project.
That suggestion is handled by the **conport** skill; this skill assumes the
decision was already made and simply runs the cycle against whatever
`get_routine_config` returns.

---

## AUTONOMY LEVELS

The config's `autonomy_level` caps what a run may do. Never act above the
configured level.

| Level | Name | What the run does |
|-------|------|-------------------|
| **0** | Report | Fetch the agenda, reconcile stale work, produce the digest. No changes beyond reconciliation. |
| **1** | Housekeep | Level 0 + housekeeping: gap triage, semantic cleanup, unblocking/snoozing stuck tasks. |
| **2** | Execute | Level 1 + actually executing ready tasks, up to `max_tasks_per_run`. |

---

## RUNBOOK — one iteration

### Phase 1: Start

1. `init` (per the conport skill) if not already done this session.
2. `get_routine_config(project_id)`.
   - `enabled=false` → **report that the routine is disabled and exit.** Do not
     start a run, do not touch the backlog.
   - `is_default=true` → proceed on the returned defaults (no config row is fine).
3. `routine_run_start(project_id)`.
   - `already_open=true` → the previous run never finished. **Deal with it
     first:** check what it left behind (stale IN_PROGRESS tasks from that run
     surface in Phase 2). If the run is dead — no live work attached — close it
     with `routine_run_finish(outcome='aborted')` and a one-line summary, then
     start your run.
4. `get_agenda(project_id)` — this single call feeds Phases 2–4.

### Phase 2: Reconcile (all autonomy levels)

Go through `housekeeping.stale_in_progress` from the agenda. For **each** stale
task decide explicitly:

- **Continue** — the work is genuinely still in flight → keep IN_PROGRESS
  (re-touching via `update_task` refreshes the lease).
- **Return** — nobody is working on it → `update_task` → TODO.
- **Close** — it's actually finished → `update_task` → DONE with `resolution`.

**Nothing is dropped silently.** Every stale task gets one of the three verdicts
and a mention in the digest.

**`woken_tasks`** need no separate handling — a woken task is simply back in
the general ready pool and competes on priority like any other. Mention the
wake-ups in the digest. One exception: when the snooze was set as "re-check X
by this date", the re-check itself **is** the task's work.

### Phase 3: Housekeeping (autonomy_level >= 1)

Skip this phase entirely at level 0.

- **`fresh_gaps`** — triage each one: `gap_ack` the meaningful ones (they become
  acknowledged work signals), `gap_dismiss` the noise **with a reason**.
- **`cleanup_hint`** — the graph accumulated enough drift → run
  `semantic_cleanup`.
- **`blocked_too_long`** — for each chronically blocked task pick one:
  **unblock** (the blocker is resolved → status back to TODO), **decompose**
  (split out the unblocked part as a new task), or **snooze with a concrete
  date** (`update_task(snooze_until=...)`) when the blocker has a known ETA.

### Phase 4: Execute (autonomy_level == 2 only)

Skip this phase entirely at levels 0–1.

- Candidate pool: `ready_top` from the agenda, filtered to
  `priority <= priority_threshold`. If the pool is thinner than
  `max_tasks_per_run`, you may extend it with
  `list_tasks(ready=true, order="priority", offset=N)` — same threshold filter.
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
  4. `update_task` → DONE with `resolution=...`. If it can't be finished this
     run — set BLOCKED with a note, or return to TODO; never leave it silently
     IN_PROGRESS.
- A task that turns out bigger than one run: stop, record where you got to in
  the task, return it to TODO (or BLOCKED), and count it in the digest as
  attempted-not-finished.
- A picked task that turns out to be a **body of work, not a leaf** — working it
  reveals it should be an epic: the iteration's work on that item **is the
  decomposition**. Promote it (`update_task` with `kind='epic'`), create its
  subtasks + dependencies, and **stop there**. Decomposition *completes* the run's
  work on that pool item — do not then also execute one of the new subtasks in
  the same run. Executing those subtasks belongs to *later* iterations: each run
  picks up one, competing on priority like any other ready task. (This keeps
  "one item per run" honest — a single item that fans out into an epic is still
  one taken item, not a licence to drain the whole new subtree.)

### Phase 5: Digest

1. `routine_run_finish(project_id, run_id, outcome, summary, task_ids)`:
   - `outcome='completed'` when anything was done (including reconcile-only or
     housekeeping-only runs); `outcome='empty'` per the empty-day protocol below.
   - `summary` — what was done, what's blocked and why, verdicts for stale
     tasks. Short and factual.
   - `task_ids` — every task the run touched.
2. **Do NOT call `log_progress` separately** — `routine_run_finish` creates the
   progress entry itself; a manual call would duplicate it.
3. If the run changed the project's focus (finished the current focus task,
   started a new front) → `update_active_context`.

---

## EMPTY-DAY PROTOCOL (hard rule)

When `ready_top` is empty **and** `housekeeping` is empty (or contains nothing
actionable at your autonomy level):

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

- **Chronic gaps** — review gaps that stayed acknowledged-but-unresolved across
  multiple runs; either turn them into tasks or dismiss with a reason.
- **Estimate vs actual** — call `get_estimation_stats(project_id)` and compare
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

- [ ] `get_routine_config` checked — and exited immediately if `enabled=false`?
- [ ] `routine_run_start` called — and an `already_open` run resolved first?
- [ ] Every `stale_in_progress` task got an explicit verdict (continue / return / close)?
- [ ] Housekeeping done only at autonomy >= 1; execution only at autonomy == 2?
- [ ] Executed at most `max_tasks_per_run` tasks, one at a time, each through IN_PROGRESS → verify → DONE with `resolution`?
- [ ] Empty agenda → `routine_run_finish(outcome='empty')` and exit, no invented work?
- [ ] `routine_run_finish` called exactly once — and no separate `log_progress` for the run?
- [ ] Weekly cadence → reflection block (chronic gaps, estimate/actual, BLOCKED review) included?
