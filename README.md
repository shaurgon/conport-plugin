# ConPort plugin

MCP integration + portable skills for [ConPort](https://conport.app) — project
context & agent memory. Packaged as a Claude Code plugin, but the MCP server
and skills work across many clients.

## What it ships

- **MCP server `conport`** — HTTP transport → `https://api.conport.app/mcp/`, Bearer auth. 40+ tools (decisions, tasks, patterns, documents, links, search, GraphRAG).
- **Skills** (plain `SKILL.md`, portable)
  - `conport` — session context management (`init`, `search`, `log_progress`, `sync_decision`, …); files a public GitHub issue here when ConPort itself has a defect, lacks a capability or gives a refusal that says nothing to act on ([docs/use-cases/agent-issues.md](./docs/use-cases/agent-issues.md))
  - `conport-routine` — one iteration of a periodic backlog cycle: agenda, housekeeping, ready tasks, run digest
  - `conport-roadmap` — the roadmap rules: a release milestone holds its epics, waiting and undated work in standing milestones, what may be said about a release
  - `superpowers-conport` — bridge for Claude Code's superpowers plugin: imports `docs/superpowers/specs/*-design.md` + `docs/superpowers/plans/*.md` into ConPort as spec + epic + tasks. Idempotent. Its `finish` mode audits the plan's epic once the work is done and prints a release-readiness verdict. With the Superpowers overlay on, `import` writes nothing and names `plan import`; `finish` audits a pulled plan through its `.conport.json`, with the overlay on or off.
- **Workflows** (Claude Code, paid plan)
  - `/conport:task` — deterministic execution of one ConPort task (worktree, independent review through REVIEW and the task journal, gated merge, close with resolution)
  - `/conport:epic` — the same for a whole epic: the plan is sliced into tasks, they run in waves, and the epic closes on the run's verdict
  - bundled helper `workflows/wf-helper.mjs` — the mechanical half of both (preflight, gate, merge, cleanup, accounting, the review cycle, scouting), so no step of a run depends on a model's mood

  See [docs/workflows.md](./docs/workflows.md).
- **Agents** (Claude Code) — typed subagents for subagent-driven development, listed among your agent types under the plugin's name:
  - `conport:sdd-implementer` — one plan task end to end: TDD, commits, a report
  - `conport:sdd-task-reviewer` — one task's diff, two verdicts (spec compliance, code quality); read-only
  - `conport:sdd-fixer` — applies a review's findings to one task, nothing else
  - `conport:sdd-gap-hunter` — what a plan or a finished slice is missing; read-only
  - `conport:sdd-final-reviewer` — a whole epic branch against its spec, after every task has merged; read-only

  None of them may start subagents of its own, and none pins a model: each runs on the model of your session. The workflows dispatch the first four; `conport:sdd-final-reviewer` is started by the session that leads an epic with subagent-driven development and hands its findings back in its answer. Dispatch any of them by hand the same way. See [docs/workflows.md](./docs/workflows.md#the-agents).
- **Hooks** (Claude Code only, Node.js, zero deps)
  - `SessionStart` — fetches the deny-list (project conventions) from ConPort; with the Superpowers overlay on, passes the overlay rules to the session
  - `PreToolUse(Bash)` — blocks commands matching deny-list patterns; with the Superpowers overlay on, refuses a commit that adds a new file under `docs/superpowers/specs/` or `docs/superpowers/plans/`
  - `PostToolUse(add_task / update_task)` — records the epics this session changed
  - `UserPromptSubmit` — context restore + save reminder every 5 messages + `[TAILS]` reminder for epics near closing, printed only when its composition changed
  - `Stop` — holds the end of the turn once while an epic this session changed still has open children, and lists them (epics that grew after work started first)

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
| `CONPORT_PROJECT_NAME` | `.claude/settings.local.json` env (**required**) | The project's handle (`prk7m2qx9d` — shown by `init`, `list_projects` and the projects page of the dashboard), or its name: `<project>` for a personal repository, `k7m2qx9d/<project>` for a team's one (the team ID is on the team's settings page) |

`CONPORT_PROJECT_ID` is no longer read. While it is set, every session starts
with one line saying so; move the project's handle or name into
`CONPORT_PROJECT_NAME` and remove it.

## Superpowers overlay

In a project that works with the Superpowers skills, the overlay keeps specs
and plans in ConPort instead of git: the spec is a `spec` document, the plan a
`plan` document, and the epic's tasks are tied to the plan's sections. Turn it
on with `.superpowers/config.json` at the root of the repository:

```json
{ "conport": { "superpowers": true } }
```

The file at the root of the current worktree decides on its own; the main
worktree's file is read only when the current worktree has none. Add one line
to the project's instructions (`CLAUDE.md` or `AGENTS.md`):
`Specs and plans of this project live in ConPort — follow the ConPort Superpowers overlay`.
The rules are [skills/conport/references/superpowers-overlay.md](./skills/conport/references/superpowers-overlay.md);
they call the `conport` CLI as `npx -y conport@^0.7`. The CLI does not see the
plugin's `api_key`: it needs `CONPORT_API_KEY` in the environment or in
`~/.config/conport/.env`.

| Command | Does |
|---|---|
| `documents get doc-N [-o <file>] [--force]` | Writes a document to a local file (default `.superpowers/docs/doc-N.md`) with a `<file>.conport.json` beside it |
| `plan import <file> [--spec doc-N] [--epic N] [--milestone N]` | Stores a plan file as a `plan` document and creates or updates its epic and one task per `### Task N:` section |
| `plan pull <epic\|doc-N> [-o <file>] [--force]` | Writes the plan with its finish tail to a local file (default `.superpowers/plans/doc-M.md`) |
| `superpowers migrate [--apply]` | Moves the specs and plans the bridge had half-imported into ConPort documents; without `--apply` it only reports |
| `superpowers relink [--apply]` | Turns the `Spec:` and `Plan:` lines earlier imports wrote into task descriptions into graph links (plan `clarifies` task, plan `derived_from` spec) and removes the lines; without `--apply` it only reports |

`--force` overwrites a local file edited since it was written, discarding the
edits. Turning the overlay off: remove the key; the `plan` documents stay in
ConPort.

## Paths (Claude Code hooks)

- `${CLAUDE_PLUGIN_ROOT}` — read-only plugin install (scripts, skills)
- `${CLAUDE_PLUGIN_DATA}` — persistent per-plugin storage
  - `deny-list.json` — cached conventions
  - `hook_state/conport_reminder.json` — save-reminder counter
  - `session_logs/<session_id>_restored.flag` — "context already restored" markers

## Community & roadmap

- **Discussions** — feature ideas, Q&A, show-and-tell:
  [github.com/shaurgon/conport-plugin/discussions](https://github.com/shaurgon/conport-plugin/discussions)
- **Roadmap** — priorities and scope: [conport.app/roadmap](https://conport.app/roadmap)
- **Pricing** — free + two beta paid tiers: [conport.app/pricing](https://conport.app/pricing)
- **Data handling** — what we store, where, who sees it, how to export/delete: [conport.app/data-handling](https://conport.app/data-handling)
- **Bug reports** — [Issues](https://github.com/shaurgon/conport-plugin/issues); agents file theirs with titles starting `[agent-report] `, through the *Agent report* form (which also sets the label `agent-report`) or `gh`

ConPort is solo-maintained — top-voted Ideas get reviewed monthly, and
roadmap commitments are announced in the Announcements category.

