# Workflows

Workflows are deterministic, scripted runs: a fixed sequence of phases where each
step is executed by a fresh subagent whose answer must match a schema. The plugin
ships them under `workflows/` and Claude Code exposes them as slash commands.

## The agents

The judgement steps of a run are dispatched as the plugin's own agent types,
which it ships under `agents/` and Claude Code lists under the plugin's name:

| Agent type | Dispatched for | Can edit files |
|---|---|---|
| `conport:sdd-implementer` | every implementation, and the fix of a confirmed critical gap | yes |
| `conport:sdd-task-reviewer` | every review, re-review and review after a rebase, and the review of a gap fix | no |
| `conport:sdd-fixer` | the fix round after a review | yes |
| `conport:sdd-gap-hunter` | the gap hunt of an epic run | no |
| `conport:sdd-final-reviewer` | the final review of a whole epic branch against its spec, in the dispatcher run of the `conport` CLI | no |

Each carries the standing procedure of its role — read the brief first, test
first, the checks before the commit, never `git stash`, no subagents of its
own (the Agent tool is denied to all five) — while the run's prompt supplies
the task and decides where the dispatch is more specific: which checks to run,
the branch to create, the structured answer to return. None of them pins a
model: they run on the model of your session. The other steps — the scout, the
helper's mechanical steps, the rebase, the verification of the hunter's
findings, the acceptance and the accounting — run as general agents.

A type Claude Code does not know — the plugin's agents did not load, or the
plugin is installed under another name — does not stop the run. The dispatch
of that type is refused, the run sends the same prompt once to a general agent
instead, and every later dispatch of that type goes to a general agent
straight away; such a dispatch shows in the run's progress under the step's
label with `-untyped` appended (`impl-untyped`). The ledger notes it once per type:
`agent type missing: conport:sdd-implementer — dispatched untyped`. The step
then works from the run's prompt alone, without the standing procedure of its
role. Any other refusal of a typed dispatch — a permission rule that denies
the type, for one — is not caught and stops the run as before.

The same types serve subagent-driven development by hand: dispatch them
with a brief and a report path, or with a ConPort task whose journal holds the
brief. They serve the dispatcher run of the `conport` CLI (`conport epic run`)
as well: there an agent of any kind works the task journal through the ConPort
MCP tools or the `conport journal` commands, decides an ambiguity by the spec
and records the decision, raises a block with `conport task block` only for an
irreversible operation or a merge conflict it cannot resolve without guessing,
and the gap hunter and the final reviewer submit their findings with
`conport epic findings submit`.

## `/conport:task`

Deterministic execution of one ConPort task, end to end:

1. implement it in an isolated worktree,
2. review it with an independent agent,
3. one round of fixes if the review found anything serious,
4. merge behind the full project gate,
5. close the task in ConPort with a resolution.

The run takes the task through the review cycle of ConPort and writes it into
the task's journal as it goes: a `brief` with the assignment before the
implementer starts, the implementer's `report` (the task moves to REVIEW), the
reviewer's `review` with its verdict. A serious finding is `changes_requested`:
the task returns to IN_PROGRESS for the next round, the fix comes back as a
`fix` entry (the task moves to REVIEW again) and the re-review is one more
`review`. Minor findings alone are an `approve`. The task is closed from
REVIEW after the approval, with the run's resolution. The entries are signed
`orchestrator` (the brief), `implementer` (the report and the fix) and
`reviewer` (the review) — the reviewer never signs as the author of the work it
reviews.

Every agent of the run is handed the task, not its text: the run writes the
brief into the task's journal first, and the agent's prompt is the task number
and how to read the journal (`get_task_journal_entry` with `kind="brief"`,
`list_task_journal` for the earlier entries). A fixer, a re-reviewer, a
rebaser and the reviewer after a rebase each get a new brief — the whole
assignment plus the findings, the fixer's actions, the rebase onto the default
branch or the conflicted files. The agents only read the
journal; the run writes every entry from their answers.

Nothing is ever pushed — every merge stays local, so you review the result before
it leaves the machine.

