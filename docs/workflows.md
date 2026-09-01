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
- Passing prechecks — the run aborts before any work is dispatched unless all of
  these hold: the working tree is clean and on the default branch, the task is
  not already closed (DONE or CANCELLED), and the baseline is green (the gate
  passes on the untouched default branch).

### Arguments

| Argument | Type | Required | Meaning |
|---|---|---|---|
| `task` | integer | yes | Id of the ConPort task to execute. |
| `project` | string | no | ConPort project name. Omitted → derived from `CONPORT_PROJECT_NAME`, the git remote, or the directory name. |
| `plan` | string | no | Path to the plan file holding the task's section. Omitted → the plan is looked up by the task's anchor comment, but only across `docs/superpowers/plans/*.md` — if your plans live anywhere else, `plan` is effectively required. |
| `gate` | object | no | `{dir, commands}` — the directory to run in and the list of gate commands. Omitted → taken from the plan's Global Constraints. |
| `serialChecks` | boolean | no | Worktree agents run static checks only — all tests are deferred to the merge gate, which runs alone. For projects whose gate shares one test database. |
| `fileMinors` | boolean | no | Leftover minors (rare — minors are normally fixed in the run) are collected into ONE umbrella task under the "Workflow run tails" epic. Off by default: leftovers travel only in the run ledger. |

Example:

```
/conport:task {"task": 1234, "gate": {"dir": "backend", "commands": ["uv run pytest -q", "uv run mypy", "uv run ruff check"]}}
```

### Behavior

- **Minor review findings are fixed in the same run.** The fix round applies
  every finding, minors included. A minor still open after the round does not
  block the merge — it travels in the run ledger; no task is ever created for it
  unless you pass `fileMinors`, and then all leftovers become ONE umbrella task
  under a tails epic, never scattered root tasks.
- **An epic id is rejected.** An epic is not a unit of execution; use
  `/conport:epic`.
- **A task with neither an acceptance criterion nor a plan slice is rejected.**
  Give it a criterion first — a run without one cannot tell done from plausible.
- **A failed run leaves the task BLOCKED, not half-done.** When the
  implementation dead-ends, the review rejects the fix, or the merge gate stays
  red, the ConPort task is set to BLOCKED and a `## Blocked: <reason>` section
  is appended to its description — the original text is kept, so the reason is
  visible next time someone picks the task up.
- **Nothing is ever pushed.** Merges are local, on your default branch.

### Resuming an interrupted run

If a run is interrupted, start it again with `resumeFromRunId` set to the id of
the interrupted run: agents that already finished replay from cache instead of
being re-executed, so the run picks up where it stopped.

`resumeFromRunId` is an option of the Workflow tool that runs the script — not
a workflow argument, so it cannot go inside the `/conport:task {...}` JSON. The
interrupted run's result names both the run id and the saved script path; the
resume call passes them alongside the original arguments:

```
Workflow({
  scriptPath: "<script path from the interrupted run's result>",
  args: {"task": 1234},
  resumeFromRunId: "<run id from the interrupted run's result>"
})
```

In practice: ask Claude to "resume workflow run <run id>" and it issues this
call with the same arguments as the original run.

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

- **Findings never grow the running epic — or your backlog.** There is no code
  path that adds a discovered issue to the epic being executed. Review minors
  are fixed in the same run; leftovers travel in the run ledger only. Confirmed
  criticals get one capped fix round; unresolved criticals and escalations are
  the only findings that always become tasks (priority 1, in a separate tails
  epic). Pass `fileMinors` to also collect leftover minors into ONE umbrella
  child there.
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
| `fileMinors` | boolean | no | As in `/conport:task`: leftover minors become ONE umbrella child of the tails epic instead of staying ledger-only. |

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

## Mechanics are code, meaning is the model

Every mechanical step of a run — the git checks before it starts, the project
gate, the merge batch, the cleanup of branches and worktrees, the write-back to
ConPort, the scout's raw material — is executed by one command of the bundled
`wf-helper` CLI, which the plugin ships next to the workflows. Whatever the run
comes to, the command prints exactly one JSON object and exits 0: a red gate, a
conflict or a refusal is data, not a crashed process. (Only a malformed
invocation is different — it exits 2 with a usage line on stderr and prints no
JSON at all.) The workflow returns that JSON verbatim, so the same input
always produces the same result and nothing about the outcome depends on how an
agent phrased it.

