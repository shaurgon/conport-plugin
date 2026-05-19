# ConPort Agent Tools Reference

## Identity

| Tool | Args | Description |
|------|------|-------------|
| `agent_init` | `uuid?`, `name?`, `type?` | Find or create agent. Returns uuid, memories, projects |
| `agent_attach_project` | `agent_uuid`, `project` | Attach to project by name/ID. Returns project context |

## Memory

| Tool | Args | Description |
|------|------|-------------|
| `agent_remember` | `agent_uuid`, `content`, `memory_type?`, `tags?`, `category?`, `entity_ref?`, `pinned?`, `project_id?` | Store memory with auto-dedup. `project_id` scopes the memory to one project (omit for agent-global facts). |
| `agent_recall` | `agent_uuid`, `query`, `memory_type?`, `category?`, `limit?`, `pinned_only?`, `tags?`, `include_linked?`, `project_id?` | Semantic search with decay scoring. Pass `project_id` to scope results to global + this project; omit for cross-project audit only. |
| `agent_forget` | `agent_uuid`, `memory_id`, `hard_delete?` | Supersede (default) or hard-delete a memory by its per-agent id. |
| `agent_reflect` | `agent_uuid`, `scope?`, `project_id?` | Analyze memories: promotable notes, stale, duplicates. scope=full auto-supersedes >0.92 dupes. `project_id` scopes the analysis. |
| `agent_link_memories` | `agent_uuid`, `source_memory_id`, `target_memory_id`, `relation_type`, `similarity_score?` | Create directional link between memories (per-agent ids). |

## Project Scoping (`project_id`)

`agent_memory` is agent-scoped, not project-scoped by default. Memories
written without `project_id` are **agent-global** — visible from every
project's recall. Memories written with `project_id` are **project-scoped**
— visible only from that project's recall (plus all global rows).

When to use which:

| Memory | `project_id`? |
|--------|---------------|
| Identity, role, principles, cross-cutting feedback | omit (global) |
| Codebase-specific facts, project decisions, project bugs, project workflow notes | pass the active project's id |
| Background cron with no conversation context | prefer not to use `agent_recall` for project-shaped outputs at all — use `search` / `list_decisions` instead |

Without `project_id`, `agent_recall` for a multi-project agent returns
top-K from every project, mixing material across projects. Using that as
input to `add_task` / `log_progress` against one project leaks other
projects' content (task-331).

## Decay Scoring

Memories decay in retrieval priority over time:
- **Hot** (accessed < 7 days): full weight
- **Warm** (7-30 days): reduced weight
- **Cold** (30+ days, never accessed): lowest weight
- Frequently accessed memories resist decay.
- **Pinned** memories are always hot — they never decay.

`agent_recall` returns `decay_tier` and `final_score` for each result.

## Reflection Scopes

| Scope | When | What it does |
|-------|------|-------------|
| `day` | End of session / heartbeat | Find today's notes promotable to fact/pattern |
| `week` | Weekly (e.g. Monday) | Hot/warm/cold analysis, entity grouping, cold cleanup candidates |
| `full` | On demand | Full audit: duplicates (auto-supersede >0.92), stale memories |

Reflect is **read-only** — it returns analysis, you decide what to act on.

## Memory Links

Memories can be linked to form a knowledge graph:

| Relation | Meaning |
|----------|---------|
| `related_to` | General association |
| `supersedes` | Newer replaces older (auto-created by reflect) |
| `derives_from` | Built upon another memory |
| `contradicts` | Conflicts with another memory |
| `supports` | Reinforces another memory |

`agent_recall` with `include_linked=true` returns 1-level linked memories for each result.
