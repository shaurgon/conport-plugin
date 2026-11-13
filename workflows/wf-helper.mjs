#!/usr/bin/env node
// Deterministic mechanics of the /conport:task and /conport:epic workflows:
// preflight, project gate, merge batch, cleanup, accounting, scouting, the
// review cycle of a task, the branch check of a task found in REVIEW and the
// check of unit versions against the base branch. Every subcommand prints exactly
// one strict JSON object on stdout and exits 0 — a red result is data, not a
// process error. Exit 2 is reserved for CLI misuse. No external dependencies.
//
// Mirror rule: the JSON shapes here are the workflow schemas S_PRE, S_BASE,
// S_MG, S_ACC, S_JAN, S_CYC, S_BR, S_VER and the scout base S_SCOUT_RAW — edit them
// together.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TAIL_LINES = 30
const API_BASE = 'https://api.conport.app/api/v1'
const PLANS_DIR = ['docs', 'superpowers', 'plans']  // where the workflows keep their plans
const PAGE = 200                                   // the list endpoint's maximum limit
const PAGE_CAP = 20                                // never walk an unbounded listing
const ERROR_BODY_CHARS = 300
const REQUEST_TIMEOUT_MS = 10000                   // per REST call, as in scripts/_common.js
// The two accounting tables this command knows how to execute — the one of a
// single task run and the one of an epic run. A table whose keys fit neither
// shape is refused whole rather than executed in part.
const TASK_TABLE_KEYS = new Set(['project', 'close', 'block', 'minors_umbrella'])
// EPIC_TABLE_KEYS_BEGIN — mirrored by EPIC_TABLE_KEYS in epic.js (drift-guarded)
const EPIC_TABLE_KEYS = new Set(['project', 'epic', 'done', 'failed', 'skipped',
  'parity_failed', 'minors', 'verdict', 'may_close', 'close_resolution'])
// EPIC_TABLE_KEYS_END
// The tails epic of the release: one per release, named by the release milestone (the
// epic's own) in a title written literally, never translated, attached to the release
// milestone right after it and taken first after the push (priority 1). Without a
// next release milestone, file under an unassigned tails epic and ask its milestone.
// Without any release at all, record the work while asking where it belongs.
const RELEASE_TAILS_TITLE = milestone => 'Tails of release ' + milestone
const RELEASE_TAILS_PRIORITY = 1
const ASKED_WHERE_TAILS_GO = ' — the person is asked which milestone the tails go to'
// Without a release at all, record the work in one progress entry while asking
// where it belongs: every entry keeps its title, priority and description.
const TAILS_WAITING_MARK = ' tails waiting for a milestone: '
const tailsWaitingText = (prefix, entries) => prefix + TAILS_WAITING_MARK +
  "the owner is asked which milestone the tails epic of the release goes to; under it, 'Tails of release " +
  "<title of the release milestone>' at priority 1, each entry below becomes a task.\n\n" +
  entries.map(e => '- ' + e.title + ' (priority ' + e.priority + '): ' + (e.description ?? '')).join('\n')
// The part of the run resolution naming the ordinary work for the tails epic, as the
// table writes it; the accountant names where that work actually went. Under a tails
// epic, only the entries filed or found already filed (`filed`) count as filed.
const TAILS_PART = /; ordinary work to the tails epic (\d+)/
const tailsOutcome = (resolution, out, filed, total) => {
  if (typeof resolution !== 'string') return resolution
  resolution = resolution.replace(TAILS_PART, '; ordinary work to the tails epic ' + total)
  if (Number.isInteger(out.tails_epic_id))
    return resolution.replace(TAILS_PART, (_, n) => '; ordinary work filed in the tails epic task-' + out.tails_epic_id + ': ' +
      (filed >= Number(n) ? n : filed + ' of ' + n + ', the rest not filed: a call failed'))
  if (out.tails_epic_needs_milestone && Number.isInteger(out.tails_waiting_progress_id))
    return resolution.replace(TAILS_PART, (_, n) => "; ordinary work waiting for the owner's answer on its milestone: " + n +
      ', recorded in progress-' + out.tails_waiting_progress_id)
  return resolution.replace(TAILS_PART, (_, n) => '; ordinary work not filed: ' + n +
    (out.tails_epic_needs_milestone ? ', the owner is asked which milestone the tails go to' : ', the tails epic could not be found or made'))
}
const RELEASE_TAILS_DESCRIPTION = 'Work of the release beyond what its epics took in, taken into work first after the push'
// What a parity-failed plan task is: the run found no child of the epic carrying
// its title. A parity row names the plan task, never an outcome, so this single
// wording covers every such row.
const NO_CHILD_OUTCOME = 'no child task in ConPort'
// KEY=value, where the key carries SECRET/TOKEN/KEY/PASSWORD. The separator is
// limited to spaces and tabs so the match cannot jump over a line break, and a
// quoted value is swallowed whole instead of being cut at its first space.
const SECRET_KEY =
  /\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Za-z0-9_.-]*)[ \t]*=[ \t]*("[^"\n]*"?|'[^'\n]*'?|\S+)/gi

// The authors of the journal entries a workflow run writes, one per kind, held
// here only: both workflows write the journal through this helper. The server
// refuses a review signed by the author of the round's report or fix
// (reviewer_is_author), so the reviewer's name differs from the implementer's by
// construction.
export const JOURNAL_AUTHORS = Object.freeze({
  brief: 'orchestrator', report: 'implementer', fix: 'implementer', review: 'reviewer',
})
// BODY_MAX_LENGTH of the server's journal schema, in characters.
export const JOURNAL_BODY_MAX = 200000
const JOURNAL_VERDICTS = new Set(['approve', 'changes_requested'])

// The stamp of the execution branch: every scout and account report of this
// helper carries via:"wf-helper", so a run ledger can tell branch A (this file)
// from branch B (the MCP fallback, which stamps via:"mcp" instead).
const VIA = 'wf-helper'

// The version handshake: a helper served from a stale plugin cache is
// indistinguishable from a broken one by behavior alone. The helper therefore
// reports the plugin version it shipped with — read from the plugin manifest
// next to the workflows directory, the same layout in the repository and in the
// installed cache. Unreadable manifest -> null, never a crash: the version is a
// diagnostic, not a requirement. Exported so the degradation is testable.
export const helperVersion = () => {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url))
    const v = JSON.parse(readFileSync(join(dirname(self), '..', '.claude-plugin', 'plugin.json'), 'utf8')).version
    return typeof v === 'string' ? v : null
  } catch { return null }
}

const usage = msg => { process.stderr.write(msg + '\n'); process.exit(2) }
const emit = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0) }

// Not a failure: an error object hands the work back to the caller, which does it
// itself. The fixed sentinels are written verbatim, spacing included — a caller
// may compare them literally.
const sentinel = what => { process.stdout.write(`{"error": "${what}"}\n`); process.exit(0) }
const errorOut = detail => { process.stdout.write(JSON.stringify({ error: detail }) + '\n'); process.exit(0) }

// The one place the API key is read. An installed plugin never sets
// CONPORT_API_KEY: the harness exposes the configured key as
// CLAUDE_PLUGIN_OPTION_API_KEY, and scripts/_common.js accepts both — so does
// this helper. Empty means no key at all, and the caller does the work itself.
const apiKey = () => (process.env.CONPORT_API_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY || '').trim() || null

// The deadline of a single REST call; the override exists for tests and for a
// slow link. An unusable value falls back to the default rather than to no
// deadline at all — exported so the degradation of a bad value is testable
// without a server.
export const timeoutMs = () => {
  const given = Number(process.env.CONPORT_TIMEOUT_MS)
  return Number.isFinite(given) && given > 0 ? given : REQUEST_TIMEOUT_MS
}

// ------------------------------------------------------------------ plumbing

// git writes warnings to stderr even when it exits 0, so the two streams stay
// apart: data is read from `stdout` only, `out` (both streams) is for error
// tails shown to a human.
const git = (...a) => {
  const r = spawnSync('git', a, { encoding: 'utf8' })
  const stdout = r.stdout ?? ''
  const stderr = r.stderr ?? ''
  return { ok: r.status === 0, stdout, stderr, out: stdout + stderr }
}
const gitOut = (...a) => git(...a).stdout.trim()

// The shell of the gate commands. Plans write them in sh syntax, and on Windows
// `shell: true` means cmd.exe, which reads them wrong and turns a sound branch
// red. There they run through the bash of Git for Windows instead:
// CLAUDE_CODE_GIT_BASH_PATH when it names a file, else the first bash.exe on
// PATH; without one the gate is refused, never reported red. POSIX keeps sh.
// Pure — platform, environment and the file probe come in — so every branch is
// testable on any machine.
export const GIT_BASH_MISSING =
  'Git Bash not found: install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe'
const isFile = p => { try { return statSync(p).isFile() } catch { return false } }
export const gateShell = ({ platform = process.platform, env = process.env, isFile: probe = isFile } = {}) => {
  if (platform !== 'win32') return { bash: null }
  const given = (env.CLAUDE_CODE_GIT_BASH_PATH ?? '').trim()
  if (given && probe(given)) return { bash: given }
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH')
  for (const entry of (pathKey ? env[pathKey] : '').split(';')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const candidate = win32.join(dir, 'bash.exe')
    if (probe(candidate)) return { bash: candidate }
  }
  return { error: GIT_BASH_MISSING }
}
// The spawnSync call of one command: POSIX exactly as before, win32 as bash -c.
export const shellInvocation = (shell, cmd) => shell.bash
  ? { file: shell.bash, args: ['-c', cmd], options: {} }
  : { file: cmd, args: null, options: { shell: true } }

