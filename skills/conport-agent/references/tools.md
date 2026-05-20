# ConPort Agent Tools Reference (v5.0.0)

26 tools, grouped by use case. All require an authenticated agent.

> **decision-692:** backend is bookkeeping + cheap pgvector / signal
> computation only. It never calls an LLM to merge / synthesise. Where
> that is needed (lift synthesis, conflict resolution, re-crystallization
> content merge), you produce the content; backend persists.

## Identity & lifecycle

| Tool | Args | Description |
|------|------|-------------|
| `agent_init` | `uuid?`, `name?`, `type?` | Bootstrap or load. Returns `AgentInitPayload` (bootstrap_state, 4 reserved root ids, current_active_node_id, trunk_context, active_branches, recent skills, pending counts). |
| `agent_activate_node` | `agent_uuid`, `node_id` | Set current_active_node_id. |
| `agent_activate_branch` | `agent_uuid`, `branch_id`, `target_node_id?` | Activate branch; dormant→active triggers a gravity probe. |

## Memory write & branches

| Tool | Args | Description |
|------|------|-------------|
| `agent_remember` | `agent_uuid`, `content`, `parent_id?`, `branch_id?` | Store + argmax routing. Returns `routing.decision` (linear/uncertain/new_branch), alternatives, gravity_signal. Both refs omitted → routing decides; explicit refs skip routing. |
| `agent_create_branch` | `agent_uuid`, `name`, `anchor_id?` | Explicit branch seeding (rare — most branches emerge via routing). |
| `agent_close_branch` | `agent_uuid`, `branch_id`, `reason?` | Marks branch_state='closed', runs terminal crystallization. |

## Memory read

| Tool | Args | Description |
|------|------|-------------|
| `agent_recall` | `agent_uuid`, `query`, `scope_root_id?`, `limit?`, `offset?` | Composite scoring: 0.6·sim + 0.2·recall_factor + 0.2·foundational_boost. Trunk-resident gets a boost. scope_root_id None → entire tree; else recursive descendants subtree. |
| `agent_get_node` | `agent_uuid`, `node_id` | Node + immediate children list. |
| `agent_walk_branch` | `agent_uuid`, `branch_id` | Origin + depth-ordered arc + attached artifacts. |
| `agent_list_branches` | `agent_uuid`, `state?` | Branch origins filtered by branch_state (active / dormant / closed). |

## Reflection / gravity

| Tool | Args | Description |
|------|------|-------------|
| `agent_reflect` | `agent_uuid`, `node_id`, `new_content?` | `new_content` given → persist merged content + refresh embedding + bookkeeping + crystallization check. Omitted → pure bookkeeping pass (resets unconsolidated counters, recomputes avg_origin_child_similarity, runs crystallization check). |

## Artifacts (branch outputs, NOT experience)

Artifacts are products (lists, drafts, summaries, external_refs). They
do **not** participate in gravity. Provenance is M:M with role_type
(decision-669; v1 uses `derived_from` exclusively).

| Tool | Args | Description |
|------|------|-------------|
| `agent_emit_artifact` | `agent_uuid`, `artifact_type`, `payload?`, `external_url?`, `branch_id?`, `derived_from?` | Create artifact + provenance edges. One of payload/external_url required. derived_from = experience node ids. |
| `agent_list_artifacts` | `agent_uuid`, `branch_id?`, `artifact_type?`, `since?`, `limit?` | Filter by branch / type / created_at since. |
| `agent_get_artifact` | `agent_uuid`, `artifact_id` | Single row. |
| `agent_artifact_provenance` | `agent_uuid`, `artifact_id` | Sources list (experience nodes + role + content preview + is_skill flag). |
| `agent_node_artifacts` | `agent_uuid`, `experience_node_id`, `role_type?` | Reverse provenance — artifacts referencing this node. |

## Lift workflow (cross-branch repeats → trunk)

Detection runs weekly. You synthesise the lifted content; backend
never synthesises.

