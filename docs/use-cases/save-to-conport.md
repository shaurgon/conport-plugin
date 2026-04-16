# Save everything important to ConPort

## Prompt

> Save what matters from this session to ConPort.

## What happens

The `conport` skill reviews the session so far and writes durable records,
picking the right tool for each piece:

- **Architectural decisions with rationale** → `mcp__conport__sync_decision`
  (summary + rationale + tags). One decision per distinct trade-off, not
  one per commit.
- **Progress / what-was-done** → `mcp__conport__log_progress` (title +
  description, optionally `linked_item_type + linked_item_id` to tie it
  to a task or decision).
- **Reusable pattern learned** → `mcp__conport__log_pattern` (name +
  description + tags).
- **Focus / open questions drift** → `mcp__conport__update_active_context`
  (merge into `current_focus`, `open_questions`, `recent_changes`).

It deliberately does **not** write:
- Code diffs (those live in git).
- Minute-by-minute timeline (use the `session-reflect` hook for that — it
  fires automatically on exit).
- Secrets, keys, or any credential material.

## Checkpoint cadence

The `UserPromptSubmit` hook fires a soft nudge every 5 prompts without a
save (`"ConPort: N changes without save. Use sync_decision / log_progress."`).
Treat it as "flush, then continue" — short entries are better than none.

## Variants

- "Save this decision" → single `sync_decision` call for the current topic.
- "Log what I just did" → single `log_progress` call, no decision.
- "Update active_context focus to X" → `update_active_context` only.
