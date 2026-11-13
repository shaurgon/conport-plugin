#!/usr/bin/env node
// PreToolUse(Bash): refuse a commit that adds a Superpowers spec or plan while
// the overlay is on, then block commands matching ConPort deny-list patterns.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  dataDir, detectProject, denyListPath, readStdin, overlayEnabled, worktreeRoot, gitIn, isForbiddenRoot,
} = require('./_common.js');

const SPECS_DIR = 'docs/superpowers/specs';
const PLANS_DIR = 'docs/superpowers/plans';

// Whether any project's deny-list was fetched on this machine. Without one
// nothing can be blocked, and the session's settings are not worked out.
function anyDenyList() {
  try {
    return fs.readdirSync(dataDir()).some((f) => f.startsWith('deny-list_'));
  } catch (_) {
    return false;
  }
}

function loadConventions(input) {
  if (!anyDenyList()) return [];
  // No project in the session's settings: no list is this session's, nothing
  // is blocked. The project is the session's, not that of a folder a command
  // moved to.
  const project = detectProject(input);
  if (!project) return [];
  const p = denyListPath(project);
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data.conventions) ? data.conventions : [];
  } catch (_) {
    return [];
  }
}

// --- commit guard -----------------------------------------------------------

// The delimiter of a here-document whose `<<` ends just before `start`:
// { delim, strip, end } with quotes removed from the delimiter, `strip` for
// `<<-`, and `end` the index after the delimiter word; null without one.
function heredocDelimiter(command, start) {
  let j = start;
  const strip = command[j] === '-';
  if (strip) j += 1;
  while (command[j] === ' ' || command[j] === '\t') j += 1;
  let delim = '';
  while (j < command.length && !' \t\n;&|()<>'.includes(command[j])) {
    const ch = command[j];
    if (ch === "'" || ch === '"') {
      const close = command.indexOf(ch, j + 1);
      const stop = close === -1 ? command.length : close;
      delim += command.slice(j + 1, stop);
      j = stop + 1;
    } else if (ch === '\\') {
      delim += command[j + 1] || '';
      j += 2;
    } else {
      delim += ch;
      j += 1;
    }
  }
  return delim ? { delim, strip, end: j } : null;
}

// The index of the line after the bodies of `heredocs`, read from `pos`:
// each body runs up to a line equal to its delimiter (leading tabs removed
// for `<<-`), or to the end of the input.
function skipHeredocBodies(command, pos, heredocs) {
  for (const { delim, strip } of heredocs) {
    while (pos < command.length) {
      let nl = command.indexOf('\n', pos);
      if (nl === -1) nl = command.length;
      const line = strip ? command.slice(pos, nl).replace(/^\t+/, '') : command.slice(pos, nl);
      pos = nl + 1;
      if (line === delim) break;
    }
  }
  return pos;
}

// The command split into simple commands, each a list of words with quotes
// removed. Control operators (`&&`, `||`, `;`, `|`, `&`, newline, parens)
// end a simple command; `>&` and `<&` stay inside a word. Here-document
// bodies are text, not commands, and are skipped. An unterminated quote ends
// with the input. Expansions are left as written.
function simpleCommands(command) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let heredocs = [];
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (c === '"') {
      inWord = true;
      for (i += 1; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) i += 1;
        word += command[i];
      }
    } else if (c === '\\') {
      if (i + 1 < command.length && command[i + 1] !== '\n') {
        word += command[i + 1];
        inWord = true;
      }
      i += 1;
    } else if (c === '#' && !inWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i += 1;
    } else if (c === '&' && (word.endsWith('>') || word.endsWith('<'))) {
      word += c;
    } else if (command.startsWith('<<', i)) {
      // A here-string (`<<<`) has no delimiter word and starts no body.
      endWord();
      const heredoc = heredocDelimiter(command, i + 2);
      if (heredoc) {
        heredocs.push(heredoc);
        i = heredoc.end - 1;
      } else {
        i += 1;
      }
    } else if ('&|;()\n'.includes(c)) {
      endCommand();
      if (c === '\n' && heredocs.length) {
        i = skipHeredocBodies(command, i + 1, heredocs) - 1;
        heredocs = [];
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Git global options that take their value as the next word.
const GIT_OPTS_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env',
]);