const sh = (cmd, cwd, shell) => {
  const { file, args, options } = shellInvocation(shell, cmd)
  const opts = { ...options, cwd, encoding: 'utf8' }
  const r = args ? spawnSync(file, args, opts) : spawnSync(file, opts)
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// Never print secret values: KEY=value with SECRET/TOKEN/KEY/PASSWORD in the key.
const mask = text => text.replace(SECRET_KEY, (_m, key) => key + '=***')
const tail = text => mask(text).replace(/\s+$/, '').split('\n').slice(-TAIL_LINES).join('\n')

// git status --porcelain path list; a rename reports its destination.
// The status letters live in the first two columns, so the raw output is parsed
// unstripped — trimming would eat the leading space of ' M path'. Only the
// stdout of git may be fed in: a stderr warning would parse as a bogus path and
// declare a clean tree dirty.
export const parseStatusPaths = stdout => stdout.split('\n')
  .filter(l => l.trim().length)
  .map(l => { const p = l.slice(3).trim(); const i = p.indexOf(' -> '); return i < 0 ? p : p.slice(i + 4) })
  .map(p => (p.startsWith('"') && p.endsWith('"')) ? p.slice(1, -1) : p)

const statusPaths = () => parseStatusPaths(git('status', '--porcelain').stdout)

const mergeHeadPath = () => {
  const dir = gitOut('rev-parse', '--absolute-git-dir')
  return dir ? join(dir, 'MERGE_HEAD') : null
}
// Debris of an interrupted previous run: abort it, then re-read the state.
const abortMergeDebris = () => {
  const p = mergeHeadPath()
  if (!p || !existsSync(p)) return false
  git('merge', '--abort')
  return true
}

export const runGate = (dir, commands, shell) => {
  for (const cmd of commands) {
    const r = sh(cmd, dir, shell)
    if (!r.ok) return { green: false, tail: tail(r.out) }
  }
  return { green: true, tail: '' }
}

// ------------------------------------------------------------------- args

const parseArgs = argv => {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usage('unexpected argument: ' + a)
    const name = a.slice(2)
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[name] = true
    else flags[name] = argv[++i]
  }
  return flags
}
const jsonArg = (raw, what) => {
  let v
  try { v = JSON.parse(raw) } catch { return usage('invalid JSON for ' + what) }
  return v
}
const jsonArray = (raw, what) => {
  const v = jsonArg(raw, what)
  if (!Array.isArray(v)) return usage(what + ' must be a JSON array')
  return v
}
const readJsonFile = (path, what) => {
  if (!existsSync(path)) return usage(what + ' not found: ' + path)
  return jsonArg(readFileSync(path, 'utf8'), what)
}
// --<name> <json> or --<name>-file <path>
const listOption = (flags, name) => {
  if (typeof flags[name] === 'string') return jsonArray(flags[name], '--' + name)
  const file = flags[name + '-file']
  if (typeof file === 'string') {
    const v = readJsonFile(file, '--' + name + '-file')
    if (!Array.isArray(v)) return usage('--' + name + '-file must hold a JSON array')
    return v
  }
  return null
}

// --------------------------------------------------------------- subcommands

const preflight = () => {
  abortMergeDebris()
  const dirty = statusPaths()
  const current = gitOut('rev-parse', '--abbrev-ref', 'HEAD')
  emit({
    clean: dirty.length === 0,
    dirty_paths: dirty,
    branch: defaultBranch(current),
    current_branch: current,
    main_sha: gitOut('rev-parse', 'HEAD'),
    // The version handshake rides the first pipe of every run, so a stale
    // helper is visible in the run report, not only to `--version` by hand.
    helper_version: helperVersion(),
    // Whether a ConPort API key is set — never the key. The workflows dispatch
    // every agent through the task's journal, which lives in ConPort, so a run
    // without a key refuses at its start.
    api_key: apiKey() !== null,
  })
}

