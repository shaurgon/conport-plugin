// ConPort project settings: `.conport.json` in the project root, committed
// and shared by the team, and `.conport.local.json` beside it, ignored by git,
// for personal overrides. The rules are pure functions over the texts of the
// two files, the environment and what git says (`resolveSettings`,
// `settingsLocations`, `jsonErrorPosition`); `loadSettings` reads the files,
// asks git and feeds them in. The cases every reader of these files passes
// are in test/fixtures/project-config-cases.json. Built-in modules only.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SETTINGS_FILE = '.conport.json';
const LOCAL_SETTINGS_FILE = '.conport.local.json';
const SCHEMA_URL = 'https://conport.app/schema/conport.json';
const MIGRATION_URL = 'https://conport.app/docs/projects/project-settings.md';

const GIT_TIMEOUT_MS = 5000;
const FORBID_VAR = 'CONPORT_SETTINGS_FORBID_ROOT';
const API_KEY_NAMES = new Set(['api_key', 'apikey', 'conport_api_key']);
const API_KEY_PREFIX = 'cport_';

const TYPE_WORDS = {
  project_name: 'a non-empty string',
  plugins: 'an object',
  'plugins.superpowers': 'true or false',
  'plugins.codegraph': 'true or false',
  arch: 'an object',
  'arch.ignore': 'a list of path patterns or {"path", "reason"} objects',
  'arch.git': 'true or false',
  units: 'a list',
};

// ---------------------------------------------------------------------------
// Paths

// A path with `\` turned into `/`, the drive letter in upper case, `.` and
// `..` folded and no trailing `/` (the roots `/` and `C:/` keep theirs). The
// same on every platform, so a Windows path is compared on any machine.
function normalizePath(p) {
  let s = String(p).replace(/\\/g, '/');
  let prefix = '';
  const drive = /^([A-Za-z]):(\/|$)/.exec(s);
  if (drive) {
    prefix = drive[1].toUpperCase() + ':/';
    s = s.slice(drive[0].length);
  } else if (s.startsWith('//')) {
    prefix = '//';
    s = s.replace(/^\/+/, '');
  } else if (s.startsWith('/')) {
    prefix = '/';
    s = s.replace(/^\/+/, '');
  }
  const parts = [];
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!prefix) parts.push('..');
      continue;
    }
    parts.push(part);
  }
  const body = parts.join('/');
  if (!prefix) return body || '.';
  return prefix + body;
}

function isAbsolutePath(p) {
  return /^([A-Za-z]:)?[\\/]/.test(p);
}

function joinPath(root, name) {
  return root.endsWith('/') ? root + name : root + '/' + name;
}

function lastPart(p) {
  const parts = p.split('/');
  return parts[parts.length - 1];
}

function parentPath(p) {
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  const head = p.slice(0, i);
  if (head === '') return '/';
  if (/^[A-Z]:$/.test(head)) return head + '/';
  return head;
}

// Where the settings files of `cwd` are, from what git said
// (`rev-parse --show-toplevel --git-common-dir`). The shared file is in the
// root of the current worktree; the personal file there, then in the root of
// the main worktree when that is another one. The main root is the parent of
// the common git directory only when that directory is named `.git`: a
// submodule (`.git/modules/<name>`) or a worktree of a bare repository
// (`<repo>.git`) has none. Outside git the root is `cwd` itself; any other
// git failure reads nothing.
function settingsLocations(cwd, git) {
  if (!git.ok) {
    const error = String(git.error || '');
    if (/not a git repository/i.test(error)) {
      const root = normalizePath(cwd);
      return {
        ok: true, root, mainRoot: null,
        shared: joinPath(root, SETTINGS_FILE), locals: [joinPath(root, LOCAL_SETTINGS_FILE)],
      };
    }
    const first = error.split('\n').map((l) => l.trim()).find(Boolean) || 'unknown error';
    return { ok: false, line: `git failed (${first}): ConPort settings were not read` };
  }
  const root = normalizePath(git.toplevel);
  const commonRaw = String(git.commonDir).replace(/\\/g, '/');
  const common = normalizePath(isAbsolutePath(commonRaw) ? commonRaw : joinPath(normalizePath(cwd), commonRaw));
  const mainRoot = lastPart(common) === '.git' ? parentPath(common) : null;
  const locals = [joinPath(root, LOCAL_SETTINGS_FILE)];
  if (mainRoot && mainRoot !== root) locals.push(joinPath(mainRoot, LOCAL_SETTINGS_FILE));
  return { ok: true, root, mainRoot, shared: joinPath(root, SETTINGS_FILE), locals };
}

