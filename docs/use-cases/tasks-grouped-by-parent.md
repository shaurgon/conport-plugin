# Tasks grouped by parent

## Prompt

> Show me the TODO tasks, grouped by parent.

## What happens

1. The `conport` skill calls `mcp__conport__init` if it hasn't already
   happened this session.
2. It calls `mcp__conport__list_tasks` with `status: "TODO"`.
3. It walks the result and buckets each task by `parent_task_number`.
   Root tasks (`parent_task_number == null`) head the list; children nest
   under their parent with their own `#number`, priority, and title.

## Sample output shape

```
EPIC #88 — Phase 1 Auth
  ├─ #94  Frontend dashboard       (P4)
  └─ #101 ConPort plugin           (P4)

Root
  ├─ #120 Data handling statement  (P3)
  ├─ #121 Roadmap feedback channel (P3)
  └─ #122 Pricing tiers            (P3)
```

## Variants worth knowing

- "Show the IN_PROGRESS tree for epic #88" → `list_tasks` with
  `status: "IN_PROGRESS"` and `parent_task_number: 88`.
- "Hide completed, show the last 7 days' activity on top" → add
  `recent_activity` before the task list.
- "Flatten to a single priority-sorted list" → same call, different
  presentation; ask explicitly.
