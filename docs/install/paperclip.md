# Paperclip

Paperclip's **claude-local adapter** runs Anthropic's Claude Code CLI for the
agent, so the right way to give a Paperclip agent ConPort is: install our
Claude Code plugin into the agent's `~/.claude/` — the adapter picks it up
automatically on the next heartbeat.

Reference: https://github.com/paperclipai/paperclip/blob/master/docs/adapters/claude-local.md

## 1. Prepare the agent's shell

Pick the OS user / shell profile the agent's adapter uses (`cwd` in the
adapter config points there). All steps run as that user.

Export two secrets:

```bash
export ANTHROPIC_API_KEY=sk-ant-...       # used by Claude Code itself
export CONPORT_API_KEY=cport_live_...     # used by the ConPort plugin
```

Get the ConPort key at https://me.conport.app/dashboard/connect.

Paperclip already injects `PAPERCLIP_AGENT_ID` into the agent's env per run,
and the `conport-agent` skill picks that up automatically — no need to set
`CONPORT_AGENT_UUID` manually (see the resolution order in
[`skills/conport-agent/SKILL.md`](../../skills/conport-agent/SKILL.md)).

## 2. Install the Claude Code plugin

Open a Claude Code session as the same user and run:

```
/plugin marketplace add https://github.com/shaurgon/conport-plugin
/plugin install conport
```

Paste `cport_live_...` when prompted for `api_key`. The plugin drops skills
into the Claude Code plugin cache, which the adapter symlinks into each agent
run via `--add-dir`. ConPort's hooks activate for every heartbeat-launched
session automatically.

## 3. Wire up the heartbeat

Add to the agent's `HEARTBEAT.md` (or equivalent prompt Paperclip sends on
each tick):

```markdown
## 1. ConPort Agent (mandatory)
First action: `agent_init({ uuid: "$PAPERCLIP_AGENT_ID", name: "<display>" })`
```

Full copy-paste blocks:
[`skills/conport-agent/references/integration.md`](../../skills/conport-agent/references/integration.md).

## Verify

From the adapter config, hit **Test Environment** — it checks Claude CLI
availability and a live API probe. Then trigger a heartbeat and confirm the
agent's first tool call is `mcp__conport__agent_init` returning a JSON
identity response.