// ---------------------------------------------------------------------------
// JSON

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

function isDigit(c) {
  return c >= 0x30 && c <= 0x39;
}

function isHex(c) {
  return isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

// Offset of the first character at which `text` stops being the start of a
// valid JSON text (RFC 8259), the length of the text when it ends too early,
// or -1 when the whole text is valid. Iterative, so no input overflows the
// stack.
function jsonErrorOffset(text) {
  const n = text.length;
  let i = 0;
  const stack = []; // '{' or '['
  const skip = () => {
    while (i < n && WS.has(text.charCodeAt(i))) i++;
  };
  // Scans one string starting at its opening quote; returns -1 or the offset.
  const string = () => {
    i++;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return -1;
      }
      if (c < 0x20) return i;
      if (c === 0x5c) {
        i++;
        if (i >= n) return n;
        const e = text[i];
        if (e === 'u') {
          for (let k = 1; k <= 4; k++) {
            if (i + k >= n) return n;
            if (!isHex(text.charCodeAt(i + k))) return i + k;
          }
          i += 5;
          continue;
        }
        if ('"\\/bfnrt'.includes(e)) {
          i++;
          continue;
        }
        return i;
      }
      i++;
    }
    return n;
  };
  const number = () => {
    if (text[i] === '-') i++;
    if (i >= n) return n;
    if (text[i] === '0') {
      i++;
    } else if (isDigit(text.charCodeAt(i))) {
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    } else {
      return i;
    }
    if (text[i] === '.') {
      i++;
      if (i >= n) return n;
      if (!isDigit(text.charCodeAt(i))) return i;
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (i >= n) return n;
      if (!isDigit(text.charCodeAt(i))) return i;
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    // A digit right after a leading zero ends the number: `01` fails at `1`
    // when the caller looks for what may follow a value.
    return -1;
  };
  const literal = (word) => {
    for (let k = 0; k < word.length; k++) {
      if (i + k >= n) return n;
      if (text[i + k] !== word[k]) return i + k;
    }
    i += word.length;
    return -1;
  };
  // The key and colon of an object member, at the key.
  const memberKey = () => {
    skip();
    if (i >= n) return n;
    if (text[i] !== '"') return i;
    const bad = string();
    if (bad >= 0) return bad;
    skip();
    if (i >= n) return n;
    if (text[i] !== ':') return i;
    i++;
    return -1;
  };
  // Scans one value. An opened container is pushed and the scan goes on to
  // its first value; the ends of containers are handled by the loop below.
  const value = () => {
    for (;;) {
      skip();
      if (i >= n) return n;
      const ch = text[i];
      if (ch === '{' || ch === '[') {
        const close = ch === '{' ? '}' : ']';
        i++;
        skip();
        if (i >= n) return n;
        if (text[i] === close) {
          i++;
          return -1;
        }
        stack.push(ch);
        if (ch === '{') {
          const bad = memberKey();
          if (bad >= 0) return bad;
        }
        continue;
      }
      if (ch === '"') return string();
      if (ch === '-' || isDigit(text.charCodeAt(i))) return number();
      if (ch === 't') return literal('true');
      if (ch === 'f') return literal('false');
      if (ch === 'n') return literal('null');
      return i;
    }
  };
  const member = () => {
    const bad = memberKey();
    return bad >= 0 ? bad : value();
  };

  let bad = value();
  while (bad < 0) {
    skip();
    if (!stack.length) return i < n ? i : -1;
    if (i >= n) return n;
    const top = stack[stack.length - 1];
    const ch = text[i];
    if (ch === ',') {
      i++;
      bad = top === '{' ? member() : value();
    } else if ((top === '{' && ch === '}') || (top === '[' && ch === ']')) {
      i++;
      stack.pop();
    } else {
      return i;
    }
  }
  return bad;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Where `text` stops being valid JSON — line counted by `\n`, column as 1 plus
// the UTF-16 code units after the last `\n` — or null when it is valid. A
// leading byte order mark is dropped first and does not count.
function jsonErrorPosition(text) {
  const t = stripBom(String(text));
  const offset = jsonErrorOffset(t);
  if (offset < 0) return null;
  const before = t.slice(0, offset);
  const lastNl = before.lastIndexOf('\n');
  let line = 1;
  for (let k = 0; k < before.length; k++) if (before.charCodeAt(k) === 0x0a) line++;
  return { line, column: offset - lastNl };
}

// ---------------------------------------------------------------------------
// The rules

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function setOwn(obj, key, value) {
  // `__proto__` from JSON.parse is an own key; keep it one.
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function isApiKeyValue(v) {
  return typeof v === 'string' && v.trimStart().startsWith(API_KEY_PREFIX);
}

// `value` without API keys: a key named like one is dropped with its value,
// a string starting with `cport_` is dropped wherever it is, array elements
// included. `found.any` is set when something was dropped.
function scrub(value, found) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (isApiKeyValue(item)) {
        found.any = true;
        continue;
      }
      out.push(scrub(item, found));
    }
    return out;
  }
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (API_KEY_NAMES.has(k.toLowerCase()) || isApiKeyValue(v)) {
        found.any = true;
        continue;
      }
      setOwn(out, k, scrub(v, found));
    }
    return out;
  }
  return value;
}

