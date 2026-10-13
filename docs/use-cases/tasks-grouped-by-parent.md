# Tasks grouped by parent

## Prompt

> Show me the TODO tasks, grouped by parent.

## What happens

1. The `conport` skill calls `mcp__conport__init` if it hasn't already
   happened this session.
2. It calls `mcp__conport__list_tasks` with `status: "TODO"`.
3. It walks the result and buckets each task by `parent_task_id`.
   Root tasks (`parent_task_id == null`) head the list; children nest
   under their parent with their own `#number`, priority, and title.

## Sample output shape

```
EPIC #<epic> — Checkout redesign
  ├─ #<id>  Cart summary component   (P4)
  └─ #<id>  Payment form validation  (P4)

Root
  ├─ #<id>  Update privacy notice    (P3)
  ├─ #<id>  Feedback form            (P3)
  └─ #<id>  Shipping rates table     (P3)
```

## Variants worth knowing

- "Show the IN_PROGRESS tree for epic #N" → `list_tasks` with
  `status: "IN_PROGRESS"` and `parent_task_id: N` (the epic's number).
- "Hide completed, show the last 7 days' activity on top" → add
  `recent_activity` before the task list.
- "Flatten to a single priority-sorted list" → same call, different
  presentation; ask explicitly.
