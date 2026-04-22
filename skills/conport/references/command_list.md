# ConPort MCP Tools Reference

> Full reference for ConPort v7.0+ MCP tools

## Call format

The prefix depends on the environment:

| Environment | Prefix |
|-------------|--------|
| **Claude Code CLI** | `mcp__conport__` |
| **Claude.ai Chat** | `mcp__claude_ai_conport__` |

**All examples below use the short prefix `mcp__conport__`.**
In Claude.ai Chat, replace it with `mcp__claude_ai_conport__`.

```
mcp__conport__<tool_name>({
  param1: value1,
  param2: value2
})
```

> **Identifiers:** most items are addressed by their **per-project sequential
> ID** (`task_id`, `decision_id`, `document_id`, `pattern_id`,
> `progress_id`). `project_id` is still the integer project ID.

---

## Session

### init

Initialize/load a project. Project name is required.

```
mcp__conport__init({
  name: "my-project",
  description: "Optional description"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | yes | Project name (1-50 chars, ASCII alphanumeric/hyphen/underscore) |
| description | string | no | Project description (max 2000 chars) |

**Returns:** `project_id`, `name`, `recent_decisions`, `recent_patterns`,
`active_tasks` (TODO+IN_PROGRESS), `stats`, `active_context`, `instructions`,
`summary`, and `reconciliation` when stale IN_PROGRESS tasks are detected.

---

## Context

### update_product_context

Update a single product context field (vision, goals, architecture, etc.)

```
mcp__conport__update_product_context({
  project_id: 11,
  field: "vision",
  value: "AI-powered knowledge base"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| field | string | yes | vision \| goals \| features \| architecture \| tech_stack \| constraints |
| value | string/array | yes | New value |

### update_active_context

Update a single active context field (current_focus, open_questions, etc.)

```
mcp__conport__update_active_context({
  project_id: 11,
  field: "current_focus",
  value: "Implementing OAuth2"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| field | string | yes | current_focus \| recent_changes \| open_questions \| risks |
| value | string/array | yes | New value |

### context_history

Context version history

```
mcp__conport__context_history({
  project_id: 11,
  context_type: "product",
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| context_type | string | yes | "product" or "active" |
| limit | integer | no | Max results (default: 10) |

---

## Decisions

### sync_decision

Create an architectural decision. Triggers pattern-emergence check in the
background (cluster of similar decisions may auto-generate a pattern).

```
mcp__conport__sync_decision({
  project_id: 11,
  summary: "Use PostgreSQL",
  rationale: "ACID compliance",
  tags: ["database", "arch"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| summary | string | yes | Short summary (max 200 chars) |
| rationale | string/object | no | Rationale (max 2000 chars). JSON string or object. |
| tags | array | no | Tags |

**Returns:** decision object including per-project `id`. May include
`_hint`, `_similar_decisions`, `_hint_message` when a cluster is detected.

### list_decisions

List architectural decisions

```
mcp__conport__list_decisions({
  project_id: 11,
  tags: ["database"],
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 20) |
| offset | integer | no | Pagination offset (default: 0) |
| tags | array | no | Filter by tags |

### delete_decision

Delete a decision by per-project ID

```
mcp__conport__delete_decision({
  project_id: 11,
  decision_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| decision_id | integer | yes | Per-project decision ID |

---

## Progress (Activity Log)

Progress entries are a pure activity log without workflow statuses.
For tasks with statuses, use **Tasks**.

### log_progress

Create an activity log entry. Optionally links to a task/decision/pattern
(linked target referenced by its per-project ID).

```
mcp__conport__log_progress({
  project_id: 11,
  description: "Started work on auth module",
  title: "Auth update",
  linked_item_type: "task",
  linked_item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| description | string | yes | Description (max 2000 chars) |
| title | string | no | Title (max 200 chars) |
| parent_number | integer | no | Per-project ID of parent progress entry (threading) |
| linked_item_type | string | no | task \| decision \| pattern |
| linked_item_id | integer | no | Per-project ID of the linked item |

**Returns:** progress entry with per-project `id`.

### update_progress

Update an activity entry

```
mcp__conport__update_progress({
  project_id: 11,
  progress_id: 45,
  description: "Updated implementation notes"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| progress_id | integer | yes | Per-project progress entry ID |
| title | string | no | New title |
| description | string | no | New description |

### list_progress

List progress entries

```
mcp__conport__list_progress({
  project_id: 11,
  limit: 20,
  offset: 0
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 50) |
| offset | integer | no | Pagination offset (default: 0) |

### delete_progress

Delete a progress entry

```
mcp__conport__delete_progress({
  project_id: 11,
  progress_id: 8
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| progress_id | integer | yes | Per-project progress entry ID |

---

## Tasks

### add_task

Create a task with optional hierarchy and priority

```
mcp__conport__add_task({
  project_id: 11,
  title: "Implement auth",
  status: "TODO",
  priority: 4
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| title | string | yes | Title (max 200 chars) |
| description | string | no | Description (max 2000 chars) |
| status | string | no | TODO \| IN_PROGRESS \| BLOCKED \| DONE \| CANCELLED (default: TODO) |
| priority | integer | no | 1-5 (5=highest, default: 3) |
| parent_task_id | integer | no | Per-project ID of parent task |

### update_task

Update a task

```
mcp__conport__update_task({
  project_id: 11,
  task_id: 5,
  status: "DONE"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |
| title | string | no | New title |
| description | string | no | New description |
| status | string | no | New status |
| priority | integer | no | New priority (1-5) |

### list_tasks

List tasks with filters. Defaults to active tasks (TODO + IN_PROGRESS).
Pass `status: "ALL"` for all statuses, or a comma-separated list.

```
mcp__conport__list_tasks({
  project_id: 11,
  status: "IN_PROGRESS"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| status | string | no | Filter by status. Comma-separated or "ALL" (default: "TODO,IN_PROGRESS") |
| priority | integer | no | Filter by priority |
| parent_task_id | integer | no | Filter by parent per-project ID (0 = root tasks only) |
| limit | integer | no | Max results (default: 50) |
| include_description | boolean | no | Include task descriptions (default: false) |

### get_task

Task details with dependencies and subtasks

```
mcp__conport__get_task({
  project_id: 11,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |

### add_task_dep

Add a dependency between two tasks

```
mcp__conport__add_task_dep({
  project_id: 11,
  task_id: 5,
  depends_on_task_id: 3,
  dependency_type: "blocks"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project ID of the dependent task |
| depends_on_task_id | integer | yes | Per-project ID of the task it depends on |
| dependency_type | string | no | blocks \| requires \| suggests (default: blocks) |

### delete_task

Delete a task (also removes its dependencies)

```
mcp__conport__delete_task({
  project_id: 11,
  task_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| task_id | integer | yes | Per-project task ID |

---

## Documents

### add_document

Create a document

```
mcp__conport__add_document({
  project_id: 11,
  title: "API Spec",
  content: "# API\n...",
  doc_type: "api_docs"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| title | string | yes | Title (max 200 chars) |
| content | string | yes | Content (max 50000 chars) |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| other |
| author | string | no | Author (max 100 chars) |
| tags | array | no | Tags |
| parent_document_id | integer | no | Per-project ID of parent document |

### update_document

Surgically patch a document via a list of operations. Creates a new version by default.

There is **no** `content` field for a full rewrite — use `operations: [{op: "set_content", content: "..."}]` instead. This keeps large-document edits cheap: you point at a section or substring and replace just that piece.

```
mcp__conport__update_document({
  project_id: 11,
  document_id: 5,
  operations: [
    { op: "replace_section_body", heading: "## API Endpoints", content: "...new body..." },
    { op: "append_to_section",   heading: "## Changelog",      content: "- 2026-04-19: patched" },
    { op: "find_replace",        find: "old-name", replace: "new-name", replace_all: true }
  ]
})
```

**Operation kinds** (all take a discriminator `op`):

| op | fields | effect |
|----|--------|--------|
| `set_content` | `content` | replace entire document body |
| `replace_section_body` | `heading`, `content` | replace everything under a heading (body + all subsections); heading line preserved |
| `append_to_section` | `heading`, `content` | append a paragraph at the end of a section's body |
| `insert_section_after` | `heading`, `content` | insert a sibling block after the section (past its subsections) |
| `delete_section` | `heading` | remove the section including its subsections |
| `find_replace` | `find`, `replace`, `replace_all?` | literal string replace; errors on 0 matches or on multiple matches when `replace_all=false` |

`heading` accepts either the literal heading line (`"## API Endpoints"`) or a disambiguating path (`"## Architecture > ### Database"`). Ambiguous matches return an error listing all matching heading paths.

Operations are applied sequentially in memory; if any operation fails, nothing is persisted and no new version is written. One new version per call regardless of how many operations it contains.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |
| operations | array | no | List of patch operations (see above). Omit for metadata-only update. |
| title | string | no | New title |
| doc_type | string | no | spec \| runbook \| api_docs \| tutorial \| architecture \| meeting_notes \| other |
| tags | array | no | New tag list |
| author | string | no | New author |
| create_new_version | boolean | no | Snapshot-per-edit history. Default **false** — the current row is updated in place and `document_id` stays stable. Set `true` only when you want a new version row with a fresh `document_id` and the old row marked `is_current=false`. |

### list_documents

List documents

```
mcp__conport__list_documents({
  project_id: 11,
  doc_type: "spec"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| doc_type | string | no | Filter by type |
| limit | integer | no | Max results (default: 50) |

### get_document

Get a document

```
mcp__conport__get_document({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

### document_versions

Document version history

```
mcp__conport__document_versions({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

### delete_document

Delete a document

```
mcp__conport__delete_document({
  project_id: 11,
  document_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| document_id | integer | yes | Per-project document ID |

---

## Patterns

### log_pattern

Create a system pattern

```
mcp__conport__log_pattern({
  project_id: 11,
  name: "Repository Pattern",
  description: "Data access abstraction",
  tags: ["architecture", "data"]
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| name | string | yes | Name (max 200 chars) |
| description | string | yes | Description (max 2000 chars) |
| tags | array | no | Tags |

### list_patterns

List architectural patterns

```
mcp__conport__list_patterns({
  project_id: 11,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| limit | integer | no | Max results (default: 20) |
| offset | integer | no | Pagination offset (default: 0) |
| tags | array | no | Filter by tags |

---

## Knowledge Graph Links

### link_items

Create a link between two items. Both source and target are referenced by
their **per-project IDs** (sequential within the project).

```
mcp__conport__link_items({
  project_id: 11,
  source_type: "decision",
  source_id: 7,
  target_type: "pattern",
  target_id: 3,
  relationship: "implements",
  description: "Decision implements this pattern"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| source_type | string | yes | decision \| progress \| pattern \| task \| document |
| source_id | integer | yes | Per-project ID of source item |
| target_type | string | yes | decision \| progress \| pattern \| task \| document |
| target_id | integer | yes | Per-project ID of target item |
| relationship | string | no | Link type (default: relates_to) |
| description | string | no | Link description |

**Link types:** relates_to, implements, depends_on, supersedes, references, blocks, clarifies

### get_linked

Get items linked to a specific item

```
mcp__conport__get_linked({
  project_id: 11,
  item_type: "decision",
  item_id: 7,
  direction: "outgoing"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| item_type | string | yes | decision \| progress \| pattern \| task \| document |
| item_id | integer | yes | Per-project ID of the item |
| relationship | string | no | Filter by link type |
| direction | string | no | outgoing \| incoming \| both (default: both) |

---

## Project Links

### link_project

Create a cross-project link

```
mcp__conport__link_project({
  project_id: 11,
  target_project: 15,
  link_type: "depends_on",
  description: "Uses for authentication"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Source project ID |
| target_project | integer | yes | Target project ID |
| link_type | string | yes | Link type |
| description | string | no | Link description |

**Link types:** depends_on, part_of, calls, shares_data, extends, deployed_with, shares_database, related_to

### get_project_links

Get cross-project links

```
mcp__conport__get_project_links({
  project_id: 11,
  direction: "both"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| direction | string | no | outgoing \| incoming \| both (default: both) |

### unlink_project

Delete a cross-project link

```
mcp__conport__unlink_project({
  project_id: 11,
  link_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| link_id | integer | yes | ID of the project-link row |

---

## Search

### search

Unified search across all project data with GraphRAG.

Automatically combines:
- **Semantic search** (vector similarity)
- **Full-text search** (FTS)
- **GraphRAG** (entity and community traversal)

Results are merged via **Reciprocal Rank Fusion (RRF)**.

```
mcp__conport__search({
  project_id: 11,
  query: "caching performance",
  types: ["decisions", "tasks"],
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| query | string | yes | Search query |
| types | array | no | Filter by types: tasks, decisions, documents, patterns, progress |
| limit | integer | no | Max results, capped at 100 (default: 20) |

**Returns:** `results` list with fields:
- `item_type` — item type
- `item_id` — internal ID
- `content` — content
- `score` — RRF score
- `source` / `_source` — e.g. `via_entity`, `via_community`,
  `aggregated_pattern`, `covered_by_pattern`
- plus `_summary`, and `_hint`/`_hint_message` when no results are found.

---

## GraphRAG & Entities

> GraphRAG tools work **globally** (without `project_id`) but are scoped to
> the current owner.

### entities

Search/list entities

```
mcp__conport__entities({
  query: "redis",
  entity_type: "technology",
  limit: 10
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | no | Search query (ILIKE match on canonical_name) |
| entity_type | string | no | technology \| component \| concept \| person \| organization |
| limit | integer | no | Max results (default: 20) |

### entity

Entity details (cross-project statistics)

```
mcp__conport__entity({
  entity_id: 42
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| entity_id | integer | yes | Canonical entity ID |

### entity_related

Related items via graph traversal

```
mcp__conport__entity_related({
  entity_id: 42,
  max_depth: 2,
  relation_types: "USES"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| entity_id | integer | yes | Canonical entity ID |
| max_depth | integer | no | Traversal depth (default: 2) |
| relation_types | string | no | Comma-separated relation types to filter |

### communities

List communities (knowledge clusters)

```
mcp__conport__communities({
  min_size: 3,
  include_summaries: true
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| min_size | integer | no | Minimum cluster size (default: 2) |
| include_summaries | boolean | no | Include summaries (default: true) |

### community

Community details with member entities and summary

```
mcp__conport__community({
  community_id: "community_0"
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| community_id | string | yes | Community ID (string) |

### graph_stats

Global knowledge graph statistics

```
mcp__conport__graph_stats()
```

No parameters.

---

## History & Activity

### recent_activity

Recent activity in the project

```
mcp__conport__recent_activity({
  project_id: 11,
  hours: 24,
  limit: 20
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| hours | integer | no | Over the last N hours (default: 24) |
| limit | integer | no | Max results (default: 10) |

### item_history

Version history of a specific item (by per-project ID)

```
mcp__conport__item_history({
  project_id: 11,
  item_type: "decision",
  item_id: 5
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | integer | yes | Project ID |
| item_type | string | yes | decision \| progress \| pattern \| custom_data \| context |
| item_id | integer | yes | Per-project item ID (for `custom_data`/`context` the raw ID is used) |

---

## Quick Reference

| Category | Tools |
|----------|-------|
| Session | `init` |
| Context | `update_product_context`, `update_active_context`, `context_history` |
| Tasks | `add_task`, `update_task`, `list_tasks`, `get_task`, `add_task_dep`, `delete_task` |
| Documents | `add_document`, `update_document`, `list_documents`, `get_document`, `delete_document`, `document_versions` |
| Decisions | `sync_decision`, `list_decisions`, `delete_decision` |
| Progress | `log_progress`, `update_progress`, `list_progress`, `delete_progress` |
| Patterns | `log_pattern`, `list_patterns` |
| Search | `search` |
| Linking | `link_items`, `get_linked`, `link_project`, `get_project_links`, `unlink_project` |
| GraphRAG | `entities`, `entity`, `entity_related`, `communities`, `community`, `graph_stats` |
| History | `recent_activity`, `item_history`, `context_history` |

**Prefix:** `mcp__conport__` (CLI) or `mcp__claude_ai_conport__` (Chat)

---

*Version: ConPort MCP v7.0*
*API: ConPort REST API v2.2*
