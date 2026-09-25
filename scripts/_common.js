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

function detectProjectIdentifierFromEnv() {
  const id = (process.env.CONPORT_PROJECT_ID || '').trim();
  if (id) return id;
  const name = (process.env.CONPORT_PROJECT_NAME || '').trim();
  if (name) return name;
  return null;
}

function detectProjectIdentifier() {
  const envId = detectProjectIdentifierFromEnv();
  if (envId) return envId;
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim();
    if (url) {
      let base = url.replace(/\/+$/, '').split('/').pop() || '';
      if (base.endsWith('.git')) base = base.slice(0, -4);
      if (base) return base;
    }
  } catch (_) {}
  return path.basename(process.cwd()) || null;
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
  CONPORT_URL, dataDir, detectProjectIdentifier, detectProjectIdentifierFromEnv,
  authHeader, request, readStdin, sessionEpicsPath, loadSessionEpics,
  fingerprintChanged,
};
