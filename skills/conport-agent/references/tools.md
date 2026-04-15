# ConPort Agent Tools Reference

## Identity

| Tool | Args | Description |
|------|------|-------------|
| `agent_init` | `uuid?`, `name?`, `type?`, `soul?` | Find or create agent. Returns uuid, soul, memories, projects |
| `agent_attach_project` | `agent_uuid`, `project` | Attach to project by name/ID. Returns project context |

## Memory

| Tool | Args | Description |
|------|------|-------------|
| `agent_remember` | `agent_uuid`, `content`, `memory_type?`, `tags?`, `category?`, `entity_ref?`, `pinned?` | Store memory with auto-dedup. Similar existing memories are superseded. |
| `agent_recall` | `agent_uuid`, `query`, `memory_type?`, `category?`, `limit?`, `pinned_only?`, `tags?`, `include_linked?` | Semantic search with decay scoring. Hot memories rank higher. |
| `agent_forget` | `agent_uuid`, `memory_number`, `hard_delete?` | Supersede (default) or hard-delete a memory by its per-agent number. |
| `agent_reflect` | `agent_uuid`, `scope?` | Analyze memories: promotable notes, stale, duplicates. scope=full auto-supersedes >0.92 dupes. |
| `agent_link_memories` | `agent_uuid`, `source_memory_number`, `target_memory_number`, `relation_type`, `similarity_score?` | Create directional link between memories (per-agent numbers). |

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
