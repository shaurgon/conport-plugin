---
name: superpowers-conport
description: Use when superpowers brainstorming/writing-plans produced a design.md + plan.md and the work needs to land in ConPort as a spec doc + epic + tasks. Idempotent via inline HTML-comment anchors written back into the source files.
metadata:
  version: 15.18.0
---

# superpowers-conport — Bridge

Imports superpowers brainstorming + writing-plans output into ConPort. Manual trigger; idempotent via inline HTML-comment anchors.

## When to use

User finished `superpowers:brainstorming` and `superpowers:writing-plans`, has `docs/superpowers/specs/<date>-<topic>-design.md` and (usually) `docs/superpowers/plans/<date>-<topic>.md`, and wants the work to live in ConPort as a spec doc + epic + tasks.

Also: the user re-ran the bridge after editing the source files and expects the corresponding ConPort entities to be updated, not duplicated.

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
- Strip all three anchor types from the body using:
  `<!--\s*conport-(spec|epic|task):\s*[a-z-]*\d+\s*-->\s*\n?`
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

Split the plan body into blocks at every `^### Task \d+:` heading. For each block:

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

## Anchor handling cheat sheet

- Detection regexes and stripping rules: see `references/anchor-format.md`.
- Anchors live in the file only. Never include an anchor in the markdown payload sent to ConPort.
- When writing an anchor back, use Edit tool with the exact heading line as `old_string` and `<heading>\n<anchor>` as `new_string`. Heading-anchored Edit is safe even if other text in the file shifts.
- **Ignore anchors inside fenced code blocks.** A spec or plan can contain anchor *examples* inside ` ``` ` fences (e.g. the anchor-format reference itself, or a plan section that documents the bridge). Those must not be treated as real anchors — otherwise on re-import the skill would try to update unrelated ConPort ids. Before applying detection regexes, mask or skip lines that fall between paired fence markers (` ``` ` or `~~~`).

## What this skill does NOT do

- Does not pull `[x]` checkbox state from `plan.md` back into `status=DONE` on ConPort tasks. That's a separate sync direction.
- Does not delete ConPort tasks that disappear from `plan.md`. Tasks orphaned in the file remain in ConPort; the user closes them manually if needed.
- Does not rewrite or normalize markdown content. Pass-through except for anchor strip.
- Does not handle more than one spec/plan pair per invocation. Run it once per pair.

## Post-write verification (Claude.ai quirk)

After every `add_document` / `update_document` / `add_task` / `update_task` call, confirm:
- Response `id` is a positive integer.
- `kind` echo on tasks matches what was requested (`'epic'` or `'task'`).
- `summary` is present.

On mismatch, re-issue the single call with field re-stated. If second attempt also drifts, abort and surface the discrepancy to the user verbatim (see post-write verification rules in the parent `conport` skill).
