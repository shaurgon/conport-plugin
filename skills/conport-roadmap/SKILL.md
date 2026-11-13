---
name: conport-roadmap
description: "Use when about to take a task into work, file an epic or a task, move a task between epics, call a task waiting, close an epic or a milestone, talk about a release, a version bump or a deploy, and before every report to the user with open tasks. The ConPort roadmap rules — milestones, the release point, the make-up of epics, work after a release, waiting on someone else's work. Requires the conport skill for base tool discipline."
metadata:
  version: 24.0.0
---

# ConPort Roadmap

The roadmap is the project's ConPort milestones in `sequence` order, epics in
each milestone, tasks in each epic. The current milestone is the open one with
the smallest `sequence`. The state is read from ConPort — `list_milestones`,
`list_tasks(parent_task_id=…)`, `get_task` — never from memory or from a plan
file.

## When to open the roadmap

Call `list_milestones` before any of these:

- taking a task into work, or handing tasks to executors;
- filing an epic or a task, moving a task;
- writing that a task is waiting for something;
- saying "release", "version bump" or "deploy";
- reporting to the user while tasks are open.

## The shape: a release milestone holds its epics

The preferred shape is `release (epic 1, epic 2)`: the milestone is created as
a release from the start (`add_milestone` with `is_release=true`), and the
epics that go into that release are attached to it directly
(`update_task` with `milestone_id`). The roadmap then shows which epic ships in
which release.

- New work that will be deployed gets a new release milestone with its epics —
  not an ordinary milestone followed by an empty release point.
- The shape `milestone (epics) → empty release point` is used only when the
  user asked for it. Finding it on the roadmap, offer the user to fold it: set
  `is_release=true` on the milestone with the epics, cancel the empty point
  with the resolution "folded into milestone N".
- There are two non-release milestones, and both are standing lists, not
  stages: **waiting** (epics that wait for a date, someone else's work, a
  measurement) and **backlog without a date** (research, designs, undated
  work). They stand after every release milestone, show their epics as a list,
  hold no release and are not part of the release order. Do not cancel or fold
  them.
- A release milestone with epics stays open until the release actually
  happened: "every epic is closed" does not close it (see *Release*).

## What goes into milestones and epics

1. **A release milestone holds only what is done before the deploy.** A task
   outside the release's scope is done after the release and sits in a
   milestone after the release point.
2. **A task that waits is not part of the epic.** Waiting for another project
   or someone else's service, a date, a measurement window, the end of a long
   run or the user's decision — the task moves at once into an epic whose
   content is that waiting, in the waiting milestone. A waiting epic is never
   attached to a release milestone: a measurement or research without a date
   must not look like part of a release. Work that needs only the deploy does
   not wait: it goes to the tails epic of the release (rule 4).
3. **An epic is uniform.** Either everything in it is done before the deploy,
   or everything waits. A mixed epic is split: the done part stays, the epic
   goes to the release milestone and is closed; the waiting part moves out. An
   epic with done tasks is never moved whole to a milestone after the release —
   its done part is the content of the release.
4. **Code is ready — the task is closed.** A live check after the deploy or a
   dry run on an environment is a new task, filed at once in the tails epic of
   the release (see *Release*), not as a child of the epic being released. A
   measurement that waits for its window is waiting work (rule 2).
5. **Milestone order.** The release milestone stands before the milestone
   after the release. The current milestone is worked; a task from a later one
   only on the user's explicit decision, naming the milestone. "Finish the
   rest" does not override the order, and neither does a Bug. An open Bug
   (`kind='bug'`, status TODO, IN_PROGRESS, REVIEW or BLOCKED) goes first
   among the children of its epic; outside its epic it has no precedence — it
   lifts neither its epic nor itself over the milestone order or over other
   epics, and a Bug without an epic ranks by its priority like an ordinary
   task. File confirmed defects with `kind='bug'`, polish and new work with
   `kind='task'`.
6. **Attachment.** Every epic is attached to a milestone (`milestone_id`), and
   the milestone is chosen by one question: it ships in a release — that
   release's milestone; it is the tails epic of a release — the milestone right
   after that release; it waits — the waiting milestone; no date — the backlog
   without a date. An epic without a milestone is an attachment error, not a
   way to take it off the roadmap. When a waiting or undated epic gets a
   release, it moves whole into that release milestone. Two or more related
   tasks — an epic first. The exception is work before a design: it is one
   task, the design creates the epic together with the spec, and the plan puts
   the tasks into the epic. A task carries no milestone, so such work shows on
   the roadmap once the design has created the epic; an epic with a spec and no
   tasks waits for its plan, and that is a normal state. The hierarchy has two
   levels: a task has no subtasks. A dependency is written with `add_task_dep`;
   no mechanism reads one written in prose.

## Waiting

- "Waits for X" is written only after `get_task` with its dependencies,
  including the counterpart tasks in other ConPort projects. The reason is
  named as checked: whose task, which status.
- Everything without a real blocker is taken at once and in parallel. "Until
  the bump command" is not a blocker when the task's acceptance does not need
  the bump.
- Do not take or offer tasks of another project: that project does them.
- A long run (a sync, a backfill) holds neither the release nor other work.

## Release