// A path pattern of the arch dialect: POSIX, from the project root, made of
// segments with `*`, `**` and `?`, a trailing `/` for a folder. Anything a
// matcher of that dialect would silently never match is refused: a blank
// string, a `\`, an empty segment (`a//b`; a leading `/` makes one), a `.`
// or `..` segment.
function isPattern(p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\\')) return false;
  const body = p.endsWith('/') ? p.slice(0, -1) : p;
  return body.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// An element of arch.ignore: a pattern, or an object of exactly a pattern
// `path` and a string `reason`.
function isIgnoreEntry(e) {
  if (typeof e === 'string') return isPattern(e);
  if (!isObject(e)) return false;
  const keys = Object.keys(e);
  return keys.length === 2 && isPattern(e.path) && typeof e.reason === 'string';
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// One file's text read by the rules: {lines, values, blocks, name}. `values`
// holds the keys that passed (project_name trimmed, plugins.*, arch.*,
// units); `blocks` is set when the file exists but cannot name a project, so
// no project is named at all.
function readFile(file, input, isLocal) {
  const out = { readError: null, lines: [], values: {}, blocks: false, name: null };
  if (input === null || input === undefined) return out;
  if (typeof input === 'object') {
    out.readError = `${file} cannot be read (${input.error}): fix it`;
    out.blocks = true;
    return out;
  }
  // The byte order mark is dropped once: jsonErrorPosition drops it for the
  // check, JSON.parse gets the same text without it.
  const pos = jsonErrorPosition(input);
  if (pos) {
    out.lines.push(`${file} is not valid JSON (line ${pos.line}, column ${pos.column}): fix it`);
    out.blocks = true;
    return out;
  }
  const parsed = JSON.parse(stripBom(input));
  if (!isObject(parsed)) {
    out.lines.push(`${file} must hold a JSON object — fix it`);
    out.blocks = true;
    return out;
  }
  const found = { any: false };
  const nameIsKey = has(parsed, 'project_name') && isApiKeyValue(parsed.project_name);
  const data = scrub(parsed, found);
  if (found.any) {
    out.lines.push(`${file} holds an API key: revoke it at https://me.conport.app/dashboard/connect, create a new one and keep it in ~/.config/conport/.env`);
  }
  if (nameIsKey) out.blocks = true;
  const wrong = (key) => out.lines.push(`${file}: ${key} must be ${TYPE_WORDS[key]} — fix it`);

  if (has(data, 'project_name')) {
    const v = data.project_name;
    if (typeof v === 'string' && v.trim()) {
      out.name = v.trim();
    } else {
      wrong('project_name');
      out.blocks = true;
    }
  }
  if (has(data, 'plugins')) {
    if (!isObject(data.plugins)) {
      wrong('plugins');
    } else {
      const plugins = {};
      for (const k of ['superpowers', 'codegraph']) {
        if (!has(data.plugins, k)) continue;
        if (typeof data.plugins[k] === 'boolean') plugins[k] = data.plugins[k];
        else wrong(`plugins.${k}`);
      }
      out.values.plugins = plugins;
    }
  }
  if (!isLocal) {
    if (has(data, 'arch')) {
      if (!isObject(data.arch)) {
        wrong('arch');
      } else {
        const arch = {};
        if (has(data.arch, 'ignore')) {
          const ig = data.arch.ignore;
          if (Array.isArray(ig) && ig.every(isIgnoreEntry)) {
            arch.ignore = ig.map((e) => (typeof e === 'string' ? e : { path: e.path, reason: e.reason }));
          } else {
            wrong('arch.ignore');
          }
        }
        if (has(data.arch, 'git')) {
          if (typeof data.arch.git === 'boolean') arch.git = data.arch.git;
          else wrong('arch.git');
        }
        out.values.arch = arch;
      }
    }
    if (has(data, 'units')) {
      if (Array.isArray(data.units)) out.values.units = data.units;
      else wrong('units');
    }
  } else {
    for (const k of ['arch', 'units']) {
      if (has(data, k)) out.lines.push(`${k} is read from .conport.json only`);
    }
  }
  return out;
}

// Whether the text of ~/.config/conport/.env assigns CONPORT_PROJECT_NAME.
function userEnvNamesProject(text) {
  if (typeof text !== 'string') return false;
  return text.split(/\r?\n/).some((l) => /^\s*(export\s+)?CONPORT_PROJECT_NAME\s*=/.test(l));
}

function envName(env) {
  const v = env && env.CONPORT_PROJECT_NAME;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// The settings and the project from the two files, the environment and an
// explicit argument. The project comes from the explicit argument, then from
// project_name of the merged files (the personal file over the shared one),
// then from CONPORT_PROJECT_NAME when no file names one. A file that exists
// but is broken (unreadable, not JSON, not an object, a bad project_name)
// names no project, and neither the other file nor the variable stands in
// for it. ~/.config/conport/.env never names it.
function resolveSettings(input) {
  const shared = readFile(SETTINGS_FILE, input.shared, false);
  const local = readFile(LOCAL_SETTINGS_FILE, input.local, true);
  const lines = [];
  for (const f of [shared, local]) if (f.readError) lines.push(f.readError);
  lines.push(...shared.lines, ...local.lines);
  if (input.local !== null && input.local !== undefined && input.localIgnored === false) {
    lines.push(`${LOCAL_SETTINGS_FILE} is not ignored by git: add it to .gitignore`);
  }

  const plugins = { ...(shared.values.plugins || {}), ...(local.values.plugins || {}) };
  const settings = { plugins, arch: { ...(shared.values.arch || {}) } };
  if (shared.values.units) settings.units = shared.values.units;

  let project = null;
  let source = null;
  const explicit = typeof input.explicit === 'string' && input.explicit.trim() ? input.explicit.trim() : null;
  const variable = envName(input.env);
  if (explicit) {
    project = explicit;
    source = 'explicit';
  } else {
    if (local.name !== null) {
      project = local.name;
      source = LOCAL_SETTINGS_FILE;
      if (shared.name !== null && shared.name !== local.name) {
        lines.push(`project_name from ${LOCAL_SETTINGS_FILE} (${local.name}) overrides ${SETTINGS_FILE} (${shared.name})`);
      }
    } else if (shared.name !== null) {
      project = shared.name;
      source = SETTINGS_FILE;
    }
    if (shared.blocks || local.blocks) {
      // A broken file, either one, names no project: neither the other file
      // nor the variable stands in for what it may have named.
      project = null;
      source = null;
    } else if (project !== null) {
      if (variable !== null && variable !== project) {
        lines.push(`CONPORT_PROJECT_NAME is ignored: ${source} names ${project} — remove the variable`);
      }
    } else if (variable !== null) {
      project = variable;
      source = 'CONPORT_PROJECT_NAME';
    }
  }
  if (userEnvNamesProject(input.userEnv)) {
    lines.push('CONPORT_PROJECT_NAME in ~/.config/conport/.env is not read: it would apply to every repository — remove it');
  }
  return { project, source, settings, lines };
}

// The line the session start says about the chosen project, or null.
function projectLine(result) {
  if (!result || !result.project || !result.source || result.source === 'explicit') return null;
  return `ConPort project: ${result.project} (from ${result.source})`;
}

// ---------------------------------------------------------------------------
// Reading

// Git is asked in English (LC_ALL=C, no LANGUAGE): a git with translations
// would otherwise say "not a git repository" in the user's language, and a
// folder outside git would read as a git failure.
function defaultRun(env) {
  const english = { ...env, LC_ALL: 'C', LANGUAGE: '' };
  return (args) => execFileSync('git', args, {
    encoding: 'utf8', env: english, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
  });
}

function errorText(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : '';
  return stderr || (err && err.message ? String(err.message) : String(err));
}

// What git says about `cwd`: the worktree root and the common git directory,
// in one call.
function readGitFacts(cwd, run = defaultRun(process.env)) {
  try {
    const out = String(run(['-C', cwd, 'rev-parse', '--show-toplevel', '--git-common-dir']));
    const [toplevel, commonDir] = out.split(/\r?\n/).map((l) => l.trim());
    if (!toplevel || !commonDir) return { ok: false, error: `unexpected answer of git rev-parse: ${out.trim()}` };
    return { ok: true, toplevel, commonDir };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

// The text of a file, null when there is none, {error: code} when it exists
// but cannot be read (a directory, no permission).
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    return { error: (err && err.code) || 'EIO' };
  }
}

// Whether the personal file in `dir` is ignored by git and not tracked:
// true, false, or null when git cannot tell.
function localIgnoredIn(dir, run) {
  try {
    run(['-C', dir, 'ls-files', '--error-unmatch', '--', LOCAL_SETTINGS_FILE]);
    return false;
  } catch (err) {
    if (!err || err.status !== 1) return null;
  }
  try {
    run(['-C', dir, 'check-ignore', '-q', '--', LOCAL_SETTINGS_FILE]);
    return true;
  } catch (err) {
    return err && err.status === 1 ? false : null;
  }
}

function realPath(p) {
  try {
    return normalizePath(fs.realpathSync.native(p));
  } catch (_) {
    return normalizePath(path.resolve(p));
  }
}

function insidePath(child, parent) {
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/');
}

// The settings of the project `cwd` belongs to, read from its files, git and
// the user env file (<XDG_CONFIG_HOME | home/.config>/conport/.env). With
// CONPORT_SETTINGS_FORBID_ROOT set, a root inside that path throws: a test
// must not read the settings of the repository it runs in.
function loadSettings({ cwd, env = process.env, explicit = null, home, run }) {
  const git = run || defaultRun(env);
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const userEnv = readText(path.join(configHome, 'conport', '.env'));
  const userEnvText = typeof userEnv === 'string' ? userEnv : null;

  const facts = readGitFacts(cwd, git);
  const where = settingsLocations(cwd, facts);
  if (!where.ok) {
    const result = resolveSettings({
      shared: null, local: null, localIgnored: null, env: {}, explicit, userEnv: userEnvText,
    });
    return { ...result, lines: [where.line, ...result.lines], root: null, mainRoot: null };
  }
  const forbid = env[FORBID_VAR];
  if (forbid) {
    // Both sides with symlinks resolved: a repository opened through a link
    // is still the repository.
    const banned = realPath(forbid);
    for (const r of [where.root, where.mainRoot]) {
      if (r && insidePath(realPath(r), banned)) {
        throw new Error(`settings root ${r} is inside ${FORBID_VAR}: run the test in a temporary folder`);
      }
    }
  }

  const shared = readText(where.shared);
  let local = null;
  let localPath = null;
  for (const candidate of where.locals) {
    local = readText(candidate);
    if (local !== null) {
      localPath = candidate;
      break;
    }
  }
  // Outside git there is nothing to ignore the file; inside, it is asked in
  // the worktree that holds it, and only when it is there.
  let localIgnored = null;
  if (localPath && facts.ok) localIgnored = localIgnoredIn(parentPath(localPath), git);

  const result = resolveSettings({
    shared, local, localIgnored, env: { CONPORT_PROJECT_NAME: env.CONPORT_PROJECT_NAME }, explicit, userEnv: userEnvText,
  });
  return { ...result, root: where.root, mainRoot: where.mainRoot };
}

module.exports = {
  SETTINGS_FILE,
  LOCAL_SETTINGS_FILE,
  SCHEMA_URL,
  MIGRATION_URL,
  normalizePath,
  settingsLocations,
  resolveSettings,
  jsonErrorPosition,
  projectLine,
  readGitFacts,
  loadSettings,
};