// The repository's default branch: origin/HEAD, else the first conventional
// name that exists locally, else whatever is checked out.
const defaultBranch = current => {
  const sym = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (sym.ok) {
    const name = sym.stdout.trim().replace(/^origin\//, '')
    if (name) return name
  }
  for (const name of ['main', 'master', 'trunk'])
    if (git('rev-parse', '--verify', '--quiet', 'refs/heads/' + name).ok) return name
  return current
}

const gate = flags => {
  const dir = typeof flags.dir === 'string' ? flags.dir : null
  if (!dir) return usage('gate requires --dir <dir>')
  const commands = listOption(flags, 'commands')
  if (!commands || !commands.length) return usage('gate requires --commands <json array> or --commands-file <path>')
  const shell = gateShell()
  if (shell.error) return errorOut(shell.error)
  const r = runGate(dir, commands, shell)
  emit(r.green ? { gate: 'GREEN', red_summary: '' } : { gate: 'RED', red_summary: r.tail })
}

const merge = flags => {
  const queuePath = typeof flags.queue === 'string' ? flags.queue : null
  if (!queuePath) return usage('merge requires --queue <path.json>')
  const queue = readJsonFile(queuePath, '--queue')
  if (!Array.isArray(queue)) return usage('--queue must hold a JSON array')
  const gateDir = typeof flags['gate-dir'] === 'string' ? flags['gate-dir'] : null
  if (!gateDir) return usage('merge requires --gate-dir <dir>')
  const commands = listOption(flags, 'gate-commands')
  if (!commands || !commands.length)
    return usage('merge requires --gate-commands <json array> or --gate-commands-file <path>')
  // Before any git step: a gate that cannot run must leave the tree as it was.
  const shell = gateShell()
  if (shell.error) return errorOut(shell.error)

  const results = queue.map(e => ({
    id: e.id, status: 'NOT_MERGED', merge_sha: null, conflict_files: [], gate_tail: '',
  }))
  const isAncestor = sha => !!sha && git('merge-base', '--is-ancestor', sha, 'HEAD').ok

  if (flags['state-only']) {
    abortMergeDebris()
    queue.forEach((e, i) => { results[i].status = isAncestor(e.head_sha) ? 'ALREADY_MERGED' : 'NOT_MERGED' })
    const g = runGate(gateDir, commands, shell)
    if (!g.green) {
      const first = results.find(r => r.status === 'NOT_MERGED')
      if (first) { first.status = 'RED_BASELINE'; first.gate_tail = g.tail }
    }
    emit({ results })
  }

  for (let i = 0; i < queue.length; i++) {
    const e = queue[i]
    const r = results[i]

    abortMergeDebris()
    const dirty = statusPaths()
    if (dirty.length) {                              // never touch a dirty tree
      r.status = 'DIRTY_ABORTED'
      r.gate_tail = dirty.join('\n')
      break
    }

    if (isAncestor(e.head_sha)) {                    // already in: gate only
      const g = runGate(gateDir, commands, shell)
      if (g.green) { r.status = 'ALREADY_MERGED'; continue }
      r.status = 'RED_BASELINE'
      r.gate_tail = g.tail
      break
    }

    const m = git('merge', '--no-ff', '--no-commit', e.branch)
    if (!m.ok) {
      const conflicts = gitOut('diff', '--name-only', '--diff-filter=U')
      git('merge', '--abort')
      r.status = 'CONFLICT'
      r.conflict_files = conflicts ? conflicts.split('\n') : []
      continue
    }

    const g = runGate(gateDir, commands, shell)
    if (!g.green) {
      git('merge', '--abort')
      r.status = 'GATE_RED'
      r.gate_tail = g.tail
      continue
    }

    const c = git('commit', '-m', 'merge task-' + e.id + ': ' + e.title)
    if (!c.ok) {                                     // treat an unexpected refusal as red
      git('merge', '--abort')
      r.status = 'GATE_RED'
      r.gate_tail = 'commit refused: ' + tail(c.out)
      continue
    }
    r.status = 'MERGED'
    r.merge_sha = gitOut('rev-parse', 'HEAD')
  }
  emit({ results })
}

// A path as git prints it in `worktree list`: symlinks resolved, and the letter
// case as it is on disk — the native realpath, because on a case-insensitive file
// system two spellings of one tree must compare equal. A directory that is
// already gone cannot be resolved itself, so its nearest existing ancestor is.
const canonPath = path => {
  let head = resolve(path)
  let rest = ''
  for (;;) {
    if (existsSync(head)) return join(realpathSync.native(head), rest)
    const up = dirname(head)
    if (up === head) return resolve(path)
    rest = join(basename(head), rest)
    head = up
  }
}

// The branches checked out in the given linked worktrees, read from git's own
// list — a stale entry (directory gone, not yet pruned) still names its branch.
// The main working tree, the first entry, is never the run's. A list git refuses
// to give is reported in `errors`: an empty answer must not read as "none".
const worktreeBranches = (paths, errors) => {
  const wanted = new Set(paths.map(canonPath))
  const branches = []
  const listed = git('worktree', 'list', '--porcelain')
  if (!listed.ok) {
    errors.push('worktree list: ' + mask(listed.out.trim()))
    return branches
  }
  const entries = listed.stdout.trim().split(/\n\n+/).slice(1)
  for (const entry of entries) {
    const path = /^worktree (.+)$/m.exec(entry)
    const branch = /^branch refs\/heads\/(.+)$/m.exec(entry)
    if (path && branch && wanted.has(canonPath(path[1])) && !branches.includes(branch[1])) branches.push(branch[1])
  }
  return branches
}

// The checkout the helper runs in — its working directory and the toplevel of
// that checkout. It is never a worktree to remove, whatever the list says: a run
// started from a linked worktree would destroy its own tree, uncommitted work
// included, on one wrong path.
const ownCheckout = () => {
  const own = new Set([canonPath(process.cwd())])
  const top = git('rev-parse', '--show-toplevel')
  if (top.ok && top.stdout.trim()) own.add(canonPath(top.stdout.trim()))
  return own
}

const cleanup = flags => {
  const merged = listOption(flags, 'merged')
  const worktrees = listOption(flags, 'worktrees')
  if (!merged || !worktrees) return usage('cleanup requires --merged <json array> and --worktrees <json array>')

  const out = { deleted: [], kept: [], worktrees_removed: [], skipped: [], errors: [] }
  // Read before anything is removed: once a worktree is gone, nothing ties its
  // path to the branch it held.
  const runBranches = worktreeBranches(worktrees, out.errors)
  const own = ownCheckout()
  // Worktrees first: a merged branch is normally still checked out in a worktree
  // of the same run, and git refuses to delete a branch a worktree holds. The
  // other order fails every deletion and leaves the branches for a second call.
  for (const path of worktrees) {
    if (!existsSync(path)) continue
    if (own.has(canonPath(path))) { out.skipped.push(path + ': the checkout the helper runs in'); continue }
    const r = git('worktree', 'remove', '--force', path)
    if (r.ok) out.worktrees_removed.push(path)
    else out.errors.push('worktree remove ' + path + ': ' + mask(r.out.trim()))
  }
  const pruned = git('worktree', 'prune')
  if (!pruned.ok) out.errors.push('worktree prune: ' + mask(pruned.out.trim()))
  for (const branch of merged) {                     // every other branch stays — forensics
    const r = git('branch', '-D', branch)
    if (r.ok) out.deleted.push(branch)
    else out.errors.push('branch -D ' + branch + ': ' + mask(r.out.trim()))
  }
  // What the run leaves on purpose: its branches that were not merged. A merged
  // branch that refused to go is an error above, not a kept one; a branch that
  // never got a commit does not exist once its worktree is gone.
  for (const branch of runBranches)
    if (!merged.includes(branch) && git('show-ref', '--verify', '--quiet', 'refs/heads/' + branch).ok)
      out.kept.push(branch)
  emit(out)
}

// The first of the given local branches that exists, with its head. A task found
// in REVIEW is reviewed on the branch an earlier run left behind; the caller
// lists the names that run may have used, most recent attempt first.
const branch = flags => {
  const names = listOption(flags, 'names')
  if (!names || !names.length || names.some(n => typeof n !== 'string' || !n))
    return usage('branch requires --names <json array of branch names>')
  for (const name of names) {
    const r = git('rev-parse', '--verify', '--quiet', 'refs/heads/' + name)
    if (r.ok) emit({ exists: true, branch: name, head_sha: r.stdout.trim() })
  }
  emit({ exists: false, branch: null, head_sha: null })
}

// The unit versions of a commit against the base branch: an epic does not raise a
// version, the release step does. The base is the published branch (origin/<branch>)
// when the repository has it, else the commit the run started from — a run on the
// default branch merges into it locally, so the local branch is no base. Beside the
// differences it names the carriers neither side can read (unchecked, never equal),
// those in which a start ahead of the published branch already differs from it, and
// whether the start is behind it or diverged (start_behind). Which units the project
// has and where each carries its version is `units` of its .conport.json, read by the
// settings rules, or, while that file names none, the old manifest .conport/units.json
// of the same tree — both as of the start of the run, so a branch under check cannot
// change what it is checked by. `manifest` names the file the units came from: none ->
// units:"none", manifest null and nothing is compared; units that cannot be read (a
// .conport.json that is not a JSON object counts, and is never passed over for the old
// manifest) -> units:"invalid" with manifest_error. Their reading lives in
// unit-versions.mjs, loaded only here: every other command runs without it.
const versions = async flags => {
  const name = typeof flags.branch === 'string' ? flags.branch : null
  const start = typeof flags.start === 'string' ? flags.start : null
  if (!name || !start) return usage('versions requires --branch <name> and --start <sha>')
  const head = typeof flags.head === 'string' ? flags.head : 'HEAD'
  const commit = ref => git('rev-parse', '--verify', '--quiet', ref + '^{commit}')
  const published = commit('refs/remotes/origin/' + name).ok
  for (const ref of [published ? 'origin/' + name : start, start, head])
    if (!commit(ref).ok) return errorOut('versions: ' + ref + ' names no commit')
  // A commit base is named by its short sha: the refusal names the base, and a title
  // carrying the refusal is cut at 200 characters.
  const base = published ? 'origin/' + name : gitOut('rev-parse', '--short', start)
  const tree = ref => ({
    read: path => (git('cat-file', '-e', ref + ':' + path).ok ? git('show', ref + ':' + path).stdout : null),
    list: dir => git('ls-tree', '-r', '--name-only', ref, '--', dir).stdout.split('\n').filter(Boolean),
  })
  const { SETTINGS_PATH, LEGACY_MANIFEST_PATH, parseUnits, parseUnitManifest, unitVersionDrift, unreadableCarriers } =
    await import('./unit-versions.mjs')
  const nothing = { base, head, differs: [], unreadable: [], start_differs: [], start_behind: false }
  const settingsText = tree(start).read(SETTINGS_PATH)
  let manifest = null
  let read = null
  if (settingsText !== null) {
    const { resolveSettings } = await settingsRules()
    const settings = resolveSettings({ shared: settingsText, local: null, env: {} })
    // What the rules say of the file as a whole or of its units; a line of another key
    // leaves the units read.
    const broken = settings.lines.find(line => [' is not valid JSON', ' must hold a JSON object', ': units must be ']
      .some(says => line.startsWith(SETTINGS_PATH + says)))
    if (settings.settings.units) [manifest, read] = [SETTINGS_PATH, parseUnits(settings.settings.units, SETTINGS_PATH)]
    else if (broken) [manifest, read] = [SETTINGS_PATH, { error: broken }]
  }
  if (read === null) {
    const text = tree(start).read(LEGACY_MANIFEST_PATH)
    if (text === null) emit({ units: 'none', manifest: null, ...nothing, equal: true })
    ;[manifest, read] = [LEGACY_MANIFEST_PATH, parseUnitManifest(text)]
  }
  if (read.error) emit({ units: 'invalid', manifest, manifest_error: read.error, ...nothing, equal: false })
  const { units } = read
  const differs = unitVersionDrift(units, tree(base), tree(head))
  const unreadable = unreadableCarriers(units, tree(base), tree(head))
  // The direction of the start against the published branch. Ahead (or equal), a start
  // that already differs from it is a release step not pushed yet: the action there is
  // the push, never a restore. Behind or diverged — a release pushed from another
  // checkout and fetched — there is nothing to push (it would not be a fast-forward):
  // start_behind, and the action is to update the default branch.
  const ahead = !published || git('merge-base', '--is-ancestor', base, start).ok
  const startDiffers = published && ahead ? unitVersionDrift(units, tree(base), tree(start)) : []
  emit({ units: 'manifest', manifest, base, head, equal: differs.length === 0 && unreadable.length === 0, differs, unreadable,
    start_differs: startDiffers, start_behind: !ahead })
}

// The rules of the ConPort project settings (.conport.json, .conport.local.json), shared
// with the plugin's hooks. Loaded only by the commands that read the settings: a helper
// copied without the plugin's scripts still answers every other command.
const settingsRules = async () => (await import('../scripts/project-config.js')).default

// ------------------------------------------------------------------ accounting

// One call against the ConPort tasks API. The key travels in the header only, so
// it never appears in an error message; a body echoed back by the server is
// scrubbed where the report is built. Every call carries its own deadline: an
// unreachable or silent server must degrade to an error the caller can act on,
// never leave a workflow waiting forever.
const conport = (base, key, team) => async (method, path, body) => {
  const headers = { 'X-API-Key': key, Accept: 'application/json' }
  if (team) headers['X-Conport-Team-Id'] = team
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const ms = timeoutMs()
  // A bare abort reads as 'This operation was aborted' and names neither the
  // endpoint nor the deadline, so a timed-out call in failed_calls or in a scout
  // error is indistinguishable from any other. Rethrow it with both.
  let res
  try {
    res = await fetch(base.replace(/\/+$/, '') + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    })
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new Error(`${method} ${path} -> timeout after ${ms}ms`)
    throw e
  }
  const text = await res.text()
  if (!res.ok) {
    // A structured refusal ({detail: {error, message}}) keeps its code and its
    // message on the error, so a step can tell a rule of the task's state from
    // a broken call.
    const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, ERROR_BODY_CHARS)}`)
    err.status = res.status
    try {
      const detail = JSON.parse(text)?.detail
      if (detail && typeof detail.error === 'string') { err.code = detail.error; err.refusal = String(detail.message ?? '') }
    } catch { /* a body that is not JSON carries no code */ }
    throw err
  }
  return text ? JSON.parse(text) : null
}

// A listing read to the end: an idempotency guard that stops at the first page
// would file a duplicate as soon as the project outgrows one page.
const listTasks = async (api, project, query) => {
  const out = []
  for (let page = 0; page < PAGE_CAP; page++) {
    const qs = new URLSearchParams({ ...query, limit: String(PAGE), offset: String(page * PAGE) })
    const r = await api('GET', `/projects/${project}/tasks?${qs}`)
    const batch = (r && r.tasks) || []
    out.push(...batch)
    if (batch.length < PAGE || out.length >= ((r && r.total) ?? out.length)) break
  }
  return out
}

// The progress journal of a project, read once and reused: a run logs at most a
// handful of entries and every one of them is guarded against a duplicate, so
// walking the listing again per item would only repeat the same pages. Both text
// fields are kept — an entry written through the MCP tools may carry the message
// as its title.
const progressJournal = (api, project) => {
  let entries = null
  const textsOf = e => [e.title, e.description].filter(t => typeof t === 'string')
  const load = async () => {
    if (entries) return entries
    const all = []
    for (let page = 0; page < PAGE_CAP; page++) {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) })
      const r = await api('GET', `/projects/${project}/progress?${qs}`)
      const batch = (r && r.entries) || []
      all.push(...batch)
      if (batch.length < PAGE || all.length >= ((r && r.total) ?? all.length)) break
    }
    entries = all
    return entries
  }
  // the first entry one of whose texts matches, or undefined
  const find = async match => (await load()).find(e => textsOf(e).some(match))
  return {
    has: async match => !!(await find(match)),
    find,
    // `extra` carries the link of the entry (linked_item_type, linked_item_id)
    log: async (description, extra = {}) => {
      const created = await api('POST', `/projects/${project}/progress`, { description, ...extra })
      const entry = created && typeof created === 'object' ? created : { description }
      if (entries) entries.push({ description, ...entry })
      return entry
    },
  }
}

// The project of a table or a step: a non-empty string, the handle the scout
// returned. A number — the project id of an earlier release — is refused; the
// server decides whether the string names a project.
const isProjectHandle = v => typeof v === 'string' && v.trim() !== ''

// The state every accounting run shares: the API client, the report's action log
// and the failed-call list. A failed item is recorded and stepped over — the
// remaining items still run. `project` is the project's handle as the scout
// returned it, ready for a path segment.
const accounting = (table, key) => {
  const api = conport(process.env.CONPORT_API_URL || API_BASE, key)
  const project = encodeURIComponent(table.project.trim())
  const actions = []
  const failed_calls = []
  const scrub = text => mask(String(text)).split(key).join('***')
  const act = (step, target, result, detail) =>
    actions.push(typeof target === 'number' ? { step, target, result, detail } : { step, result, detail })
  const failed = (step, target, call, e) => {
    const error = scrub(e && e.message ? e.message : e)
    act(step, target, 'failed', error)
    failed_calls.push({ call, error })
    return error
  }
  return { api, project, actions, failed_calls, act, failed, scrub, taskPath: id => `/projects/${project}/tasks/${id}` }
}

// The three steps both table shapes share, written once. A task run closes one
// task and blocks one; an epic run does the same for every child of its table —
// the mechanics, the guard read and the wording of the actions are identical.

// A refusal by the review rules is the task's state, not a broken call:
// retrying the same close cannot succeed. The step reports the code and
// what happened to the task, plus the server's message when it sent one, and
// stays out of failed_calls; the task is left as it is.
const refused = (c, step, id, e, outcome) => {
  const message = e.refusal ? ' — ' + c.scrub(e.refusal) : ''
  const detail = e.code + ': ' + outcome + message
  c.act(step, id, 'failed', detail)
  return detail
}

// The refusals of the review rules: retrying the same close cannot succeed.
const CLOSE_REFUSALS = new Set(['done_needs_approval', 'done_needs_review', 'done_needs_resolution'])

// Closes one task. Guarded by a read; the resolution is its own field, so the
// server appends its section and the description is never rewritten from here.
// Returns whether the task is DONE once the step is over.
const closeOne = async (c, id, resolution) => {
  try {
    const task = await c.api('GET', c.taskPath(id))
    if (task.status === 'DONE') c.act('close', id, 'skipped_already', 'already DONE')
    else {
      await c.api('PATCH', c.taskPath(id), { status: 'DONE', resolution })
      c.act('close', id, 'done', 'closed with the run resolution')
    }
    return true
  } catch (e) {
    if (e && CLOSE_REFUSALS.has(e.code)) refused(c, 'close', id, e, 'the task is not closed')
    else c.failed('close', id, 'close task-' + id, e)
    return false
  }
}

// Blocks one task, appending the reason: the original description is kept.
// A task in REVIEW leaves it only through a review verdict or a cancellation,
// so the server refuses BLOCKED with review_exit_not_allowed — reported as a
// refusal, not as a failed call.
const blockOne = async (c, id, reason) => {
  try {
    const task = await c.api('GET', c.taskPath(id))
    if (task.status === 'BLOCKED') c.act('block', id, 'skipped_already', 'already BLOCKED')
    else {
      const section = '## Blocked: ' + reason         // appended, the original text is kept
      const original = task.description || ''
      await c.api('PATCH', c.taskPath(id), { status: 'BLOCKED', description: original ? original + '\n\n' + section : section })
      c.act('block', id, 'done', 'blocked with the run reason')
    }
  } catch (e) {
    if (e && e.code === 'review_exit_not_allowed') refused(c, 'block', id, e, 'the task is in REVIEW and stays there')
    else c.failed('block', id, 'block task-' + id, e)
  }
}

// The open epics of the project: where a tails epic is looked up by its exact title.
const openEpics = c => listTasks(c.api, c.project, { kind: 'epic', status: 'TODO,IN_PROGRESS,REVIEW,BLOCKED', include_snoozed: 'true' })

// The oldest (lowest id) of the open epics carrying this title, or null: two runs that
// raced may have left more than one, and every run then settles on the same one.
const oldestTitled = (epics, title) =>
  epics.filter(t => t.title === title).sort((a, b) => a.id - b.id)[0] ?? null

// The open tails epic carrying this title, created when there is none. Returns
// it, or null when the lookup or the creation failed — the caller then files nothing
// under it. A new epic is attached to `milestone_id` when one is given.
// The lookup comes before the creation, so two parallel runs of one milestone can
// both miss the epic and both create one: after creating, the run re-reads the open
// epics of this title in that milestone and keeps the oldest. When that is another
// run's, whatever sits under this run's epic moves there and this run's epic is
// cancelled as its duplicate. Only the run's own epic is ever cancelled.
const ensureTailsEpic = async (c, { step, title, description, priority, milestone_id }) => {
  const inMilestone = Number.isInteger(milestone_id)
  let created
  try {
    const found = oldestTitled((await openEpics(c)).filter(t => (t.milestone_id ?? null) === (milestone_id ?? null)), title)
    if (found) { c.act(step, found.id, 'skipped_already', 'tails epic already open'); return found }
    created = await c.api('POST', `/projects/${c.project}/tasks`,
      { title, description, kind: 'epic', priority, ...(inMilestone ? { milestone_id } : {}) })
    c.act(step, created.id, 'done', 'tails epic created' + (inMilestone ? ' in milestone ' + milestone_id : ''))
  } catch (e) { c.failed(step, null, 'tails epic lookup or create', e); return null }
  return dropDuplicate(c, created, title, inMilestone ? milestone_id : null)
}

// The re-read after creating a tails epic: returns the epic to file under — the oldest
// open one of the title in the milestone. A failed call leaves this run's epic open
// and recorded as failed; the run still files under the oldest it knows.
const dropDuplicate = async (c, created, title, milestone_id) => {
  const step = 'tails_epic_duplicate'
  let kept
  try {
    const same = (await openEpics(c)).filter(t => (t.milestone_id ?? null) === milestone_id)
    kept = oldestTitled(same, title)
  } catch (e) { c.failed(step, created.id, 'tails epic re-read after create', e); return created }
  if (!kept || kept.id >= created.id) return created
  try {
    const kids = await listTasks(c.api, c.project, { parent_task_id: String(created.id), status: 'ALL', include_snoozed: 'true' })
    for (const kid of kids) await c.api('PATCH', c.taskPath(kid.id), { parent_task_id: kept.id })
    await c.api('PATCH', c.taskPath(created.id), { status: 'CANCELLED', resolution: 'duplicate of task-' + kept.id })
    c.act(step, created.id, 'done', 'cancelled as a duplicate of task-' + kept.id +
      (kids.length ? ', its ' + kids.length + ' task(s) moved there' : ''))
  } catch (e) { c.failed(step, created.id, 'cancel the duplicate tails epic task-' + created.id, e) }
  return kept
}

// Match the server prescription: inspect only the next open milestone, and search
// the exact title in that release milestone, or among unassigned epics when it is
// absent or a standing list. Without any release, retain the waiting-question path.
const ensureReleaseTails = async (c, epicId) => {
  const step = 'tails_epic'
  let release = null
  let next = null
  let why = null
  try {
    const epic = await c.api('GET', c.taskPath(epicId))
    if (!Number.isInteger(epic.milestone_id)) why = 'epic task-' + epicId + ' has no milestone'
    else {
      const all = await c.api('GET', `/projects/${c.project}/milestones?include_closed=true`)
      const list = Array.isArray(all) ? all : []
      const own = list.find(m => m.id === epic.milestone_id) ?? null
      if (!own) why = 'milestone ' + epic.milestone_id + ' of epic task-' + epicId + ' is not found'
      else if (own.is_release !== true) why = 'milestone ' + epic.milestone_id + ' of epic task-' + epicId + ' is not a release'
      else {
        release = own
        const after = list.filter(m => m.sequence > own.sequence && m.status === 'OPEN')
          .sort((a, b) => a.sequence - b.sequence)[0] ?? null
        next = after?.is_release === true ? after : null
      }
    }
  } catch (e) { c.failed(step, epicId, 'the milestone of epic ' + epicId, e); return { epic: null, needs_milestone: false } }
  if (why) {
    c.act(step, null, 'failed', 'not filed: ' + why + ASKED_WHERE_TAILS_GO)
    return { epic: null, needs_milestone: true }
  }
  const epic = await ensureTailsEpic(c, { step, title: RELEASE_TAILS_TITLE(release.title),
    description: RELEASE_TAILS_DESCRIPTION, priority: RELEASE_TAILS_PRIORITY, milestone_id: next?.id })
  return { epic, needs_milestone: !!epic && !Number.isInteger(epic.milestone_id) }
}

// The part of a task run's close resolution naming its review minors, as the table
// writes it; the accountant names where the umbrella actually went before the close.
const MINORS_PART = /; (\d+) review minor\(s\) left open, for one follow-up task/
const minorsOutcome = (resolution, filing) => typeof resolution !== 'string' ? resolution
  : resolution.replace(MINORS_PART, (_, n) => '; ' + n + ' review minor(s) left open, ' + filing)

// Executes the accounting table of a task run: the minors umbrella, then the close —
// its resolution naming where the umbrella went — and the block. Every item is guarded
// by a read first, so a rerun of the same table changes nothing.
const accountTask = async (table, c) => {
  const out = { via: VIA, actions: c.actions, minors_created: [], task_closed: false,
    tails_epic_id: null, tails_epic_needs_milestone: false, tails_waiting_progress_id: null, failed_calls: c.failed_calls }

  const filing = table.minors_umbrella ? await accountUmbrella(table.minors_umbrella, c, out) : null

  if (table.close) out.task_closed = await closeOne(c, table.close.id,
    filing ? minorsOutcome(table.close.resolution, filing) : table.close.resolution)

  if (table.block) await blockOne(c, table.block.id, table.block.reason)
  return out
}

// The umbrella is ordinary work. A task of an epic files it under that epic while the
// epic's ceiling of work added after the plan has room; beyond it, it goes to the tails
// epic of the epic's release. With no tails epic to file — the release rule of
// ensureReleaseTails — it waits in one progress entry for the owner's answer on its
// milestone. A task with no epic always waits so: only an epic carries a milestone, so
// the task has no release to find a tails epic by. Returns the words naming where it
// went: 'filed' only for an umbrella filed or found filed.
const accountUmbrella = async (umbrella, c, out) => {
  const { parent, task, title, description } = umbrella
  const own = Number.isInteger(parent)
  if (own) {
    try {
      const id = await fileUmbrella(c, out, umbrella, parent, 'under epic task-' + parent, true)
      return id === null ? 'not filed: a call failed' : 'filed as task-' + id + ' under epic task-' + parent
    } catch (e) {
      // Only the server decides whether ordinary work fits in this epic.
      if (e.status !== 409 || e.code !== 'epic_growth_ceiling') throw e
    }
  }
  if (!own && !Number.isInteger(task)) {
    c.act('minors_child', null, 'failed', 'no epic and no task to record the waiting tails by')
    return 'not filed: no task to record the waiting tails by'
  }
  const found = own ? await ensureReleaseTails(c, parent) : noReleaseOf(c, task)
  out.tails_epic_id = found.epic ? found.epic.id : null
  out.tails_epic_needs_milestone = found.needs_milestone
  if (out.tails_epic_id !== null) {
    const id = await fileUmbrella(c, out, umbrella, out.tails_epic_id, 'under the tails epic of the release')
    return id === null ? 'not filed: a call failed' : 'filed as task-' + id + ' in the tails epic task-' + out.tails_epic_id
  }
  if (!found.needs_milestone) {
    c.act('minors_child', null, 'failed', 'no tails epic to attach the umbrella to')
    return 'not filed: the tails epic could not be found or made'
  }
  // asked where the tails go: the umbrella waits for the answer in one progress entry
  // linked to the epic (the task without one) — a rerun finds it by its mark and title
  const prefix = `[task-run:${task}]`
  const journal = progressJournal(c.api, c.project)
  try {
    const have = await journal.find(t => t.startsWith(prefix + TAILS_WAITING_MARK) && t.includes(title))
    if (have) {
      out.tails_waiting_progress_id = have.id ?? null
      c.act('tails_waiting', have.id, 'skipped_already', 'the waiting tails are already recorded')
    } else {
      const entry = await journal.log(tailsWaitingText(prefix, [{ title, priority: UMBRELLA_PRIORITY, description }]),
        { linked_item_type: 'task', linked_item_id: own ? parent : task })
      out.tails_waiting_progress_id = entry.id ?? null
      c.act('tails_waiting', entry.id, 'done', 'the tails waiting for a milestone are recorded')
    }
  } catch (e) {
    c.failed('tails_waiting', null, 'record the tails waiting for a milestone', e)
    return 'not filed: the owner is asked which milestone the tails go to'
  }
  return "waiting for the owner's answer on their milestone, recorded in progress-" + out.tails_waiting_progress_id
}
const UMBRELLA_PRIORITY = 4

// A task with no epic: no release milestone, so no tails epic is looked up or made, and
// the person is asked which milestone the tails go to.
const noReleaseOf = (c, task) => {
  c.act('tails_epic', null, 'failed', 'not filed: task-' + task + ' has no epic, so no release milestone' + ASKED_WHERE_TAILS_GO)
  return { epic: null, needs_milestone: true }
}

// Files the umbrella as a child of `epic` once: a child of the same title is skipped.
// Returns its id, or null when a call failed.
const fileUmbrella = async (c, out, { title, description }, epic, where, routeCeiling = false) => {
  try {
    const kids = await listTasks(c.api, c.project, { parent_task_id: String(epic), status: 'ALL', include_snoozed: 'true' })
    const same = kids.find(t => t.title === title)
    if (same) { c.act('minors_child', same.id, 'skipped_already', 'umbrella already filed'); return same.id }
    const created = await c.api('POST', `/projects/${c.project}/tasks`, { title, description, kind: 'task', priority: UMBRELLA_PRIORITY, parent_task_id: epic })
    out.minors_created.push(created.id)
    c.act('minors_child', created.id, 'done', 'umbrella filed ' + where)
    return created.id
  } catch (e) {
    if (routeCeiling && e.status === 409 && e.code === 'epic_growth_ceiling') throw e
    c.failed('minors_child', null, 'minors umbrella under epic ' + epic, e); return null
  }
}

// Executes the accounting table of an epic run, step by step in the order of the
// accountant: the children's outcomes, the parity note, the tails epic with its
// entries, the run summary, and last the epic itself — closed only when the table
// says it may be. Nothing beyond the table is created, and each item is guarded
// by a read, so a rerun changes nothing.
const accountEpic = async (table, c) => {
  const { api, project, act, failed, taskPath } = c
  const epicId = table.epic
  const prefix = `[epic-run:${epicId}]`
  const journal = progressJournal(api, project)
  const out = {
    via: VIA, actions: c.actions, tails_epic_id: null, tails_epic_needs_milestone: false, tails_waiting_progress_id: null,
    tails_children: [], epic_children: [], epic_progress: null,
    epic_closed: false, epic_close_error: null, failed_calls: c.failed_calls,
  }

  for (const { id, resolution } of table.done ?? []) await closeOne(c, id, resolution)

  for (const { id, reason } of table.failed ?? []) await blockOne(c, id, reason)

  for (const { id, dep } of table.skipped ?? []) {
    try {
      const task = await api('GET', taskPath(id))
      const original = task.description || ''
      if (/^##\s+Skipped\b/m.test(original)) act('skipped', id, 'skipped_already', 'already marked skipped')
      else {
        // The status stays as it is: the task waits for the next run.
        const section = '## Skipped: dependency task-' + dep + ' failed'
        await api('PATCH', taskPath(id), { description: original ? original + '\n\n' + section : section })
        act('skipped', id, 'done', 'marked as waiting for a failed dependency')
      }
    } catch (e) { failed('skipped', id, 'mark task-' + id + ' skipped', e) }
  }

  for (const row of table.parity_failed ?? []) {
    const title = row.title
    const message = `${prefix} plan task without a child: ${title} — ${NO_CHILD_OUTCOME}`
    try {
      // The guard is this run's prefix plus this title, not the whole message:
      // it identifies the entry by what it is about, so a reworded message around
      // the same title is still recognised as already logged.
      if (await journal.has(t => t.startsWith(prefix) && t.includes(title)))
        act('parity_progress', null, 'skipped_already', 'already logged for this run')
      else {
        await journal.log(message)
        act('parity_progress', null, 'done', 'logged a plan task without a child')
      }
    } catch (e) { failed('parity_progress', null, 'log the parity gap of "' + title + '"', e) }
  }

  // An entry naming a parent is a child of that epic — a finding of the run's own
  // epic, one child per finding. An entry naming none is ordinary work beyond the
  // epic's ceiling of added work: it goes to the tails epic of the release, taken into
  // work first after the push. A defect always names its epic.
  const all = table.minors ?? []
  const minors = all.filter(e => !Number.isInteger(e.parent))
  for (const entry of all.filter(e => Number.isInteger(e.parent))) {
    try {
      const kids = await listTasks(api, project, { parent_task_id: String(entry.parent), status: 'ALL', include_snoozed: 'true' })
      // Only an open child is this finding filed before: a closed one of the same
      // title is another task the run finished — a plan task, say.
      const same = kids.find(t => t.title === entry.title && !['DONE', 'CANCELLED'].includes(String(t.status).toUpperCase()))
      if (same) { act('finding_child', same.id, 'skipped_already', 'entry already filed'); continue }
      const created = await api('POST', `/projects/${project}/tasks`,
        { title: entry.title, description: entry.description, kind: entry.kind ?? 'task', priority: entry.priority, parent_task_id: entry.parent })
      out.epic_children.push(created.id)
      act('finding_child', created.id, 'done', 'entry filed under epic task-' + entry.parent)
    } catch (e) {
      if (e.status === 409 && e.code === 'epic_growth_ceiling') minors.push(entry)
      else failed('finding_child', null, 'finding entry "' + entry.title + '"', e)
    }
  }
  if (minors.length) {
    const found = await ensureReleaseTails(c, epicId)
    const tails = found.epic ? found.epic.id : null
    out.tails_epic_id = tails
    out.tails_epic_needs_milestone = found.needs_milestone

    // asked where the tails go: the entries wait for the answer in one progress entry
    // linked to the epic — once per run, a rerun finds it by its mark and its titles
    if (tails === null && found.needs_milestone) {
      const mark = prefix + TAILS_WAITING_MARK
      try {
        const have = await journal.find(t => t.startsWith(mark) && minors.every(e => t.includes(e.title)))
        if (have) {
          out.tails_waiting_progress_id = have.id ?? null
          act('tails_waiting', have.id, 'skipped_already', 'the waiting tails are already recorded')
        } else {
          const entry = await journal.log(tailsWaitingText(prefix, minors), { linked_item_type: 'task', linked_item_id: epicId })
          out.tails_waiting_progress_id = entry.id ?? null
          act('tails_waiting', entry.id, 'done', 'the tails waiting for a milestone are recorded')
        }
      } catch (e) { failed('tails_waiting', null, 'record the tails waiting for a milestone', e) }
    } else if (tails === null) act('tails_child', null, 'failed', 'no tails epic to attach the entries to')
    else {
      let kids = null
      try {
        kids = await listTasks(api, project, { parent_task_id: String(tails), status: 'ALL', include_snoozed: 'true' })
      } catch (e) { failed('tails_child', null, 'children of tails epic ' + tails, e) }
      for (const entry of (kids ? minors : [])) {
        try {
          const same = kids.find(t => t.title === entry.title)
          if (same) { act('tails_child', same.id, 'skipped_already', 'entry already filed'); continue }
          const created = await api('POST', `/projects/${project}/tasks`,
            { title: entry.title, description: entry.description, kind: entry.kind ?? 'task', priority: entry.priority, parent_task_id: tails })
          kids.push(created)                    // two entries of one table sharing a title are filed once
          out.tails_children.push(created.id)
          act('tails_child', created.id, 'done', 'entry filed under the tails epic')
        } catch (e) { failed('tails_child', null, 'tails entry "' + entry.title + '"', e) }
      }
    }
  }

  // the resolution names where the ordinary work for the tails epic went
  const filed = c.actions.filter(a => a.step === 'tails_child' && (a.result === 'done' || a.result === 'skipped_already')).length
  const resolution = minors.length ? tailsOutcome(table.close_resolution, out, filed, minors.length) : table.close_resolution
  {
    // Logged for every epic run, as the accountant prompt does it: the summary is
    // the run's trace in the journal and does not depend on the epic being closable.
    const summary = `${prefix} result: ${resolution ?? ''}`
    try {
      // One summary per epic run: the resolution text may be reworded between two
      // runs, the prefix and the 'result:' marker identify it.
      if (await journal.has(t => t.startsWith(prefix + ' result: ')))
        act('run_summary', null, 'skipped_already', 'the run summary is already logged')
      else {
        await journal.log(summary)
        act('run_summary', null, 'done', 'run summary logged')
      }
    } catch (e) { failed('run_summary', null, 'log the run summary', e) }
  }

  if (table.may_close === true) {
    try {
      const epic = await api('GET', taskPath(epicId))
      if (epic.status === 'DONE') {
        out.epic_closed = true
        act('epic_close', epicId, 'skipped_already', 'already DONE')
      } else {
        const kids = await listTasks(api, project, { parent_task_id: String(epicId), status: 'ALL', include_snoozed: 'true' })
        const open = kids.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED')
        out.epic_progress = { open: open.length, closed: kids.length - open.length }
        if (open.length) {
          // Not worked around: the open children are reported as they are.
          out.epic_close_error = 'open children: ' + open.map(t => t.id).join(', ')
          act('epic_close', epicId, 'failed', out.epic_close_error)
        } else {
          await api('PATCH', taskPath(epicId), { status: 'DONE', resolution })
          out.epic_closed = true
          act('epic_close', epicId, 'done', 'epic closed with the run resolution')
        }
      }
    } catch (e) {
      // A row that went through the review cycle as a task closes only through
      // it, epic or not: the same refusals as a task close, reported the same way.
      out.epic_close_error = e && CLOSE_REFUSALS.has(e.code)
        ? refused(c, 'epic_close', epicId, e, 'the epic is not closed')
        : failed('epic_close', epicId, 'close epic ' + epicId, e)
    }
  }
  return out
}

// Reads the table, decides which of the two shapes it is and executes it. A table
// whose keys fit neither shape is refused whole: half of an accounting run is
// worse than none, and the caller does the whole of it instead.
const account = async flags => {
  const path = typeof flags.table === 'string' ? flags.table : null
  if (!path) return usage('account requires --table <path.json>')
  const table = readJsonFile(path, '--table')
  if (!table || typeof table !== 'object' || Array.isArray(table)) return usage('--table must hold a JSON object')

  // Both sentinels tell the caller to execute the table itself instead.
  const key = apiKey()
  if (!key) sentinel('no api key')
  const keys = Object.keys(table)
  const fits = known => keys.every(k => known.has(k))
  if (!fits(TASK_TABLE_KEYS) && !fits(EPIC_TABLE_KEYS)) sentinel('unsupported table')
  if (!isProjectHandle(table.project)) return usage("--table: project must be the project's handle")

  const c = accounting(table, key)
  emit(fits(TASK_TABLE_KEYS) ? await accountTask(table, c) : await accountEpic(table, c))
}

// --------------------------------------------------------------- review cycle

// One step of a task's review cycle, as a run decides it: the journal entry the
// step is about and the status change that goes with it.
//   brief  — the assignment, signed by the orchestrator; no status change;
//   report — a TODO or BLOCKED task is started first, then the report, then REVIEW;
//   fix    — the fix report, then REVIEW;
//   review — the verdict, then, for changes_requested, the return to IN_PROGRESS
//            (the server opens the next round).
// The step stops at the first write that does not land: what follows it would
// only be refused in turn.
const CYCLE_STEPS = new Set(['brief', 'report', 'fix', 'review'])

// The refusals a cycle write can meet. Each is the task's state, not a broken
// call — retrying the same write cannot succeed — so it is reported like a
// refused close and stays out of failed_calls.
const CYCLE_REFUSALS = new Set([
  'review_needs_report', 'return_needs_review', 'reviewer_is_author', 'review_exit_not_allowed',
  'review_from_in_progress_only', 'journal_kind_not_allowed', 'journal_task_closed',
])

// A body within the server's limit. Characters are counted as the server counts
// them, never split in two; a cut body says so at its end.
export const fitBody = text => {
  const chars = Array.from(String(text))
  if (chars.length <= JOURNAL_BODY_MAX) return chars.join('')
  const marker = `\n\n[truncated by the workflow helper: the full text had ${chars.length} characters]`
  return chars.slice(0, JOURNAL_BODY_MAX - Array.from(marker).length).join('') + marker
}

const texts = v => (Array.isArray(v) ? v.map(String) : [])
const section = (title, items) => (items.length ? ['', title, ...items.map(i => '- ' + i)] : [])
const findingLine = f => {
  const at = String(f.file ?? '') + (f.line ? ':' + f.line : '')
  const extra = [['spec', f.specRef], ['scenario', f.scenario], ['fix', f.fix]]
    .filter(([, v]) => v).map(([k, v]) => ` ${k}: ${v}.`).join('')
  return `[${f.severity}] ${at} — ${f.what}.${extra}`
}

// A full text the caller wrote itself, or null.
const fullText = s => (typeof s.body === 'string' && s.body.trim() ? s.body : null)

// The text of an entry. The brief arrives written, and so may a report, a fix or
// a review: a full text in `body` is the entry as it stands. Without one the
// report, the fix and the review are written here from the agents' structured
// results, the same way for both workflows.
export const journalBody = s => {
  const r = s.result ?? {}
  if (s.step === 'brief' || fullText(s) !== null) return String(s.body)
  if (s.step === 'report') return [
    'Implementer report: ' + r.status,
    `Branch: ${r.branch} at ${r.head_sha}`,
    ...(texts(r.files_changed).length ? ['Files changed: ' + texts(r.files_changed).join(', ')] : []),
    // A spec edit never enters the diff: the reviewer reads these blocks itself.
    ...(texts(r.spec_blocks).length ? ['Spec blocks changed: ' + texts(r.spec_blocks).join(', ')] : []),
    ...(r.checks_summary ? ['Checks: ' + r.checks_summary] : []),
    ...section('Concerns:', texts(r.concerns)),
    ...section('Questions:', texts(r.questions)),
  ].join('\n')
  if (s.step === 'fix') return [
    'Fix report: ' + r.status,
    'Head: ' + r.head_sha,
    ...section('Per finding:', (Array.isArray(r.per_finding) ? r.per_finding : [])
      .map(p => `#${p.idx} ${p.action}` + (p.note ? ' — ' + p.note : ''))),
    ...(r.checks_summary ? ['', 'Checks: ' + r.checks_summary] : []),
  ].join('\n')
  const findings = Array.isArray(r.findings) ? r.findings : []
  return [
    ...(s.note ? [String(s.note)] : []),
    `Verdict: ${s.verdict} (the reviewer answered ${r.verdict})`,
    ...(findings.length ? section(`Findings (${findings.length}):`, findings.map(findingLine)) : ['Findings: none']),
    // The ruling on each concern the implementer finished with stays on record.
    ...section('Concern rulings:', (Array.isArray(r.concern_rulings) ? r.concern_rulings : []).map(c => `#${c.idx} ${c.ruling}`
      + (c.ruling === 'FINDING' && Number.isInteger(c.finding_idx) ? ` (finding #${c.finding_idx})` : '')
      + (c.reason ? ' — ' + c.reason : ''))),
    ...section('Unverifiable:', texts(r.unverifiable)),
  ].join('\n')
}

