#!/usr/bin/env node
// Stop: the end of the turn is where "done" gets said. If an epic this
// session changed (see track-session-epics.js) still has open children, hold
// the turn once and hand the agent the list — once per composition of those
// tails: a later turn on the same list ends freely. Only the epics the nearest
// release milestone waits for are listed; a roadmap with no release point
// lists them all and says to create one. No session epics → no output, no
// request. Any failure → silent: an outage must never trap a turn.
'use strict';

const {
  CONPORT_URL, authHeader, request, readStdin, loadSessionEpics, fingerprintChanged,
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

// The epics the nearest release waits for: those attached to the open
// milestones up to and including the first open release point. `null` when
// the roadmap has no open release point. Throws when the roadmap is
// unreadable — the caller then falls back to every session epic.
async function releaseScope(project, auth) {
  const res = await request('GET',
    `${CONPORT_URL}/api/v1/projects/${encodeURIComponent(project)}/milestones`,
    { headers: auth, timeoutMs: REQUEST_TIMEOUT_MS });
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const milestones = JSON.parse(res.body);
  if (!Array.isArray(milestones)) throw new Error('not a list');
  const ordered = [...milestones].sort((a, b) => a.sequence - b.sequence);
  const release = ordered.find((m) => m.is_release);
  if (!release) return null;
  const ids = new Set();
  for (const m of ordered) {
    if (m.sequence > release.sequence) break;
    for (const e of m.epics || []) ids.add(e.task_id);
  }
  return ids;
}

async function collectTails(epics, auth) {
  const byProject = new Map();
  for (const e of epics) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project).push(e);
  }
  const tails = [];
  const noRelease = [];
  for (const [project, sessionEpics] of byProject) {
    // Work after the nearest release, or on no milestone at all, is not
    // what this turn's "done" is about — only what the release waits for.
    let scope;
    try { scope = await releaseScope(project, auth); } catch (_) { scope = undefined; }
    if (scope === null) noRelease.push(project);
    const projectEpics = scope instanceof Set
      ? sessionEpics.filter((e) => scope.has(e.epic_id))
      : sessionEpics;
    if (!projectEpics.length) continue;
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
  const ordered = tails
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (Number(b.t.grew) - Number(a.t.grew)) || (a.i - b.i))
    .map(({ t }) => t);
  // A missing release point is only worth saying next to a tail of its project.
  const listed = new Set(ordered.map((t) => t.project));
  return { tails: ordered, noRelease: noRelease.filter((p) => listed.has(p)) };
}

function formatReason(tails, noRelease) {
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
  for (const p of noRelease) {
    lines.push(`[TAILS] Project ${p} has no release milestone on its roadmap — ` +
      'create one (add_milestone with is_release=true) and attach the epics ' +
      'it ships to the milestones before it.');
  }
  return lines.join('\n');
}

// What the hold is about: which epics, which children are open, and whether
// a release point is missing. Titles and statuses are left out — a rename or
// a TODO → IN_PROGRESS move is not a new tail.
function composition(tails, noRelease) {
  return tails
    .map((t) => `${t.project}:${t.epic_id}=` + t.open.map((c) => c.id).join(','))
    .concat(noRelease.map((p) => `${p}:no-release`))
    .sort()
    .join('\n');
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

  let found;
  try {
    found = await Promise.race([
      collectTails(epics, auth),
      new Promise((resolve) => { setTimeout(() => resolve(null), TOTAL_BUDGET_MS).unref(); }),
    ]);
  } catch (_) {
    process.exit(0);
  }
  // Timed out: the composition is unknown, so the memory is left as it was.
  if (!found) process.exit(0);
  const { tails, noRelease } = found;
  const sid = input.session_id || 'unknown';
  // Nothing open is a composition too: record it, so a child reopened later
  // is a change and is held again.
  if (!tails.length) {
    fingerprintChanged('stop_tails_held', sid, '');
    process.exit(0);
  }
  // The stop_hook_active guard lasts one stop cycle; without this the same
  // list held every turn of the session. Hold again only on a new composition.
  if (!fingerprintChanged('stop_tails_held', sid, composition(tails, noRelease))) process.exit(0);

  process.stdout.write(JSON.stringify({ decision: 'block', reason: formatReason(tails, noRelease) }));
  process.exit(0);
}

main();