What is left for a model is what only a model can do: reading a plan and a spec,
judging a change, hunting for gaps, deciding whether the goal was reached.

### The helper's commands

| Command | What it does |
|---|---|
| `preflight` | State of the repository before a run: clean or dirty tree, current branch, the default branch, the head commit. Debris of an interrupted merge is aborted first. |
| `gate` | Runs the gate commands in the gate directory and reports GREEN, or RED with the tail of the first failing command. |
| `merge` | Merges the queued branches one at a time, the full gate after each; a conflict or a red gate aborts that merge cleanly and the batch reports it per branch. |
| `cleanup` | Deletes the merged branches and removes the run's worktrees; anything not merged is kept for forensics. |
| `account` | Writes the run's outcome back to ConPort: closes done tasks with their resolutions, blocks failures, files deferred findings, logs the run summary, closes the epic when the run says it may. Every item is guarded by a read, so re-running the same table changes nothing. |
| `scout` | Collects the raw material of one task: the task itself, its slice of the plan, the files it names, the Global Constraints, the gate object and the spec reference. It compresses and judges nothing. |
| `--version` | The plugin version the helper shipped with, as `{"version": "..."}` (`null` when the manifest next to it is unreadable). |

### The version handshake

A helper served from a stale plugin cache is indistinguishable from a broken
one by its behavior alone, so the helper reports its own version: `--version`
prints it, and every `preflight` report carries it as `helper_version` — the
run ledger records the stamp in its notes, `unknown` meaning a helper old
enough to predate it — or one whose manifest is unreadable (a torn cache
entry). **A run that aborts at preflight, or a helper whose
output looks wrong → the first step is the version: run
`node <helper> --version`, and when it does not match the installed plugin,
update the plugin and rerun.** A helper old enough to predate the handshake
does not know the flag at all: it prints the one-line usage of its own
subcommands on stderr, exits 2 and prints no JSON — that is not a crash, it is
the answer, and the plainest possible "this helper is stale".

### Environment

The helper needs Node 18 or newer — it calls the global `fetch`, which older
runtimes do not have.

- `CONPORT_API_KEY` — a ConPort API key. With it, `account` and `scout` talk to
  ConPort over REST. Without it, the run does the same steps through the ConPort
  MCP tools instead; the behavior is identical, only slower. An installed plugin
  needs nothing here: the key configured for the plugin reaches the helper as
  `CLAUDE_PLUGIN_OPTION_API_KEY`, which is read exactly like `CONPORT_API_KEY`.
- `CONPORT_API_URL` — the API base, for a self-hosted ConPort. Include the
  `/api/v1` suffix, as in `https://api.conport.app/api/v1`. Defaults to the
  hosted API.
- `CONPORT_PROJECT_NAME` — the project `scout` reads when the call carries no
  `--project` flag. Without either, `scout` hands the work back.
- `CONPORT_TIMEOUT_MS` — the deadline of a single REST call, 10000 by default. A
  silent server ends the call with an error the run falls back on, never a hang.

### Permissions

To a permission system every helper call is one opaque command — `node
<helper> merge ...` — and nothing in its text says which commands touch the
repository: `preflight` aborts leftover merge debris, `merge` rewrites
branches, `gate` runs whatever commands the project configured, and `account`
writes back over the ConPort REST API. In auto mode the classifier judges the
command by what it can see, so it may refuse the mutating commands (`merge`,
`cleanup`, `gate`, `account`) to a run's agents even where it would pass the
same git steps written out one by one — and `gate` and `account` have no
bare-git equivalent to compare against at all. The fix is an explicit allow
rule: a command matched by one runs without a prompt. Add it to
`permissions.allow` in your settings — the project's `.claude/settings.json`,
your machine-local `.claude/settings.local.json` (the right home for a broad
rule: the committed project file applies to every collaborator), or your user
settings:

