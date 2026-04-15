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

The plugin ships:

- `skills/conport/` — project-context skill (init, search, tasks, decisions)
- `skills/conport-agent/` — agent identity and persistent memory
- MCP server `conport` pointing at `https://api.conport.app/mcp/` (Bearer auth)
- Node.js hook scripts under `scripts/` (Claude Code specific)

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