// Words that may stand before the command itself: shell keywords, a group
// brace, negation and the prefixes that run the next word as a command.
const COMMAND_PREFIXES = new Set([
  '{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', 'command', 'exec',
]);

// The words of a simple command from the command name on: leading prefixes
// and `NAME=value` assignments are skipped.
function commandWords(words) {
  let i = 0;
  while (i < words.length &&
    (COMMAND_PREFIXES.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i += 1;
  return words.slice(i);
}

// `target` resolved against `dir`. A path built by an expansion (`$`, a
// backtick) cannot be known here, so the directory stays as it was.
function moveTo(dir, target) {
  return /[$`]/.test(target) ? dir : path.resolve(dir, expandHome(target));
}

// A git invocation in a simple command: { sub, dir } where `sub` is the
// subcommand after the global options and `dir` is where it runs (`-C` paths
// resolved against `dir` in order, as git does), or null when the words are
// not a git call.
function gitInvocation(words, dir) {
  if (!words.length || path.basename(words[0]) !== 'git') return null;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!w.startsWith('-')) return { sub: w, dir };
    if (GIT_OPTS_WITH_VALUE.has(w)) {
      if (i + 1 >= words.length) return null;
      if (w === '-C') dir = moveTo(dir, words[i + 1]);
      i += 1;
    }
  }
  return null;
}

// The directories of every `git commit` in `command`, run from `cwd`, and
// whether the command also runs `git add`. A `cd <path>` before a commit
// moves the directory the commit runs in.
function commitsIn(command, cwd) {
  const dirs = [];
  let adds = false;
  let dir = cwd;
  for (const all of simpleCommands(command)) {
    const words = commandWords(all);
    if (words[0] === 'cd') {
      const target = words.slice(1).find((w) => w === '-' || !w.startsWith('-'));
      if (target === undefined) dir = os.homedir();
      else if (target !== '-') dir = moveTo(dir, target);
      continue;
    }
    const call = gitInvocation(words, dir);
    if (!call) continue;
    if (call.sub === 'commit') dirs.push(call.dir);
    else if (call.sub === 'add') adds = true;
  }
  return { dirs, adds };
}

// `git status --porcelain -z` records for the two directories, from the
// root, or null when git cannot answer. NUL-separated records carry paths
// unquoted; untrimmed, because the first column is meaningful. No optional
// locks: a status must not hold index.lock against a parallel git call.
function porcelainStatus(root) {
  try {
    return execFileSync('git', [
      '--no-optional-locks', '-C', root, 'status', '--porcelain', '-z', '--untracked-files=all',
      '--', SPECS_DIR, PLANS_DIR,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .split('\0');
  } catch (_) {
    return null;
  }
}

// The guarded directory that holds `p`, or null.
const guardedDirOf = (p) => [SPECS_DIR, PLANS_DIR].find((d) => p.startsWith(`${d}/`)) || null;

// The first file a commit would add under the two directories: a staged new
// file, the new side of a rename or copy into them, or — when the command
// runs `git add` — an untracked file. Modified and deleted files pass, and so
// does a rename whose old and new paths lie in the same guarded directory:
// that moves an archive file, it adds none.
// A rename or copy record (`R` or `C` in either column) names the new path
// and is followed by its old path.
function addedFile(records, adds) {
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const xy = record.slice(0, 2);
    const file = record.slice(3);
    const moved = /[RC]/.test(xy);
    const from = moved ? records[i + 1] || '' : '';
    if (moved) i += 1;
    if (xy === '??') {
      if (adds) return file;
    } else if (xy.includes('A')) {
      return file;
    } else if (moved) {
      const dir = guardedDirOf(file);
      if (dir && !(xy.includes('R') && guardedDirOf(from) === dir)) return file;
    }
  }
  return null;
}

const SEQUENCER_HEADS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];

// Whether a merge, cherry-pick or revert is in progress in the worktree that
// holds `dir`: its commit records what that operation brought in, files that
// were created on another branch. Each head is looked up in the worktree's
// own git directory; git prints the paths relative to `dir`.
function operationInProgress(dir) {
  const out = gitIn(dir, ['rev-parse', ...SEQUENCER_HEADS.flatMap((name) => ['--git-path', name])]);
  if (!out) return false;
  return out.split('\n').some((p) => p && fs.existsSync(path.resolve(dir, p)));
}

const CONTROL = /[\x00-\x1f\x7f]/;
const ANSI_C_ESCAPES = { '\n': '\\n', '\t': '\\t', '\\': '\\\\', "'": "\\'" };

// `s` as one shell word on one line: letters of any script stay as they are,
// a name with a control character becomes an ANSI-C `$'…'` word, anything
// else the shell would read specially gets the word single-quoted.
function shellWord(s) {
  if (/^[\p{L}\p{N}\p{M}@%+=:,./_-]+$/u.test(s)) return s;
  if (CONTROL.test(s)) {
    const body = [...s].map((ch) => ANSI_C_ESCAPES[ch] ||
      (CONTROL.test(ch) ? `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}` : ch)).join('');
    return `$'${body}'`;
  }
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function refusal(root, rel) {
  const file = shellWord(path.join(root, rel));
  if (rel.startsWith(`${PLANS_DIR}/`)) {
    return `BLOCKED: ${file} is a new Superpowers plan, and with the ConPort overlay on plans live in ConPort: ` +
      `run \`npx -y conport@^0.11.0 plan import ${file} --spec doc-N --epic <id>\` with doc-N the plan's spec and <id> the spec's epic, then remove the file.`;
  }
  return `BLOCKED: ${file} is a new Superpowers spec, and with the ConPort overlay on specs live in ConPort: ` +
    `run \`npx -y conport@^0.11.0 documents upload ${file} --doc-type spec\`, then remove the file.`;
}

// The refusal for a command that commits a new spec or plan with the overlay
// on, or null. The overlay is read from the settings of the folder each
// commit runs in, not from the session's. No commit, the overlay off, no git,
// or a merge, cherry-pick or revert in progress — no check.
function commitGuard(command, cwd) {
  const { dirs, adds } = commitsIn(command, cwd);
  const seen = new Set();
  for (const dir of dirs) {
    if (!overlayEnabled(dir)) continue;
    const root = worktreeRoot(dir);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    if (operationInProgress(dir)) continue;
    const records = porcelainStatus(root);
    const rel = records && addedFile(records, adds);
    if (rel) return refusal(root, rel);
  }
  return null;
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (_) {
    process.exit(0);
  }

  const toolInput = input && input.tool_input;
  const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command) process.exit(0);

  // The guard comes before the deny-list and the project: it needs neither.
  let reason = null;
  try {
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    reason = commitGuard(command, cwd);
  } catch (err) {
    if (isForbiddenRoot(err)) throw err;
    reason = null;
  }
  if (reason) {
    // Wait for the write: on a pipe stderr may be asynchronous.
    await new Promise((resolve) => process.stderr.write(`${reason}\n`, resolve));
    process.exit(2);
  }

  const conventions = loadConventions(input);
  for (const conv of conventions) {
    const pattern = conv && conv.pattern;
    if (!pattern) continue;
    let re;
    try { re = new RegExp(pattern); } catch (_) { continue; }
    if (re.test(command)) {
      const reason = conv.reason || 'Convention violation';
      let msg = `BLOCKED: ${reason}`;
      if (conv.replacement) msg += `\nUse instead: ${conv.replacement}`;
      process.stderr.write(`${msg}\n`);
      process.exit(2);
    }
  }
  process.exit(0);
}

main();
