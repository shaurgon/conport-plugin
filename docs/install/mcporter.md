# mcporter

`mcporter` (https://github.com/steipete/mcporter) is a stdio-to-HTTP MCP
proxy — useful for headless agents that can only speak stdio MCP.

Get an API key at https://me.conport.app/dashboard/connect (`cport_live_...`).

## 1. Register ConPort

```bash
npx mcporter config add conport https://api.conport.app/mcp/ \
  --header "Authorization:Bearer cport_live_..."
```

That writes to `config/mcporter.json`:

```jsonc
{
  "mcpServers": {
    "conport": {
      "baseUrl": "https://api.conport.app/mcp/",
      "headers": {
        "Authorization": "Bearer cport_live_..."
      }
    }
  }
}
```

## 2. Keep the token out of the file (optional)

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
the proxied server.

## Verify

```bash
npx mcporter list conport
```

Expected: a list including `init`, `search`, `add_task`, `sync_decision`, and
~40 other ConPort tools. If you see `Missing session ID` on the very first
call after a server redeploy, reconnect once — that is expected for HTTP
transport.