- The release is ready when the release milestone has no open children: every
  epic is closed, the Critical and Important findings of the final review are
  fixed, the checks are green.
- While the release milestone has open children, do not mention the bump at
  all — not even as a line "waiting for your command" at the end of a report.
  First finish or move out the work by the rules above.
- Tasks of the milestone after the release do not hold the release and are not
  called blockers.
- The make-up of a release epic is frozen at the version bump. What is found
  after the freeze, and work that can be done right after the push, goes into
  the tails epic of the release, except defects in this release's code — those
  are closed before the push. Work that waits on someone else, a date or a
  measurement window goes to the waiting milestone (rule 2), never into the
  tails epic.
- The tails epic of the release is one per release, filed at the first such
  finding. It is attached to the milestone right after the release — not to a
  later release milestone with work of its own, not to the backlog without a
  date — and is taken into work first after the push, before any other
  milestone. It holds no waiting work and is never closed as CANCELLED because
  it waits. Its title is `Tails of release <title of the release milestone>`,
  written literally and never translated: look for an epic with that title
  before filing one, so a session and the epic workflow never start two. It is
  filed with priority 1. Inspect the next open milestone after the release: if
  it is a release, find the oldest open tails epic with the exact title in
  that milestone, or create it there; otherwise find or create it without a
  milestone, file the work, and ask the user which milestone it goes to.
- On `epic_growth_ceiling`, take one action: execute the call in `suggestions[].call`.
  Follow the calls in their given order; the server names the tails epic and its
  milestone. Never calculate growth locally.
- After the push, the tails epic of the release is taken into work first,
  before any other milestone.
- An epic does not bump a version: its changes go into the changelog of the
  unit under `## Unreleased`. The version is bumped once, at the release step,
  after every epic of the release milestone has merged — that bump is the
  freeze. Which units carry a version and how each is bumped follows the
  project's own rules (its instructions and memory). The release step is not
  run through `/conport:task` or `/conport:epic`: they refuse a version that
  differs from the published default branch, so run them only after the
  release is pushed.
- A release milestone closes only after the actual release, with the version
  in the resolution (`update_milestone` with `status='DONE'` and
  `resolution`). "Every epic is closed" is not yet a release.
- A server refusal `milestone_not_ready` or `epic_not_ready` is a
  prescription: close what it lists. Never cancel a milestone or an epic to get
  around it.

## The user's decisions

A number, a date, a make-up or an order the user named is carried out as
written. A finding of your own that disagrees with it is no reason to
recalculate silently and no reason to argue: if the user already spoke to that
point, carry it out. Ask only when the user named no value; then show the fact
and the options, and do everything else until the answer comes.

## The report to the user

Two separate lists, both read from ConPort:

1. **Release milestone** — its epics, the open children of each, what is being
   done on them now.
2. **Waiting** — the waiting epics with the checked reason for each task. The
   backlog without a date is not reported until the user asks about it.

The number of open children is recounted after every close and every move.

## Check before sending the report

- [ ] `list_milestones` was called in this pass, not restored from memory.
- [ ] The release milestone holds no task that cannot be done before the
      deploy.
- [ ] No epic holds done tasks next to waiting ones.
- [ ] Every waiting task has its reason checked with `get_task` and its
      dependency written.
- [ ] No task is put off without a real blocker.
- [ ] The word "bump" appears only with a release milestone that has no open
      children.
- [ ] Every milestone with a deploy has `is_release=true` and its epics
      attached to it; there are no empty release points except those the user
      named.

## Red flags

| Thought | What is actually true |
|---|---|
| "This acceptance is only possible after the deploy, let it hang in the epic for now" | The epic cannot close before the release, the release cannot happen before the epic closes. Move it out now. |
| "I'll move the whole epic to the milestone after the release" | Its done tasks are the content of the release. Split it. |
| "No code tails left, I'll remind the user about the bump" | The release milestone still has open children — say nothing about the bump and work. |
| "I'll do this task after the bump command" | Read its acceptance: most likely its branch or edit can be prepared now. |
| "It waits for the sync to finish" | Not checked. `get_task`, the dependencies, the counterpart task. |
| "I found that the number the user named does not fit" | Carry it out as written; the user already rejected that point or will decide it. |
| "The milestone after the release stands before the release one, but that is how it turned out" | The milestone order is wrong — fix it with `update_milestone(sequence=…)`. |
| "I'll make an ordinary milestone for the work and a release point after it" | The preferred shape is one release milestone with its epics. Two milestones only on the user's word. |
| "The waiting epic spoils the release picture — I'll detach it or cancel the waiting milestone" | The waiting and backlog milestones are standing lists; their epics belong there. Leave them. |
| "I'll attach the measurement to the release milestone, it is about this release" | Waiting work in a release milestone cannot close before the release. The waiting milestone only. |
| "The epic is ready, here are N findings for the report" | The findings are tasks of this epic — an ordinary one past the growth ceiling goes to the tails epic of the release; the epic is not ready, the work goes on. |
| "This is after the release, I'll put it into the next milestone or the backlog" | A finding or a check right after the push — into the tails epic of the release, taken first after the push. Work that waits on someone else, a date or a measurement — the waiting milestone. |
