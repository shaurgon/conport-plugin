// Shared helpers for ConPort plugin hooks (Node.js, built-ins only).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { loadSettings } = require('./project-config.js');

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

// --- session settings ---------------------------------------------------------

// The folder the session's settings are read from: the project directory the
// harness names, else the `cwd` of the hook input, else the process's own.
function sessionRoot(input) {
  const dir = (process.env.CLAUDE_PROJECT_DIR || '').trim();
  if (dir) return dir;
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd;
  return process.cwd();
}

function sessionId(input) {
  return input && typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
}

function settingsCachePath(id) {
  return path.join(dataDir(), 'hook_state', `settings_${encodeURIComponent(id)}.json`);
}

const isStringOrNull = (v) => v === null || typeof v === 'string';

// The cached settings of a session, or null when there is none or it is not
// a whole record (a write torn by a crash): the caller works them out again.
function readSettingsCache(id) {
  try {
    const value = JSON.parse(fs.readFileSync(settingsCachePath(id), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!isStringOrNull(value.root) || !isStringOrNull(value.mainRoot) ||
      !isStringOrNull(value.project) || !isStringOrNull(value.source)) return null;
    if (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) return null;
    if (!Array.isArray(value.lines) || !value.lines.every((l) => typeof l === 'string')) return null;
    return value;
  } catch (_) {
    return null;
  }
}

// Written to a file of its own and renamed over the cache, so a hook of the
// same session reading at that moment sees the old record or the new one,
// never half of one. Best-effort.
function writeSettingsCache(id, value) {
  let tmp = null;
  try {
    const target = settingsCachePath(id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, target);
  } catch (_) {
    if (tmp) try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

// The settings of this session: {root, mainRoot, project, source, settings,
// lines}. Worked out from the session root (`loadSettings`) at the session
// start (`fresh`) and kept by session id; every other hook reads the record,
// so a `cd` in a command does not move the session to another project. A hook
// with no record works the settings out and keeps them; without a session id
// nothing is kept. A root inside CONPORT_SETTINGS_FORBID_ROOT throws.
function sessionSettings(input, { fresh = false } = {}) {
  const id = sessionId(input);
  if (id && !fresh) {
    const cached = readSettingsCache(id);
    if (cached) return cached;
  }
  const result = loadSettings({ cwd: sessionRoot(input), env: process.env, home: os.homedir() });
  const value = {
    root: result.root, mainRoot: result.mainRoot, project: result.project,
    source: result.source, settings: result.settings, lines: result.lines,
  };
  if (id) writeSettingsCache(id, value);
  return value;
}

// The project this session works in, or null: project_name of .conport.json
// (.conport.local.json over it), else CONPORT_PROJECT_NAME — a handle carries
// no team (the server finds the project's own), a `team/project` name is
// split. Nothing is guessed from the repository or the working directory:
// with no project the hooks stay silent. CONPORT_PROJECT_ID is not read.
function detectProject(input) {
  return parseProject(sessionSettings(input || {}).project);
}

// Whether `err` is the refusal of a settings root inside
// CONPORT_SETTINGS_FORBID_ROOT. It stops the hook: only a test sets the
// variable, and a test reading this repository's settings must fail loudly.
function isForbiddenRoot(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.includes('inside CONPORT_SETTINGS_FORBID_ROOT'));
}

// The one line said at session start while CONPORT_PROJECT_ID still holds a
// value, or null. The variable addresses nothing any more, so a stale number
// left in the environment must not pass in silence.
const RETIRED_PROJECT_ID =
  "CONPORT_PROJECT_ID is no longer read — set project_name in .conport.json to the project's handle or name";
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

// Whether the Superpowers overlay is switched on for `dir`: plugins.superpowers
// of its settings (.conport.local.json over .conport.json), and without that
// key the old flag (`overlayFromSettings`). Never throws, except for a root
// inside CONPORT_SETTINGS_FORBID_ROOT.
function overlayEnabled(dir) {
  let result;
  try {
    result = loadSettings({ cwd: dir, env: process.env, home: os.homedir() });
  } catch (err) {
    if (isForbiddenRoot(err)) throw err;
    return false;
  }
  return overlayFromSettings(result);
}

// The overlay switch from settings already worked out for `dir`
// ({root, mainRoot, settings}) and where it stands: {on, from}, `from` being
// the tag 'settings' when plugins.superpowers is set and 'old' when the old
// flag decided — a tag, never a path, so no separator of the OS reaches a text. Without the key the old flag decides — `.superpowers/config.json`
// holding {"conport": {"superpowers": true}}, looked up in the root of the
// current worktree, then in the root of the main one (`.superpowers/` is
// usually ignored, so a linked worktree has no copy of its own); outside git
// the root is the folder itself. The first file found decides. When git failed
// there is no root and nothing is read: off. A missing file, any other value
// or unreadable JSON is off. Never throws.
function overlaySwitch(result) {
  const flag = result && result.settings && result.settings.plugins && result.settings.plugins.superpowers;
  if (typeof flag === 'boolean') return { on: flag, from: 'settings' };
  const off = { on: false, from: null };
  const root = result && result.root;
  if (!root) return off;
  try {
    let raw = readOverlayConfig(root);
    const main = result && result.mainRoot;
    // Asked only when the current worktree has no file of its own.
    if (raw === null && main && main !== root) raw = readOverlayConfig(main);
    if (raw === null) return off;
    const config = JSON.parse(raw);
    return { on: Boolean(config && config.conport && config.conport.superpowers === true), from: 'old' };
  } catch (_) {
    return off;
  }
}

// Whether the overlay is on, by `overlaySwitch`.
function overlayFromSettings(result) {
  return overlaySwitch(result).on;
}

// The switch that turned the overlay on, as the notice names it, by the tag
// `overlaySwitch` gives.
const OVERLAY_SOURCES = {
  settings: '`plugins.superpowers` is `true` in .conport.json or .conport.local.json',
  old: '`conport.superpowers` is `true` in .superpowers/config.json, an old place of the switch',
};

// The notice the session start gives the agent when the overlay is on: the
// switch, the one rule that must hold before the rules are read, the line to
// print and the rules file to read. Claude Code shows the agent only the first
// 2 KB of the start context, so the rules themselves stay in their file.
function overlayNoticeText(from, rulesPath) {
  return [
    `ConPort Superpowers overlay: on (${OVERLAY_SOURCES[from]}).`,
    "The user's preference for this project: specs and plans live in ConPort, not in git. " +
      'Never create or commit a file under docs/superpowers/specs/ or docs/superpowers/plans/; ' +
      'wherever a Superpowers skill says to write or commit one, follow the overlay rules instead.',
    'At the start of the session print one line: `[CONPORT] Superpowers overlay: on`.',
    `The overlay rules are not in this context: read the whole file \`${rulesPath}\` ` +
      'before brainstorming, writing a spec or a plan, executing a plan or dispatching a subagent.',
  ].join('\n');
}

// The bytes of start context the agent is given at most: Claude Code shows the
// agent the first 2 KB of a hook's context and saves the rest to a file.
const START_CONTEXT_BUDGET = 1800;

const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');

// The line that stands for the settings lines left out of the agent's context.
function moreLinesLine(count) {
  return `${count} more ConPort settings line${count === 1 ? '' : 's'} did not fit here: ` +
    'the user was shown them at the start of the session';
}

// The agent's start context: the project line first, then the settings lines,
// then the overlay notice after a blank line. The notice and the project line
// are always whole; when everything does not fit `budget` bytes, the settings
// lines from the first one that does not fit on collapse into one line that
// says how many were left out (the user is shown them all).
function startContext({ project = null, lines = [], notice = null }, budget = START_CONTEXT_BUDGET) {
  const head = project ? [project] : [];
  const compose = (body) => [body.join('\n'), notice].filter(Boolean).join('\n\n');
  const whole = compose([...head, ...lines]);
  if (utf8Bytes(whole) <= budget) return whole;
  for (let kept = lines.length - 1; kept > 0; kept--) {
    const text = compose([...head, ...lines.slice(0, kept), moreLinesLine(lines.length - kept)]);
    if (utf8Bytes(text) <= budget) return text;
  }
  return compose([...head, moreLinesLine(lines.length)]);
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
  CONPORT_URL, dataDir, parseProject, sessionSettings, detectProject, isForbiddenRoot,
  RETIRED_PROJECT_ID, retiredProjectIdNotice,
  projectRoute, denyListPath, authHeader, request, readStdin, sessionEpicsPath, loadSessionEpics,
  epicTailsCachePath, dropEpicTailsCaches, fingerprintChanged, gitIn, worktreeRoot, mainWorktreeRoot,
  overlayEnabled, overlayFromSettings, overlaySwitch, OVERLAY_SOURCES, overlayNoticeText,
  START_CONTEXT_BUDGET, startContext,
};
