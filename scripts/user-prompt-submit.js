#!/usr/bin/env node
// UserPromptSubmit: restore context on first prompt, remind to save every N
// messages, and surface the project's rotting epic tails — only when their
// composition changed since this session last saw them, and never on the
// first prompt, where init prints the same tails itself. Before all of that,
// a message that is exactly the consent phrase records the person's consent
// to grow an epic that has a plan.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, dataDir, detectProject, parseProject, projectRoute,
  authHeader, request, readStdin, fingerprintChanged, epicTailsCachePath,
} = require('./_common.js');
const { parseConsentPhrase, writeConsent, isHandle, withinBudget } = require('./epic-growth-consent.js');
const { budgetMs } = require('./hook-time.js');

const MESSAGES_BEFORE_REMINDER = 5;
const REMINDER_COOLDOWN_MINUTES = 15;
const TAILS_CACHE_TTL_MS = 10 * 60 * 1000;
// Negative results (not a ConPort project, outage, timeout) get a much
// shorter TTL than a real hit: long enough that a chatty session doesn't
// re-spend the request budget on every single prompt, short enough that a
// transient outage or a project that only just got created recovers fast.
const TAILS_NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
const TAILS_REQUEST_TIMEOUT_MS = budgetMs(500);
const CONSENT_LOOKUP_TIMEOUT_MS = budgetMs(3000);

function sessionFlagPath(sessionId) {
  const dir = path.join(dataDir(), 'session_logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId}_restored.flag`);
}

function stateFilePath() {
  const dir = path.join(dataDir(), 'hook_state');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'conport_reminder.json');
}

function loadState() {
  const p = stateFilePath();
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return { last_save_reminder: null, messages_since_save: 0 };
}

function saveState(state) {
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
}

function shouldRestoreContext(sessionId) {
  const p = sessionFlagPath(sessionId);
  if (!fs.existsSync(p)) return true;
  const ageMs = Date.now() - fs.statSync(p).mtimeMs;
  return ageMs > 60 * 60 * 1000;  // >1h → treat as new session
}

function markSessionRestored(sessionId) {
  const p = sessionFlagPath(sessionId);
  fs.closeSync(fs.openSync(p, 'w'));
}

function shouldRemindSave(state) {
  if ((state.messages_since_save || 0) < MESSAGES_BEFORE_REMINDER) return false;
  const last = state.last_save_reminder;
  if (last) {
    const ts = Date.parse(last);
    if (!Number.isNaN(ts) && Date.now() - ts < REMINDER_COOLDOWN_MINUTES * 60 * 1000) {
      return false;
    }
  }
  return true;
}

// The cache holds the raw `tails` rows, not printed lines: a cache left by an
// older hook (ready-made `lines`, possibly carrying the imperative wording)
// has no `tails` array and is simply a miss, and a future format change
// cannot be served stale text either.
function writeTailsCache(cachePath, tails, ok) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ fetched_at: Date.now(), tails, ok }));
  } catch (_) {}
}

// A tail with no open children keeps the server's one action — close the
// epic now. A tail with open children is a reference, not an order: this
// block rides along with every kind of prompt, questions included, and its
// open children are often not doable yet (a measurement waiting for its
// observation window). So it lists them from `open_tasks` instead of
// printing the server's imperative "Finish …" suggested_action. The split is
// on `open_tasks` itself, not the `closable` flag, so a row whose flag and
// list disagree never prints an empty "open: ".
function formatTail(t) {
  const open = t.open_tasks || [];
  const note = open.length
    ? `open: ${open.map((c) => `task-${c.id}`).join(', ')}`
    : t.suggested_action;
  return `[TAILS] task-${t.epic_id} ${t.title} — ${note}`;
}

async function fetchEpicTails(input) {
  // Cached, time-boxed, silent-failure: the hook must never slow a prompt.
  // The project is the session's, from the settings kept at its start.
  const project = detectProject(input);
  if (!project) return { lines: [], ok: false };
  // Keyed by project — otherwise a session in another repo is served the
  // first project's tails (its epic ids!) for the rest of the TTL. A task
  // write drops it (track-session-epics.js), so a child closed a moment ago
  // is not named open from the cache.
  const cachePath = epicTailsCachePath(project.raw);
  try {
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(cached.tails)) {
        // `ok` (not "tails is empty") decides the TTL: a 200 with zero
        // tails is the steady state for a healthy, caught-up project and
        // must get the full TTL like any other real hit. Only an actual
        // failure (non-200, thrown error, client-side race timeout) is
        // `ok: false` and gets the short negative TTL — don't let that keep
        // re-spending the request budget on every prompt forever, but don't
        // hammer it either.
        const ttl = cached.ok === false ? TAILS_NEGATIVE_CACHE_TTL_MS : TAILS_CACHE_TTL_MS;
        if (Date.now() - cached.fetched_at < ttl) {
          return { lines: cached.tails.map(formatTail), ok: cached.ok !== false };
        }
      }
    }
  } catch (_) {}
  try {
    const auth = authHeader();
    // authHeader() returns {} when no key (truthy!) — gate on the header itself.
    // No cache write here: this path never spends a request, so there's
    // nothing to protect against re-spending on the next prompt.
    if (!auth.Authorization) return { lines: [], ok: false };
    // request() resolves {status, body} with body a RAW STRING — parse it.
    const route = projectRoute(project);
    const pending = request('GET',
      `${CONPORT_URL}/api/v1/projects/${route.segment}/epic-tails`,
      { headers: { ...auth, ...route.headers }, timeoutMs: TAILS_REQUEST_TIMEOUT_MS })
      .catch(() => null);
    // Its own req.setTimeout only arms once the socket is connected, so an
    // unroutable host would hold the prompt for the OS connect timeout
    // (~4s observed). Race the whole call against our own budget.
    const res = await Promise.race([pending, new Promise((resolve) => {
      setTimeout(() => resolve(null), TAILS_REQUEST_TIMEOUT_MS).unref();
    })]);
    // A known race, left on purpose: a prompt of another session that sent
    // this request before a task write and gets its answer after the write
    // dropped the cache stores rows from before the write. The window is the
    // request budget (≤ TAILS_REQUEST_TIMEOUT_MS), the stale rows live one
    // TTL at most, the next task write drops them again, and the block only
    // lists tails — it orders nothing. Closing it would need a write
    // generation shared between hooks for a 500 ms window.
    if (!res || res.status !== 200) {
      writeTailsCache(cachePath, [], false);
      return { lines: [], ok: false };
    }
    const tails = (JSON.parse(res.body).tails) || [];
    // No open-count filter: closable tails (0 open) are exactly the
    // "close it now" reminder this feature exists for, and tails with open
    // children are listed too — as a reference to them (see formatTail),
    // never as an order to finish them.
    const lines = tails.map(formatTail);
    writeTailsCache(cachePath, tails, true);
    return { lines, ok: true };
  } catch (_) {
    writeTailsCache(cachePath, [], false);
    return { lines: [], ok: false };
  }
}

