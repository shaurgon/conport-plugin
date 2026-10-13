# Tool profiles

A **tool profile** is the part of the tool list a connection asks the ConPort
MCP server for. The server has dozens of tools; an agent that needs a handful of
them can name a profile and have only those listed, so the rest never enter the
model's context.

A profile changes the list and nothing else:

- **No profile means the full list.** A connection that names none sees every
  tool, exactly as before profiles existed.
- **A tool outside the profile still works.** A profile is about the size of
  the list, not about rights: any tool can be called by name whatever the
  profile says. What you may reach is decided by team membership alone.

## Naming a profile

A profile is a comma-separated list of groups. Name it in either place:

| Where | Example |
|---|---|
| Parameter of the MCP address | `https://api.conport.app/mcp?profile=core` |
| Request header | `X-Conport-Profile: core,gaps,diagrams` |

When both are sent, the header wins. `full`, an empty value and no value at all
mean the full list. A header or a parameter sent several times names all its
groups together: `?profile=core&profile=gaps` is `core,gaps`.

A name that is no group is refused: every request of such a connection is
answered with HTTP 400 and the list of valid groups, so the client does not
connect at all. Reconnect with a profile made of those names only.

## Groups

`core` is the set every session needs. Every other group is one area of the
server; each tool belongs to exactly one area, and the tools of `core` stay in
their areas too — `core,tasks` lists the four task tools of `core` plus the
rest of `tasks`.

| Group | Tools | What it holds |
|---|---|---|
| `core` | 20 | The entry points, search, create / get / list / update of tasks, decisions, progress and documents, and the update of the active context |
| `session` | 1 | `init` |
| `projects` | 2 | Listing and creating projects |
| `tasks` | 7 | Tasks, their dependencies, deleting, tasks in a linked project |
| `milestones` | 3 | Roadmap milestones |
| `agenda` | 1 | The single-call briefing of a routine run |
| `documents` | 13 | Documents, their versions and block-level editing |
| `diagrams` | 1 | Architecture diagrams |
| `decisions` | 7 | Decisions, their retirement and deletion |
| `progress` | 4 | The progress log |
| `patterns` | 3 | Patterns |
| `context` | 2 | Product and active context |
| `search` | 1 | `search` |
| `links` | 5 | Links between items and between projects |
| `graphrag` | 6 | Entities, communities and graph statistics |
| `history` | 3 | Recent activity and item history |
| `guardrails` | 4 | Conventions and error solutions |
| `gaps` | 6 | Knowledge-base gaps |
| `semantic` | 8 | The semantic pass and its proposals |
| `recipes` | 4 | Context assembly and architecture rendering |
| `routine` | 6 | Periodic cycles: policy, runs, estimation statistics |

The tools of `core`: `init`, `create_project`, `list_projects`, `search`,
`add_task`, `get_task`, `list_tasks`, `update_task`, `sync_decision`,
`get_decision`, `list_decisions`, `update_decision`, `log_progress`,
`list_progress`, `update_progress`, `add_document`, `get_document`,
`list_documents`, `update_document`, `update_active_context`.

## Example: Claude Code

The connection the plugin installs lists every tool, and it has no setting for
a profile. A narrowed connection **replaces** it: the session must end up with
exactly one `conport` connection loaded — the narrowed one. While the plugin's
connection is loaded as well, both tool lists are in the context: more tools,
not fewer.

The narrowed connection, as an entry of the `.mcp.json` of the repository:

```json
{
  "mcpServers": {
    "conport": {
      "type": "http",
      "url": "https://api.conport.app/mcp?profile=core",
      "headers": {
        "Authorization": "Bearer <your cport_live_... key>"
      }
    }
  }
}
```

The key travels in the `Authorization` header, as on the plugin's connection.
Do not commit a key: how to keep it out of the file, and how to switch a
connection off, is described in the Claude Code documentation on MCP
connections — https://docs.claude.com/en/docs/claude-code/mcp. Named
`conport`, the connection gives its tools the `mcp__conport__` prefix the
skill calls them by.

To widen the list later, add groups to the address
(`?profile=core,gaps,diagrams`) and reconnect.

## What the agent is told

Under a narrowed profile the `init` response carries `tool_profile`:

| Field | Meaning |
|---|---|
| `active` | The groups this connection lists |
| `available` | The groups it does not list |
| `hint` | One sentence on how to list more |

With the full list the field is absent.
