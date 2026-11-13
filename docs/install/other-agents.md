# Other agents (`npx skills add`)

Shell-capable harnesses — Codex, Copilot, Gemini, and others — use ConPort
through two pieces: the portable **`conport` skill** (the always-on discipline)
plus the **`conport` CLI** (the ConPort tools themselves). No MCP server is
required for this tier; the CLI talks straight to the live API.

## 1. Install the skill

Any harness that reads portable [Agent Skills](https://github.com/anthropics/skills)
can install the ConPort skills directly from this repo with the
[skills CLI](https://github.com/anthropics/skills). It scans
`skills/<name>/SKILL.md` and ignores the rest of the plugin (hooks, MCP config,
scripts). Install `conport` with `conport-roadmap`, the roadmap rules the
`conport` skill sends the agent to:

```bash
npx skills add shaurgon/conport-plugin --skill conport --skill conport-roadmap
```

Target a specific agent with `-a` (replace `codex` with `copilot` / `gemini` /
your agent):

```bash
npx skills add shaurgon/conport-plugin --skill conport --skill conport-roadmap -a codex
```

## 2. Get an API key

Generate one at [me.conport.app/dashboard/connect](https://me.conport.app/dashboard/connect)
and export it — **never paste the key into a chat or pass it on the command
line**. The CLI reads it from the environment:

```bash
export CONPORT_API_KEY=cport_live_...
```

Tenant isolation is enforced server-side. The key is yours: one key works in
your `Private Team` and in every shared team you are a member of, and sees
nothing else.

## Project name (required)

```text
Set project_name in .conport.json at the root of the repository and commit the file.
Any repository: the project's handle, e.g. prk7m2qx9d — init, list_projects and the projects page of the dashboard show it.
Personal repository: <project>.
Team repository: k7m2qx9d/<project> — the team ID is on the team's settings page.
A bare name in a team repository sends every member to their own Private Team.
Never put the API key into the file: it is committed.
```

The file `.conport.json`:

```json
{
  "$schema": "https://conport.app/schema/conport.json",
  "project_name": "<project>"
}
```

These agents have no session-start hook: the agent reads the file itself, by
*Step 1* of the `conport` skill — the root of the repository from
`git rev-parse --show-toplevel`, `project_name` of `.conport.json` there, and a
personal override from `.conport.local.json` beside it (kept out of git; a
linked worktree without one reads the main worktree's). `CONPORT_PROJECT_NAME`
of the agent's environment is read only when no file names the project; in
`~/.config/conport/.env` it is never read. A repository that still keeps its
ConPort settings in the old places (`CONPORT_PROJECT_NAME` in the environment,
`.superpowers/config.json`) moves them by
<https://conport.app/docs/projects/project-settings.md>.

A client with no environment variables (Claude.ai, for one) has the user name
the project in the chat, in the same form.

A project that does not exist yet is not created by reading it: ask the
user, and only when they say so run
`npx -y conport@^0.11.0 api projects create --name <project>` — for a team's project
add `--team-id k7m2qx9d`; the name itself never contains `/`.

## 3. Use the CLI

The skill drives the agent; the `conport` CLI is how the agent actually
reads and writes ConPort.

```bash
# Browse the live docs (keyless — also verifies connectivity)
npx -y conport@^0.11.0 docs

# Discover every resource and operation from the live OpenAPI spec
npx -y conport@^0.11.0 api __schema

# Call any operation: conport api <resource> <operation> [--flags]
npx -y conport@^0.11.0 api tasks list --project <project_name from .conport.json>
npx -y conport@^0.11.0 api search create --query "auth flow"
```

`npx -y conport@^0.11.0 docs` works without a key and confirms the CLI can
reach the API. Everything under `conport api …` is generated from the live
OpenAPI spec, so `__schema` is the source of truth for resources, operations,
and flags — run `npx -y conport@^0.11.0 api <resource> --help` for the exact
options of any one operation. `conport api …` takes the project only from
`--project`: pass `project_name` of `.conport.json` as the file has it.

## Optional: MCP

If your agent also speaks MCP, you can instead point its MCP config at the
hosted server rather than using the CLI:

```
url:  https://api.conport.app/mcp/
auth: Bearer ${CONPORT_API_KEY}
```

The exact config shape depends on your harness — see its MCP docs. The Cursor
guide ([cursor.md](./cursor.md)) is a concrete worked example of the
server + skill combination. For most CLI-tier agents the `conport` CLI path
above is simpler and needs no extra configuration.

## Optional: Superpowers overlay

If the project works with the Superpowers skills, specs and plans can live in
ConPort instead of `docs/superpowers/`. Turn it on with
`"plugins": { "superpowers": true }` in `.conport.json`; while neither
`.conport.json` nor `.conport.local.json` sets `plugins.superpowers`, the old
switch `.superpowers/config.json` holding `{"conport": {"superpowers": true}}`
is still read. These agents have no session-start hook: the agent gets the
overlay rules from the **Superpowers overlay** block of the `conport` skill.
There is no commit guard either, so nothing refuses a commit of a new file
under `docs/superpowers/` — the rules alone keep specs and plans out of git. The
rules call the `conport` CLI, which takes the project from `.conport.json` from
0.11 on (`npx -y conport@^0.11.0`) and needs `CONPORT_API_KEY` in the
environment or in `~/.config/conport/.env` (the key from step 2). See the
[README](../../README.md#superpowers-overlay).
