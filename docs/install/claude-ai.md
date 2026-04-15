# Claude.ai (custom connector)

> **Heads-up.** Claude.ai's custom-connector UI is built around **OAuth**. Our
> MCP server at `https://api.conport.app/mcp/` authenticates with a static
> `Authorization: Bearer cport_live_...` header, which the current custom
> connector form does **not** expose a field for. As of today there is no
> reliable way to pass the API key through the Claude.ai UI.
>
> If you just want ConPort inside a Claude chat, use **Claude Code**, **Cursor**,
> or **mcporter** instead — see the sibling guides in this directory.

## Walkthrough (for when OAuth support ships)

Claude.ai docs: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

1. Free/Pro/Max: **Settings → Customize → Connectors → Add custom connector**.
   Team/Enterprise owners: **Organization settings → Connectors → Add → Custom → Web**.
2. Paste the MCP URL: `https://api.conport.app/mcp/`.
3. The UI will try to start an OAuth flow. Our server currently does not expose
   a public OAuth client — the connection will fail at the sign-in step.
4. Save the connector only if/when OAuth is enabled on `api.conport.app`. Until
   then leave it off.

Plan limits (from Claude's docs): Free is capped at one custom connector.
Pro/Max/Team/Enterprise can add several.

## Skills

Claude.ai does not run `SKILL.md` files from this plugin. The skill logic
only activates in Claude Code.

## Verify

Nothing to verify until OAuth support lands. Track progress at
https://github.com/shaurgon/conport-plugin. For now, use Claude Code or Cursor.
