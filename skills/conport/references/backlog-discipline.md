# Backlog discipline

The rules behind the *BACKLOG DISCIPLINE* section of the conport skill: what
goes into ConPort, when a piece of work gets a task, what a finding becomes,
and how an epic is kept from growing without end. The roadmap itself — milestones, the release point,
what waits — is the **conport-roadmap** skill.

## What to record

Record what was decided and why: the rationale, the options rejected and the
reason for each, the constraints that shaped the choice, and numbers together
with the method that produced them. Do not record a chronology of actions
("did A, then B, then C"), a retelling of the conversation, or a duplicate of
what is already saved — search before writing.

## A decision with a list of work spawns tasks

When the body of a `sync_decision` holds a list of things to do ("to remove:
…", "to migrate: …", "remaining: …"), each item gets its own task in the same
message — `add_task`, under an epic when there are two or more — and the task
numbers are written into the decision (`update_decision`). Under an epic that
has a plan, each such task is the exception of *A new task in an epic that has
a plan* below. A list in prose is read by no mechanism; a decision is not a
place to store work.

This holds during a design session too. The tasks that implement a spec wait
for its plan; the tasks that remove something or carry out a consequence of an
accepted decision are filed at once.

## A question from the user is not an instruction

A remark in the form of a question ("which X was Y made with?", "is there any
point in Z?") is not an instruction, a decision or a task.

1. Answer it first, and check the answer before giving it.
2. File a task only when the answer showed a defect, and only when what the
   defect concerns is still in use.
3. Record a decision as the user's only for what the user stated
   affirmatively. Your own conclusion in reply to a question is an ordinary
   decision of yours.

An affirmative instruction from the user on the substance of the work is
recorded at once, in the same message and in the user's words: `add_task` or
`sync_decision`.

## Two or more related tasks: an epic first

Planning or filing two or more related tasks starts with `add_task` with
`kind='epic'`; the tasks go under it with `parent_task_id`. Related tasks are
never left loose at the root of the backlog. The exception is work before a
plan: an idea is one task, the approved spec closes it and waits with the tag
`awaiting-plan`, and the import of the plan creates the epic with its tasks —
see the Planning rows *Work that needs a design, before the design*, *The spec
is approved* and *The plan is approved* of the conport skill.

## Findings: a finding is fixed, not filed

A finding from a review, a gap hunt or your own work is checked before
anything is done with it. "Cannot check it" or "only if X" is no reason to skip
it: the check is the diagnosis. A symptom is not a finding; the fix goes to an
established cause.

A finding is fixed, not filed. Where each one goes:

- A task review's finding: a fix round of that task by its implementer, every
  finding at once (a Minor outside the task's diff is dropped). Important and
  Minor go together; nothing is sorted into "later". The Minor findings of an
  `approve` are fixed while the task stays in REVIEW: the implementer writes
  them there as a `fix` entry, and the task waits for a new review.
- A final review's or end gap hunt's finding, one in the code of a closed task
  included: one fix round of the epic's final-review task, one fixer dispatch
  with the whole list, recorded in that task's journal. That task is the last
  section of the plan, *Final review*, and the session that leads the epic
  runs it.
- A gap hunt of the spec: an edit of the spec.
- A merge, a gate red after a merge, a re-submission, a manifest or skill
  edit: done, never filed.
- A finding outside the epic's goal: the tails epic of the release.

A Note is a question: when only the user can answer it, ask the user at once,
and the answer goes into the same fix round. A finding is never kept aside for
the end of the run.

**An epic is not ready while a finding of it is open.** A finding goes to its
fix round as the next action: a list nobody runs is the same list in another
place. A report "after the epic I found N problems" as text, with no work
started, is forbidden — those findings are fix rounds of this epic, and the
epic is not ready while one is open.

**A new task in an epic that has a plan is the exception: only new work the
goal needs that no plan task and no fix round can hold.** Its description
starts with `Why not a fix round:`, and the person approves each one (in Claude
Code the plugin's hook asks for it; elsewhere ask in one line and wait for an
explicit yes). The server still bounds what the epic takes after the plan
(`epic_growth_ceiling`): on that refusal execute the calls in `suggestions`.
How the hook holds it and how the person says yes: *A new task in an epic that
has a plan* below.

**What a Bug is.** File a Bug (`kind='bug'`) only for a confirmed behaviour
defect found outside the fix rounds of an epic that has a plan; new work is
`kind='task'`. That is a defect found outside an epic, in an epic without a
plan, a plan section labelled `kind: bug`, or an approved exception. A finding
inside the epic's goal is never a Bug: it is fixed in its fix round, or in the
spec for a gap hunt of the spec. One outside the goal goes to the tails epic of
the release, where a defect is a Bug. A defect is the work not doing what its
spec, plan or contract says.

## Depth: one level

The re-review after a fix round checks only that round's diff, and what it
finds goes into the next fix round of the same task — nothing from it is filed
or dropped. After the third failed fix round the task is BLOCKED, the finding
stays in its journal, the epic is not ready, and the user is told one action.
Work that waits on someone else (another party's service, a date, a
measurement window) goes to an epic of the waiting milestone; a check after the
deploy goes to the tails epic of the release. This is what keeps the rule from
looping: "the reviewer found nothing" never converges — the stronger the
reviewer, the more it finds.

## A new task in an epic that has a plan

The plan is the make-up of the epic. A new task in it is the exception of
*Findings* above, and the person approves each one.

**What the hook holds.** In Claude Code the plugin's hook stands before
`add_task` and `update_task` of the ConPort MCP server. It holds only an epic
that has a plan: a plan started (`epic_progress.plan_started`) or a plan
document linked to the epic (`epic_progress.plan_document`). An epic without a
plan is a container, and a direct request "add a task to the epic" passes. The
tails epic of the release is not held: it is where a finding outside the goal
goes. It holds `add_task` with a parent epic, and an `update_task` that
attaches a task with no epic to an epic; moving a task between epics is free.

**Its refusals.** Each names one action:

| Refusal | When | The one action |
|---|---|---|
| R1 | The description does not start with `Why not a fix round:` | A finding is a fix round of the task it came from, or of the epic's final-review task (or, in an epic without one, of the task whose code it is in); one outside the goal goes to the tails epic of the release. Only for new work the goal needs: start the description with `Why not a fix round:` and call again. |
| R2 | The prefix is there, the person has not said yes | Ask the person in a plain message, not with a question tool, in one line why this is not a fix round and to reply `allow epic <N> in <project>`; then call again — a refused call needs a new yes. |
| R3 | The call comes from a subagent | Put the task you would file, with its `Why not a fix round:` line, into your answer; the session that dispatched you decides. |
| R4 | ConPort did not say whether the epic has a plan (no answer, an error, an answer without the fields) | Call again in a minute. The cause is a line of `epic-growth-guard.log` in the plugin's data folder. |

**The person's yes.** The person replies with a message that is exactly
`allow epic <N> in <project>` (case and the spaces around it do not matter) —
or `allow epic <N>` when the session has a project. `<project>` is the handle,
the name or `team/project`; R2 prints the form with the handle. The hook
records the yes for that project and that epic; the call it lets through
removes it. One yes is one task, and it is spent before the server answers: a
refused call needs a new yes. The reply is the only way to give it. Only the
person gives it: never write that reply or the consent file yourself, by any
tool — the plugin's command guard refuses a Bash command that names the
consent file.

**The switch.** `CONPORT_EPIC_GROWTH_GUARD=off` in the environment of Claude
Code turns the hook off: it passes every call without asking ConPort. Any other
value, or none, leaves it on. Turning it off removes only the hook: the text of
the rule and the server ceiling stay. It is the person's decision; a refusal
never names it.

**What the hook does not see.** Hosts without hooks (Cursor, Codex, other
agents), `conport api tasks create` with a parent epic run through the shell,
and the switch turned off: there the rule is this text and the server ceiling —
ask the person in one line in the chat and wait for an explicit yes before the
call. `plan import` runs over REST and passes no hook: after the plan has
started it refuses a new section without the marker of its task, so an
approved exception is filed with `add_task` first and its marker then goes
under the section's heading.

## A change to behaviour a spec describes changes the spec

A task that changes behaviour a spec describes — a text the spec quotes, an
interface, the order of steps, a structure — changes the spec in the same task,
with the block tools (`update_block`, `insert_block`), before the task is
closed. Otherwise the spec and the code part ways without anyone noticing.

- "The epic is closed" and "the code is the source of truth" are no reasons to
  skip it: a spec stays the description of the system until another spec
  replaces it.
- A task filed from a finding — after its epic is closed too — names in its
  acceptance the section of the spec it changes, or says "does not touch the
  spec".

When the work has no spec, this rule does not apply.

## Epic growth ceiling

Where the ceiling applies, the server takes at most
max(3, floor(0.3 × plan tasks)) ordinary tasks into an epic after its plan,
approved exceptions included; a Bug never counts. A plan of 10 tasks: the
server takes 3 added ordinary tasks and refuses the 4th. A plan of 20 tasks:
the server takes 6 added ordinary tasks and refuses the 7th. The ceiling bounds
the exceptions of *A new task in an epic that has a plan*; it is no allowance
for filing findings, which are fix rounds.

- The ceiling is the server's. Never recount it locally: read
  `epic_progress.plan_tasks`, `ordinary_added`, `bugs` and `growth_ceiling`;
  `null` means no ceiling (the epic is outside its scope). The server summary
  with a ceiling is "ordinary after plan N of C, bugs B", and a report of the
  epic's progress gives the ordinary tasks added and the Bugs as two numbers.
- On `epic_growth_ceiling`, take one action: execute the call in
  `suggestions[].call`, then the rest of the ordered calls in `suggestions`.
  The tails epic is the one named by that refusal — the one tails epic of the
  release described under *The release epic is frozen at the version bump*;
  there is no second tails epic per epic. Do not pick another epic.
  `ask_user_milestone` is present whenever the target tails epic has no
  milestone, whether found or created.

## Epic progress is counted by its children

- The progress of an epic is its open children in ConPort —
  `list_tasks(parent_task_id=<epic>)` or the `epic_progress` a write echoes —
  never the task list of a plan file. A plan does not see the tasks added
  after it.
- Recount after every close and every merge.
- A report to the user carries both numbers: "plan tasks N of M, open children
  of the epic K".

A filed task sends no notification and drops out of the working plan, so a
tail nobody counts feels done while it is not.

## The release epic is frozen at the version bump

The make-up of a release epic is frozen at the moment the version is bumped.

- **An epic does not bump a version.** It writes its changes into the
  changelog of the unit under `## Unreleased`. The version of every changed
  unit is bumped once, at the release step, after every epic of the release
  milestone has merged: `## Unreleased` becomes the number. That one bump is the freeze.
  Parallel epics of one milestone that each bumped would ship diverging
  numbers.
- Before the freeze the rule of *Findings* above holds. A finding is fixed,
  not filed. The findings of the epic go to their fix rounds and are closed
  before the bump; one outside the epic's goal goes to the tails epic of the
  release, and readiness does not wait for it.
- A finding made after the freeze goes into the tails epic of the release as a
  task — not into the release epic, not into an epic of a later milestone with
  work of its own, not into a report line — except a defect in code that is
  already in this release, which is closed before the push.
- Once every epic of the release milestone has merged, only the Critical and
  Important findings of the final review in this release's code hold the
  bump, and so does a defect in this release's code; anything else found then
  goes to the tails epic of the release.
- Work that can be done right after the push (a live check after the deploy, a
  dry run on an environment) goes to the tails epic of the release too.
- Work that cannot be finished before the push for an outside reason (another
  party's service, a date, a measurement window) is waiting work: it goes to
  an epic of the waiting milestone, with the reason written into the task —
  never into the tails epic.

**The tails epic of the release** is one per release, filed at the first such
finding or work. It is attached to the milestone right after the release — not
to a later release milestone with work of its own, not to the backlog without
a date — and is taken into work first after the push, before any other
milestone. It holds no waiting work, is never held waiting and never closed as
CANCELLED because it waits. Its title is `Tails of release <title of the
release milestone>`, written literally and never translated: look for an epic
with that title before filing one, so two sessions never start two. It is
filed with priority 1. Inspect the next open milestone after the release: if
it is a release, find the oldest open tails epic with the exact title in that
milestone, or create it there; otherwise find or create it without a
milestone, file the work, and ask the user which milestone it goes to.

"An epic closes only with its children closed" applies to the frozen make-up.
Without a freeze, a tail becomes a child, the epic cannot close, there is no
release, the hunt for gaps goes on and finds the next tail — a loop with no
exit.

## Session start: interrupted attempts

At every session start — after a crash, a context reset or a compaction too,
not only on a fresh start — read the tasks in IN_PROGRESS
(`list_tasks(status="IN_PROGRESS")`, or the reconciliation hint of `init`).
A task in IN_PROGRESS with no live executor and no commit since the last
session is an interrupted attempt: tell the user, then either continue it from
what it left behind (its journal, its branch) or return it to TODO. Hanging
tasks pile up at ordinary session boundaries, not only after a crash.
