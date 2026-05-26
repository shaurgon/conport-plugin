# ConPort Agent Tools Reference (v6.1.0)

18 tools (7 memory + 11 workspace), grouped by layer. All require an authenticated agent.

> **decision-692:** backend is bookkeeping + storage only. It never calls
> an LLM. Scoring, synthesis, conflict resolution — you produce the
> content; backend persists.

## Memory layer (sphere graph)

### Identity & lifecycle

| Tool | Args | Description |
|------|------|-------------|
| `agent_init` | `uuid?`, `name?`, `type?` | Bootstrap or load. Returns identity (10), principles (10), broadcast_facts (10), mature_communities, borderline_nodes, pending_extraction, summary. |

### Memory write

| Tool | Args | Description |
|------|------|-------------|
| `agent_chat_turn` | `agent_uuid`, `role`, `text` | Record a chat message. Returns `extraction_signal` (true when buffer >= 10) + `pending_message_ids`. |
| `agent_remember` | `agent_uuid`, `meta_type`, `content`, `visibility?`, `edges?` | Direct node write. Trigger forces identity/principle to private. |
| `agent_extract_thread` | `agent_uuid`, `message_ids` | LLM extraction: converts buffered messages into typed nodes + edges. |

### Memory read

| Tool | Args | Description |
|------|------|-------------|
| `agent_recall` | `agent_uuid`, `query`, `limit?`, `scope?` | Vector search with visibility filter. |
| `agent_get_subgraph` | `agent_uuid`, `root_node_id`, `depth?`, `edge_types?` | BFS from a node outward. |

### Skill emergence

| Tool | Args | Description |
|------|------|-------------|
| `agent_promote_skill` | `agent_uuid`, `community_id`, `content` | Create broadcast skill node from mature community. |

## Workspace layer (event-sourced)

### Entity

| Tool | Args | Description |
|------|------|-------------|
| `agent_entity_upsert` | `agent_uuid`, `entity_type`, `name`, `attrs?` | Create or merge attrs on typed entity. Natural key = (entity_type, name). |
| `agent_entity_get` | `agent_uuid`, `entity_type`, `name` | Lookup by natural key. |
| `agent_entity_list` | `agent_uuid`, `entity_type`, `attrs_filter?`, `limit?` | List with optional JSONB containment filter. |

### Event

| Tool | Args | Description |
|------|------|-------------|
| `agent_event_record` | `agent_uuid`, `event_type`, `payload`, `entity_id?`, `occurred_at?`, `run_id?` | Append-only event. `occurred_at` is real-world time. |
| `agent_event_query` | `agent_uuid`, `entity_id?`, `event_type?`, `since?`, `until?`, `run_id?`, `limit?` | Query with filters. |

### Run

| Tool | Args | Description |
|------|------|-------------|
| `agent_run_start` | `agent_uuid`, `skill_name`, `params?`, `skill_node_id?` | Start workflow run (status=running). |
| `agent_run_finish` | `agent_uuid`, `run_id`, `status`, `outputs?` | Finish run (completed/failed/cancelled). |

### Projection

| Tool | Args | Description |
|------|------|-------------|
| `agent_projection_record` | `agent_uuid`, `entity_id`, `projection_type`, `value`, `derived_from_event_ids?`, `derived_from_run_id?` | Record derived snapshot with provenance. |
| `agent_projection_current` | `agent_uuid`, `entity_id`, `projection_type` | Latest snapshot. |
| `agent_projection_history` | `agent_uuid`, `entity_id`, `projection_type`, `since?`, `until?`, `limit?` | All snapshots over time. |

### Cross-link

| Tool | Args | Description |
|------|------|-------------|
| `agent_link_node_to_entity` | `agent_uuid`, `node_id`, `entity_id`, `link_type?` | Link memory node to workspace entity ('mentions', 'about', 'derived_from'). |
