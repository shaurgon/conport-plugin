# ConPort plugin — install by instructions

Purpose: register the ConPort MCP server and attach its two skills to an agent.

## 1. MCP server config

Add to the host's MCP registry (e.g. `openclaw mcp set`, `mcporter config add`,
`~/.cursor/mcp.json`, or equivalent):

```json
{
  "mcpServers": {
    "conport": {
      "url": "https://api.conport.app/mcp/",
      "headers": {
        "Authorization": "Bearer ${CONPORT_API_KEY}"
      }
    }
  }
}
```

Transport: HTTP. Auth: static Bearer header. No OAuth.

## 2. API key

1. Open https://me.conport.app/dashboard/connect
2. Sign in, click **Create API key**, copy the `cport_live_...` value
   (shown exactly once).
3. Export it wherever the agent process reads env vars:

```bash
export CONPORT_API_KEY=cport_live_...
```

The key goes into the `Authorization: Bearer <key>` header on every MCP
request. Alternatively the server also accepts `X-API-Key: cport_live_...`.

## 3. Attach the two skills

This repo ships skills at:

- `skills/conport/SKILL.md` — project context, tasks, decisions, search
- `skills/conport-agent/SKILL.md` — agent identity and persistent memory

Both are plain `SKILL.md` files with a `references/` directory and no
host-specific hooks, so they are portable across skill-aware agents.

Host-specific attachment:

- **OpenClaw**: copy both dirs into `~/.openclaw/skills/` (auto-discovered)
  and list them in `agents.list[].skills` in `openclaw.json`.
- **Claude Code**: installed automatically by `/plugin install conport` after `/plugin marketplace add https://github.com/shaurgon/conport-plugin`.
- **Cursor / mcporter / plain MCP client**: no SKILL.md runtime — use the MCP
  tools directly (`init`, `search`, `add_task`, `sync_decision`, ...).

If the host has its own skills directory, copy the two folders in verbatim.

## 4. Verify

Call the `init` tool:

```
tool: init
args: { "name": "<project-name>" }
```

Expected response: a JSON object with `project_id`, `summary`,
`instructions`, and (for existing projects) `recent_decisions`,
`backlog` (top-5 + totals), `stats`.

If the first call after a server redeploy returns `Missing session ID`,
reconnect the MCP client once — this is expected behaviour for HTTP
transport, not a config error.

## Troubleshooting

- `401 Unauthorized` → key wrong, expired, or missing `Bearer ` prefix.
- `404` on a project lookup → tenant isolation; the key's owner does not own
  that project. Create it first via `init`.
- Tool list empty → MCP client did not reconnect after config change. Restart
  the client.
