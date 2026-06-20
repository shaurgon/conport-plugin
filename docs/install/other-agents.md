# Other agents (`npx skills add`)

Shell-capable harnesses — Codex, Copilot, Gemini, and others — use ConPort
through two pieces: the portable **`conport` skill** (the always-on discipline)
plus the **`npx conport` CLI** (the ConPort tools themselves). No MCP server is
required for this tier; the CLI talks straight to the live API.

## 1. Install the skill

Any harness that reads portable [Agent Skills](https://github.com/anthropics/skills)
can install the ConPort skill directly from this repo with the
[skills CLI](https://github.com/anthropics/skills). It scans
`skills/<name>/SKILL.md` and ignores the rest of the plugin (hooks, MCP config,
scripts).

```bash
npx skills add shaurgon/conport-plugin --skill conport
```

Target a specific agent with `-a` (replace `codex` with `copilot` / `gemini` /
your agent):

```bash
npx skills add shaurgon/conport-plugin --skill conport -a codex
```

## 2. Get an API key

Generate one at [me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect)
and export it — **never paste the key into a chat or pass it on the command
line**. The CLI reads it from the environment:

```bash
export CONPORT_API_KEY=cport_live_...
```

Tenant isolation is enforced server-side, so each key only ever sees its own
projects and memory.

## 3. Use the CLI

The skill drives the agent; the `npx conport` CLI is how the agent actually
reads and writes ConPort.

```bash
# Browse the live docs (keyless — also verifies connectivity)
npx conport docs

# Discover every resource and operation from the live OpenAPI spec
npx conport api __schema

# Call any operation: conport api <resource> <operation> [--flags]
npx conport api tasks list --project-id <id>
npx conport api search query --q "auth flow"
```

`npx conport docs` works without a key and confirms the CLI can reach the API.
Everything under `npx conport api …` is generated from the live OpenAPI spec, so
`__schema` is the source of truth for resources, operations, and flags — run
`npx conport api <resource> --help` for the exact options of any one operation.

## Optional: MCP

If your agent also speaks MCP, you can instead point its MCP config at the
hosted server rather than using the CLI:

```
url:  https://api.conport.app/mcp/
auth: Bearer ${CONPORT_API_KEY}
```

The exact config shape depends on your harness — see its MCP docs. The Cursor
guide ([cursor.md](./cursor.md)) is a concrete worked example of the
server + skill combination. For most CLI-tier agents the `npx conport` path
above is simpler and needs no extra configuration.
