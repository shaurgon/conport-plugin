# Claude Code

Install ConPort into Claude Code via the plugin marketplace.

## 1. Get an API key

Open https://me.conport.app/dashboard/connect, sign in, and create a key.
The value looks like `cport_live_...` and is shown exactly once — copy it now.

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
- 4 hooks (Node.js scripts under `scripts/`) — session start, command check,
  prompt submit, session reflect

## 3. Reload

In the same session:

```
/reload-plugins
```

## Verify

Ask Claude in the session:

> Call `mcp__conport__init` with name "<your-project>".

Expected: a JSON response with `project_id`, `summary`, `instructions`, and
(if it's a known project) `recent_decisions`. If you get
`Missing session ID` once right after install, just reconnect `/mcp` — that is
expected for a fresh HTTP transport.

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