// The block used to be printed on every prompt, weeks on end with the same
// text — noise the agent learns to skip. It is printed only when its
// composition differs from what this session was last shown. A failed fetch
// says nothing about the composition, so it neither prints nor resets.
function tailsChanged(sessionId, lines) {
  return fingerprintChanged('tails_shown', sessionId, lines.join('\n'));
}

// The project a consent is kept under: { project } with the handle, or
// { missing: true } when the server says there is no such project. A name or
// `team/project` is looked up (GET /projects/<name>, the team as a header). A
// 404 is an answer: a consent under that name could never match. Without an
// answer — no key, a network failure, the budget spent, any other status, no
// handle in the body — the project is kept as named, and only a call whose
// project is answered under that same spelling matches it.
async function consentProject(raw) {
  if (isHandle(raw)) return { project: raw };
  const project = parseProject(raw);
  const auth = authHeader();
  if (!project || !auth.Authorization) return { project: raw };
  try {
    const route = projectRoute(project);
    const res = await withinBudget(request('GET', `${CONPORT_URL}/api/v1/projects/${route.segment}`,
      { headers: { ...auth, ...route.headers }, timeoutMs: CONSENT_LOOKUP_TIMEOUT_MS }),
    CONSENT_LOOKUP_TIMEOUT_MS);
    if (res && res.status === 404) return { missing: true };
    if (!res || res.status !== 200) return { project: raw };
    const handle = JSON.parse(res.body).handle;
    return { project: isHandle(handle) ? handle.toLowerCase() : raw };
  } catch (_) {
    return { project: raw };
  }
}

// The context line for a message that is the consent phrase, or null. The
// phrase works in a session with no project too: then only its full form is
// taken, and the short one is answered with the full form to say.
async function recordConsent(input) {
  const text = typeof input.prompt === 'string' ? input.prompt : '';
  let consent = parseConsentPhrase(text, null);
  if (!consent) return null;
  if (consent.needsProject) consent = parseConsentPhrase(text, detectProject(input));
  if (consent.needsProject) return `say: allow epic ${consent.epic} in <project>`;
  const kept = await consentProject(consent.project);
  if (kept.missing) {
    return `consent not recorded: no project "${consent.project}"; ` +
      `say: allow epic ${consent.epic} in <project handle>`;
  }
  try {
    writeConsent({ project: kept.project, epic: consent.epic });
  } catch (err) {
    // The phrase is the only way to give the consent: a failed write is said.
    const reason = (err && (err.code || err.name)) || 'error';
    return `consent for epic task-${consent.epic} not recorded: ${reason}`;
  }
  return `consent for epic task-${consent.epic} recorded`;
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  const sessionId = input.session_id || 'unknown';

  const messages = [];
  try {
    const consentLine = await recordConsent(input);
    if (consentLine) messages.push(consentLine);
  } catch (_) {}

  const restoring = shouldRestoreContext(sessionId);
  if (restoring) {
    messages.push('ConPort: run mcp__conport__init() before responding.');
    markSessionRestored(sessionId);
  }

  const state = loadState();
  state.messages_since_save = (state.messages_since_save || 0) + 1;

  if (shouldRemindSave(state)) {
    messages.push(
      `ConPort: ${state.messages_since_save} changes without save. ` +
      'Use sync_decision / log_progress.'
    );
    state.last_save_reminder = new Date().toISOString();
  }
  saveState(state);

  // On the first prompt init prints these same tails, so the block would be
  // a duplicate. Its composition is still recorded (tailsChanged runs first),
  // so the next prompt with the same tails stays quiet too.
  const tails = await fetchEpicTails(input);
  if (tails.ok && tailsChanged(sessionId, tails.lines) && !restoring) {
    messages.push(...tails.lines);
  }

  if (messages.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: messages.join('\n\n'),
      },
    }));
  }
  process.exit(0);
}

main();
