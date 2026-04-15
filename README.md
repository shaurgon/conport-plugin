# ConPort plugin

MCP integration + portable skills for [ConPort](https://conport.app) — project
context & agent memory. Packaged as a Claude Code plugin, but the MCP server
and skills work across many clients.

## What it ships

- **MCP server `conport`** — HTTP transport → `https://api.conport.app/mcp/`, Bearer auth. 40+ tools (decisions, tasks, patterns, documents, links, search, GraphRAG, agent memory).
- **Skills** (plain `SKILL.md`, portable)
  - `conport` — session context management (`init`, `search`, `log_progress`, `sync_decision`, …)
  - `conport-agent` — persistent agent identity & memory (`agent_init`, `agent_remember`, `agent_recall`, …)
- **Hooks** (Claude Code only, Node.js, zero deps)
  - `SessionStart` — fetches the deny-list (project conventions) from ConPort
  - `PreToolUse(Bash)` — blocks commands matching deny-list patterns
  - `UserPromptSubmit` — context restore + save reminder every 5 messages
  - `SessionEnd` — LLM-based reflection of unsaved decisions

## Install

Pick your client:

| Client | Guide |
|---|---|
| Claude Code | [docs/install/claude-code.md](./docs/install/claude-code.md) |
| Cursor | [docs/install/cursor.md](./docs/install/cursor.md) |
| Claude.ai (web) | [docs/install/claude-ai.md](./docs/install/claude-ai.md) |
| OpenClaw | [docs/install/openclaw.md](./docs/install/openclaw.md) |
| mcporter (generic MCP host) | [docs/install/mcporter.md](./docs/install/mcporter.md) |
| Paperclip | [docs/install/paperclip.md](./docs/install/paperclip.md) *(stub — verifying upstream)* |

Onboarding an operator (e.g. an OpenClaw agent told to "add conport by
instructions"): point them at [INSTRUCTIONS.md](./INSTRUCTIONS.md).

Get an API key at [me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect) — format is `cport_live_...`.

## Configuration (Claude Code)

| Variable | Where | Purpose |
|---|---|---|
| `user_config.api_key` | Plugin userConfig (prompted on install) | Auth for MCP + hooks |
| `CONPORT_PROJECT_ID` | `.claude/settings.local.json` env (optional) | Override numeric project id |
| `CONPORT_PROJECT_NAME` | `.claude/settings.local.json` env (optional) | Override project name |

Fallback when neither override is set: `basename(git remote)` → current dir name.

## Paths (Claude Code hooks)

- `${CLAUDE_PLUGIN_ROOT}` — read-only plugin install (scripts, skills)
- `${CLAUDE_PLUGIN_DATA}` — persistent per-plugin storage
  - `deny-list.json` — cached conventions
  - `hook_state/conport_reminder.json` — save-reminder counter
  - `session_logs/<session_id>_restored.flag` — "context already restored" markers
  - `session-end.log` — reflection debug log

## Migration from a manual Claude Code setup

1. Install the plugin (see the Claude Code guide above).
2. Remove the manual `conport` entry from `~/.claude.json` → `mcpServers`.
3. Remove conport-related hook entries from `~/.claude/settings.json`.
4. Delete `~/.claude/skills/conport` and `~/.claude/skills/conport-agent`.
5. Delete `~/.claude/hooks/guardrails/` + `user_prompt_submit.py` + `session-reflect.py`.

## Community & roadmap

- **Discussions** — feature ideas, Q&A, show-and-tell:
  [github.com/shaurgon/conport-plugin/discussions](https://github.com/shaurgon/conport-plugin/discussions)
- **Roadmap** — priorities and scope: [roadmap.md](./roadmap.md)
- **Bug reports** — [Issues](https://github.com/shaurgon/conport-plugin/issues)

ConPort is solo-maintained — top-voted Ideas get reviewed monthly, and
roadmap commitments are announced in the Announcements category.

