# Installing ConPort (agent guide)

> **You are a coding agent installing ConPort for the current project.**
> Follow these steps in order. ConPort is a project-memory / context service:
> once it's wired in you can track this project's tasks, decisions, and docs,
> and search across all of them in plain language. Work in the user's harness —
> any of Claude Code, Cursor, Claude.ai, Codex, Copilot, Gemini, or another
> agent. Pick the path that matches your harness in **Step 2**.

The whole install is one human step (the user supplies an API key once) plus a
few commands you run yourself. Do not improvise extra files, credentials, or
config — only what's below.

---

## Step 1 — API key (the one thing the user must do)

ConPort needs a per-user API key. **You never invent, store, or echo it.**

1. Tell the user to open
   <https://me.conport.app/dashboard/connect>, sign in, and create a key. The
   value looks like `cport_live_...` and is shown exactly once.
2. Ask the user to make it available to you as the environment variable
   `CONPORT_API_KEY` — either by exporting it in the shell you run commands in:

   ```bash
   export CONPORT_API_KEY=cport_live_...
   ```

   or by pasting it into the harness's secure secret / credential field (Claude
   Code's plugin `api_key` prompt, Cursor's MCP env, Claude.ai's connector auth).

**Secret discipline — non-negotiable:**

- Do **not** write the key into any file in the repository (no `.env` committed,
  no config, no script, no doc).
- Do **not** print, echo, or repeat the key back — not even a prefix or the
  first characters.
- Do **not** put it on a command line as an argument (it would land in shell
  history). It is read from the environment only.
- If the user pastes it into chat anyway, warn them it is now visible in the
  transcript and proceed without repeating it.

Tenant isolation is enforced server-side: a key only ever sees its owner's
projects and memory.

---

## Step 2 — pick the execution layer for your harness

There are two ways to give yourself ConPort tools. **Choose by capability, not
preference:** if you can run shell commands, use the CLI path — it works in the
current session with no restart.

### Path A — you have a shell (Codex, Copilot, Gemini, Cursor terminal, Claude Code)

This works immediately, **no harness restart needed**.

1. Verify connectivity with the public docs command (no key required):

   ```bash
   npx -y conport docs
   ```

   You should see a docs index (a `docs_version:` line and a list of pages). If
   this fails, the network or `npx` is the problem — fix that before continuing.

2. From now on, run ConPort operations through the `conport` CLI. It is generic
   over the live OpenAPI spec and authenticates from `CONPORT_API_KEY`. Discover
   the full surface yourself:

   ```bash
   npx -y conport api __schema        # every resource + operation
   npx -y conport api tasks --help    # operations under one resource
   npx -y conport api tasks list --help   # flags for one operation
   ```

   Common operations (all read `CONPORT_API_KEY` from the env):

   ```bash
   npx -y conport api projects list
   npx -y conport api tasks list --project_identifier <project>
   npx -y conport api decisions list --project_identifier <project>
   npx -y conport api search ...      # see: conport api search --help
   ```

   Browse deep reference any time with `npx -y conport docs <topic>` or
   `npx -y conport docs --search <query>`.

3. (Agent-framework runtimes only — Hermes, Pi, and similar multi-agent
   harnesses with persistent agent identity.) The agent-memory line is a
   separate CLI:

   ```bash
   npx -y conport-agent api __schema
   npx -y conport-agent remember ...   # intent aliases: remember / recall / create-kind / event
   ```

   A normal project install does **not** need `conport-agent` — skip it unless
   the user explicitly runs a multi-agent framework. See
   [docs/install/agents.md](./docs/install/agents.md).

### Path B — you are an MCP host (Claude Code, Cursor, Claude.ai)

The MCP path exposes a richer native tool surface (`init`, `search`,
`sync_decision`, block-level document tools, …) directly in the harness.

**Trade-off, state it to the user:** MCP config changes require
**restarting / reloading the harness** to take effect. For an in-session
agentic install the CLI path (Path A) is faster because it needs no restart.
If the harness has a terminal, you can use Path A now and add MCP later.

To wire the MCP server, follow the exact per-harness config in:

- Claude Code → [docs/install/claude-code.md](./docs/install/claude-code.md)
  (the plugin marketplace installs MCP + skills + hooks in one step)
- Cursor → [docs/install/cursor.md](./docs/install/cursor.md)
- Claude.ai → [docs/install/claude-ai.md](./docs/install/claude-ai.md)

All three point the server at `https://api.conport.app/mcp/` with
`Authorization: Bearer ${CONPORT_API_KEY}`. After editing MCP config, tell the
user to reload/restart the harness, then continue at Step 4.

---

## Step 3 — install the runtime discipline skill

The `conport` skill carries ConPort's always-on rules (run `init` at session
start, search before answering, save decisions and progress as they happen).
Install it so you actually follow them.

```bash
npx -y skills add shaurgon/conport-plugin --skill conport -a <your-agent>
```

Replace `<your-agent>` with your harness (`codex`, `copilot`, `gemini`,
`cursor`, …). List what's available first if unsure:

```bash
npx -y skills add shaurgon/conport-plugin --list
```

Notes:

- **Claude Code** already bundles this skill via the plugin (Path B) — you don't
  need this command there.
- **Cursor** can take the skill via `.cursor`/`.agents` skill paths or this
  command; see [docs/install/cursor.md](./docs/install/cursor.md).

---

## Step 4 — verify and report

1. Bootstrap ConPort and confirm it works:
   - **MCP host:** call the `init` tool with this project's name
     (`mcp__conport__init` in Claude Code, or the equivalent MCP tool name).
   - **CLI host:** run `npx -y conport api projects list`, then list this
     project's tasks with
     `npx -y conport api tasks list --project_identifier <project> --status TODO,IN_PROGRESS`.

2. Report the result to the user in plain language: confirm the connection
   works, name the project ConPort resolved, and summarize its current
   backlog (open tasks, recent decisions). If the project is new and empty, say
   so and offer to start capturing decisions and tasks as you work.

If `init` (or the first CLI call) returns auth errors, the key isn't reaching
the process — recheck that `CONPORT_API_KEY` is set in the environment you run
in (Step 1). Do not paper over it by hard-coding the key anywhere.

---

## Per-harness reference

| Harness | Guide |
|---|---|
| Claude Code | [docs/install/claude-code.md](./docs/install/claude-code.md) |
| Cursor | [docs/install/cursor.md](./docs/install/cursor.md) |
| Claude.ai (web) | [docs/install/claude-ai.md](./docs/install/claude-ai.md) |
| Other CLI agents (Codex / Copilot / Gemini) | [docs/install/other-agents.md](./docs/install/other-agents.md) |
| Agent-memory line (Hermes / Pi) | [docs/install/agents.md](./docs/install/agents.md) |
