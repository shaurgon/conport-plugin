# Other agents (`npx skills add`)

Any harness that reads portable [Agent Skills](https://github.com/anthropics/skills)
— Codex, Copilot, Gemini, and others — can install the ConPort skills directly
from this repo with the [skills CLI](https://github.com/anthropics/skills). It
scans `skills/<name>/SKILL.md` at the repo root and ignores the rest of the
plugin (hooks, MCP config, scripts).

## Install the skill

```bash
npx skills add shaurgon/conport-plugin --skill conport
```

Target a specific agent with `-a`:

```bash
npx skills add shaurgon/conport-plugin --skill conport -a cursor
```

## API key

You need a ConPort API key. Generate one at
[me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect)
and export it — **never paste the key into a chat**:

```bash
export CONPORT_API_KEY=cport_live_...
```

Tenant isolation is enforced server-side, so each key only ever sees its own
projects and memory.

## Connecting the MCP server

The skill carries the always-on discipline and routes to the live docs at
[conport.app](https://conport.app) for deep reference. To give the agent the
ConPort tools themselves, point its MCP config at the HTTP server:

```
url:  https://api.conport.app/mcp/
auth: Bearer ${CONPORT_API_KEY}
```

The exact config shape depends on your harness — see its MCP docs. The Cursor
guide ([cursor.md](./cursor.md)) is a concrete worked example of the same
server + skill combination.
