---
name: superpowers-conport
description: "Use when superpowers brainstorming/writing-plans produced a design.md + plan.md and the work needs to land in ConPort as a spec doc + epic + tasks. Use when such a plan has been executed and the final whole-branch review is clean, and the work is about to be declared finished — finish mode audits the plan's epic and prints a release-readiness verdict. Idempotent via inline HTML-comment anchors written back into the source files."
metadata:
  version: 15.36.0
---

# superpowers-conport — Bridge

Imports superpowers brainstorming + writing-plans output into ConPort. Manual trigger; idempotent via inline HTML-comment anchors.

## When to use

User finished `superpowers:brainstorming` and `superpowers:writing-plans`, has `docs/superpowers/specs/<date>-<topic>-design.md` and (usually) `docs/superpowers/plans/<date>-<topic>.md`, and wants the work to live in ConPort as a spec doc + epic + tasks.

Also: the user re-ran the bridge after editing the source files and expects the corresponding ConPort entities to be updated, not duplicated.

Also: every task of the plan is done, the final whole-branch review has come back clean and
its fixes are merged, and the agent is about to declare the work finished — call the bridge
in `finish` mode for the release verdict before handing over to
`superpowers:finishing-a-development-branch`.

## Modes

| Invocation | Mode | What it does |
|---|---|---|
| default, no argument | `import` | spec → document, plan → epic + tasks, contract blocks back into the plan |
| argument `finish` | `finish` | read-only audit of the plan's epic; prints a release verdict, writes nothing |

`finish` is the plan's terminal step (see step 4.5) — the last thing done on the plan, run
by the controller itself. In SDD's own order it belongs **after** the final whole-branch
review is clean and its fixes are merged, and **before**
`superpowers:finishing-a-development-branch`: that is, inside SDD's Finish step, ahead of
the workspace deletion that step performs.

SDD's task loop, however, reaches the terminal block earlier than that — the block is an
ordinary plan task, so a todo is created for it at setup and the loop offers it while
"more tasks remain" is still true; the branch to the final review is taken only once no
task is left. The block therefore carries its own ordering gate in its body: reached
early, it is left open and the controller goes on to the final whole-branch review first.
The gate has to live in the body because that body is all the controller sees — `task-brief`
hands it the block and nothing else, and this table is not read at that moment.

## Inputs

- `<spec_path>` (optional) — path to a `*-design.md`. If omitted, pick the newest file in `docs/superpowers/specs/` by mtime.
- `<plan_path>` (optional) — path to the matching `*.md` plan. Derive from spec by replacing `/specs/` with `/plans/` and dropping the `-design` suffix. Skip the plan stage silently if the derived file does not exist.

## Flow

### 1. Resolve ConPort project

Call `mcp__conport__init({name: <auto>})` where `<auto>` is:
1. The basename of `git config --get remote.origin.url` (strip `.git`), or
2. The basename of `pwd` if step 1 fails.

If init reports the project does not exist, ask the user via AskUserQuestion whether to create it under that name or pick from `list_projects`. Do not auto-create silently.

Record `project_id` for all subsequent calls.

### 2. Import spec doc

Read `<spec_path>` (Read tool).

Search the body for `<!--\s*conport-spec:\s*doc-(\d+)\s*-->`.

**Anchor found** (captures `<doc_id>`):
- Strip all five anchor types from the body using:
  `<!--\s*conport-(spec|epic|task):\s*[a-z-]*\d+\s*-->\s*\n?|<!--\s*/?conport-(finish|contract)\s*-->\s*\n?`
- Call:
  ```
  mcp__conport__update_document({
    project_id, document_id: <doc_id>,
    content: <stripped body>,
    change_kind: 'amend',
    reason: 're-import from superpowers spec'
  })
  ```

**Anchor not found:**
- Extract H1 (first line matching `^# (.+)$`) → use as `title`.
- Strip anchors (no-op on first run, but safe).
- Call:
  ```
  mcp__conport__add_document({
    project_id,
    title: <H1>,
    content: <stripped body>,
    doc_type: 'spec'
  })
  ```
- Capture returned `id` → write `<!-- conport-spec: doc-<id> -->` into the file on its own line immediately after the H1 (Edit tool, append a newline after the title line and then the anchor line).

