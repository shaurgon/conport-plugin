// Shared helpers for ConPort plugin hooks (Node.js, built-ins only).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CONPORT_URL = process.env.CONPORT_URL || 'https://api.conport.app';

function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), '.claude', 'plugin-data', 'conport');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A project as a caller names it — its handle, a bare name or `team/project`
// — split at its only "/": { raw, team, project }. An empty value, an empty
// part or a second "/" is not a project: null.
function parseProject(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length > 2 || parts.some((part) => !part)) return null;
  return parts.length === 1
    ? { raw, team: null, project: raw }
    : { raw, team: parts[0], project: parts[1] };
}

// The project this session works in, or null when the environment names
// none. CONPORT_PROJECT_NAME is the only source — a handle carries no team
// (the server finds the project's own), a `team/project` name is split — and
// nothing is guessed from the repository or the working directory: with no
// project the hooks stay silent. CONPORT_PROJECT_ID is not read.
function detectProject() {
  return parseProject(process.env.CONPORT_PROJECT_NAME);
}

// The one line said at session start while CONPORT_PROJECT_ID still holds a
// value, or null. The variable addresses nothing any more, so a stale number
// left in the environment must not pass in silence.
const RETIRED_PROJECT_ID =
  "CONPORT_PROJECT_ID is no longer read — set CONPORT_PROJECT_NAME to the project's handle or name";
function retiredProjectIdNotice() {
  return (process.env.CONPORT_PROJECT_ID || '').trim() ? RETIRED_PROJECT_ID : null;
}

// How a detected project goes into a `/projects/{…}` path: `team/project`
// does not fit one path segment, so the short name is the segment and the
// team travels as a header.
function projectRoute(project) {
  return {
    segment: encodeURIComponent(project.project),
    headers: project.team ? { 'X-Conport-Team-Id': project.team } : {},
  };
}

// The deny-list of one project. The data dir is machine-global, so the file
// is keyed by the project as named, team prefix included: a list fetched for
// one project must never block commands in another.
function denyListPath(project) {
  return path.join(dataDir(), `deny-list_${encodeURIComponent(project.raw)}.json`);
}