### Requirements

- A paid plan — workflows run on the Workflow tool, and the harness setting
  `disableWorkflows` turns them off.
- A ConPort API key: `CONPORT_API_KEY`, or the api key option of the plugin.
  Without one the run refuses at its start with `ABORTED_NO_API_KEY` — the
  agents work from the task journal, which lives in ConPort.
- A resolvable ConPort project: pass `project`, or set `CONPORT_PROJECT_NAME`
  — the project's handle (`prk7m2qx9d`) or its name (`k7m2qx9d/<project>` for
  a team's project). There is no other source of the name.
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
| `project` | string | no | ConPort project: its handle or name. Omitted → taken from `CONPORT_PROJECT_NAME`. |
| `plan` | string | no | Path to the plan file holding the task's section. Omitted → the plan is looked up by the task's anchor comment, but only across `docs/superpowers/plans/*.md` — if your plans live anywhere else, `plan` is effectively required. A plan kept in ConPort is pulled first — see [A plan kept in ConPort](#a-plan-kept-in-conport). |
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
  visible next time someone picks the task up. A task waiting in REVIEW cannot
  be blocked: the run reports the refusal and leaves the task in REVIEW for its
  verdict.
- **A task already in REVIEW is reviewed, not implemented again.** A run that
  finds the task in REVIEW — an earlier run stopped after the report — skips
  the implementation and reviews the branch that run left (`task/t<id>`, or its
  `-r2` / `-ctx` retry). That branch has no worktree any more: an agent that
  needs one makes it and names it, and the run removes it at cleanup. When none
  of the branches exists the run aborts with `ABORTED_IN_REVIEW_NO_BRANCH`. If
  the work is already merged, close the task DONE from REVIEW with a resolution
  once a `review` entry with verdict `approve` exists; otherwise a reviewer adds
  a `review` entry with verdict `changes_requested` and moves the task back to
  IN_PROGRESS, then the task can be run again.
- **A brief that does not land stops its dispatch.** Each journal step is one
  helper command, named in the run ledger (`journal`). The first brief that
  does not land aborts the run with `ABORTED_NO_BRIEF` before any agent works; a
  later one fails the task with `BRIEF_NOT_WRITTEN` and its agent is not
  dispatched. A report, review or fix that is refused or fails skips the later
  entries of that task, while the run itself goes on.
- **A report that landed only in part** (the report is written, the move to
  REVIEW failed) leaves the task IN_PROGRESS with a report, and its close is
  refused with `done_needs_review`: move the task to REVIEW, add the review,
  then close it.
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
   fix round per task — every child goes through REVIEW and its journal exactly
   as in `/conport:task`, and a child already in REVIEW is reviewed on the
   branch an earlier run left (`epic<epic id>/t<task id>`) instead of being
   implemented again; without that branch it fails with
   `ABORTED_IN_REVIEW_NO_BRANCH` while the rest of the epic runs,
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
| `plan` | string | no | Path to the plan file. Omitted → looked up by the epic's anchor under `docs/superpowers/plans/`. A plan kept in ConPort is pulled first — see [A plan kept in ConPort](#a-plan-kept-in-conport). |
| `project` | string | no | ConPort project: its handle or name. Omitted → derived as in `/conport:task`. |
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

## A plan kept in ConPort

With the Superpowers overlay on (see the plugin README), a plan is not a file
under `docs/superpowers/plans/` but a ConPort document of type `plan`, and the
workflows do not look it up there. Take it into a local file with `plan pull`
first, then pass that file's path as the `plan` argument — the run hands it to
the helper as `--plan .superpowers/plans/doc-M.md`:

```
npx -y conport@^0.6 plan pull <epic id>
/conport:epic {"epic": <epic id>, "plan": ".superpowers/plans/doc-M.md"}
/conport:task {"task": <task id>, "plan": ".superpowers/plans/doc-M.md"}
```

The JSON answer of `plan pull` names the file it wrote (`file`; `doc-M` is the
plan document) and a `<file>.conport.json` is kept beside it. The pulled file carries a marker under each
section that ties it to its task. Pull again after the plan changes in ConPort:
a stale copy is the plan as it was.

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
| `preflight` | State of the repository before a run: clean or dirty tree, current branch, the default branch, the head commit, whether an API key is set (`api_key`). Debris of an interrupted merge is aborted first. |
| `gate` | Runs the gate commands in the gate directory and reports GREEN, or RED with the tail of the first failing command. |
| `merge` | Merges the queued branches one at a time, the full gate after each; a conflict or a red gate aborts that merge cleanly and the batch reports it per branch. |
| `cleanup` | Deletes the merged branches and removes the run's worktrees; anything not merged is kept for forensics, and the run's own unmerged branches are named in `kept`. The checkout the helper runs in is never removed, even when listed: it is named in `skipped` (a `cleanup skipped: …` note in the run ledger). |
| `branch` | Names the first of the given local branches that exists, with its head commit — how a run finds the branch of a task it found in REVIEW. |
| `cycle` | Writes one step of a task's review cycle to ConPort: the journal entry (`brief`, `report`, `fix` or `review` with its verdict) and the status change that goes with it — REVIEW after a report or a fix, IN_PROGRESS after `changes_requested`. The authors are fixed here, and an entry longer than the server takes is cut with a marker. A refusal by the review rules is reported as the task's state, not as a failed call. |
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

The helper is tested on Node 22. It calls the global `fetch`, so a runtime
without one cannot run it at all; nothing older than Node 22 is tested.

- `CONPORT_API_KEY` — a ConPort API key. With it, `account`, `scout` and
  `cycle` talk to ConPort over REST. `preflight` reports whether a key is set
  (`api_key`, never the key itself), and both workflows refuse to start
  without one: their agents read the task journal, and `cycle` has no MCP
  fallback. Run by hand without a key, `account` and `scout` hand their work
  back to the ConPort MCP tools. An installed plugin
  needs nothing here: the key configured for the plugin reaches the helper as
  `CLAUDE_PLUGIN_OPTION_API_KEY`, which is read exactly like `CONPORT_API_KEY`.
- `CONPORT_API_URL` — the API base, for a self-hosted ConPort. Include the
  `/api/v1` suffix, as in `https://api.conport.app/api/v1`. Defaults to the
  hosted API.
- `CONPORT_PROJECT_NAME` — the project `scout` reads when the call carries no
  `--project` flag: the project's handle, `<project>` for a personal project, `k7m2qx9d/<project>`
  for a team's one. Without either, `scout` hands the work back.
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

Without the rule, a refusal destroys nothing, and the run names it. Every
per-branch status a run is *meant* to record, `NOT_MERGED` and its `gate_tail`
included, comes from a helper that ran; a refusal means the helper never ran,
so the agent answers with an error object instead — `{"error": "refused:
..."}`, the shape of the helper's own error answers — and the run writes it
into the ledger's notes under the label of the step: `merge error:"refused:
..."`. A helper that crashed or printed garbage leaves no such note, which is
how the two are told apart. The first helper call of a run is `preflight`, so
without the rule that is usually where the refusal lands: the run ends as
`ABORTED_PREFLIGHT` with the note `preflight error:"refused: ..."`, before any
work is dispatched. Further into a run the outcome is the same either way: the merge step
yields no result, the run asks once for the merge state and that call is
refused as well, and the task ends as `UNKNOWN_MERGE` — the ConPort task is
set BLOCKED with that reason (the permission cause is in the notes, not in the
reason), and in an epic run later tasks that depend on it are skipped. A
refused cleanup is noted the same way, `janitor error:"refused: ..."`, while a
cleanup that ran and could not remove something lists it as `cleanup errors:
...`. The run's own unmerged branches that cleanup left in place are named in
one more note, `cleanup kept: <branches, comma-separated>`; a run that kept
none has no such note. The two leftovers a cleanup handles are not the same kind of thing.
Unmerged branches staying on disk is
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
