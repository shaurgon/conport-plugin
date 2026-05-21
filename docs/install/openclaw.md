# OpenClaw

OpenClaw is a harness consumer — the agent-shaped runtime per
[doc-92](https://me.conport.app/dashboard/p/11/documents). It registers
MCP servers via its CLI and auto-discovers skills from a set of
well-known directories.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).

## 1. Register the agent MCP server

OpenClaw points at the **agent-only** endpoint
(`/mcp-agent`, 29 tools, all `agent_*`):

```bash
openclaw mcp set conport-agent \
  '{"url":"https://api.conport.app/mcp-agent/","headers":{"Authorization":"Bearer cport_live_..."}}'
```

`X-API-Key: cport_live_...` works in place of `Authorization` —
ConPort's MCP middleware translates it transparently.

Verify it's there:

```bash
openclaw mcp list
openclaw mcp show conport-agent
```

To remove later: `openclaw mcp unset conport-agent`.

> **Don't mix in `/mcp`.** The project surface
> (`https://api.conport.app/mcp/`, 72 tools) is for project-shaped IDE
> consumers (Claude Code / Cursor) and intentionally hidden from
> harness agents — exposing it pollutes recall hygiene and breaks the
> "agent is not project-scoped" guarantee (decision-660).

## 2. Attach the skill

OpenClaw auto-scans for `SKILL.md` files in (precedence order):

1. `<workspace>/skills`
2. `<workspace>/.agents/skills`
3. `~/.agents/skills`
4. `~/.openclaw/skills`

Drop the agent skill into one of those. From this repo:

```bash
mkdir -p ~/.openclaw/skills
cp -r skills/conport-agent ~/.openclaw/skills/
```

Then grant it to your agent in `openclaw.json`:

```json5
{
  agents: {
    list: [
      { id: "writer", skills: ["conport-agent"] }
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
openclaw mcp show conport-agent
```

Then in an agent session:

> Call the `agent_init` tool on the `conport-agent` MCP server.

Expected: JSON with `agent_uuid`, `bootstrap_state`, `trunk_root_id`,
and `summary`.

## Migrating from `/mcp` to `/mcp-agent`

Older installs registered ConPort under `/mcp` and used the agent tools
that lived there pre-task-359. Those tools moved to `/mcp-agent`
(decision-666 / amend decision-717). To migrate:

```bash
openclaw mcp unset conport
openclaw mcp set conport-agent \
  '{"url":"https://api.conport.app/mcp-agent/","headers":{"Authorization":"Bearer cport_live_..."}}'
```

Restart the OpenClaw runtime to pick up the change.

## Updating

Pull the latest plugin into your install location:

```bash
cd <openclaw-plugins-dir>/conport-plugin
git pull
```

Then restart your OpenClaw runtime so it picks up the refreshed SKILL.md
and MCP config.

The server reports skill drift via `agent_init`: if your `skill_version`
lags, the response carries `skill_update_available` and the agent
surfaces a one-line notice. After `git pull` the next session is clean.

> **Versioning.** `skill_version` is the SKILL.md content version, NOT the
> plugin release tag. A `git pull` may bring scripts/hooks updates without
> moving SKILL.md — in that case no notice fires. If the notice IS
> showing, SKILL.md genuinely changed.
