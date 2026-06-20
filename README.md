# ConPort plugin

MCP integration + portable skills for [ConPort](https://conport.app) — project
context & agent memory. Packaged as a Claude Code plugin, but the MCP server
and skills work across many clients.

## What it ships

- **MCP server `conport`** — HTTP transport → `https://api.conport.app/mcp/`, Bearer auth. 40+ tools (decisions, tasks, patterns, documents, links, search, GraphRAG).
- **Skills** (plain `SKILL.md`, portable)
  - `conport` — session context management (`init`, `search`, `log_progress`, `sync_decision`, …)
  - `superpowers-conport` — bridge for Claude Code's superpowers plugin: imports `docs/superpowers/specs/*-design.md` + `docs/superpowers/plans/*.md` into ConPort as spec + epic + tasks. Idempotent.
- **Hooks** (Claude Code only, Node.js, zero deps)
  - `SessionStart` — fetches the deny-list (project conventions) from ConPort
  - `PreToolUse(Bash)` — blocks commands matching deny-list patterns
  - `UserPromptSubmit` — context restore + save reminder every 5 messages
  - `SessionEnd` — LLM-based reflection of unsaved decisions

## Install — one line, any agent

Give your coding agent this single instruction and it installs and configures
ConPort itself:

> Install ConPort from github.com/shaurgon/conport-plugin and set it up for this project.

The agent reads [INSTALL.md](./INSTALL.md) from this repo and follows it: it
picks the right path for your harness (CLI or MCP), installs the discipline
skill, and verifies the connection. You configure nothing by hand — you only
supply your API key once when the agent asks.

Get an API key at [me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect) — format is `cport_live_...`. Never paste it into chat; the agent reads it from the `CONPORT_API_KEY` environment variable.

### Prefer to set it up by hand?

Pick your client and follow the per-harness guide:

| Client | Guide |
|---|---|
| Claude Code | [docs/install/claude-code.md](./docs/install/claude-code.md) |
| Cursor | [docs/install/cursor.md](./docs/install/cursor.md) |
| Claude.ai (web) | [docs/install/claude-ai.md](./docs/install/claude-ai.md) |
| Other agents (`npx skills add`) | [docs/install/other-agents.md](./docs/install/other-agents.md) |

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

## Community & roadmap

- **Discussions** — feature ideas, Q&A, show-and-tell:
  [github.com/shaurgon/conport-plugin/discussions](https://github.com/shaurgon/conport-plugin/discussions)
- **Roadmap** — priorities and scope: [roadmap.md](./roadmap.md)
- **Pricing** — free + two beta paid tiers: [pricing.md](./pricing.md)
- **Data handling** — what we store, where, who sees it, how to export/delete: [data-handling.md](./data-handling.md)
- **Bug reports** — [Issues](https://github.com/shaurgon/conport-plugin/issues)

ConPort is solo-maintained — top-voted Ideas get reviewed monthly, and
roadmap commitments are announced in the Announcements category.