| Tool | Args | Description |
|------|------|-------------|
| `agent_review_lift_candidates` | `agent_uuid` | Pending agent_lift_candidate rows + matched origin previews + detection_score + auto_eligible flag. |
| `agent_confirm_lift` | `agent_uuid`, `candidate_id`, `action`, `synthesized_content?`, `target_trunk_parent_id?` | action=accept/edit_content → create trunk node with synthesized_content under target_trunk_parent_id (must be trunk-resident — typically identity_root / principles_root / person_knowledge_root from agent_init); back-refs set on matched origins. action=reject → flag only. |
| `agent_request_synthesis_assistance` | `agent_uuid`, `candidate_id` | Opt-in Mistral fallback (decision-672). v1 returns `not_implemented`. Synthesise yourself and pass to agent_confirm_lift. |

## Promotion (branch-local skill → trunk-promoted)

Trigger: cross_branch_activation_count ≥ 3 distinct branches AND
crystallized > 14d ago AND promotion_status='branch_only'. Backend
finds pgvector neighbors in trunk / other skills. None → auto
`trunk_promoted`. Found → `conflict_held` for your review.

| Tool | Args | Description |
|------|------|-------------|
| `agent_review_promotion_conflicts` | `agent_uuid` | Skills with promotion_status='conflict_held' + their pgvector neighbors (other skills OR trunk-resident, similarity ≥ 0.85). |
| `agent_resolve_promotion_conflict` | `agent_uuid`, `skill_id`, `action` | action=promote → trunk_promoted (you merged via add_skill_note / reflect / remember beforehand if needed). action=revert → branch_only. |
| `agent_load_skill` | `agent_uuid`, `skill_id` | Explicit cross-load. Bumps cross_branch_activation_count when loading from a different branch than current active (and skill still branch_only). |

## Skill versioning & notes

Skills mutate in-place between crystallization events; notes accumulate
and fold into the next version (decision-675).

| Tool | Args | Description |
|------|------|-------------|
| `agent_skill_versions` | `agent_uuid`, `skill_id` | Version history, newest first. |
| `agent_get_skill_version` | `agent_uuid`, `skill_id`, `version_number` | Specific snapshot. |
| `agent_get_skill_md` | `agent_uuid`, `skill_id` | Pre-rendered markdown: title (first non-reserved tag) + version footer + content + active notes grouped by type. |
| `agent_add_skill_note` | `agent_uuid`, `skill_id`, `content`, `note_type?` | Append note. note_type ∈ {observation, correction, edge_case, example}. |
| `agent_supersede_skill_note` | `agent_uuid`, `note_id` | Manually mark superseded (reason='manually_superseded'). Idempotent. |
| `agent_complete_re_crystallization` | `agent_uuid`, `skill_id`, `new_content`, `integrated_note_ids?` | Persist merged content + refresh embedding + insert new agent_skill_version + mark integrated notes superseded. You did the merge; backend records. |
| `agent_review_re_crystallization` | `agent_uuid` | Skills meeting hysteresis (consolidation_delta ≥ 3 OR active_note_count ≥ 5 OR content drift). |

## Sunset (removed in v5.0.0)

`agent_attach_project` — agent layer is separated from project layer
(decision-660). Project memory tools live under the `conport` skill.

`agent_forget` — v2 is non-destructive; nothing "forgets". For skill
notes use `agent_supersede_skill_note`. Future archival of experience
nodes will be a separate tool with explicit semantics.

`agent_link_memories` — replaced by tree edges (`parent_id`),
trunk-promotion back-refs (`lifted_to_trunk_node_id` +
`lift_source_origin_ids[]`), and artifact provenance edges. Cross-edges
may return as a separate concept if a use case appears.

Old args on `agent_remember` / `agent_recall` / `agent_reflect`
(memory_type / category / pinned / tags / include_linked / project_id /
scope='day|week|full') are **gone**. The v2 signatures replace them
entirely.
