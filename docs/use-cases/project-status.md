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
[CONPORT] <project> (ID: <project id>) · <n> decisions · <n> patterns

Focus
  Checkout redesign: cart and payment form in review …

In progress
  #<id> Payment form validation

Last 48h
  progress  "Cart summary component merged"
  decision  "#<id> Validate card numbers on the client first"
  commit    "feat(checkout): inline validation errors"
```

## Variants

- "Give me the status of epic #N" → add `parent_task_id: N`
  (the epic's number) to `list_tasks`, skip global activity.
- "What changed since Monday?" → `recent_activity` with a wider window.
- "Just the numbers" → use the `stats` from `init` and stop there.