// What is wrong with a step file, or null when it is a step this command runs.
const stepProblem = s => {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'the step must be a JSON object'
  if (!isProjectHandle(s.project)) return "project must be the project's handle"
  if (!Number.isInteger(s.task_id)) return 'task_id must be an integer'
  if (!CYCLE_STEPS.has(s.step)) return 'step must be one of ' + [...CYCLE_STEPS].join(', ')
  if (s.step === 'brief') return fullText(s) !== null ? null : 'a brief needs a non-empty body'
  if (s.body !== undefined && fullText(s) === null) return `a ${s.step} body must be a non-empty text`
  if (fullText(s) === null && (!s.result || typeof s.result !== 'object' || Array.isArray(s.result)))
    return `a ${s.step} needs the agent's result object or a full text in body`
  if (s.step === 'review' && !JOURNAL_VERDICTS.has(s.verdict)) return 'a review needs verdict approve or changes_requested'
  return null
}

// A write of a step that did not land: a refusal of the cycle is reported as
// the task's state, anything else as a failed call.
const cycleFailure = (c, id, action, call, e, outcome) => {
  if (e && CYCLE_REFUSALS.has(e.code)) refused(c, action, id, e, outcome)
  else c.failed(action, id, call, e)
  return false
}

// One write of a step. Returns whether it landed.
const cycleWrite = async (c, id, action, call, write, done, outcome) => {
  try {
    await write()
    c.act(action, id, 'done', done)
    return true
  } catch (e) {
    return cycleFailure(c, id, action, call, e, outcome)
  }
}

