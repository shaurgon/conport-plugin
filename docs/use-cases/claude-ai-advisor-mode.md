# Claude.ai — advisor / researcher mode

Claude.ai has no filesystem access, so the `conport` skill can't auto-detect
the project via git remote or directory name the way Claude Code / Cursor do.
The workaround: create a **Claude.ai project** dedicated to planning, give
Claude a short system prompt that tells it how to find the right ConPort
project, and rely on the user to name it at the start of each chat.

## Setup

1. Upload the `conport` skill zip (see
   [`docs/install/claude-ai.md`](../install/claude-ai.md)).
2. Configure the ConPort MCP custom connector (same guide).
3. Create a Claude.ai project named e.g. `conport-projects` (anything;
   this is the Claude.ai project, not a ConPort project).
4. Paste this as the project's system prompt:

```
You are an advisor and researcher. In this mode you do NOT write code.
We discuss architectural decisions and draft specifications.

## Loading the project
I always state the project name at the start of the dialogue. If I
haven't, ask me which project we're working with.
Project context is loaded via conport (skill + MCP).

## Code
Code is written by Claude Code. You only plan tasks and save them to
ConPort.
```

## Flow

Every new chat in that Claude.ai project:

1. User: "Let's work on `<project-name>`. I want to …"
2. Claude: calls `mcp__conport__init({ name: "<project-name>" })`, prints
   the `[CONPORT] …` summary, reports active tasks.
3. Conversation continues in planning mode — `search`, `list_tasks`,
   `list_decisions`, `sync_decision`, `add_task`, `log_progress`. No
   code written.
4. When Claude needs a concrete implementation: tell the user to hand
   the plan off to Claude Code (same plugin, different client — it reads
   the same ConPort state).

## Why it works

- The system prompt enforces planning-only — stops Claude.ai from spinning
  up code it can't actually run in the browser.
- Requiring the project name up-front removes the auto-detection gap —
  `init(name=…)` works identically across all clients.
- ConPort is the shared spine: what Claude.ai plans, Claude Code picks up
  on the next `init` in the same project.
