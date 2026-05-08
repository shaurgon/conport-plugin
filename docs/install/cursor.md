# Cursor

Cursor accepts both our MCP server and our `SKILL.md` bundles directly — no
wrappers, no porting.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).

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

Otherwise, clone once and symlink the `conport` skill:

```bash
git clone --depth=1 https://github.com/shaurgon/conport-plugin ~/.conport-plugin
mkdir -p ~/.cursor/skills
ln -s ~/.conport-plugin/skills/conport ~/.cursor/skills/conport
```

> The plugin also ships `conport-agent` for multi-agent frameworks (Paperclip,
> OpenClaw, Hermes). Inside Cursor you don't need it — skip it.

## Verify

Restart Cursor. In the MCP panel (Settings → MCP) the `conport` server should
show green with ~40 tools. In Agent chat, ask:

> Call `mcp__conport__init` with name "<your-project>".

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

2. Pull the latest skill files from this repo (`skills/conport/SKILL.md` and,
   if you have it, `skills/conport-agent/SKILL.md`).
3. Replace your local copies (typically under your Cursor skills directory
   or wherever you placed them on install).
4. Restart Cursor or reload the MCP panel.

> The MCP server itself doesn't need updating from your side — that lives
> at `https://api.conport.app/mcp` and is updated independently. The
> notice fires only when the agent-facing SKILL.md content has shifted.
