# Project status

## Prompt

> What's the status of the project?

## What happens

The `conport` skill produces a compact dashboard by chaining three MCP calls:

1. `mcp__conport__init` — returns `product_context`, `active_context`,
   `recent_decisions`, stats, and active tasks. In a shared team it also
   returns `me` (who you are), `backlog.mine` (your open tasks) and
   `in_progress_by_others` (what other people lead right now).
2. `mcp__conport__list_tasks` with `status: "IN_PROGRESS,REVIEW"` to surface
   what's actually in flight and what waits for a reviewer. In a shared team
   each row carries its `assignee`.
3. `mcp__conport__recent_activity` for the last 24–48 h — commits,
   progress entries, new decisions.

A task another person leads is named with its assignee — the email, else the
handle. Your own and free tasks carry no name. A Private Team shows no
assignees: every task there is yours.

## Sample output shape

```
[CONPORT] <project> (<handle>) · <n> decisions · <n> patterns

Focus
  Checkout redesign: cart and payment form in review …

Mine
  #<id> Payment form validation (in progress)

In progress
  #<id> Payment form validation
  #<id> Shipping rates cache — ann@example.com

In review
  #<id> Cart summary component (round 2)
  #<id> Address autocomplete — bob@example.com

Last 48h
  progress  "Cart summary component merged"
  decision  "#<id> Validate card numbers on the client first"
  commit    "feat(checkout): inline validation errors"
```

## Variants

- "Give me the status of epic #N" → add `parent_task_id: N`
  (the epic's number) to `list_tasks`, skip global activity.
- "What is on my plate?" → `list_tasks` with `assignee: "me"`.
- "What is free to take?" → `list_tasks` with `assignee: "none"`.
- "What changed since Monday?" → `recent_activity` with a wider window.
- "Just the numbers" → use the `stats` from `init` and stop there.
