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

## The tools of each group

To get a tool listed, find it here and add its group to the profile. A tool of
`core` is in the row of its area as well: either group lists it.

| Group | Tools |
|---|---|
| `core` | `init`, `create_project`, `list_projects`, `search`, `add_task`, `get_task`, `list_tasks`, `update_task`, `sync_decision`, `get_decision`, `list_decisions`, `update_decision`, `log_progress`, `list_progress`, `update_progress`, `add_document`, `get_document`, `list_documents`, `update_document`, `update_active_context` |
| `session` | `init` |
| `projects` | `list_projects`, `create_project` |
| `tasks` | `add_task`, `update_task`, `list_tasks`, `get_task`, `delete_task`, `add_task_dep`, `add_linked_task` |
| `milestones` | `add_milestone`, `update_milestone`, `list_milestones` |
| `agenda` | `get_agenda` |
| `documents` | `add_document`, `update_document`, `list_documents`, `get_block_backlinks`, `get_semantically_related_blocks`, `get_document`, `delete_document`, `document_versions`, `list_blocks`, `get_block`, `update_block`, `insert_block`, `delete_block` |
| `diagrams` | `list_diagrams` |
| `decisions` | `sync_decision`, `update_decision`, `deprecate_decision`, `reactivate_decision`, `list_decisions`, `get_decision`, `delete_decision` |
| `progress` | `log_progress`, `update_progress`, `list_progress`, `delete_progress` |
| `patterns` | `log_pattern`, `update_pattern`, `list_patterns` |
| `context` | `update_product_context`, `update_active_context` |
| `search` | `search` |
| `links` | `link_items`, `get_linked`, `link_project`, `get_project_links`, `unlink_project` |
| `graphrag` | `entities`, `entity`, `entity_related`, `communities`, `community`, `graph_stats` |
| `history` | `recent_activity`, `item_history`, `context_history` |
| `guardrails` | `add_convention`, `add_error_solution`, `list_conventions`, `list_error_solutions` |
| `gaps` | `gap_list`, `gap_ack`, `gap_dismiss`, `gap_dismiss_bulk`, `gap_undismiss`, `gap_stats` |
| `semantic` | `semantic_pass_run`, `semantic_proposals_list`, `semantic_proposal_approve`, `semantic_proposal_reject`, `semantic_proposal_defer`, `semantic_proposals_apply`, `semantic_pass_stats`, `semantic_cleanup` |
| `recipes` | `assemble_context`, `list_context_recipes`, `audit_doc_l1_coverage`, `render_current_architecture` |
| `routine` | `get_routine_config`, `set_routine_config`, `routine_run_start`, `routine_run_finish`, `list_routine_runs`, `get_estimation_stats` |

## What each skill and workflow needs

The skills, the workflows and the hooks of the plugin name tools by name. A
connection narrowed below the groups of those tools does not list them, so
connect with the profile of what you run:

| What you run | Profile |
|---|---|
| Skill `conport` | `full` |
| Skill `conport-routine` | `core,milestones,agenda,gaps,semantic,routine` |
| Skill `superpowers-conport` | `core,links` |
| Workflow `task` | `core` |
| Workflow `epic` | `core` |
| Hooks | `core,milestones` |

Each profile is the fewest groups that list every tool the files of that part
name — the tools the part names itself, not the ones a session ends up
calling. The `conport` skill is the reference of every tool, which is why its
row says `full`; loading the skill does not require `full`. The hooks call no
tool themselves: their profile lists the tools they tell the agent to call. To
run several parts on one connection, name the groups of all of them together —
`core,milestones,links` for the `superpowers-conport` skill with the hooks.

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
| `available` | The groups that have a tool this connection does not list |
| `hint` | The one thing the agent does when it needs a tool that is not listed: tell you which group to add to the profile. It names the groups of `available` and the address of this page |

A group whose tools are all listed already is not in `available`: under `core`
that is `session`, `projects` and `search`. When the connection lists every
tool — no profile, `full`, or groups that hold every tool between them — the
field is absent.
