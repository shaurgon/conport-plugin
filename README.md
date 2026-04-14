# ConPort Plugin

Claude Code plugin that bundles MCP integration, skills, and hooks for
[ConPort](https://conport.app) — project context & agent memory.

## What it installs

- **MCP server** `conport` (streamable HTTP → `https://api.conport.app/mcp/`) with 40+ tools for decisions, tasks, patterns, documents, custom data, links, search, GraphRAG, agent memory.
- **Skills**
  - `conport` — session context management (init, search, log_progress, sync_decision, …)
  - `conport-agent` — persistent agent memory (agent_init, agent_remember, agent_recall, …)
- **Hooks**
  - `SessionStart` — fetches the deny-list (project conventions) from ConPort
  - `PreToolUse(Bash)` — blocks commands matching deny-list patterns
  - `UserPromptSubmit` — context restore + save reminder every 5 messages
  - `SessionEnd` — LLM-based reflection of unsaved decisions from the transcript

## Install

```bash
claude plugins marketplace add https://github.com/shaurgon/conport-plugin
claude plugins install conport
```

On install Claude asks for `api_key` — a ConPort key like `cport_live_...`.
Generate one at [me.conport.app/settings/api-keys](https://me.conport.app/settings/api-keys).

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `user_config.api_key` | Plugin userConfig (prompted on install) | Auth for MCP + hooks |
| `CONPORT_PROJECT_ID` | `.claude/settings.local.json` env (optional) | Override numeric project id |
| `CONPORT_PROJECT_NAME` | `.claude/settings.local.json` env (optional) | Override project name |

If neither override is set the hooks fall back to `basename(git remote)` or the current directory name.

## Paths

- `${CLAUDE_PLUGIN_ROOT}` — plugin install location (read-only: scripts, skills)
- `${CLAUDE_PLUGIN_DATA}` — persistent per-plugin storage
  - `deny-list.json` — cached conventions from ConPort
  - `hook_state/conport_reminder.json` — save-reminder counter
  - `session_logs/<session_id>_restored.flag` — "context already restored" markers
  - `session-end.log` — reflection debug log

## Migration from the manual setup

1. `claude plugins install conport`
2. Remove the manual `conport` entry from `.claude/settings.local.json` → `mcpServers`
3. Remove the hook entries in `~/.claude/settings.json` that pointed to `~/.claude/hooks/guardrails/*` and `~/.claude/hooks/session-reflect.py`
4. Delete `~/.claude/skills/conport/` and `~/.claude/skills/conport-agent/`

## Runtime

Hook scripts are plain Node.js (no external dependencies — only built-ins: `fs`, `http`/`https`, `child_process`, `path`). Since Claude Code itself runs on Node, nothing else needs to be installed.

## Local development

From the `conport-global` repo:

```bash
claude --plugin-dir ./plugin
```

Adjust scripts under `plugin/scripts/`, hot-reload `claude --plugin-dir ./plugin` to pick them up.
