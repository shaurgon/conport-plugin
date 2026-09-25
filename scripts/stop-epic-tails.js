#!/usr/bin/env node
// Stop: the end of the turn is where "done" gets said. If an epic this
// session changed (see track-session-epics.js) still has open children, hold
// the turn once and hand the agent the list. No session epics → no output,
// no request. Any failure → silent: an outage must never trap a turn.
'use strict';

const {
  CONPORT_URL, authHeader, request, readStdin, loadSessionEpics,
} = require('./_common.js');

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 3000;
const TOTAL_BUDGET_MS = 6000;

function isOpen(status) {
  return status !== 'DONE' && status !== 'CANCELLED';
}

// All children (every status, snoozed included) of the given epics of one
// project. Every status, not just open ones: the "grew after start" test
// needs the started_at of children that are already closed.
async function fetchChildren(project, epicIds, auth) {
  const children = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      parent_task_ids: epicIds.join(','),
      status: 'ALL',
      include_snoozed: 'true',
      limit: String(PAGE_LIMIT),
      offset: String(page * PAGE_LIMIT),
    });
    const res = await request('GET',
      `${CONPORT_URL}/api/v1/projects/${encodeURIComponent(project)}/tasks?${qs}`,
      { headers: auth, timeoutMs: REQUEST_TIMEOUT_MS });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const body = JSON.parse(res.body);
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    children.push(...tasks);
    if (tasks.length < PAGE_LIMIT || children.length >= (body.total || 0)) break;
  }
  return children;
}

// Same test as the server's `epic_grew_after_start` gap: an open child
// created after the first child of the epic was started.
function grewAfterStart(children) {
  const starts = children
    .map((c) => Date.parse(c.started_at))
    .filter((t) => !Number.isNaN(t));
  if (!starts.length) return false;
  const firstStart = Math.min(...starts);
  return children.some((c) => isOpen(c.status) && Date.parse(c.created_at) > firstStart);
}

async function collectTails(epics, auth) {
  const byProject = new Map();
  for (const e of epics) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project).push(e);
  }
  const tails = [];
  for (const [project, projectEpics] of byProject) {
    const children = await fetchChildren(
      project, projectEpics.map((e) => e.epic_id), auth);
    for (const epic of projectEpics) {
      const own = children.filter((c) => c.parent_task_id === epic.epic_id);
      const open = own.filter((c) => isOpen(c.status)).sort((a, b) => a.id - b.id);
      if (!open.length) continue;
      tails.push({ ...epic, open, grew: grewAfterStart(own) });
    }
  }
  // Grown epics first — work appended after the start is exactly what gets
  // forgotten; otherwise the order in which the session touched them.
  return tails
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (Number(b.t.grew) - Number(a.t.grew)) || (a.i - b.i))
    .map(({ t }) => t);
}

function formatReason(tails) {
  const lines = [
    '[TAILS] If this turn reports the work as done, it is not — these children ' +
      'of epics changed in this session are still open; name them to the user. ' +
      'Otherwise end the turn as planned.',
  ];
  for (const t of tails) {
    const title = t.title ? ` ${t.title}` : '';
    const grew = t.grew ? ' (grew after work started)' : '';
    lines.push(`[TAILS] task-${t.epic_id}${title}${grew} — ${t.open.length} open`);
    for (const c of t.open) lines.push(`  · task-${c.id} [${c.status}] ${c.title}`);
  }
  return lines.join('\n');
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  // Already held once in this stop cycle: let the turn end, or the hook
  // would loop the agent forever on a tail it cannot close right now.
  if (input.stop_hook_active) process.exit(0);

  const epics = loadSessionEpics(input.session_id || 'unknown');
  if (!epics.length) process.exit(0);

  const auth = authHeader();
  if (!auth.Authorization) process.exit(0);

  let tails;
  try {
    tails = await Promise.race([
      collectTails(epics, auth),
      new Promise((resolve) => { setTimeout(() => resolve(null), TOTAL_BUDGET_MS).unref(); }),
    ]);
  } catch (_) {
    process.exit(0);
  }
  if (!tails || !tails.length) process.exit(0);

  process.stdout.write(JSON.stringify({ decision: 'block', reason: formatReason(tails) }));
  process.exit(0);
}

main();
