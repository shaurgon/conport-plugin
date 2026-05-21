# mcporter

`mcporter` (https://github.com/steipete/mcporter) is a stdio-to-HTTP MCP
proxy — useful for headless agents that can only speak stdio MCP.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).

## 1. Pick an endpoint

ConPort exposes two MCP endpoints. Pick by how the agent will use it
(see [doc-92 — Agent Architecture Spec](https://me.conport.app/dashboard/p/11/documents) for the rationale):

| Endpoint | Surface | When to use |
| --- | --- | --- |
| `https://api.conport.app/mcp-agent/` | `agent_*` tools only (29) | Harness consumers (OpenClaw / Paperclip / mcporter pointed at the agent skill). Use the [`conport-agent`](../../skills/conport-agent/SKILL.md) skill alongside. |
| `https://api.conport.app/mcp/`       | Project tools (72)        | Project-shaped work (decisions / tasks / documents / patterns / search). Use the [`conport`](../../skills/conport/SKILL.md) skill alongside. |

The two surfaces are physically disjoint — no overlap. Same credential
works on either.

## 2. Register the proxy

For an **agent-shaped** harness install:

```bash
npx mcporter config add conport-agent https://api.conport.app/mcp-agent/ \
  --header "Authorization:Bearer cport_live_..."
```

For a **project-shaped** install (rare for mcporter — usually that's
Claude Code / Cursor — but supported):

```bash
npx mcporter config add conport https://api.conport.app/mcp/ \
  --header "Authorization:Bearer cport_live_..."
```

That writes to `config/mcporter.json`:

```jsonc
{
  "mcpServers": {
    "conport-agent": {
      "baseUrl": "https://api.conport.app/mcp-agent/",
      "headers": {
        "Authorization": "Bearer cport_live_..."
      }
    }
  }
}
```

`X-API-Key: cport_live_...` works in place of `Authorization` —
ConPort's MCP middleware translates it transparently.

## 3. Keep the token out of the file (optional)

mcporter supports `$env:VAR` interpolation in headers:

```jsonc
"headers": { "Authorization": "$env:CONPORT_BEARER" }
```

Then export before launching:

```bash
export CONPORT_BEARER="Bearer cport_live_..."
```

## Skills

mcporter only proxies MCP tools. The `SKILL.md` files in this plugin are not
loaded by mcporter itself — attach them in whatever agent framework consumes
the proxied server. Harness agents on `/mcp-agent` should attach
[`conport-agent/SKILL.md`](../../skills/conport-agent/SKILL.md).

## Verify

```bash
npx mcporter list conport-agent
```

Expected on `/mcp-agent`: 29 tools, all named `agent_*` — `agent_init`,
`agent_remember`, `agent_recall`, `agent_reflect`, `agent_create_branch`,
etc.

Expected on `/mcp`: 72 project tools — `init`, `search`, `add_task`,
`sync_decision`, etc.

If you see `Missing session ID` on the very first call after a server
redeploy, reconnect once — that is expected for HTTP transport.

## Migrating an existing install from `/mcp` to `/mcp-agent`

Older harness configs pointed at `https://api.conport.app/mcp/` and used
the agent tools that lived there pre-task-359. Those tools moved to
`/mcp-agent` (decision-666 / amend decision-717). To migrate:

```bash
sed -i.bak 's|api.conport.app/mcp"|api.conport.app/mcp-agent"|g' ~/.mcporter/mcporter.json
sed -i.bak 's|api.conport.app/mcp/|api.conport.app/mcp-agent/|g' ~/.mcporter/mcporter.json
```

Then reconnect mcporter (`systemctl --user restart mcporter` if you run
it as a user service, or whatever your launcher uses).

## Updating

mcporter pulls the MCP server config from this repo, so updating means
re-running the install command (or whichever package-update flow your
mcporter setup uses):

```bash
npx mcporter install conport-agent --upgrade
```

The skill files (`SKILL.md`) under `skills/` come along with the same
update. After upgrade, reconnect MCP if your client caches tool lists.

When your local `skill_version` is behind the server's published one, the
next session's `agent_init` response carries `skill_update_available` and
the agent prints one short notice line — that's your signal to upgrade.
Once done, the notice clears on the next session.

> The `skill_version` in SKILL.md frontmatter is independent of plugin
> release tags — bumped only when SKILL.md content meaningfully shifts. A
> regular plugin release without skill behaviour changes will not produce
> a notice.
