# Anchor format

The bridge writes HTML-comment anchors into superpowers source files so re-imports map to the same ConPort entities. Anchors live in the file, never in the ConPort entity body (they are stripped before send).

## Three anchor types

| File | Position | Anchor |
|---|---|---|
| `*-design.md` | Line immediately after H1 | `<!-- conport-spec: doc-<id> -->` |
| `*.md` (plan) | Line immediately after H1 | `<!-- conport-epic: <task_id> -->` |
| `*.md` (plan) | Line immediately after each `### Task N: <title>` | `<!-- conport-task: <task_id> -->` |

`<id>` is the per-project ConPort document id (decimal integer). `<task_id>` is the per-project ConPort task id. No quotes, no extra whitespace inside the comment beyond the single spaces shown.

## Regex patterns

For detection:

- Spec: `<!--\s*conport-spec:\s*doc-(\d+)\s*-->`
- Epic: `<!--\s*conport-epic:\s*(\d+)\s*-->`
- Task: `<!--\s*conport-task:\s*(\d+)\s*-->`

Per-task anchor must be matched within the task's block (from `### Task N:` heading to next `### Task` heading or EOF) — a global scan would mix anchors between blocks.

## Strip before ConPort write

The skill always removes all three anchor types from markdown before sending content to ConPort (`add_document.content`, `update_document.content`, `add_task.description`, `update_task.description`). Strip regex:

```
<!--\s*conport-(spec|epic|task):\s*[a-z-]*\d+\s*-->\s*\n?
```

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