const runCycle = async (c, s) => {
  const id = s.task_id
  // The answer of the entry. A server whose entry moves its task says so in
  // `status` (null when it moved nothing) and puts a refused move under
  // `move_refused`; an answer without `status` comes from a server whose entry
  // moves nothing, and the step moves the task itself.
  let written = null
  const entry = (kind, verdict) => cycleWrite(c, id, kind, `${kind} entry on task-${id}`,
    async () => {
      written = await c.api('POST', c.taskPath(id) + '/journal', {
        kind, author: JOURNAL_AUTHORS[kind], body: fitBody(journalBody(s)), ...(verdict ? { verdict } : {}),
      })
    },
    `${kind} entry written as ${JOURNAL_AUTHORS[kind]}`, 'the entry is not written')
  const move = (action, status) => cycleWrite(c, id, action, `move task-${id} to ${status}`,
    () => c.api('PATCH', c.taskPath(id), { status }), 'moved to ' + status, 'the task keeps its status')
  // The move that follows a written entry: reported from the entry's answer
  // when the server made it or refused it, sent as a status change otherwise —
  // an answer without `status`, or one naming another status and no refusal.
  const after = (action, status) => {
    if (!written || typeof written !== 'object' || !('status' in written)) return move(action, status)
    const r = written.move_refused
    if (!r && written.status !== status) return move(action, status)
    if (!r) { c.act(action, id, 'done', 'moved to ' + status); return true }
    const e = Object.assign(
      new Error(`POST ${c.taskPath(id)}/journal -> the move to ${status} refused: ${r.error} ${r.message ?? ''}`.trim()),
      { code: r.error, refusal: String(r.message ?? '') })
    return cycleFailure(c, id, action, `move task-${id} to ${status}`, e, 'the task keeps its status')
  }

  if (s.step === 'brief') return entry('brief')
  if (s.step === 'review') return (await entry('review', s.verdict)) && s.verdict === 'changes_requested' && after('return', 'IN_PROGRESS')
  if (s.step === 'report') {
    // Read first: a closed task is never reopened by a report, and a task in
    // REVIEW is never returned by one — those are refused at the entry instead.
    let task
    try { task = await c.api('GET', c.taskPath(id)) } catch (e) { c.failed('start', id, 'read task-' + id, e); return false }
    if ((task.status === 'TODO' || task.status === 'BLOCKED') && !(await move('start', 'IN_PROGRESS'))) return false
  }
  return (await entry(s.step)) && after('to_review', 'REVIEW')
}

