# conport changelog

## 15.25.0
Decision auto-extraction from progress is now reviewable: candidates extracted from log_progress land in the semantic proposals queue (semantic_proposals_list → approve/reject/defer) instead of committing directly; a dedup hit against an existing decision proposes a relates_to link instead of silently skipping. Extraction requires decision markers (an explicit choice AND a stated reason) and preserves the source language — chronicle statements are no longer extracted. Decisions carry server-assigned provenance: source (manual | progress_extraction) with a filter in list_decisions, existing auto-extracted decisions backfilled from their derived_from links; the dashboard shows an auto badge.

## 15.24.1
semantic_cleanup now returns immediately and runs in the background — poll semantic_pass_stats for completion, then semantic_proposals_list for the remainder. Concurrent calls while a pass is open return already_running with the run id.

## 15.24.0
Routine task selection: opt-in `routine_eligible` flag on tasks (`add_task`/`update_task`, filter in `list_tasks`) and a `selection` mode in the routine config — `threshold` (default, current behavior) or `tagged` (the cycle picks only marked tasks; the priority threshold still applies as the risk limiter). In tagged mode `get_agenda` ready_top contains only marked rows; init's backlog stays project-wide. Mark the exact row the agent may pick up — the epic itself for whole-epic execution. Dashboard: routine badge, detail-panel toggle and a routine-only filter.

## 15.23.1
conport-routine: woken tasks got an explicit runbook place in the Reconcile phase — they re-enter the general ready pool, get a digest mention, with the re-check-by-date exception spelled out.

## 15.23.0
Routines: periodic backlog cycles are now product behavior. New conport-routine skill (six-phase runbook: start/reconcile/housekeeping/execute/digest/empty-day). New MCP tools: `get_agenda` (single-call run briefing), `get_routine_config` / `set_routine_config` (per-project cycle policy: cadence, run limits, autonomy levels 0-2), `routine_run_start` / `routine_run_finish` / `list_routine_runs` (run journal), `get_estimation_stats` (estimate calibration). `list_tasks` gains `ready=true` (dependency-unblocked only), `order="priority"` (effective-priority ranking) and `offset`; tasks gain `snooze_until` (hidden until a date, auto-wake) and an IN_PROGRESS lease with automatic release of stale claims. `update_task` close now echoes `estimate_drift` (plan vs actual). `init` may return `routine_suggestion` for routine-ripe projects; four rhythm gap types (`routine_run_missed`, `routine_run_died`, `task_blocked_too_long`, `backlog_starving`) join gap detection. Live docs: `projects/routines`.

## 15.22.1
Wrapped skill frontmatter `description` in quotes so strict YAML/frontmatter parsers don't break on em-dashes and slashes in the description.

## 15.22.0
Thinned skill — always-on discipline here, deep reference routed to live docs at conport.app | 83 MCP tools | Auto-detection | GraphRAG | Gap detection | Semantic pass | Cross-project linked tasks | Block-level document model | Recipe-pattern context assembly | Prefix-id convention | Skill version notification | Post-write payload verification | Slim MCP write responses | Task reparenting + 2-level hierarchy schema invariant | Canonical cross-reference grammar | Spec append-only enforcement | Documentation graph callouts + backlinks | current_architecture recipe + L1 capture-gap audit | Per-task time tracking | Server-side reject of MCP tool-call XML leakage
