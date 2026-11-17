// The time budgets of the hooks — a request, a git call, the whole wait of a
// hook — in milliseconds, multiplied by CONPORT_HOOK_TIME_SCALE: a positive
// number, 1 when it is unset or anything else. A hook test runs on a machine
// that may be busy, where a pause of a few seconds would spend a budget the
// test does not mean to spend and turn its answer into an outage: the tests
// stretch every budget, and a test of a budget itself shrinks it so the wait
// stays short.
//
// Only a test may stretch. A budget past 1x could outlast the timeout Claude
// Code gives the hook (guard-epic-growth.js: two 3 s reads inside 10 s, and a
// hook past its timeout blocks the call), so a scale above 1 counts only where
// CONPORT_SETTINGS_FORBID_ROOT is set too — the variable that already marks a
// hook test run (project-config.js); anywhere else it is cut to 1. Shrinking
// is never cut: a shorter budget only gives up sooner.
'use strict';

const SCALE_VAR = 'CONPORT_HOOK_TIME_SCALE';
const TEST_MARK_VAR = 'CONPORT_SETTINGS_FORBID_ROOT';

function scaleOf(env) {
  const raw = env[SCALE_VAR];
  const scale = Number(raw);
  if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(scale) || scale <= 0) return 1;
  return env[TEST_MARK_VAR] ? scale : Math.min(scale, 1);
}

function budgetMs(ms, env = process.env) {
  return Math.max(1, Math.round(ms * scaleOf(env)));
}

module.exports = { SCALE_VAR, TEST_MARK_VAR, budgetMs };
