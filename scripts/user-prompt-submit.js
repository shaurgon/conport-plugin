#!/usr/bin/env node
// UserPromptSubmit: restore context on first prompt, remind to save every N
// messages, and surface the project's rotting epic tails.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  CONPORT_URL, dataDir, detectProjectIdentifier, detectProjectIdentifierFromEnv,
  authHeader, request, readStdin,
} = require('./_common.js');

const MESSAGES_BEFORE_REMINDER = 5;
const REMINDER_COOLDOWN_MINUTES = 15;
const TAILS_CACHE_TTL_MS = 10 * 60 * 1000;
// Negative results (not a ConPort project, outage, timeout) get a much
// shorter TTL than a real hit: long enough that a chatty session doesn't
// re-spend the request budget on every single prompt, short enough that a
// transient outage or a project that only just got created recovers fast.
const TAILS_NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
const TAILS_REQUEST_TIMEOUT_MS = 500;
// How long a resolved project identifier is trusted before we ask
// detectProjectIdentifier() (which may shell out to `git config`) again.
const PROJECT_ID_CACHE_TTL_MS = 10 * 60 * 1000;

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

function resolveProjectIdentifier() {
  // CONPORT_PROJECT_ID / CONPORT_PROJECT_NAME are the highest-priority
  // source AND free (no I/O, no subprocess) — check them first, every time,
  // uncached. Skipping this and going straight to a cwd-keyed disk cache is
  // what reintroduced the cross-project leak b408c92 fixed: the cache can't
  // tell "same repo, different CONPORT_PROJECT_NAME override" from "stale",
  // so a later run in the same cwd with a different env var got served the
  // first run's project. Only the `git config` / cwd-basename fallback leg
  // of detectProjectIdentifier() — the one that actually spawns a
  // subprocess — is worth caching.
  const envId = detectProjectIdentifierFromEnv();
  if (envId) return envId;

  // detectProjectIdentifier() may shell out to `git config` (up to a 2s
  // timeout); this hook runs on every prompt, so re-running it every time —
  // including on tails-cache hits — puts a subprocess spawn on the hot path
  // for no reason. Cache the resolved fallback identifier per cwd (NOT
  // globally: a session in a different repo must resolve its own project,
  // same correctness requirement as the tails cache below) for the same
  // window we trust the tails cache for.
  const cwdKey = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 16);
  const idCachePath = path.join(dataDir(), 'hook_state', `project_id_${cwdKey}.json`);
  try {
    if (fs.existsSync(idCachePath)) {
      const cached = JSON.parse(fs.readFileSync(idCachePath, 'utf8'));
      if (Date.now() - cached.resolved_at < PROJECT_ID_CACHE_TTL_MS) {
        return cached.id || null;
      }
    }
  } catch (_) {}
  const id = detectProjectIdentifier();
  try {
    fs.mkdirSync(path.dirname(idCachePath), { recursive: true });
    fs.writeFileSync(idCachePath, JSON.stringify({ id, resolved_at: Date.now() }));
  } catch (_) {}
  return id;
}

function writeTailsCache(cachePath, lines, ok) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ fetched_at: Date.now(), lines, ok }));
  } catch (_) {}
}

async function fetchEpicTails() {
  // Cached, time-boxed, silent-failure: the hook must never slow a prompt.
  const project = resolveProjectIdentifier();
  if (!project) return [];
  // The data dir is machine-global, so the cache file is keyed by project —
  // otherwise a session in another repo is served the first project's tails
  // (its epic ids!) for the rest of the TTL.
  const cachePath = path.join(dataDir(), 'hook_state',
    `epic_tails_${encodeURIComponent(project)}.json`);
  try {
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(cached.lines)) {
        // `ok` (not "lines is empty") decides the TTL: a 200 with zero
        // tails is the steady state for a healthy, caught-up project and
        // must get the full TTL like any other real hit. Only an actual
        // failure (non-200, thrown error, client-side race timeout) is
        // `ok: false` and gets the short negative TTL — don't let that keep
        // re-spending the request budget on every prompt forever, but don't
        // hammer it either.
        const ttl = cached.ok === false ? TAILS_NEGATIVE_CACHE_TTL_MS : TAILS_CACHE_TTL_MS;
        if (Date.now() - cached.fetched_at < ttl) {
          return cached.lines;
        }
      }
    }
  } catch (_) {}
  try {
    const auth = authHeader();
    // authHeader() returns {} when no key (truthy!) — gate on the header itself.
    // No cache write here: this path never spends a request or a subprocess,
    // so there's nothing to protect against re-spending on the next prompt.
    if (!auth.Authorization) return [];
    // request() resolves {status, body} with body a RAW STRING — parse it.
    const pending = request('GET',
      `${CONPORT_URL}/api/v1/projects/${encodeURIComponent(project)}/epic-tails`,
      { headers: auth, timeoutMs: TAILS_REQUEST_TIMEOUT_MS }).catch(() => null);
    // Its own req.setTimeout only arms once the socket is connected, so an
    // unroutable host would hold the prompt for the OS connect timeout
    // (~4s observed). Race the whole call against our own budget.
    const res = await Promise.race([pending, new Promise((resolve) => {
      setTimeout(() => resolve(null), TAILS_REQUEST_TIMEOUT_MS).unref();
    })]);
    if (!res || res.status !== 200) {
      writeTailsCache(cachePath, [], false);
      return [];
    }
    const tails = (JSON.parse(res.body).tails) || [];
    // No open-count filter: closable tails (0 open) are exactly the
    // "close it now" reminder this feature exists for. Reuse the existing
    // [TAILS] format from the conport skill's OUTPUT FORMAT section —
    // suggested_action carries both cases.
    const lines = tails.map(
      (t) => `[TAILS] task-${t.epic_id} ${t.title} — ${t.suggested_action}`);
    writeTailsCache(cachePath, lines, true);
    return lines;
  } catch (_) {
    writeTailsCache(cachePath, [], false);
    return [];
  }
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  const sessionId = input.session_id || 'unknown';

  const messages = [];
  if (shouldRestoreContext(sessionId)) {
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

  const tailLines = await fetchEpicTails();
  messages.push(...tailLines);

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
