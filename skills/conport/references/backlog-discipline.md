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
criterion, or write one line in the resolution of the task the finding came
from. A symptom is not a task; a task is filed for an established cause.

What is filed is done right away. The backlog shrinks by doing what was found,
not by refusing to file it; a filed task is not deleted later as speculative
and is not left hanging.

**Only what matters becomes a task:**

| Source | A task of the epic, done at once | Not a task of the epic |
|---|---|---|
| Code review | Critical, Important | Minor |
| Gap hunt | Blocker | Should-fix, Note |
| Anything else | A confirmed defect of behaviour | Polish, style, wider coverage |

A gap-hunt Should-fix is a real gap that does not hold the work it was found
in, so it is not filed into the running epic: list it for the user at the end
of the run, and it becomes a task in the next piece of work when the user says
so. A Note is one line in the report. A Minor inside the diff under review is
fixed by its author in the same pass; a Minor outside that diff — dead code
nearby, style, "coverage could be wider" — is dropped with one line in the
report. The reason for the threshold: "the reviewer found nothing" never
converges — the stronger the reviewer, the more it finds.

## Depth: one level

A task filed from a finding is reviewed on its own diff only, and that review
reports only Critical and Important findings. A finding from a finding becomes
a task only when it is a defect of behaviour, never polish.

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

When the tasks added to an epic after its plan's tasks were filed exceed 30% of
the plan's task count — and number at least three — stop. Give the user the
list of what was added and ask: continue in this epic, or move the additions
to an epic of their own. Continue only on an explicit yes.

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

- Before the freeze, the findings that become tasks of the epic (see the
  threshold above) go into this epic and are closed before the bump.
- A finding made after the freeze goes into an epic of the next milestone, not
  into the release epic — except a defect in code that is already in this
  release, which is closed before the push.
- After the freeze only the Critical and Important findings of the final
  review in this release's code hold the bump. A gap-hunt Should-fix never
  holds it: it is listed for the user, as at any other time.
- Work that cannot be finished before the push for an outside reason (a
  production artifact, another party's service) goes to an epic for the work
  after the release, with the reason written into the task.

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
