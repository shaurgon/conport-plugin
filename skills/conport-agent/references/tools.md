# ConPort Agent Tools Reference (v6.0.0)

7 tools, grouped by use case. All require an authenticated agent.

> **decision-692:** backend is bookkeeping + cheap pgvector / signal
> computation only. It never calls an LLM. Skill promotion, conflict
> resolution — you produce the content; backend persists.

## Identity & lifecycle

| Tool | Args | Description |
|------|------|-------------|
| `agent_init_v3` | `uuid?`, `name?`, `type?` | Bootstrap or load. Returns identity (10), principles (10), broadcast_facts (10), mature_communities, borderline_nodes, pending_extraction, summary. |

## Memory write

| Tool | Args | Description |
|------|------|-------------|
| `agent_chat_turn` | `agent_uuid`, `role`, `text` | Record a chat message in the buffer. Returns `extraction_signal` (true when buffer ≥ 10) + `pending_message_ids`. |
| `agent_remember_v3` | `agent_uuid`, `meta_type`, `content`, `visibility?`, `edges?` | Direct node write. `meta_type` ∈ {identity, principle, fact, observation, skill, artifact}. `edges` = [{target_node_id, edge_type}]. Trigger forces identity/principle to private. |
| `agent_extract_thread` | `agent_uuid`, `message_ids` | LLM extraction: converts buffered messages into typed nodes + edges. Call when `extraction_signal` fires. |

## Memory read

| Tool | Args | Description |
|------|------|-------------|
| `agent_recall_v3` | `agent_uuid`, `query`, `limit?`, `scope?` | Vector search with visibility filter. `scope` = {meta_types, visibility, community_id}. Returns ranked nodes with similarity score. |
| `agent_get_subgraph` | `agent_uuid`, `root_node_id`, `depth?`, `edge_types?` | BFS from a node outward (default depth 2, max 4). Returns {nodes, edges}. |

## Skill emergence

| Tool | Args | Description |
|------|------|-------------|
| `agent_promote_skill` | `agent_uuid`, `community_id`, `content` | Create a broadcast skill node + skill_of edges to community central nodes. Only call when `mature_communities` in init payload suggests it. |
