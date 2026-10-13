// Shared helpers for ConPort plugin hooks (Node.js, built-ins only).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONPORT_URL = process.env.CONPORT_URL || 'https://api.conport.app';

function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), '.claude', 'plugin-data', 'conport');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A project as a caller names it — a numeric id, a bare name or
// `team/project` — split at its only "/": { raw, team, project }. An empty
// value, an empty part or a second "/" is not a project: null.
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
// none. CONPORT_PROJECT_ID comes first, then CONPORT_PROJECT_NAME; both go
// through the same split, so a number carries no team (the server derives it
// from the project) and a value that is not a number is read as a name and
// never reaches a path with a "/" in it. The environment is the only source:
// nothing is guessed from the repository or the working directory, and with
// no project the hooks stay silent.
function detectProject() {
  const id = (process.env.CONPORT_PROJECT_ID || '').trim();
  return parseProject(id || process.env.CONPORT_PROJECT_NAME);
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
  CONPORT_URL, dataDir, parseProject, detectProject, projectRoute, denyListPath,
  authHeader, request, readStdin, sessionEpicsPath, loadSessionEpics,
  fingerprintChanged,
};
