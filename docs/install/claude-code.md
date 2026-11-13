# Claude Code

Install ConPort into Claude Code via the plugin marketplace.

## 1. Get an API key

Open https://me.conport.app/dashboard/connect, sign in, and create a key.
The value looks like `cport_live_...` and is shown exactly once — copy it now.
The key is yours: one key works in your `Private Team` and in every shared team
you are a member of.

## Project name (required)

```text
Set project_name in .conport.json at the root of the repository and commit the file.
Any repository: the project's handle, e.g. prk7m2qx9d — init, list_projects and the projects page of the dashboard show it.
Personal repository: <project>.
Team repository: k7m2qx9d/<project> — the team ID is on the team's settings page.
A bare name in a team repository sends every member to their own Private Team.
Never put the API key into the file: it is committed.
```

The file `.conport.json`:

```json
{
  "$schema": "https://conport.app/schema/conport.json",
  "project_name": "<project>"
}
```

The plugin's hooks read it at session start, from the root of the repository
Claude Code was opened in, and print the project and where it came from:
`ConPort project: <project> (from .conport.json)`. A `cd` into another
repository during the session does not change the project. A personal override
goes into `.conport.local.json` beside it, kept out of git (add it to
`.gitignore`); a linked worktree without one reads the main worktree's.
`CONPORT_PROJECT_NAME` of Claude Code's environment is read only when no file
names the project.

Without a project the hooks stay silent and the skill stops at session start
and asks for `project_name` — the name is never taken from anywhere else. A
repository that still keeps the project in `env.CONPORT_PROJECT_NAME` of
`.claude/settings.local.json`, or the overlay switch in
`.superpowers/config.json`, gets a line at session start that names those old
places; move them by
<https://conport.app/docs/projects/project-settings.md>.

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

- 4 skills (`conport`, `conport-routine`, `conport-roadmap`, `superpowers-conport`) —
  project-context discipline (init, search, tasks, decisions), one iteration of a
  periodic backlog routine, the roadmap rules (milestones, releases, waiting work),
  and the superpowers→ConPort spec/epic flow with its `finish` release verdict
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

> Call `mcp__conport__init` with `project_name` from `.conport.json`. If it
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
ConPort instead of `docs/superpowers/`. Turn it on with `plugins.superpowers`
in `.conport.json`:

```json
{
  "$schema": "https://conport.app/schema/conport.json",
  "project_name": "<project>",
  "plugins": { "superpowers": true }
}
```

and add one line to the project's `CLAUDE.md`:

```text
Specs and plans of this project live in ConPort — follow the ConPort Superpowers overlay
```

The switch is the team's, committed with the file; one person can turn it off
with `"plugins": { "superpowers": false }` in `.conport.local.json`. While
neither file sets `plugins.superpowers`, the old switch
`.superpowers/config.json` holding `{"conport": {"superpowers": true}}` is still
read. From the next session on, the session-start hook tells Claude the overlay
is on and names the file of its rules, which Claude reads; Claude prints
`[CONPORT] Superpowers overlay: on`; the command check reads the settings of the
folder of each commit and refuses one that adds a new file under
`docs/superpowers/specs/` or `docs/superpowers/plans/`. The rules call the `conport` CLI (`documents get`, `plan import`, `plan pull`,
`superpowers migrate`), which takes the project from `.conport.json` from 0.11
on — `npx -y conport@^0.11.0` — so Node.js and network access are needed. The
CLI does not see the plugin's `api_key`: put `CONPORT_API_KEY` in the
environment or in `~/.config/conport/.env`. See the
[README](../../README.md#superpowers-overlay). To turn the overlay off, set
`plugins.superpowers` to `false`.

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
