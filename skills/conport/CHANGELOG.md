# conport changelog

## 15.23.1
conport-routine: woken tasks got an explicit runbook place in the Reconcile phase — they re-enter the general ready pool, get a digest mention, with the re-check-by-date exception spelled out.

## 15.23.0
Routines: periodic backlog cycles are now product behavior. New conport-routine skill (six-phase runbook: start/reconcile/housekeeping/execute/digest/empty-day). New MCP tools: `get_agenda` (single-call run briefing), `get_routine_config` / `set_routine_config` (per-project cycle policy: cadence, run limits, autonomy levels 0-2), `routine_run_start` / `routine_run_finish` / `list_routine_runs` (run journal), `get_estimation_stats` (estimate calibration). `list_tasks` gains `ready=true` (dependency-unblocked only), `order="priority"` (effective-priority ranking) and `offset`; tasks gain `snooze_until` (hidden until a date, auto-wake) and an IN_PROGRESS lease with automatic release of stale claims. `update_task` close now echoes `estimate_drift` (plan vs actual). `init` may return `routine_suggestion` for routine-ripe projects; four rhythm gap types (`routine_run_missed`, `routine_run_died`, `task_blocked_too_long`, `backlog_starving`) join gap detection. Live docs: `projects/routines`.

## 15.22.1
Wrapped skill frontmatter `description` in quotes so strict YAML/frontmatter parsers don't break on em-dashes and slashes in the description.

## 15.22.0
Thinned skill — always-on discipline here, deep reference routed to live docs at conport.app | 83 MCP tools | Auto-detection | GraphRAG | Gap detection | Semantic pass | Cross-project linked tasks | Block-level document model | Recipe-pattern context assembly | Prefix-id convention | Skill version notification | Post-write payload verification | Slim MCP write responses | Task reparenting + 2-level hierarchy schema invariant | Canonical cross-reference grammar | Spec append-only enforcement | Documentation graph callouts + backlinks | current_architecture recipe + L1 capture-gap audit | Per-task time tracking | Server-side reject of MCP tool-call XML leakage
