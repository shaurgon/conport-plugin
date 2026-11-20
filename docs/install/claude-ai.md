# Claude.ai (web)

Claude.ai takes our two pieces separately: the **MCP server** as a custom
connector, and the **skills** as zip uploads. Skills need code execution. On a
personal plan, turn on **Code execution and file creation** under
**Settings → Capabilities** (called **Create and edit files** in the newer
settings layout). On Team and Enterprise it is an organization policy: an
owner turns on **Cloud code execution and file creation** and **Skills** under
**Organization settings → Plugins & skills → Policy**.

## 1. MCP server — custom connector

1. Sign in at https://claude.ai.
2. Open **Customize → Connectors**, click **+ Add**, then **Add custom connector**
   (Team/Enterprise owners: **Organization settings → Connectors → Add → Custom → Web**;
   members then find `ConPort` under **Customize → Connectors** and click **Connect**).
3. Fill in:
   - **Name**: `ConPort`
   - **URL**: `https://api.conport.app/mcp/`

   and click **Continue**.
4. Claude.ai checks the server's authentication: keep the detected OAuth
   settings and click **Continue** again.
5. Click **Add**.

The connector signs in with OAuth: on the first connect Claude.ai opens the
ConPort sign-in page, and you sign in with your ConPort account. No API key is
needed here — the `cport_live_...` key is for agents that cannot sign in.

## 2. Skill — zip upload

Download the prebuilt skill zips:

- https://github.com/shaurgon/conport-plugin/releases/download/skills-latest/conport-skill.zip
- https://github.com/shaurgon/conport-plugin/releases/download/skills-latest/conport-roadmap-skill.zip
  — the roadmap rules the `conport` skill sends the agent to

Each zip has the skill's folder with its `SKILL.md` (and, for `conport`, the
`references/` subdirectory), exactly what Claude.ai expects.

Upload each in Claude.ai:

1. **Customize → Skills**, click **+**, then **Create skill → Upload a skill**.
2. Select `conport-skill.zip`; repeat for `conport-roadmap-skill.zip`.

Claude.ai skills are per-user — every teammate uploads their own copy.

## Project name (required)

Claude.ai has no repository, so it reads no `.conport.json`: you name the
project in the chat.
Personal project: `<project>`. Team project: `k7m2qx9d/<project>` — the team ID
is on the team's settings page. A bare name always means a project of your own
`Private Team`. The project's handle (`prk7m2qx9d`, shown by `init`,
`list_projects` and the projects page of the dashboard) names it from anywhere.

## Superpowers overlay

The Superpowers overlay keeps a project's specs and plans in ConPort instead
of `docs/superpowers/`. Its switch is `plugins.superpowers` in `.conport.json`
at the root of a repository; the agent gets its
rules from the **Superpowers overlay** block of the `conport` skill, with no
session-start hook and no commit guard, and the rules call the `conport` CLI,
which needs `CONPORT_API_KEY` in the environment or in
`~/.config/conport/.env`. Claude.ai has no repository and no shell, so the
overlay does not apply here: use it from Claude Code, Cursor or another agent
that works in the repository. See the
[README](../../README.md#superpowers-overlay).

## Verify

- **Skills**: **Customize → Skills** lists `conport` and
  `conport-roadmap` as enabled.
- **Connector**: **Customize → Connectors** shows `ConPort` connected. In a new chat ask Claude to call the ConPort `init` tool with your
  project name. `init` only finds a project, it never creates one: for a
  project that does not exist yet it answers `project_not_found`. Ask Claude
  to call `create_project` with the same name, then `init` again; the answer
  is a JSON response with `project` (the project's handle) and `summary`.

## Updating

Claude.ai has no plugin auto-update — you replace the skill files manually.

The good news: the server tells you when an update is available. After a
session start, if your local SKILL.md is older than the published version,
the agent will print one line at the top of its first reply:

```
[SKILL UPDATE] conport 13.0.0 → 13.10.0 (minor). Changelog: <url> · Install: <url>
```

To apply the update:

1. Open the [releases page](https://github.com/shaurgon/conport-plugin/releases)
   and read the changelog for the entries between your version and the
   latest.
2. Download the latest skill zips from the links in section 2.
3. **Customize → Skills** — open each ConPort skill, turn it off, choose
   **⋯ → Delete**, then upload its new zip as in section 2.
4. Reload any open chat or start a new session; the notice should disappear
   on the next `init` call.

> **Note on versioning.** `skill_version` (in SKILL.md frontmatter
> `metadata.version`) is independent of plugin release tags. A new plugin
> release does **not** automatically mean your SKILL.md is stale — the
> notice fires only when the SKILL.md content has actually been bumped.
> No notice = nothing to do.
