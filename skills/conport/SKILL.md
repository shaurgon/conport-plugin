---
name: conport
description: Use when managing project context - task planning, progress tracking, documentation, searching project information. Must run init at session start.
metadata:
  version: 8.0.0
---

# ConPort — Project Management System

> **ConPort stores everything about the project:** tasks, documents, decisions, infrastructure.
> **Without init, context is unavailable.** Without search, you are answering blindly.

### MCP Prefix

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

---

## FIRST ACTION OF THE SESSION

### Step 1: Determine the project name

**Claude Code CLI** — the env var `CONPORT_PROJECT_NAME` is already available (from `.claude/settings.local.json`).
If it's not set, fall back in this priority order:

1. **Git remote** — extract the repo name (last segment of the URL without `.git`)
2. **Directory name** — basename of the current working directory

**Claude.ai Chat** — ask the user (the file system is not available).

### Step 2: Call init

```
mcp__conport__init({ name: "<detected_name>" })
```

If auto-detection did not work, ask the user.

### After init — MANDATORY:

1. **Print summary:** `[CONPORT] {summary from response}`
2. **Execute instructions** from the response (read files, apply rules)
3. **Report active tasks** (if `active_tasks` is present — TODO and IN_PROGRESS)
4. **If the project is empty** (no decisions, no patterns, empty `product_context`) — offer the bootstrap flow from `references/bootstrap.md`.

**Without init you cannot:** answer questions about the project or work with tasks.
**Ignoring instructions is FORBIDDEN.**

---

## WORKFLOW — When to call which tool

### Planning

| Trigger | Tool |
|---------|------|
| "We need to do X" | `add_task` with priority |
| "X depends on Y" | `add_task_dep` |
| "Break it into subtasks" | `add_task` with `parent_task_id` |

### Execution

| Trigger | Tool |
|---------|------|
| Starting work | `update_task` → IN_PROGRESS |
| Done / Finished | `update_task` → DONE |
| Blocked | `update_task` → BLOCKED |

### Patterns

| Trigger | Tool |
|---------|------|
| "Show me the patterns" | `list_patterns` |
| "Record a pattern" | `log_pattern` with name, description, tags |
| "What approaches do we use?" | `list_patterns` or `search` by topic |

### Search

| Trigger | Tool |
|---------|------|
| Question about the project | `search` BEFORE answering |
| "What was decided about Y?" | `search` by topic |

### Sync

| Trigger | Tool |
|---------|------|
| Technology choice | `sync_decision` |
| Trade-off with rationale | `sync_decision` |

### Progress

| Trigger | Tool |
|---------|------|
| Something was done | `log_progress` |
| Context has changed | `update_active_context` |

### Documentation

| Trigger | Tool |
|---------|------|
| Spec / API docs | `add_document` |
| Document update | `update_document` |

---

## OUTPUT FORMAT

MCP tools return JSON with a `summary` field. Use it to inform the user.

| After | Format |
|-------|--------|
| `init` | `[CONPORT] {summary}` |
| `search` | `[ConPort: N results found for "query"] ...` |
| `update_task` | `✅ {summary}` |
| Task DONE | `✅ {summary}` + suggest updating active_context |

---

## MCP ERROR HANDLING

On an `Invalid arguments for tool` error:

1. **READ `path`** — the name of the broken parameter
2. **READ `expected`** — the required type
3. **FIX ONLY THAT PARAMETER**
4. **DO NOT TOUCH OTHER PARAMETERS**

| `path` | Fix |
|--------|-----|
| `project_id` | `"4"` → `4` |
| `tags` | `"tag"` → `["tag"]` |
| `priority` | `"3"` → `3` |

---

## CHECKLIST

- [ ] Has `init` been run?
- [ ] Question about the project → has `search` been done?
- [ ] New work → task created/updated?
- [ ] Work finished → task = DONE?
- [ ] Decision made → `sync_decision`?
- [ ] Important information → document created?

**Full API:** `references/command_list.md`
**Fresh-project onboarding:** `references/bootstrap.md`

---

*v8.0.0 | 40 MCP tools | Auto-detection | GraphRAG enabled*
