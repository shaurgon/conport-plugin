#!/usr/bin/env node
// Stop: the end of the turn is where "done" gets said. If an epic this
// session changed (see track-session-epics.js) still has open children, hold
// the turn once and hand the agent the list — once per composition of those
// tails: a later turn on the same list ends freely. Only the epics the nearest
// release milestone waits for are listed; a roadmap with no release point
// lists them all and says to create one. A child another member leads is
// listed with who leads it and is never demanded; tails with only such
// children hold nothing. No project in the session's settings
// or no session epics → no output, no request. Any failure → silent: an outage
// must never trap a turn.
'use strict';

const {
  CONPORT_URL, authHeader, request, readStdin, loadSessionEpics, fingerprintChanged,
  parseProject, detectProject, projectRoute,
} = require('./_common.js');
const { budgetMs } = require('./hook-time.js');

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = budgetMs(3000);
const TOTAL_BUDGET_MS = budgetMs(6000);
// Left of the whole budget for printing the open children already fetched.
const PRINT_RESERVE_MS = budgetMs(250);

function isOpen(status) {
  return status !== 'DONE' && status !== 'CANCELLED';
}

// All children (every status, snoozed included) of the given epics of one
// project, or only the caller's own with `filter` { assignee: 'me' }. Closed
// children are filtered out before the tails are displayed.
async function fetchChildren(route, epicIds, auth, filter = {}) {
  const children = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      parent_task_ids: epicIds.join(','),
      status: 'ALL',
      include_snoozed: 'true',
      limit: String(PAGE_LIMIT),
      offset: String(page * PAGE_LIMIT),
      ...filter,
    });
    const res = await request('GET',
      `${CONPORT_URL}/api/v1/projects/${route.segment}/tasks?${qs}`,
      { headers: { ...auth, ...route.headers }, timeoutMs: REQUEST_TIMEOUT_MS });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const body = JSON.parse(res.body);
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    children.push(...tasks);
    if (tasks.length < PAGE_LIMIT || children.length >= (body.total || 0)) break;
  }
  return children;
}

// Who leads a child another member leads: the email of its card, else the
// handle. A child leads nobody else when it is free (`assignee` null), when
// the team shows no assignees (no `assignee` key: a Private Team) or when it
// is among `mine` — the ids the same list filtered by assignee=me answers.
// `mine` null (that read failed): every assigned child counts as another's,
// so the hold never orders the agent to take a task it may not lead.
function ledBy(child, mine) {
  const card = child.assignee;
  if (!card) return null;
  if (mine && mine.has(child.id)) return null;
  return card.email || card.handle || 'another member';
}

// The ids of the caller's own children among `children`; read only when a
// child has an assignee. `null` when the read fails.
async function ownChildIds(route, epicIds, children, auth) {
  if (!children.some((c) => c.assignee)) return new Set();
  try {
    const own = await fetchChildren(route, epicIds, auth, { assignee: 'me' });
    return new Set(own.map((c) => c.id));
  } catch (_) {
    return null;
  }
}

// Use the server's ordinary growth counter; list rows do not expose attachment
// times. An epic outside the ceiling scope never gets the growth marker.
async function grewAfterStart(route, epicId, auth, deadline) {
  // The marker is optional: leave time to print already-fetched open children.
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now() - PRINT_RESERVE_MS);
  if (timeoutMs <= 0) return false;
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const res = await request('GET',
          `${CONPORT_URL}/api/v1/projects/${route.segment}/tasks/${epicId}`,
          { headers: { ...auth, ...route.headers }, timeoutMs });
        if (res.status !== 200) return false;
        const progress = JSON.parse(res.body).epic_progress;
        return progress?.growth_ceiling != null && progress.ordinary_added > 0;
      })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The epics the nearest release waits for: those attached to the open
// milestones up to and including the first open release point. `null` when
// the roadmap has no open release point. Throws when the roadmap is
// unreadable — the caller then falls back to every session epic.
async function releaseScope(route, auth) {
  const res = await request('GET',
    `${CONPORT_URL}/api/v1/projects/${route.segment}/milestones`,
    { headers: { ...auth, ...route.headers }, timeoutMs: REQUEST_TIMEOUT_MS });
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
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const byProject = new Map();
  for (const e of epics) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project).push(e);
  }
  const tails = [];
  const noRelease = [];
  for (const [project, sessionEpics] of byProject) {
    // The record holds the project as the tool call named it — a handle or a
    // name, possibly `team/project`. A record that is not a project is skipped;
    // a number left by an earlier version is sent as it is and answers 404.
    const parsed = parseProject(project);
    if (!parsed) continue;
    const route = projectRoute(parsed);
    // Work after the nearest release, or on no milestone at all, is not
    // what this turn's "done" is about — only what the release waits for.
    let scope;
    try { scope = await releaseScope(route, auth); } catch (_) { scope = undefined; }
    if (scope === null) noRelease.push(project);
    const projectEpics = scope instanceof Set
      ? sessionEpics.filter((e) => scope.has(e.epic_id))
      : sessionEpics;
    if (!projectEpics.length) continue;
    const epicIds = projectEpics.map((e) => e.epic_id);
    const children = await fetchChildren(route, epicIds, auth);
    const mine = await ownChildIds(
      route, epicIds, children.filter((c) => isOpen(c.status)), auth);
    const projectTails = [];
    for (const epic of projectEpics) {
      const own = children.filter((c) => c.parent_task_id === epic.epic_id);
      const open = own.filter((c) => isOpen(c.status)).sort((a, b) => a.id - b.id)
        .map((c) => ({ ...c, ledBy: ledBy(c, mine) }));
      if (!open.length) continue;
      projectTails.push({ ...epic, open });
    }
    tails.push(...await Promise.all(projectTails.map(async epic => ({
      ...epic, grew: await grewAfterStart(route, epic.epic_id, auth, deadline),
    }))));
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
    '[TAILS] These children of epics changed in this session are still open — ' +
      'the epic is not done: dispatch these now, or name the reason each cannot start.',
  ];
  for (const t of tails) {
    const title = t.title ? ` ${t.title}` : '';
    const grew = t.grew ? ' (grew after work started)' : '';
    lines.push(`[TAILS] task-${t.epic_id}${title}${grew} — ${t.open.length} open`);
    for (const c of t.open) {
      // A child another member leads is theirs: named, never to dispatch.
      const lead = c.ledBy ? ` — led by ${c.ledBy}, not yours to dispatch` : '';
      lines.push(`  · task-${c.id} [${c.status}] ${c.title}${lead}`);
    }
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
// a TODO → IN_PROGRESS move is not a new tail; a child another member leads
// is marked, so one that becomes the session's to dispatch is a new tail.
function composition(tails, noRelease) {
  return tails
    .map((t) => `${t.project}:${t.epic_id}=` + t.open.map((c) => `${c.id}${c.ledBy ? '@' : ''}`).join(','))
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
  if (!detectProject(input)) process.exit(0);

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
  // Only children other members lead and a release point in place: nothing
  // is this session's to dispatch, so the turn ends freely.
  const demanded = tails.some((t) => t.open.some((c) => !c.ledBy));
  if (!demanded && !noRelease.length) process.exit(0);

  process.stdout.write(JSON.stringify({ decision: 'block', reason: formatReason(tails, noRelease) }));
  process.exit(0);
}

main();
