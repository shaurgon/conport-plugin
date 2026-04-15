# OpenClaw

OpenClaw registers MCP servers via its CLI and auto-discovers skills from a
set of well-known directories.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).

## 1. Register the MCP server

```bash
openclaw mcp set conport '{"url":"https://api.conport.app/mcp/","headers":{"Authorization":"Bearer cport_live_..."}}'
```

Verify it's there:

```bash
openclaw mcp list
openclaw mcp show conport
```

To remove later: `openclaw mcp unset conport`.

## 2. Attach the skills

OpenClaw auto-scans for `SKILL.md` files in (precedence order):

1. `<workspace>/skills`
2. `<workspace>/.agents/skills`
3. `~/.agents/skills`
4. `~/.openclaw/skills`

Drop the plugin's two skills into one of those. From this repo:

```bash
mkdir -p ~/.openclaw/skills
cp -r skills/conport       ~/.openclaw/skills/
cp -r skills/conport-agent ~/.openclaw/skills/
```

Then grant them to your agent in `openclaw.json`:

```json5
{
  agents: {
    list: [
      { id: "writer", skills: ["conport", "conport-agent"] }
    ]
  }
}
```

`agents.list[].skills` is the final set for that agent (it does **not** merge
with `agents.defaults.skills`).

## "Add by instructions"

OpenClaw does **not** have a chat-based "install plugin from INSTRUCTIONS.md URL"
flow as of docs.openclaw.ai today. For operators asked to "add ConPort by
instructions", point them at `plugin/INSTRUCTIONS.md` and run the steps above
manually.

## Verify

```bash
openclaw mcp show conport
```

Then in an agent session:

> Call the `init` tool on the `conport` MCP server with name `<your-project>`.

Expected: JSON with `project_id`, `summary`, and `instructions`.
