# Cursor

Cursor accepts both our MCP server and our `SKILL.md` bundles directly — no
wrappers, no porting.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).
The key is yours: one key works in your `Private Team` and in every shared team
you are a member of.

## Project name (required)

```text
Set CONPORT_PROJECT_NAME.
Personal repository: <project>.
Team repository: k7m2qx9d/<project> — the team ID is on the team's settings page.
A bare name in a team repository sends every member to their own Private Team.
```

Cursor reads it from the environment of its own process — export it in the
shell Cursor inherits, next to the key:

```bash
export CONPORT_PROJECT_NAME=<project>
```

## 1. MCP server

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (workspace):

```json
{
  "mcpServers": {
    "conport": {
      "url": "https://api.conport.app/mcp/",
      "headers": {
        "Authorization": "Bearer ${env:CONPORT_API_KEY}"
      }
    }
  }
}
```

Then export the key in the shell Cursor inherits:

```bash
export CONPORT_API_KEY=cport_live_...
```

Cursor identifies remote servers by the presence of `url` (vs. `command` for
stdio) — no `"type"` field needed. `${env:VAR}` interpolation is supported in
header values.

## 2. Skills

Cursor auto-scans these directories for `SKILL.md`:

| Path | Scope |
|---|---|
| `.agents/skills/` | workspace |
| `.cursor/skills/` | workspace |
| `~/.agents/skills/` | global |
| `~/.cursor/skills/` | global |

It *also* reads `.claude/skills/` and `~/.claude/skills/`, so if you already
have the Claude Code plugin installed, Cursor inherits the same skills
automatically.

Otherwise, install all three ConPort skills into Cursor with one command:

```bash
npx skills add shaurgon/conport-plugin --skill conport --skill conport-routine --skill superpowers-conport -a cursor
```

## Verify

Restart Cursor. In the MCP panel (Settings → MCP) the `conport` server should
show green with ~40 tools. In Agent chat, ask:

> Call `mcp__conport__init` with the name from `CONPORT_PROJECT_NAME`. If it
> answers `project_not_found`, call `mcp__conport__create_project` with the
> same name and repeat `init`.

`init` only finds a project, it never creates one, and the agent calls
`create_project` only on your word — which this request gives it.

Expected: a JSON response with `project_id` and `summary`. Type `/conport` in
chat — the skill should be offered as a slash completion.

## Updating

Cursor doesn't ship plugin auto-update for skills, so the SKILL.md files
need to be replaced by hand.

1. The server emits a one-line notice on session start when your installed
   `skill_version` is behind:

   ```
   [SKILL UPDATE] conport 13.0.0 → 13.10.0 (minor). Changelog: <url> · Install: <url>
   ```

2. Pull the latest `skills/conport/SKILL.md` from this repo.
3. Replace your local copy (typically under your Cursor skills directory
   or wherever you placed it on install).
4. Restart Cursor or reload the MCP panel.

> The MCP server itself doesn't need updating from your side — that lives
> at `https://api.conport.app/mcp` and is updated independently. The
> notice fires only when the agent-facing SKILL.md content has shifted.