// Writes one step of the review cycle over the REST API. No key -> the sentinel:
// the run goes on without a journal, as it did before the review cycle existed.
const cycle = async flags => {
  const path = typeof flags.step === 'string' ? flags.step : null
  if (!path) return usage('cycle requires --step <path.json>')
  const s = readJsonFile(path, '--step')
  const problem = stepProblem(s)
  if (problem) return usage('cycle: ' + problem)

  const key = apiKey()
  if (!key) sentinel('no api key')
  const c = accounting({ project: s.project }, key)
  await runCycle(c, s)
  emit({ via: VIA, task: s.task_id, step: s.step, actions: c.actions, failed_calls: c.failed_calls })
}

// --------------------------------------------------------------------- scout

// Markdown lines tagged with whether they sit inside a fenced code block: a plan
// quotes source, and quoted '### Task' or '## Global Constraints' lines are text,
// not section boundaries.
const scanFences = lines => {
  let fence = null
  return lines.map(text => {
    const m = /^\s*(`{3,}|~{3,})/.exec(text)
    if (m && fence === null) { fence = m[1][0]; return { text, code: true } }
    if (m && m[1][0] === fence) { fence = null; return { text, code: true } }
    return { text, code: fence !== null }
  })
}

const headingsAt = (marked, re) => marked.reduce((acc, l, i) => (!l.code && re.test(l.text) ? [...acc, i] : acc), [])
// A trailing newline yields one empty element; it is not a line of the document.
const lineCount = lines => (lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length)

// The '### Task N:' section carrying the task's anchor, as 1-based line numbers:
// from = the heading itself, to = the line before the next '### ' heading, or the
// last line of the file.
const planSection = (text, taskId) => {
  const lines = text.split('\n')
  const marked = scanFences(lines)
  const anchor = marked.findIndex(l => !l.code && anchorRe('task', taskId).test(l.text))
  if (anchor < 0) return null
  const heads = headingsAt(marked, /^###\s/)
  const from = heads.filter(h => h <= anchor).pop()
  if (from === undefined) return null
  const next = heads.find(h => h > anchor)
  return { from: from + 1, to: next === undefined ? lineCount(lines) : next }
}

// The paths of the section's '**Files:**' block: the Create / Modify / Test
// bullets under it, backticked path first, bare token as a fallback.
const planFiles = sectionText => {
  const lines = sectionText.split('\n')
  const start = lines.findIndex(l => /^\s*\*\*Files:\*\*/.test(l))
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\s*[-*]\s*(?:\*\*)?(?:Create|Modify|Test)(?:\*\*)?\s*:\s*(.+)$/i.exec(lines[i])
    if (!m) { if (lines[i].trim() === '' && !out.length) continue; break }
    const quoted = [...m[1].matchAll(/`([^`]+)`/g)].map(q => q[1].trim())
    if (quoted.length) out.push(...quoted)
    else {
      const bare = m[1].split(/[\s,;]+/).find(w => w.includes('/') || w.includes('.'))
      if (bare) out.push(bare)
    }
  }
  return out
}

// The '## Global Constraints' body, verbatim, heading excluded. The block ends at
// the next heading; a thematic break ('---') parking between the two belongs to
// neither, so trailing rules and blanks are dropped.
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const globalConstraints = text => {
  const marked = scanFences(text.split('\n'))
  const start = headingsAt(marked, /^##\s+Global Constraints\s*$/i)[0]
  if (start === undefined) return ''
  const end = headingsAt(marked, /^#{1,3}\s/).find(h => h > start) ?? marked.length
  const body = marked.slice(start + 1, end).map(l => l.text)
  while (body.length && (body[body.length - 1].trim() === '' || RULE.test(body[body.length - 1]))) body.pop()
  return body.join('\n').trim()
}

// The object of a '{...}' literal, from the first brace to its match. Quoted
// braces do not count, so a command carrying one cannot cut the literal short.
const bracedObject = text => {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let quote = null
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

// Plans write the gate object as prose, so both a strict JSON object and a JS-ish
// one (single quotes, bare keys) have to parse.
const GATE_MARKER = /(?:Gate object|Гейт-объект для воркфлоу)\s*:/i
// Single quotes into double ones, bare keys quoted: only ever applied to a literal
// strict JSON has already rejected, because a command may legitimately carry an
// apostrophe ("-k 'not slow'") that this rewrite would tear a valid string apart on.
const relaxToJson = raw => raw
  .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, s) => JSON.stringify(s.replace(/\\'/g, "'")))
  .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
export const extractGate = text => {
  const marker = GATE_MARKER.exec(text)
  if (!marker) return null
  const raw = bracedObject(text.slice(marker.index + marker[0].length))
  if (!raw) return null
  let gate
  try { gate = JSON.parse(raw) } catch {
    try { gate = JSON.parse(relaxToJson(raw)) } catch { return null }
  }
  if (!gate || typeof gate.dir !== 'string' || !Array.isArray(gate.commands)) return null
  if (!gate.commands.length || gate.commands.some(c => typeof c !== 'string')) return null
  return { dir: gate.dir, commands: gate.commands }
}

// '## Acceptance' section, else an 'Acceptance:' line. Neither present means an
// empty string: the acceptance criterion is never invented here. Tasks in this
// repository are written in Russian as often as in English, so «Приёмка» is the
// same marker — reading only the English one dropped the criterion silently.
const ACCEPTANCE_MARKER = '(?:Acceptance|Приёмка)'
const extractAcceptance = description => {
  const lines = (description ?? '').split('\n')
  // A letter class, not \b: \b knows only ASCII word characters, so it would
  // refuse the Cyrillic marker at the end of a heading line.
  const head = lines.findIndex(l => new RegExp(`^#{2,6}\\s*${ACCEPTANCE_MARKER}(?![\\p{L}\\p{N}_])`, 'iu').test(l))
  if (head >= 0) {
    const end = lines.findIndex((l, i) => i > head && /^#{1,6}\s/.test(l))
    return lines.slice(head + 1, end < 0 ? lines.length : end).join('\n').trim()
  }
  const inline = new RegExp(`^[ \\t]*(?:[-*]\\s*)?(?:\\*\\*)?${ACCEPTANCE_MARKER}(?:\\*\\*)?\\s*:[ \\t]*(.+)$`, 'im')
    .exec(description ?? '')
  return inline ? inline[1].trim() : ''
}

const anchorRe = (kind, id) => new RegExp(`<!--\\s*conport-${kind}:\\s*${id}\\s*-->`)
const docRef = text => { const m = /\bdoc-(\d+)\b/.exec(text ?? ''); return m ? Number(m[1]) : null }
// Everything above the first '### ' heading: where a plan names its spec.
const planHeader = text => {
  const marked = scanFences(text.split('\n'))
  const first = headingsAt(marked, /^###\s/)[0]
  return marked.slice(0, first === undefined ? marked.length : first).map(l => l.text).join('\n')
}

// The plan file of this id: the one carrying its task anchor, else — for an epic
// id — the one carrying its epic anchor, which still yields the constraints and
// the gate. Newest by file name wins.
const findPlan = (root, id) => {
  const dir = join(root, ...PLANS_DIR)
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  for (const kind of ['task', 'epic']) {
    const re = anchorRe(kind, id)
    for (let i = files.length - 1; i >= 0; i--) {
      const path = join(dir, files[i])
      if (re.test(readFileSync(path, 'utf8'))) return path
    }
  }
  return null
}

// Every link an item is the source or the target of, all pages. The pages are
// walked by link number — `after=0` first, then the `next_after` of the last
// page until it is null — so while links are written or deleted (the service
// writes automatic ones) every link that was there at the first page and still
// is comes back exactly once. A walk by offset from the newest link repeats
// some links and hides others.
export const linksOf = async (api, projectSegment, type, id) => {
  const read = paging => api('GET', `/projects/${projectSegment}/links?${new URLSearchParams({
    item_type: type, item_id: String(id), limit: '500', ...paging,
  })}`)
  const out = []
  let page = await read({ after: '0' })
  out.push(...page.links)
  // A server before `after` ignores it and answers no `next_after` at all (a
  // server with it answers the key on every page, null on the last): read the
  // rest from it by offset, as before.
  if (!('next_after' in page)) {
    while (page.links.length && out.length < page.total) {
      page = await read({ offset: String(out.length) })
      out.push(...page.links)
    }
    return out
  }
  while (page.next_after != null) {
    page = await read({ after: String(page.next_after) })
    out.push(...page.links)
  }
  return out
}

// The first of these documents, by id, whose type is `type`; null when none is.
// A document that no longer exists is no candidate.
const firstDocOfType = async (api, projectSegment, ids, type) => {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    let doc
    try { doc = await api('GET', `/projects/${projectSegment}/documents/${id}?raw=true`) } catch (e) {
      if (e && e.status === 404) continue
      throw e
    }
    if (doc && doc.doc_type === type) return id
  }
  return null
}

// The spec of a task through the graph: the plan document linked to the task
// with clarifies, then the spec that plan is derived_from. Null when either
// link is missing; the description is never read for it.
const specThroughPlan = async (api, projectSegment, taskId) => {
  const toTask = await linksOf(api, projectSegment, 'task', taskId)
  const plan = await firstDocOfType(api, projectSegment, toTask
    .filter(l => l.link_type === 'clarifies' && l.source_type === 'doc' && l.target_type === 'task' && l.target_id === taskId)
    .map(l => l.source_id), 'plan')
  if (plan === null) return null
  const fromPlan = await linksOf(api, projectSegment, 'doc', plan)
  return firstDocOfType(api, projectSegment, fromPlan
    .filter(l => l.link_type === 'derived_from' && l.source_type === 'doc' && l.source_id === plan && l.target_type === 'doc')
    .map(l => l.target_id), 'spec')
}

// A project as the caller holds it: its handle, a bare name or `team/project`.
// The team does not fit the path segment, so it is split off here and sent as a
// header. An empty part or a second "/" is not a name — null, as with no name.
export const projectAddress = name => {
  const parts = String(name || '').trim().split('/')
  if (parts.length > 2 || parts.some(part => !part)) return null
  return parts.length === 1 ? { team: null, project: parts[0] } : { team: parts[0], project: parts[1] }
}

// The lines of the settings rules that name no project (the spec's line texts): a
// failing git, a settings file that cannot be read, is not JSON or not an object, and
// a wrong project_name. Every other line leaves the project to the files or the variable.
const BROKEN_SETTINGS = [/^git failed \(/, / cannot be read \(/, / is not valid JSON \(/, / must hold a JSON object/, /: project_name must be /]
const breaksSettings = line => BROKEN_SETTINGS.some(re => re.test(line))
const NO_PROJECT_LINE = 'no ConPort project: set project_name in .conport.json'

// The mechanical half of the scout: the task from ConPort, its plan slice, the
// constraints, the gate and the spec reference. Nothing here is a judgement —
// compressing and digesting is left to the caller.
const scout = async flags => {
  const taskId = Number(flags.task)
  if (!Number.isInteger(taskId)) return usage('scout requires --task <id>')

  const key = apiKey()
  if (!key) sentinel('no api key')
  const root = typeof flags['repo-root'] === 'string' ? flags['repo-root'] : process.cwd()
  // --project wins; without it the name comes from the settings of the repository
  // root: project_name of .conport.json (.conport.local.json over it), else
  // CONPORT_PROJECT_NAME — a settings file that exists but names no project names none.
  let name = typeof flags.project === 'string' ? flags.project : null
  let lines = []
  if (name === null) {
    try {
      const settings = (await settingsRules()).loadSettings({ cwd: root, env: process.env, home: homedir() })
      ;[name, lines] = [settings.project, settings.lines]
    } catch (e) { errorOut(e && e.message ? e.message : String(e)) }
  }
  const project = projectAddress(name)
  // A broken settings file or a failing git names no project, and nothing else may
  // name one in its place: the answer carries the lines of the rules, and the run
  // refuses by them instead of resolving the project another way. Lines that break
  // nothing (a wrong key other than project_name, an API key, the user env file) do
  // not say why there is no project, so the line that does closes them.
  if (!project && lines.length)
    emit({ error: 'no project', lines: lines.some(breaksSettings) ? lines : [...lines, NO_PROJECT_LINE] })
  if (!project) sentinel('no project')

  const api = conport(process.env.CONPORT_API_URL || API_BASE, key, project.team)
  const scrub = text => mask(String(text)).split(key).join('***')
  // The address becomes the project's handle once; every later path carries the
  // handle. A project answered without one leaves nothing to address the task by.
  let handle
  let task
  let linkedSpec
  try {
    handle = (await api('GET', '/projects/' + encodeURIComponent(project.project))).handle
    if (typeof handle !== 'string' || !handle) throw new Error('the server answered no project handle')
    task = await api('GET', `/projects/${encodeURIComponent(handle)}/tasks/${taskId}`)
    linkedSpec = await specThroughPlan(api, encodeURIComponent(handle), taskId)
  } catch (e) { errorOut(scrub(e && e.message ? e.message : e)) }

  const given = typeof flags.plan === 'string' ? flags.plan : null
  const planPath = given && !existsSync(given) ? join(root, given) : (given ?? findPlan(root, taskId))
  const text = planPath && existsSync(planPath) ? readFileSync(planPath, 'utf8') : null

  const section = text ? planSection(text, taskId) : null
  const gc = text ? globalConstraints(text) : ''
  emit({
    via: VIA,
    project: handle,
    task: {
      id: task.id, kind: task.kind, status: task.status, title: task.title,
      description: task.description ?? '', parent_epic_id: task.parent_task_id ?? null,
    },
    // The file the constraints came from, even when it holds no slice of this id:
    // an epic's plan carries the constraints and the gate but no task section.
    plan_path: text ? planPath : null,
    plan: section === null ? null : {
      path: planPath, from: section.from, to: section.to,
      files: planFiles(text.split('\n').slice(section.from - 1, section.to).join('\n')),
    },
    global_constraints: gc,
    gc_lines: gc ? gc.split('\n').length : 0,
    gate: gc ? extractGate(gc) : null,
    acceptance: extractAcceptance(task.description),
    // The plan's spec in the graph, else the one a local plan file's header names.
    spec_doc_id: linkedSpec ?? (text ? docRef(planHeader(text)) : null),
  })
}

// ---------------------------------------------------------------------- main

// Run only when executed as a script; importing the module (tests of the pure
// parsers) must not dispatch a subcommand. Node realpaths the main module for
// `import.meta.url` but leaves argv[1] as given, so argv[1] is realpathed too —
// otherwise invoking the helper through a symlink would dispatch nothing and
// print no JSON.
const realpathOrSelf = p => { try { return realpathSync(p) } catch { return p } }
const invokedDirectly = process.argv[1] &&
  pathToFileURL(realpathOrSelf(process.argv[1])).href ===
    pathToFileURL(realpathOrSelf(fileURLToPath(import.meta.url))).href

if (invokedDirectly) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === '--version') emit({ version: helperVersion() })  // the handshake, by hand
  const flags = parseArgs(rest)
  if (cmd === 'preflight') preflight()
  else if (cmd === 'gate') gate(flags)
  else if (cmd === 'merge') merge(flags)
  else if (cmd === 'cleanup') cleanup(flags)
  else if (cmd === 'branch') branch(flags)
  else if (cmd === 'account') await account(flags)
  else if (cmd === 'cycle') await cycle(flags)
  else if (cmd === 'scout') await scout(flags)
  else if (cmd === 'versions') await versions(flags)
  else usage('usage: wf-helper.mjs <preflight|gate|merge|cleanup|branch|versions|account|cycle|scout|--version> [options]')
}
