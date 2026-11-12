# Backlog discipline

The rules behind the *BACKLOG DISCIPLINE* section of the conport skill: what
goes into ConPort, when a piece of work becomes a task, and how an epic is kept
from growing without end. The roadmap itself — milestones, the release point,
what waits — is the **conport-roadmap** skill.

## What to record

Record what was decided and why: the rationale, the options rejected and the
reason for each, the constraints that shaped the choice, and numbers together
with the method that produced them. Do not record a chronology of actions
("did A, then B, then C"), a retelling of the conversation, or a duplicate of
what is already saved — search before writing.

## A decision with a list of work spawns tasks

When the body of a `sync_decision` holds a list of things to do ("to remove:
…", "to migrate: …", "remaining: …"), each item becomes a task in the same
message — `add_task`, under an epic when there are two or more — and the task
numbers are written into the decision (`update_decision`). A list in prose is
read by no mechanism; a decision is not a place to store work.

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
design: it is one task, and the design creates the epic with the spec — see the
Planning rows *Work that needs a design, before the design* and *The spec is
approved* of the conport skill.

## Findings: check first, then file, then do

A finding from a review, a gap hunt or your own work becomes a task after it
is checked, not instead of checking it. "Cannot check it" or "only if X" is
neither a reason to skip filing nor a reason to file blind: the check is the
diagnosis. Then either file a task for a confirmed defect, with its acceptance
criterion and `kind='bug'`, or write one line in the resolution of the task
the finding came from. A symptom is not a task; a task is filed for an established cause.

What is filed is done right away. The backlog shrinks by doing what was found,
not by refusing to file it; a filed task is not deleted later as speculative
and is not left hanging.

**An epic is not ready while a finding of it is open.** Every finding of the
epic's work that is not fixed in the same pass becomes a task of the current
epic and is done before the epic is declared ready:

| Source | A task of the current epic, done before the epic is ready |
|---|---|
| Gap hunt | Blocker, Should-fix, Note — every severity |
| Code review, final review | Critical, Important, and a Minor not fixed in the same pass |
| Anything else | A confirmed defect of behaviour |

The *Epic growth ceiling* below bounds this table: a behaviour defect always
stays in this epic; an ordinary finding past the growth ceiling goes to the
tails epic of the release, and readiness does not wait for it.

A Minor inside the diff under review is fixed by its author in the same pass;
one left open after that pass becomes a task like any other finding. A Minor
outside that diff — dead code nearby, style — is not a finding of that review.
A Note is a question: when only the user can answer it, ask the user at once,
and the answer becomes the task. A finding is never kept aside for the end of
the run: the report and the readiness entry name the task numbers made from
the findings, not the findings themselves.

A filed finding goes to an executor as the next action: a task nobody runs is
the same list in another place. A report "after the epic I found N problems"
as text, with no task numbers and no work started, is forbidden — those
findings are tasks of this epic, or past the growth ceiling of the tails epic
of the release, and the epic is not ready while one of its own is open.

## Depth: one level

A task filed from a finding is reviewed on its own diff, and that review
reports every severity: its author fixes all of it, Minor included, in the
task's own fix round, before the task merges. Nothing that review finds is
filed as a new task, and nothing is dropped. Only a defect of behaviour found
outside that task's diff becomes a new task — never polish. This is what keeps
the rule above from looping: "the reviewer found nothing" never converges — the
stronger the reviewer, the more it finds.

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

Where the server ceiling applies, an epic takes max(3, floor(0.3 × plan tasks))
ordinary tasks added after the plan; the next ordinary task goes to the
tails epic of the release. A plan of 10 tasks: 3 added ordinary tasks stay
in the epic, the 4th goes to the tails epic of the release. A plan of 20
tasks: 6 added ordinary tasks stay in the epic, the 7th goes to the tails
epic of the release.

- **A defect never counts and always stays in this epic: a review's Critical
  and Important, a gap hunt's Blocker and Should-fix, a confirmed behaviour
  defect.** A defect — the work does not do what its spec, plan or contract
  says, or the goal is not reached — is fixed in the epic whatever the count; a
  Should-fix is a defect, never polish. File these with `kind='bug'`.
- **Polish from findings counts: a review's Minor left after the pass, a task
  from a Note's answer.** Style, a duplicate, a missing test left as a Minor is
  an ordinary task, and so is new scope: a new capability, a new step, a new
  consumer. File polish and new work with `kind='task'`. The `kind` field,
  not whether the task came from a finding, determines the count.
  An epic is not polished without end.
- **Past the ceiling, the tails epic of the release.** It is the one tails
  epic of the release described under *The release epic is frozen at the
  version bump*: attached to the milestone right after the release and taken
  into work first after the push; there is no second tails epic per epic. The
  work is neither added to this epic nor dropped, the user is not asked whether
  to go on in this epic, and the epic's readiness does not wait for it.
- The server counts the ceiling itself. On `epic_growth_ceiling`, take one
  action: execute the call in `suggestions[].call`. The tails epic is the one
  named by that refusal; do not calculate the ceiling or pick another epic.
- A report of the epic's progress names the ordinary tasks added (counted) and
  the defect fixes (not counted) as two numbers. Read `epic_progress.plan_tasks`,
  `ordinary_added`, `bugs` and `growth_ceiling`. The server summary with a ceiling
  is "ordinary after plan N of C, bugs B".
- The ceiling is `epic_progress.growth_ceiling`; `null` means no ceiling (the
  epic is outside its scope). Never count locally; on `epic_growth_ceiling`,
  execute the ordered calls in `suggestions`. `ask_user_milestone` is present
  whenever the target tails epic has no milestone, whether found or created.

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
- Before the freeze, the findings of the epic (see above: every severity) go
  into this epic as tasks and are closed before the bump: a behaviour defect
  always stays in this epic; an ordinary finding past the growth ceiling goes
  to the tails epic of the release, and readiness does not wait for it.
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
with that title before filing one, so a session and the epic workflow never
start two. It is filed with priority 1. Inspect the next open milestone after
the release: if it is a release, find the oldest open tails epic with the
exact title in that milestone, or create it there; otherwise find or create it
without a milestone, file the work, and ask the user which milestone it goes
to.

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