function authHeader() {
  // Harness exposes the plugin's user_config.api_key as $CLAUDE_PLUGIN_OPTION_API_KEY.
  // CONPORT_API_KEY stays as a manual/legacy override.
  const key = (
    process.env.CONPORT_API_KEY ||
    process.env.CLAUDE_PLUGIN_OPTION_API_KEY ||
    ''
  ).trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function request(method, urlStr, { headers = {}, body = null, timeoutMs = 10000 } = {}) {
  const url = new URL(urlStr);
  const lib = url.protocol === 'http:' ? require('http') : require('https');
  return new Promise((resolve, reject) => {
    const req = lib.request({
      method, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// Per-session record of the epics this session changed: the PostToolUse hook
// appends one JSON line per touch, the Stop hook reads them. Keyed by session
// id — another session's epics are not this session's tails. Append-only
// because parallel tool calls run their hooks concurrently: a
// read-modify-write of one JSON document would drop records.
function sessionEpicsPath(sessionId) {
  const dir = path.join(dataDir(), 'hook_state');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `session_epics_${encodeURIComponent(sessionId)}.jsonl`);
}

// The UserPromptSubmit cache of GET /epic-tails rows. The data dir is
// machine-global, so the file is keyed by the project as the environment names
// it, team prefix included: the same short name in two teams is two projects.
const EPIC_TAILS_CACHE = /^epic_tails_.*\.json$/;
function epicTailsCachePath(projectRaw) {
  return path.join(dataDir(), 'hook_state', `epic_tails_${encodeURIComponent(projectRaw)}.json`);
}

// A task write changes the tails at once, while a cached row would name a
// child closed a moment ago for the rest of the cache's life. The project of
// the write may be spelled otherwise than the one a cache is keyed by (a
// handle against a name), so every project's cache goes: the next prompt
// fetches again. Best-effort.
function dropEpicTailsCaches() {
  let dir;
  try { dir = path.join(dataDir(), 'hook_state'); } catch (_) { return; }
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of names) {
    if (!EPIC_TAILS_CACHE.test(name)) continue;
    try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
  }
}

// Distinct epics in first-touch order; the latest non-empty title wins.
function loadSessionEpics(sessionId) {
  let raw = '';
  try { raw = fs.readFileSync(sessionEpicsPath(sessionId), 'utf8'); } catch (_) { return []; }
  const byKey = new Map();
  for (const line of raw.split('\n')) {
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (!rec || typeof rec.project !== 'string' || !Number.isInteger(rec.epic_id)) continue;
    const key = `${rec.project}:${rec.epic_id}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { project: rec.project, epic_id: rec.epic_id, title: rec.title || '' });
    else if (rec.title) prev.title = rec.title;
  }
  return [...byKey.values()];
}

// Per-session "last shown" memory of a hook, so a hook repeats itself only
// when what it would say changed. True — and the new fingerprint recorded —
// when `fingerprint` differs from the one stored under `name` for this
// session. An unreadable record counts as changed; a failed write still
// answers changed (the hook speaks this once rather than never). Never throws.
function fingerprintChanged(name, sessionId, fingerprint) {
  let p;
  try {
    p = path.join(dataDir(), 'hook_state',
      `${name}_${encodeURIComponent(sessionId)}.json`);
  } catch (_) {
    return true;
  }
  try {
    if (JSON.parse(fs.readFileSync(p, 'utf8')).fingerprint === fingerprint) return false;
  } catch (_) {}
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ fingerprint }));
  } catch (_) {}
  return true;
}

// One git query run in `dir`: its trimmed stdout, or null when git is
// missing, `dir` is not in a repository or does not exist. Never throws.
function gitIn(dir, args) {
  try {
    const out = execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
    return out || null;
  } catch (_) {
    return null;
  }
}

// Root of the git worktree that holds `dir`, or null outside git.
function worktreeRoot(dir) {
  return gitIn(dir, ['rev-parse', '--show-toplevel']);
}

// Root of the main worktree of the repository holding `dir`: the parent of
// the common git directory, which every linked worktree shares. git may print
// that directory relative to where it ran (`.git`, `../.git`), so it is
// resolved against `dir` here rather than by `--path-format`, which older git
// does not know.
function mainWorktreeRoot(dir) {
  const common = gitIn(dir, ['rev-parse', '--git-common-dir']);
  return common ? path.dirname(path.resolve(dir, common)) : null;
}

const OVERLAY_CONFIG = path.join('.superpowers', 'config.json');

// Whether the Superpowers overlay is switched on for `dir`: the file
// `.superpowers/config.json` holding {"conport": {"superpowers": true}}. The
// file is looked up in the current worktree root, then in the main worktree
// root — `.superpowers/` is usually ignored, so a linked worktree has no copy
// of its own — and outside git in `dir` only. The first file found decides.
// A missing file, any other value or unreadable JSON is off. Never throws.
function overlayEnabled(dir) {
  try {
    const root = worktreeRoot(dir);
    let raw = readOverlayConfig(root || dir);
    if (raw === null && root) {
      // Asked only when the current worktree has no file of its own.
      const main = mainWorktreeRoot(dir);
      if (main && path.resolve(main) !== path.resolve(root)) raw = readOverlayConfig(main);
    }
    if (raw === null) return false;
    const config = JSON.parse(raw);
    return Boolean(config && config.conport && config.conport.superpowers === true);
  } catch (_) {
    return false;
  }
}

// The overlay config text under `root`, or null when there is no file there.
// A file that exists but cannot be read (EACCES, a directory) still decides:
// the error propagates and overlayEnabled answers off.
function readOverlayConfig(root) {
  try {
    return fs.readFileSync(path.join(root, OVERLAY_CONFIG), 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(''));
  });
}

module.exports = {
  CONPORT_URL, dataDir, parseProject, detectProject, retiredProjectIdNotice, projectRoute, denyListPath,
  authHeader, request, readStdin, sessionEpicsPath, loadSessionEpics,
  epicTailsCachePath, dropEpicTailsCaches, fingerprintChanged, gitIn, worktreeRoot, mainWorktreeRoot, overlayEnabled,
};
