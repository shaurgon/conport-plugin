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
  - `superpowers-conport` — bridge for Claude Code's superpowers plugin: imports `docs/superpowers/specs/*-design.md` + `docs/superpowers/plans/*.md` into ConPort as spec + epic + tasks. Idempotent. Its `finish` mode audits the plan's epic once the work is done and prints a release-readiness verdict. With the Superpowers overlay on, `import` writes nothing and names `plan import`; `finish` audits a pulled plan through its `<file>.conport.json`, with the overlay on or off.
- **Agents** (Claude Code) — typed subagents for subagent-driven development and for the review of the project model, listed among your agent types under the plugin's name:
  - `conport:sdd-implementer` — one plan task end to end: TDD, commits, a report
  - `conport:sdd-task-reviewer` — one task's diff, two verdicts (spec compliance, code quality); read-only
  - `conport:sdd-fixer` — applies a review's findings to one task, nothing else
  - `conport:sdd-gap-hunter` — what a plan or a finished slice is missing; read-only
  - `conport:sdd-final-reviewer` — a whole epic branch against its spec, after every task has merged; read-only
  - `conport:model-reviewer` — a document's draft portion of the project model against the document's text, before it is submitted; read-only; started by the session that submits the portion

  None of them may start subagents of its own, and none pins a model: each runs on the model of your session. The session that leads an epic with subagent-driven development dispatches them, the model reviewer aside; it starts `conport:sdd-final-reviewer` once, after every task has merged, and the reviewer hands its findings back in its answer. Dispatch any of them by hand the same way. See [docs/agents.md](./docs/agents.md).
- **Hooks** (Claude Code only, Node.js, zero deps)
  - `SessionStart` — fetches the deny-list (project conventions) from ConPort; with the Superpowers overlay on, tells the session so and names the file of the overlay rules
  - `PreToolUse(Bash)` — blocks commands matching deny-list patterns; with the Superpowers overlay on, refuses a commit that adds a new file under `docs/superpowers/specs/` or `docs/superpowers/plans/`
  - `PreToolUse(add_task / update_task)` — holds a new task in an epic that has a plan (a started plan or a plan document), and an `update_task` that attaches a task with no epic to one: without `Why not a fix round:` at the start of the description it says a finding is a fix round; with it, it asks for the person's reply `allow epic <N> in <project>` and lets one call through per reply; a subagent is told to hand the task to the session that dispatched it; when ConPort does not answer, it says to call again and writes the cause to `epic-growth-guard.log` in the plugin's data folder (`CLAUDE_PLUGIN_DATA`, else `~/.claude/plugin-data/conport`; the log keeps its newer half past 64 KiB). An epic without a plan, the tails epic of a release and a move between epics pass. `CONPORT_EPIC_GROWTH_GUARD=off` in the environment of Claude Code turns it off. The ConPort server must be connected under a name with `conport`, `Conport`, `ConPort` or `conPort` in it (the plugin's `.mcp.json` does so). A hook that does not answer within its 10 seconds refuses the call on Claude Code 2.1.295 or later (`onFailure: "block"`); an older Claude Code lets such a call through
  - `PostToolUse(add_task / update_task / delete_task)` — records the epics this session changed and drops the cached `[TAILS]` rows, so the next message fetches them again
  - `UserPromptSubmit` — context restore + save reminder every 5 messages + `[TAILS]` reminder for epics near closing, printed only when its composition changed; a message that is exactly `allow epic <N> in <project>` (or `allow epic <N>` in a session with a project) records the person's one-time consent to add a new task to that epic. Only the person gives it: `PreToolUse(Bash)` refuses any command that names the consent file `epic-growth-allow`
  - `Stop` — holds the end of the turn once while an epic this session changed still has open children, lists them (epics that grew after work started first) and says the epic is not done: dispatch them now, or name the reason each cannot start

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

| Setting | Where | Purpose |
|---|---|---|
| `user_config.api_key` | Plugin userConfig (prompted on install) | Auth for MCP + hooks |
| `project_name` | `.conport.json` at the root of the repository, committed (**required**) | The project's handle (`prk7m2qx9d` — shown by `init`, `list_projects` and the projects page of the dashboard), or its name: `<project>` for a personal repository, `k7m2qx9d/<project>` for a team's one (the team ID is on the team's settings page) |
| `plugins.superpowers` | `.conport.json` | The Superpowers overlay (below) |

```json
{
  "$schema": "https://conport.app/schema/conport.json",
  "project_name": "<project>"
}
```

A personal override of `project_name` or `plugins` goes into
`.conport.local.json` beside it, kept out of git. Session start prints the
project and its source, `ConPort project: <project> (from .conport.json)`.
`CONPORT_PROJECT_NAME` of the environment is read only when no file names the
project; in `~/.config/conport/.env` it is never read. Settings still in the
old places (`env.CONPORT_PROJECT_NAME` in `.claude/settings.local.json`,
`.superpowers/config.json`) are named by a line at session start; move them by
<https://conport.app/docs/projects/project-settings.md>.

`CONPORT_PROJECT_ID` is no longer read. While it is set, every session starts
with one line saying so; move the project's handle or name into `project_name`
of `.conport.json` and remove it.

## Superpowers overlay

In a project that works with the Superpowers skills, the overlay keeps specs
and plans in ConPort instead of git: the spec is a `spec` document, the plan a
`plan` document, and the epic's tasks are tied to the plan's sections. Turn it
on with `plugins.superpowers` in `.conport.json`:

```json
{ "plugins": { "superpowers": true } }
```

`.conport.local.json` can turn it off for one person. While neither file sets
`plugins.superpowers`, the old switch `.superpowers/config.json` holding
`{"conport": {"superpowers": true}}` is still read. Add one line
to the project's instructions (`CLAUDE.md` or `AGENTS.md`):
`Specs and plans of this project live in ConPort — follow the ConPort Superpowers overlay`.
The rules are [skills/conport/references/superpowers-overlay.md](./skills/conport/references/superpowers-overlay.md);
they call the `conport` CLI, which takes the project from `.conport.json` from
0.11 on: `npx -y conport@^0.13.0`. The CLI does not see the plugin's `api_key`:
it needs `CONPORT_API_KEY` in the environment or in `~/.config/conport/.env`.

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