```json
{
  "permissions": {
    "allow": [
      "Bash(node */wf-helper.mjs *)"
    ]
  }
}
```

A `*` in a Bash rule matches any text, so this one rule covers the helper
wherever it is found — the repository checkout and the installed plugin's
cache directory alike. The trade-off is breadth, and it is wider than "any
script named `wf-helper.mjs`": the wildcard sits between `node` and the path,
so `node --eval "<anything>" x/wf-helper.mjs y` and
`node --require ./evil.js x/wf-helper.mjs run` match the rule too and are
auto-approved with no prompt — arbitrary code execution, which is exactly
what Claude Code's startup warning about a wildcard before the script path is
pointing at. The rule still applies despite the warning; where that breadth is
unacceptable, spell out the absolute path of the installed helper instead — at
the cost of re-pinning it on every plugin update, since the cache path carries
the version:

```json
{
  "permissions": {
    "allow": [
      "Bash(node /absolute/path/to/wf-helper.mjs *)"
    ]
  }
}
```

Keep the trailing ` *`: every call carries a subcommand and flags, so an exact
command rule without it matches nothing.

Without the rule, a refusal destroys nothing — but it is not reported as a
refusal either. Every per-branch status a run is *meant* to record, `NOT_MERGED`
and its `gate_tail` included, comes from a helper that ran; a refusal means the
helper never ran, so by design there is nothing to report. What the run does
then is this: the merge step's answer fails its schema, the run asks once for
the merge state and that call is refused as well, no result survives, and the
task ends as `UNKNOWN_MERGE` — in a task run the ConPort task is set BLOCKED
with a reason that never mentions permissions; in an epic run the task is
neither closed nor blocked, it stays `UNKNOWN_MERGE` in the ledger and later
tasks that depend on it are skipped. A refused cleanup produces no report at
all, so nothing reaches an `errors` list, and the two leftovers it should have
handled are not the same kind of thing. Unmerged branches staying on disk is
the policy — cleanup only ever deletes the merged ones, and forensics lives in
the branch. Worktrees are not kept: the janitor is handed every worktree the
run made regardless of outcome, so a worktree still on disk is debris the run
meant to remove and you have to remove by hand. Leaving it there keeps its
branch checked out and will trip the next run's branch operations. Nothing is
left half-merged either way: a merge that never started changed nothing.

The one thing that can be worse than the refusal is the agent papering over it.
In one observed run the agent that was refused summarised the refusal itself in
a schema-valid report, `NOT_MERGED` with the refusal text in `gate_tail`. That
reads like the kinder outcome and is not: `NOT_MERGED` has no arm in the
outcome dispatch, so a run that accepts one records *less* than a run that got
nothing. In a task run the outcome is never set and ends as `UNKNOWN`, and
because the accounting table closes the ConPort task only on `MERGED` and
blocks it only on `FAILED`, the task is left untouched — where the fully
refused path at least blocks it. In an epic run the merge results are applied
the same way, so the row keeps its `APPROVED` state, skip propagation does not
treat `APPROVED` as bad, dependants are dispatched onto a base that never got
the merge, and the row shows up in none of the done, failed or skipped lists.
Treat a `NOT_MERGED` you did not expect as agent behaviour on the day, not as
an outcome the run understands. Add the rule, then rerun or resume the
workflow.

### When the helper hands the work back

The rule is not a list of messages, it is a shape. The agent discards the
output and takes the fallback branch — the same steps through the MCP tools —
whenever the helper prints either of these:

- **any JSON object carrying an `error` key.** The fixed
  `{"error": "no api key"}` (no key in the environment),
  `{"error": "no project"}` (no project named and none in the environment) and
  `{"error": "unsupported table"}` (the write-back table is not a shape this
  command knows, so it is refused whole — half an accounting run is worse than
  none) are the ones a run meets most often, but a scrubbed API failure comes
  back the same way, in an `error` key with the reason inside. The agent reads
  the key, not the text.
- **anything on stdout that is not a JSON object** — empty output, a crash
  trace, a bare string. The helper did not run as expected, so nothing it
  printed is treated as an answer.