Verify the response echo: returned id is a positive integer, `summary` is present. On mismatch, retry once.

### 3. Ask about plan import

If `<plan_path>` does not exist on disk: skip to step 5 with no question.

Otherwise: `AskUserQuestion`: "Import epic + tasks from `<plan_path>`?" (yes / no). On `no`, skip to step 5.

### 4. Import plan as epic + tasks

Read `<plan_path>`.

**`description` length constraint.** `add_task.description` is capped at **2000 chars** by the MCP schema. Plan task blocks routinely exceed this. The skill does NOT shove the whole block into the description. Instead:

- **Epic description:** one or two sentences summarising the plan, plus a reference `See spec: doc-<doc_id>. Full plan: <plan_path>.`
- **Subtask description:** one short sentence summarising the task's goal (derived from the H3 heading or the `**Files:**` block), plus optionally `See plan §Task N`.

The full plan body lives in the spec doc (`add_document.content` cap is 50 000 chars — comfortable for typical plans). ConPort tasks intentionally carry only short metadata; the source of truth is the markdown file.

**Epic:**

Search for `<!--\s*conport-epic:\s*(\d+)\s*-->` outside fenced code blocks (see anchor cheat sheet).

- Anchor found (captures `<epic_id>`):
  ```
  mcp__conport__update_task({
    project_id, task_id: <epic_id>,
    title: <H1>,
    description: <short summary, ≤ 2000 chars>
  })
  ```
  Do not change `kind` or `status` on re-import.

- Anchor not found:
  - Extract H1.
  - Call:
    ```
    mcp__conport__add_task({
      project_id,
      title: <H1>,
      description: <short summary referencing doc-<doc_id> and the plan path>,
      kind: 'epic',
      priority: 3
    })
    ```
  - Write `<!-- conport-epic: <id> -->` on a new line immediately after the H1.

Capture `epic_id`.

**Tasks:**

