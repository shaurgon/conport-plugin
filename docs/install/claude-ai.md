# Claude.ai (web)

Claude.ai takes our two pieces separately: the **MCP server** as a custom
connector, and the **skills** as zip uploads. Both features require a paid
plan (Pro, Max, Team, or Enterprise) with code execution enabled.

## 1. MCP server — custom connector

1. Sign in at https://claude.ai.
2. Open **Settings → Customize → Connectors → Add custom connector**
   (Team/Enterprise owners: **Organization settings → Connectors → Add → Custom → Web**).
3. Fill in:
   - **Name**: `ConPort`
   - **URL**: `https://api.conport.app/mcp/`
4. Save.

> **Auth caveat.** Our server accepts a static Bearer header (`cport_live_...`),
> but the Claude.ai custom-connector UI only exposes an OAuth flow — no field
> for arbitrary HTTP headers. Until we ship OAuth on `api.conport.app`, the
> connector will fail at the sign-in step. If you need authenticated MCP
> *today*, use **Claude Code** or **Cursor**. The skill-upload path below
> works independently.

## 2. Skill — zip upload

Download the prebuilt skill zip:

- https://github.com/shaurgon/conport-plugin/releases/download/skills-latest/conport-skill.zip

The zip has `SKILL.md` at its root plus the `references/` subdirectory,
exactly what Claude.ai expects.

Upload it in Claude.ai:

1. **Settings → Features → Skills → Upload Skill**.
2. Select `conport-skill.zip`; accept the permissions prompt.

Claude.ai skills are per-user — every teammate uploads their own copy.

> The second skill, `conport-agent`, is for multi-agent frameworks
> (Paperclip, OpenClaw, …) and is not useful inside a Claude.ai chat,
> so it's omitted here.

## Verify

- **Skills**: **Settings → Features → Skills** lists both `conport` and
  `conport-agent` as enabled.
- **Connector** (once OAuth is live): the connectors panel shows `ConPort`
  green, and asking Claude to call `mcp__conport__init` in a new chat
  returns a JSON response with `project_id` and `summary`.
