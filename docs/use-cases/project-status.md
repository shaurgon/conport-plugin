# Project status

## Prompt

> What's the status of the project?

## What happens

The `conport` skill produces a compact dashboard by chaining three MCP calls:

1. `mcp__conport__init` — returns `product_context`, `active_context`,
   `recent_decisions`, stats, and active tasks.
2. `mcp__conport__list_tasks` with `status: "IN_PROGRESS"` to surface what's
   actually in flight.
3. `mcp__conport__recent_activity` for the last 24–48 h — commits,
   progress entries, new decisions.

## Sample output shape

```
[CONPORT] conport-global (ID: 4) · 201 decisions · 27 patterns

Focus
  Post-infrastructure: three-domain stack live …

In progress
  #140 Multi-client distribution

Last 48h
  progress  "Phase 3: marketplace repo + CI sync"
  decision  "#281 Use mirror repo for plugin distribution"
  commit    "feat(landing): six-client install tabs"
```

## Variants

- "Give me the status of epic #88" → add `parent_task_id: 88` to
  `list_tasks`, skip global activity.
- "What changed since Monday?" → `recent_activity` with a wider window.
- "Just the numbers" → use the `stats` from `init` and stop there.