**Mask fenced code blocks before splitting.** A plan that documents this bridge carries
literal `### Task N:` headings inside its examples; splitting on them creates phantom
tasks and shifts every real block's boundary. Mask or skip lines between paired fence
markers (` ``` ` or `~~~`) before applying the split, exactly as the anchor detection does.
A fence opens on a run of three or more identical markers and closes only on a run of the
same character that is at least as long, so a fence opened with a longer run swallows
every shorter run nested inside it — a naive open/close toggle unmasks the nested content
and is not sufficient.

Split the plan body into blocks at every `^### Task \d+:` heading.

**Skip the terminal block.** A block is terminal when the terminal anchor
`<!-- conport-finish -->` sits on the line immediately after its heading, outside fenced
code blocks. Position matters: a plan about this bridge mentions the anchor throughout its
prose, and containment-based detection would skip its real tasks. The terminal block is
the bridge's own, written by step 4.5, and is never reflected in ConPort. Reflecting it
would deadlock the epic: the block closes on a READY verdict, and READY requires every
child of the epic to be closed, including that block's own task.

For each block:

- Extract `<title>` from the heading line. Strip leading `Task N: ` so the ConPort task title is just the human name (e.g. `Parser` from `### Task 1: Parser`).
- Derive a short summary (one sentence) from the heading + the `**Files:**` block, or from the first non-empty line after the heading. Trim to ≤ 2000 chars.

Within the block, search for `<!--\s*conport-task:\s*(\d+)\s*-->` (outside fenced code blocks).

- Anchor found (captures `<task_id>`):
  ```
  mcp__conport__update_task({
    project_id, task_id: <task_id>,
    title: <title>,
    description: <short summary>
  })
  ```

- Anchor not found:
  ```
  mcp__conport__add_task({
    project_id,
    title: <title>,
    description: <short summary>,
    parent_task_id: <epic_id>,
    kind: 'task',
    priority: 3
  })
  ```
  Then write `<!-- conport-task: <id> -->` on a new line immediately after the `### Task N: <title>` heading in the file.

Verify each response echo (id positive, kind matches).

### 4.5 Write the execution contract back into the plan

Two blocks go into `<plan_path>`. Both are idempotent: on re-import each is replaced
whole, never duplicated. Neither is ever sent to ConPort.

**Mask fenced code blocks before locating either block.** Every search in this step — the
terminal heading, the terminal anchor, the paired contract anchors, the `## Global
Constraints` heading — runs over the masked view already used for the split in step 4
(nested-fence rule included, see the anchor cheat sheet). A plan that documents this
bridge quotes all of these verbatim inside its own examples; an unmasked search locks onto
the quotation and the rewrite swallows the prose around it.

**Precondition — the contract anchors are validated before anything is written.** In the
masked view, count the opening `<!-- conport-contract -->` lines and the closing
`<!-- /conport-contract -->` lines. Exactly one of each, opening before closing, is a
replacement. None of either is a first write. **Any other configuration — an unpaired
anchor, a closing anchor standing before the opening one, or a second pair left behind when
the user copied the section — is not a range: write nothing at all in this step, neither
block, and report the offending anchor lines with their line numbers so the user can remove
the copy.** Counting alone does not settle it: one anchor of each kind in the wrong order
counts as a pair and delimits nothing. Replacing the first pair and leaving the second
one alive is worse than refusing: the plan then carries two contracts, one of them stale,
and nothing says which one binds. The check runs before either write precisely so the
promise covers the whole file — a terminal block already appended by the time the anchors
are counted would make "the file is left unchanged" false.

**Terminal task — the primary carrier.** `<N>` is the highest task number already present
in the file (masked split, terminal block excluded) — the highest number, not the count of
blocks: a plan whose numbering has a gap (Task 3 deleted, 1, 2 and 4 left) would otherwise
reuse a number that is still in use. `<N+1>` therefore continues the plan's numbering. A
plan carrying no task block at all — none was ever written, or every one was removed — has
no highest number: `<N>` is 0 and the block is written as `### Task 1: ConPort finish`.
Written at EOF:

```markdown
### Task <N+1>: ConPort finish
<!-- conport-finish -->

The controller runs this itself and does not delegate it to a subagent.

**Do this last.** Its precondition is that the final whole-branch review has come back
clean and its fixes are merged. If you reach this task while another plan task is still
open, leave this one open and go back to that task — the final review is not due yet. If
every other task is closed but that review has not run, leave this one open, take the "no
tasks remain" branch to the final whole-branch review, finish that review's fix wave, and
then come back here. Nothing in the plan runs after this task.

Call superpowers-conport in finish mode for this plan. Carry out the prescription it
prints. This task is done only on a READY verdict.

Until READY: no workspace deletion, no finishing-a-development-branch, no release. The
SDD workspace and its ledger are the audit's own inputs, so they outlive this task and are
deleted after it, not before.

On READY this task is done and the plan is complete: go straight to SDD's own Finish step —
delete the workspace, hand over to finishing-a-development-branch. Do not dispatch the final
whole-branch review a second time.
```

Replacement rule: in the masked view, find the block whose heading matches
`### Task \d+: ConPort finish` and whose next line is the terminal anchor, running to the
next heading of **any** level or EOF — stopping only at `### ` would carry a following
`## ...` section into the block and destroy it on the move. That is stricter than the range
used to read a per-task anchor, deliberately so; `references/anchor-format.md` states both
and why they differ. Found → delete it in place and
re-append at EOF with the recomputed number; a plan edited after the first import may have
gained tasks below it, and a terminal block in the middle is terminal in name only. Not
found → append at EOF. Deletion takes the blank line directly above the heading along with
the block, and stops at the block's last line that is neither blank nor a **trailing**
horizontal rule — trailing meaning nothing but blank lines stands between that rule and the
end of the range. The blank lines directly above the following heading belong to that
heading as its separator, and taking them welds the terminal block's former neighbours
together.

A trailing horizontal rule (`---` on its own line) below the block is left in place for the
same reason. Plans written by `superpowers:writing-plans` separate tasks with it, so the rule
reads as the divider closing the task above it; once the terminal block leaves the middle of
the file, the rule goes on dividing the two neighbours it now sits between. A rule with
further text below it inside the range is a different thing — it divides nothing that the
move disturbs, it is interior to the block, and it goes with the block. **Only the block
itself moves.** No rule is synthesised at EOF to stand in for the one left behind, and a
rule the user put below the block when it was already at EOF stays where it is, above the
re-appended block, on every subsequent run — which is what keeps that run a no-op.

Before appending, trailing blank lines at EOF are trimmed, then exactly one blank line is
written between the preceding content and the heading — a file that already ends in several
blank lines otherwise makes the separator unreproducible, and every re-import grows or eats
a line, so the write is no longer a no-op.

**Contract block — the duplicate carrier.** Written into the plan's `## Global
Constraints` section, wrapped in the paired delimiter anchor:

```markdown
<!-- conport-contract -->
### ConPort execution contract
- Project <project_id> · Epic task-<epic_id> · Spec doc-<doc_id>.
- Definition of Done for this plan: every plan task complete AND epic task-<epic_id>
  closed. An executed plan with an open epic is NOT finished work.
- A finding not fixed in the current round (parked / deferred minor / BLOCKED /
  "cannot verify") is filed as a task immediately, in the same message that puts it in
  the ledger: add_task(parent_task_id=<epic_id>, priority=3).
- A finding that genuinely must wait is closed as CANCELLED with a resolution — an
  explicit act, never a default.
- The plan's terminal step is a call to superpowers-conport in `finish` mode on this plan,
  run by the controller after the final whole-branch review is clean and its fixes are
  merged. The work is not finished, the workspace is not deleted and nothing is released
  until that call returns a READY verdict.
<!-- /conport-contract -->
```

Block boundaries for replacement: **the paired anchor, and nothing else.** In the masked
view, find `<!-- conport-contract -->` and the first `<!-- /conport-contract -->` after it,
each on its own line, and replace everything from the opening line through the closing line
inclusive. No heading, `---` rule or blank line takes part in the boundary. Anything the
user wrote above the opening anchor or below the closing one — their own constraints, added
before or after the bridge first ran — lies outside the range and survives every re-import
untouched.

Unpaired and duplicated anchors never reach this point — the precondition at the top of the
step has already refused the whole step with the file untouched. Guessing where the block
ends is exactly how user text gets eaten.

First write, `## Global Constraints` already present: insert the wrapped block at the **end**
of that section — after its last constraint, above any horizontal rule that closes the
section, and above the next heading of any level; at EOF if the section is the last one.
Never at the top of the section: the user's existing constraints keep their order and their
position.

Blank lines around that first insertion are normalised, so that what the first write leaves
behind is exactly what a later replacement reproduces. The insertion point is directly after
the section's last line that is neither blank nor a **trailing** horizontal rule — trailing
meaning that nothing but blank lines stands between that rule and the following heading (or
EOF), the same sense the terminal block uses. Plans written by `superpowers:writing-plans`
close the constraints section with a `---` divider before the first task; the rule is not a
blank line, so an insertion point that skipped only blank lines would land below it and weld
the contract block onto the first task instead of the section it belongs to. The rule stays
where it is, below the block, and goes on dividing the section from the task that follows.
Whatever blank lines already stood between the insertion point and what follows it collapse
to exactly one blank line above the opening anchor, and exactly one blank line is written
between the closing anchor and the following content — the trailing rule if there is one,
otherwise the next heading. When the section ends the file with no trailing rule, the
closing anchor is the last line and the file ends with a single newline after it. Left
unspecified, the first write and the re-import disagree by a line, and the run that is
supposed to be a no-op rewrites the file instead.

First write, no `## Global Constraints` section: create the section immediately before the
first real task heading, with the wrapped block as its only content. A plan with no task
heading other than the terminal one has no first real task heading: create the section
immediately before the terminal block's heading instead, so the constraints still stand
above every task. A plan with no task heading at all — the terminal block not yet written,
or written after this — gets the section at EOF.

Both blocks are written with the Edit tool.

### 5. Link spec ↔ epic

If both `doc_id` and `epic_id` exist (whether created or updated this run):

```
mcp__conport__link_items({
  project_id,
  source_type: 'doc', source_id: <doc_id>,
  target_type: 'task', target_id: <epic_id>,
  relationship: 'clarifies'
})
```

Note: `source_type` is `'doc'`, not `'document'` — the link_items enum uses the short form.

Backend dedups, so re-runs are no-ops.

### 6. Report

Print one line per outcome:

```
[superpowers-conport]
  spec: doc-<N>   (created|updated)
  epic: task-<M>  (created|updated)
  tasks: <X> created, <Y> updated
  link: doc-<N> --clarifies--> task-<M>
```

## Mode: finish

Read-only audit. **Makes no writes at all** — not to ConPort, not to files. It reads three
sources and prints one prescription; every change is made by the agent that received it.
Rationale: the ledger can disagree with reality, and a silent close by an intermediary is
the worst kind of disagreement.

### Sources

The inputs are the ones named in `## Inputs` — `<plan_path>` and the paired `*-design.md`
it derives from. `project_id` is resolved exactly as in step 1: `init` on the repo-derived
name, which here is a lookup only — `finish` never creates a project, and never asks to.

**No such project.** When `init` reports the project does not exist there is no
`project_id`, so there is no listing, no children and no subject to audit. That is RELEASE
BLOCKED on the same grounds as a missing epic anchor: the audit found nothing, which is
never read as "nothing left to close". It prints the no-epic-anchor report (see
`### Output — no epic anchor`) with the project line in place of the anchor line —

```
  проект <name> в ConPort не найден — план не импортирован
```

— and the same single prescription: run the bridge in `import` mode on this plan, which is
where the question of creating the project is asked, then re-run `finish`.

1. `<plan_path>` anchors → `epic_id` (`conport-epic`), the per-task ids (`conport-task`),
   and the spec id from the paired `*-design.md` (`conport-spec`). Task anchors are used
   to spot plan tasks that never reached ConPort; the spec id goes into the report header
   of every verdict below, and the header line is omitted when the design file carries no
   `conport-spec` anchor — a missing spec is not on its own grounds to block.
   **No `conport-epic` anchor in the plan — the audit has no subject.** Either the plan was
   never imported or the anchor was edited out; either way there is nothing to audit and no
   grounds for a verdict about the work. That case is RELEASE BLOCKED, and the single
   prescription is to run the bridge in `import` mode on this plan and then re-run `finish`.
   An absent epic is never read as "nothing left to close".
2. `mcp__conport__list_tasks({project_id, parent_task_id: <epic_id>, status: 'ALL',
   include_description: true, include_snoozed: true, limit: 200, offset: 0})`. The MCP
   surface takes the singular parent id only; it returns no descriptions unless
   `include_description` is set, and hides children snoozed into the future unless
   `include_snoozed` is.
   **Read every page.** `limit` defaults to 50 on that surface, so an epic with more
   children than the limit returns a first page and nothing says so at a glance. An audit
   that stopped there would print READY over open tasks it never saw — the exact failure
   the mode exists to prevent. The response carries `total`: while the number of tasks
   received so far is below `total`, call again with `offset` set to that number. The
   verdict is computed over the union of the pages, never over one of them.
3. The SDD ledger, if still on disk:
   `$(git rev-parse --show-toplevel)/.superpowers/sdd/$(basename <plan_path> .md)/progress.md`.
   Its first line reads `# SDD ledger — plan: <path>`; if that path is not `<plan_path>`,
   the ledger belongs to another plan — ignore it and report it as not found. A stray
   ledger at the older flat path `.superpowers/sdd/progress.md` is likewise not yours.

**An open task** = a child of the epic whose status is not `DONE` / `CANCELLED`. `BLOCKED` and
`PARKED` count as open. The word is used in this sense for ConPort tasks only; a ledger
`fix round` line counts *findings* still open in that round, which is a different thing and is
spelled out that way wherever it appears below.

**Plan tasks that never reached ConPort.** Two shapes count, and each blocks the release on
its own: a plan task block (terminal block excluded) carrying no `conport-task` anchor at
all, and an anchor whose id appears on none of the pages of the listing — the epic with no
children at all, next to a plan that still carries task anchors, being the extreme case of
the second. Both mean the import is unfinished, not that the plan is finished: an epic that
is empty because its tasks never arrived is indistinguishable, from ConPort alone, from an
epic that is empty because there was nothing to do. They are listed on the report's
missing-tasks line and the verdict is RELEASE BLOCKED. An epic with zero children prints
READY only when the plan has no task block other than the terminal one.

### Ledger line formats

| Line | Meaning |
|---|---|
| `Task <N>: complete (commits <a>..<b>, review clean)` | plan task done |
| `Task <N>: complete (commits <a>..<b>, <K> parked)` | done, has deferred findings |
| `Task <N>: minor (deferred): <text>` | follow-up candidate |
| `Task <N>: parked — <finding> — ruling: <verdict>` | follow-up candidate |
| `Task <N>: BLOCKED — <reason>` | follow-up candidate |
| `Task <N>: fix round <R>/5 (<X> addressed, <Y> open — <finding one-liners>; commits …)` | if this is the LAST line about that task, its loop never closed: each of the `<Y>` findings still open in that round is a candidate, and the verdict is RELEASE BLOCKED regardless of ConPort state |

A candidate counts as already filed when some child of the epic carries a distinctive
fragment of the ledger line in its title or description. Matching is approximate and
deliberately biased toward a false "not filed": an extra line in the report is cheaper
than a silently lost finding.

**What the ledger does not cover.** Findings of the final whole-branch review have no line
format in SDD — at that stage the ledger is only read. The output therefore always carries
a reminder that they must be entered by hand if there were any.

### Output — blocked

```
[superpowers-conport finish]
  spec: doc-<N>
  epic: task-<M> — RELEASE BLOCKED
  открыто задач: 2
    task-<a> <title> (TODO)
    task-<b> <title> (BLOCKED)
  в плане есть, в ConPort нет: 1
    Task 6: <заголовок блока плана>
  в журнале есть, задачи нет: 1
    Task 4: parked — <находка> — ruling: <вердикт>
  незакрытый цикл правок: 1
    Task 5: fix round 3/5 — открыто находок: 2 — <находки одной строкой>
  журнал: разобран (12 строк)
  находки финального ревью журналом не покрыты — внеси вручную, если были

  Сделай сейчас:
    1. прогони superpowers-conport в режиме import на этом плане — он заведёт
       недостающие задачи плана, затем повтори finish
    2. add_task(parent_task_id=<M>, priority=3) — на находку выше
    3. update_task(task-<a>, IN_PROGRESS) и доделай
    4. доделай цикл правок по Task 5
  Релиз запрещён, пока эпик task-<M> не закрыт.
```

The counted lines carry only what was found: a category with a count of zero is omitted
rather than printed as `0`, and the missing-tasks line is the one that reports plan tasks
absent from the epic.

**Every printed reason has its own prescription item, and every item answers one reason.**
Dropping a category drops its item too, and the numbering closes up. Plan tasks absent from
ConPort are answered by the import — that is the same run of the bridge that files the plan's
missing tasks, so the audit names it rather than leaving the agent to invent a way to create
them by hand. Ledger candidates are answered by filing them, open children by finishing them,
an unclosed fix round by finishing that round.

**The fix-round item prescribes finishing the round and nothing else.** An item that also
offered "or write a completion line" would let the agent argue the block away instead of
clearing it, which is the deliberation the single-action rule below exists to prevent. There
is one state in which the round really is over and only the ledger lagged behind — the fixes
landed and were reviewed, but the closing line was never written. It is settled by recording
that round's completion in the ledger and re-running `finish`; from the ledger alone the audit
cannot tell that state from an unfinished round, so it prescribes the safe one and this
paragraph, not the report, carries the exception.

**A blocked report is never printed empty.** The zero-omission rule has one state in which it
could strip everything: the last ledger line about some task is a `fix round`, which blocks
regardless of ConPort state, while every candidate has already been filed and closed, the plan
carries no task absent from the epic, and the epic has no open children — all three of the
other categories zero. The block comes from the ledger, so the ledger is the reason: the
unclosed round gets its own counted line and its own item, exactly as shown above. The
invariant is that a RELEASE BLOCKED report always carries at least one reason line and at
least one prescription item; if the audit can name neither, the verdict was not blocked.

### Output — no epic anchor

The plan carries no `conport-epic` anchor, so there is no epic to name and no listing to
count. The report says exactly that and prescribes the import:

```
[superpowers-conport finish]
  spec: doc-<N>
  план: <plan_path> — RELEASE BLOCKED
  анкор conport-epic в плане не найден — план не импортирован
  Сделай сейчас: прогони superpowers-conport в режиме import на этом плане, затем повтори finish.
```

### Output — ready

```
[superpowers-conport finish]
  spec: doc-<N>
  epic: task-<M> — READY
  все задачи закрыты, в журнале отложенных находок нет
  находки финального ревью журналом не покрыты — внеси вручную, если были
  Сделай сейчас: update_task(task-<M>, DONE, resolution=...).
```

The reminder about the final review sits in this template too, and it matters more here than
in the blocked one: READY is the verdict the agent acts on by releasing, so the last thing it
reads before closing the epic has to be that the ledger never saw those findings.

**The prescription stops at closing the epic; it does not order the workspace deleted.**
Deleting it is SDD's own Finish step, gated on the final whole-branch review being clean —
a condition this audit reads nothing about and cannot certify. Worse, the ledger the audit
parses lives in that workspace: an audit that ordered its removal would be destroying the
evidence the next run needs, and would do it at the one moment the final review's findings
have not yet been entered anywhere. Closing the epic is safe on its own; the deletion waits
for the step that owns it.

The verdict prescribes the single next action. A menu of options gets the agent
deliberating instead of working.

### Degraded mode

No ledger on disk (deleted, executed by another skill, done by hand) → report from ConPort
alone. The verdict is still produced; the ledger only adds findings that never reached
ConPort, so its absence can never turn a blocked verdict into a ready one.

In the blocked report the ledger-status line becomes this one, in place of the line that
would have said how many ledger lines were parsed:

```
  журнал: не найден
```

The ready report has no ledger-status line to replace. Its summary line is what mentions
deferred findings, and with no ledger on disk that half of the sentence is an assurance
about a file nobody read. Replace the whole summary line with one that claims only what was
actually checked:

```
  все задачи закрыты; журнал: не найден — отложенные находки не проверены
```

## Anchor handling cheat sheet

- Detection regexes and stripping rules: see `references/anchor-format.md`.
- Anchors live in the file only. Never include an anchor in the markdown payload sent to ConPort.
- One anchor is paired: `<!-- conport-contract -->` … `<!-- /conport-contract -->` delimits the
  execution-contract block written by step 4.5. It addresses no ConPort entity; it exists so
  the rewrite has an explicit lower bound and cannot swallow the user's own text in
  `## Global Constraints`.
- When writing an anchor back, use Edit tool with the exact heading line as `old_string` and `<heading>\n<anchor>` as `new_string`. Heading-anchored Edit is safe even if other text in the file shifts.
- **Ignore anchors inside fenced code blocks.** A spec or plan can contain anchor *examples* inside ` ``` ` fences (e.g. the anchor-format reference itself, or a plan section that documents the bridge). Those must not be treated as real anchors — otherwise on re-import the skill would try to update unrelated ConPort ids. Before applying detection regexes, mask or skip lines that fall between paired fence markers (` ``` ` or `~~~`).
  A fence opens on a run of three or more identical markers and closes only on a run of the
  same character that is at least as long, so a fence opened with a longer run swallows
  every shorter run nested inside it; a naive open/close toggle leaves the nested content
  unmasked.
  The same masking applies to the `### Task N:` split itself, not only to anchor
  detection — otherwise a plan that quotes task headings inside examples produces phantom
  ConPort tasks.

## What this skill does NOT do

- Does not pull `[x]` checkbox state from `plan.md` back into `status=DONE` on ConPort tasks. That's a separate sync direction.
- Does not delete ConPort tasks that disappear from `plan.md`. Tasks orphaned in the file remain in ConPort; the user closes them manually if needed.
- Does not rewrite or normalize markdown content. Pass-through except for anchor strip,
  the execution-contract block and the terminal-task block (step 4.5).
- Does not handle more than one spec/plan pair per invocation. Run it once per pair.
- `finish` does not write anything — it never closes tasks, files follow-ups, or edits
  files. It reports; the agent acts.

## Post-write verification (Claude.ai quirk)

After every `add_document` / `update_document` / `add_task` / `update_task` call, confirm:
- Response `id` is a positive integer.
- `kind` echo on tasks matches what was requested (`'epic'` or `'task'`).
- `summary` is present.

On mismatch, re-issue the single call with field re-stated. If second attempt also drifts, abort and surface the discrepancy to the user verbatim (see post-write verification rules in the parent `conport` skill).
