# Anchor format

The bridge writes HTML-comment anchors into superpowers source files so re-imports map to the same ConPort entities. Anchors live in the file, never in the ConPort entity body (they are stripped before send).

## Five anchor types

| File | Position | Anchor |
|---|---|---|
| `*-design.md` | Line immediately after H1 | `<!-- conport-spec: doc-<id> -->` |
| `*.md` (plan) | Line immediately after H1 | `<!-- conport-epic: <task_id> -->` |
| `*.md` (plan) | Line immediately after each `### Task N: <title>` | `<!-- conport-task: <task_id> -->` |
| `*.md` (plan) | Line immediately after the terminal `### Task N:` heading | `<!-- conport-finish -->` |
| `*.md` (plan) | Own lines, wrapping the execution-contract block inside `## Global Constraints` | `<!-- conport-contract -->` … `<!-- /conport-contract -->` (paired) |

`<id>` is the per-project ConPort document id (decimal integer). `<task_id>` is the per-project ConPort task id. No quotes, no extra whitespace inside the comment beyond the single spaces shown.

Two of the five carry no id, because they address no ConPort entity.

`<!-- conport-finish -->` **excludes** its own block from the plan-to-tasks split. The
terminal block it marks is never reflected in ConPort — reflecting it would deadlock the
epic, since that block closes on a READY verdict and READY requires every child of the epic
to be closed, including that block's own task.

`<!-- conport-contract -->` … `<!-- /conport-contract -->` is the only **paired** anchor: it
delimits the execution-contract block that step 4.5 rewrites on every import. Both anchor
lines belong to the block and are replaced with it. The pair exists to give the rewrite an
explicit lower bound — without it the range has to be guessed from the next heading or a
`---` rule, and any constraint the user added to `## Global Constraints` after the bridge
first ran is deleted on the next import.

## Regex patterns

For detection:

- Spec: `<!--\s*conport-spec:\s*doc-(\d+)\s*-->`
- Epic: `<!--\s*conport-epic:\s*(\d+)\s*-->`
- Task: `<!--\s*conport-task:\s*(\d+)\s*-->`
- Terminal block: `<!--\s*conport-finish\s*-->`
- Contract block, opening: `^\s*<!--\s*conport-contract\s*-->\s*$`
- Contract block, closing: `^\s*<!--\s*/conport-contract\s*-->\s*$`

Per-task anchor must be matched within the task's block — from the `### Task N:` heading
down to the next `### Task` heading, the next heading standing *above* `###` (`#` or `##`,
which closes the task list), or EOF. A global scan would mix anchors between blocks.
Headings *below* `###` (`####` and deeper) are interior to a task block and do not end it.

The terminal block that step 4.5 of `SKILL.md` rewrites is delimited more strictly: it runs
to the next heading of **any** level, `####` included. The difference is deliberate, and it
follows from what each range is for. The per-task range is only ever read, so extra lines in
it cost nothing as long as it cannot reach the next task. The terminal range is deleted and
re-appended whole, so whatever it over-reaches is destroyed by the move — it stops at the
first heading it meets.

A terminal block is recognised by position, not by containment: the terminal anchor must
sit on the line **immediately following** the `### Task N:` heading, exactly like the
per-task anchor. A plan that merely mentions `conport-finish` in its prose — as any plan
about this bridge does — must not have its tasks skipped. As with every other anchor
pattern here, matches inside fenced code blocks do not count.

The contract pair is anchored to whole lines (hence the `^ … $` in both patterns). Step 4.5
counts the matches of both patterns over the masked view *before* it writes anything, and
accepts exactly two configurations: one opening anchor followed by one closing anchor (the
range to replace), or neither anchor present (a first write). Anything else is not a range —
an opening anchor with no closing anchor after it, a closing anchor with no opening one
before it, a closing anchor standing before the opening one, or a second pair left behind
when the section was copied. In that case the whole step is refused: neither the contract
block nor the terminal block is written, the file is left unchanged, and the user is told the
line numbers of the offending anchors. The second pair is why the count is taken rather than
just the first pair matched — replacing one pair and leaving the other alive would leave the
plan carrying two contracts, one of them stale, with nothing saying which one binds.
Fenced-code masking applies here too: a plan documenting this bridge prints the pair inside
its examples, and an unmasked match would put the range around the example.

## Strip before ConPort write

The skill always removes all five anchor types from markdown before sending content to ConPort (`add_document.content`, `update_document.content`, `add_task.description`, `update_task.description`). Strip regex:

```
<!--\s*conport-(spec|epic|task):\s*[a-z-]*\d+\s*-->\s*\n?|<!--\s*/?conport-(finish|contract)\s*-->\s*\n?
```

The second alternative is a belt-and-braces measure covering both id-less anchors, opening
and closing: neither the terminal block nor the contract block is sent to ConPort in the
first place, but the strip must be complete. The `/?` is what makes the closing anchor of
the contract pair match as well.

Otherwise anchors end up in the entity body, get embedded into the vector, and pollute semantic search.

## Example

Before first import (`docs/superpowers/plans/2026-05-21-foo.md`):

```markdown
# Foo Feature Implementation Plan

**Goal:** ...

### Task 1: Parser

...

### Task 2: Validator

...
```

After first import (anchors written back):

```markdown
# Foo Feature Implementation Plan
<!-- conport-epic: 320 -->

**Goal:** ...

### Task 1: Parser
<!-- conport-task: 321 -->

...

### Task 2: Validator
<!-- conport-task: 322 -->

...
```

Re-running the bridge on the same file now updates `task-320` (epic), `task-321`, `task-322` rather than creating duplicates.
