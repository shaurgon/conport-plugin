# Workflows

Workflows are deterministic, scripted runs: a fixed sequence of phases where each
step is executed by a fresh subagent whose answer must match a schema. The plugin
ships them under `workflows/` and Claude Code exposes them as slash commands.

## `/conport:task`

Deterministic execution of one ConPort task, end to end:

1. implement it in an isolated worktree,
2. review it with an independent agent,
3. one round of fixes if the review found anything serious,
4. merge behind the full project gate,
5. close the task in ConPort with a resolution.

Nothing is ever pushed — every merge stays local, so you review the result before
it leaves the machine.

### Requirements

- A paid plan — workflows run on the Workflow tool, and the harness setting
  `disableWorkflows` turns them off.
- A resolvable ConPort project: pass `project`, or let the run derive it from
  `CONPORT_PROJECT_NAME`, the git remote, or the working directory name.
- A gate — the commands that must be green before a merge. Pass it as `gate`, or
  let the run read it from the Global Constraints section of the plan that
  carries the task.

### Arguments

| Argument | Type | Required | Meaning |
|---|---|---|---|
| `task` | integer | yes | Id of the ConPort task to execute. |
| `project` | string | no | ConPort project name. Omitted → derived from `CONPORT_PROJECT_NAME`, the git remote, or the directory name. |
| `plan` | string | no | Path to the plan file holding the task's section. Omitted → the plan is looked up by the task's anchor. |
| `gate` | object | no | `{dir, commands}` — the directory to run in and the list of gate commands. Omitted → taken from the plan's Global Constraints. |
| `serialChecks` | boolean | no | Worktree agents run static checks only — all tests are deferred to the merge gate, which runs alone. For projects whose gate shares one test database. |

Example:

```
/conport:task {"task": 1234, "gate": {"dir": "backend", "commands": ["uv run pytest -q", "uv run mypy", "uv run ruff check"]}}
```

### Behavior

- **Minor review findings become tasks, not silence.** Each MINOR the reviewer
  raised is created as a root TODO task with priority 4, deduplicated by title,
  so nothing is lost and nothing blocks the merge.
- **An epic id is rejected.** An epic is not a unit of execution; use
  `/conport:epic`.
- **A task with neither an acceptance criterion nor a plan slice is rejected.**
  Give it a criterion first — a run without one cannot tell done from plausible.
- **Nothing is ever pushed.** Merges are local, on your default branch.

### Resuming an interrupted run

If a run is interrupted, start it again with `resumeFromRunId` set to the id of
the interrupted run: agents that already finished replay from cache instead of
being re-executed, so the run picks up where it stopped.

## `/conport:epic`

Deterministic execution of one ConPort epic from its plan, start to closure:

1. scout the plan, the spec and the epic's ConPort children into one manifest,
2. restore plan↔ConPort parity (plan tasks missing a child get one — before any
   execution, never during),
3. lay the tasks into waves of file-disjoint work (up to five in parallel), each
   implemented in its own worktree and reviewed by an independent agent, with one
   fix round per task,
4. merge the approved branches strictly one at a time, the full gate after every
   merge — a red gate aborts that merge cleanly and fails the task,
5. run ONE gap-hunt pass over the whole change, verify every finding
   adversarially, fix at most five confirmed criticals in one round,
6. accept the GOAL by observation — not by counting closed tasks,
7. write everything back to ConPort: done tasks closed with resolutions, failures
   marked BLOCKED with reasons, deferred findings collected into a separate
   "Tails" epic, and the epic itself closed only when nothing is left open AND
   the acceptance verdict is READY.

### Anti-sprawl guarantees

- **Findings never grow the running epic.** There is no code path that adds a
  discovered issue to the epic being executed: minors and unverified findings go
  to a separate tails epic, confirmed criticals get one capped fix round in the
  same run, and anything beyond the cap is escalated to you.
- **Every counter is a literal in the script**, not an agent's judgment: one fix
  round plus one re-review per task, one rebase per merge conflict, one hunt
  pass, one critical-fix round.
- **The epic closes behind a double lock**: zero open children in ConPort AND an
  acceptance verdict reached by observation.

### Arguments

| Argument | Type | Required | Meaning |
|---|---|---|---|
| `epic` | integer | yes | Id of the ConPort epic to execute. |
| `plan` | string | no | Path to the plan file. Omitted → looked up by the epic's anchor under `docs/superpowers/plans/`. |
| `project` | string | no | ConPort project name. Omitted → derived as in `/conport:task`. |
| `gate` | object | no | `{dir, commands}` — as in `/conport:task`. |
| `allowNoPlan` | boolean | no | Without a plan file the run aborts. Set this to execute the epic's ConPort children from their own descriptions instead — strictly sequentially. |
| `serialChecks` | boolean | no | As in `/conport:task`. |

### Failure behavior

- No plan found and no `allowNoPlan` → the run aborts with a report; running
  without a plan is an explicit choice, never a fallback.
- An epic child with no plan section is reported by name and NOT executed — the
  epic stays open until you decide what it is.
- A dirty tree, a wrong branch, an unresolved gate or a red baseline abort the
  run before any work is dispatched.
- Nothing is ever pushed; every merge is local.

### Resuming

Same as `/conport:task`: relaunch with `resumeFromRunId` — finished agents
replay from cache, side effects are idempotent, and a full restart without the
cache is also safe (already-merged branches and already-closed tasks are
detected, not redone).
