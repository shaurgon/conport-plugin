# Claude Code

Install ConPort into Claude Code via the plugin marketplace.

## 1. Get an API key

Open https://me.conport.app/dashboard/connect, sign in, and create a key.
The value looks like `cport_live_...` and is shown exactly once — copy it now.
The key is yours: one key works in your `Private Team` and in every shared team
you are a member of.

## Project name (required)

```text
Set CONPORT_PROJECT_NAME.
Any repository: the project's handle, e.g. prk7m2qx9d — init, list_projects and the projects page of the dashboard show it.
Personal repository: <project>.
Team repository: k7m2qx9d/<project> — the team ID is on the team's settings page.
A bare name in a team repository sends every member to their own Private Team.
CONPORT_PROJECT_ID is no longer read.
```

In Claude Code the variable lives in `.claude/settings.local.json` of the
repository:

```json
{
  "env": { "CONPORT_PROJECT_NAME": "<project>" }
}
```

Without the variable the hooks stay silent and the skill stops at session start
and asks for this line — the name is never taken from anywhere else.

## 2. Add the marketplace and install

Inside a Claude Code session, run these slash commands:

```
/plugin marketplace add https://github.com/shaurgon/conport-plugin
/plugin install conport
```

`/plugin install` opens a picker — choose `conport-plugin` → `conport`.
Claude Code then prompts for the `api_key` credential; paste the
`cport_live_...` value from step 1.

The plugin loads in Claude Code:

- 3 skills (`conport`, `conport-routine`, `superpowers-conport`) — project-context
  discipline (init, search, tasks, decisions), one iteration of a periodic backlog
  routine, and the superpowers→ConPort spec/epic flow with its `finish` release verdict
- MCP server `conport` pointing at `https://api.conport.app/mcp/` (Bearer auth)
- 5 hooks (Node.js scripts under `scripts/`) — session start, command check,
  epic tracking, prompt submit, epic tails at the end of a turn

The connection lists every tool of the server. To have only some groups of
tools listed, see [tool-profiles.md](./tool-profiles.md).

## 3. Reload

In the same session:

```
/reload-plugins
```

## Verify

Ask Claude in the session:

> Call `mcp__conport__init` with the name from `CONPORT_PROJECT_NAME`. If it
> answers `project_not_found`, call `mcp__conport__create_project` with the
> same name and repeat `init`.

`init` only finds a project, it never creates one, and the agent calls
`create_project` only on your word — which this request gives it.

Expected: a JSON response with `project` (the project's handle), `summary`, `instructions`, and
(if it's a known project) `recent_decisions`. If you get
`Missing session ID` once right after install, just reconnect `/mcp` — that is
expected for a fresh HTTP transport.

## Superpowers overlay (optional)

If the project works with the Superpowers skills, specs and plans can live in
ConPort instead of `docs/superpowers/`. Create `.superpowers/config.json` at
the root of the repository:

```json
{ "conport": { "superpowers": true } }
```

and add one line to the project's `CLAUDE.md`:

```text
Specs and plans of this project live in ConPort — follow the ConPort Superpowers overlay
```

The file at the root of the current worktree decides on its own; a worktree
without one (an epic branch, for example) reads the main worktree's file.
From the next session on, the session-start hook passes the overlay rules to
Claude, which prints `[CONPORT] Superpowers overlay: on`; the command check
reads the file on every commit and refuses one that adds a new file under
`docs/superpowers/specs/` or `docs/superpowers/plans/`. The rules call the `conport` CLI through
`npx -y conport@^0.5` (`documents get`, `plan import`, `plan pull`,
`superpowers migrate`), so Node.js and network access are needed. The CLI does
not see the plugin's `api_key`: put `CONPORT_API_KEY` in the environment or in
`~/.config/conport/.env`. See the
[README](../../README.md#superpowers-overlay). To turn the overlay off, remove
the `conport.superpowers` key.

## Updating

Claude Code manages plugin updates natively:

```bash
claude plugins update conport-plugin
```

This refreshes everything — SKILL.md, hooks, MCP server config — atomically.
After the update, `/mcp reconnect conport` to pick up any new tools the
server exposes.

If you missed an update, the server will tell you on the next session
start: a line like

```
[SKILL UPDATE] conport 13.9.0 → 13.10.0 (minor). Changelog: <url> · Install: <url>
```

appears at the top of the first reply. Run `claude plugins update` and the
notice clears on the next `init`.

Rolling back to a previous version: an install always follows the marketplace's
current release, so pin the source instead — clone
`https://github.com/shaurgon/conport-plugin` and `git checkout` the tag you
want, then run exactly:

```
/plugin uninstall conport
/plugin marketplace remove conport-plugin
/plugin marketplace add <path to the clone at the desired tag>
/plugin install conport
/reload-plugins
```

Then `/mcp reconnect conport`. To return to the current release, repeat the
sequence with `https://github.com/shaurgon/conport-plugin` as the marketplace.

> **Versioning note.** The `skill_version` in `SKILL.md` frontmatter is
> independent of plugin release tags — bumped only when SKILL.md content
> actually changes. A plugin release that only touches hooks or scripts
> won't trigger the notice; a notice is the signal that SKILL.md
> behaviour shifted.
