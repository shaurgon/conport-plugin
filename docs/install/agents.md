# Agent line (unlisted)

> **This is the agent line — non-public and unlisted.** It targets the agent
> service at `agent.conport.app`, which is not yet generally available. Nothing
> here is advertised in the main install flow; reach it by path only. If you
> just want ConPort for Claude Code, Cursor, or Claude.ai, use the
> [main install guides](../../README.md) instead — they cover the `conport`
> skill, which is all you need.

The agent line is the `conport-agent` skill plus the `conport-agent` CLI:
persistent agent identity, memory, and structured domains for multi-agent
frameworks. It speaks the Intent API (`agent_init`, `agent_remember`,
`agent_recall`, …) against `agent.conport.app`.

## API key

```bash
export CONPORT_API_KEY=cport_live_...
```

Generate one at [me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect).
Never paste the key into a chat. Tenant isolation is enforced server-side.

## Hermes

Hermes installs the agent line via its own plugin, **`conport-hermes`**, which
ships from a separate mirror and carries the Hermes-specific system prompt and
memory discipline. Install that plugin in the Hermes runtime; it wires up the
skill and MCP transport for you:

```bash
hermes plugins install shaurgon/conport-hermes
```

Repo: https://github.com/shaurgon/conport-hermes

If the plugin isn't available in your runtime, fall back to the skill + MCP
combination:

```bash
npx skills add shaurgon/conport-plugin --skill conport-agent
```

and point the agent's MCP config at the Intent API:

```
url:  https://agent.conport.app/mcp/
auth: Bearer ${CONPORT_API_KEY}
```

## Pi (and other self-hosted agents)

Install the skill straight from this repo:

```bash
npx skills add shaurgon/conport-plugin --skill conport-agent
```

For scripted / headless access, use the CLI — it targets `agent.conport.app`
and reads `CONPORT_API_KEY` from the environment:

```bash
export CONPORT_API_KEY=cport_live_...
npx conport-agent
```

`CONPORT_BASE_URL` overrides the agent host if you're pointing at a different
deployment. The agent line's live docs live at
[conport.app/agents](https://conport.app/agents) (unlisted) — the CLI fetches
situational reference from there at runtime.
