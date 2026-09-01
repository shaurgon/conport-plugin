#!/usr/bin/env node
// Deterministic mechanics of the /conport:task and /conport:epic workflows:
// preflight, project gate, merge batch, cleanup, accounting, scouting. Every
// subcommand prints exactly
// one strict JSON object on stdout and exits 0 — a red result is data, not a
// process error. Exit 2 is reserved for CLI misuse. No external dependencies.
//
// Mirror rule: the JSON shapes here are the workflow schemas S_PRE, S_BASE,
// S_MG, S_ACC, S_JAN and the scout base S_SCOUT_RAW — edit them together.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TAIL_LINES = 30
const API_BASE = 'https://api.conport.app/api/v1'
const TAILS_EPIC_TITLE = 'Workflow run tails'
const TAILS_EPIC_DESCRIPTION = 'Deferred review minors from workflow runs'
const PLANS_DIR = ['docs', 'superpowers', 'plans']  // where the workflows keep their plans
const PAGE = 200                                   // the list endpoint's maximum limit
const PAGE_CAP = 20                                // never walk an unbounded listing
const ERROR_BODY_CHARS = 300
const REQUEST_TIMEOUT_MS = 10000                   // per REST call, as in scripts/_common.js
// The two accounting tables this command knows how to execute — the one of a
// single task run and the one of an epic run. A table whose keys fit neither
// shape is refused whole rather than executed in part.
const TASK_TABLE_KEYS = new Set(['project_id', 'close', 'block', 'minors_umbrella'])
// EPIC_TABLE_KEYS_BEGIN — mirrored by EPIC_TABLE_KEYS in epic.js (drift-guarded)
const EPIC_TABLE_KEYS = new Set(['project_id', 'epic', 'done', 'failed', 'skipped',
  'parity_failed', 'minors', 'verdict', 'may_close', 'close_resolution'])
// EPIC_TABLE_KEYS_END
const EPIC_TAILS_TITLE = epic => 'Tails of epic task-' + epic
const EPIC_TAILS_DESCRIPTION = 'Findings deferred from the epic run'
// What a parity-failed plan task is: the run found no child of the epic carrying
// its title. A parity row names the plan task, never an outcome, so this single
// wording covers every such row.
const NO_CHILD_OUTCOME = 'no child task in ConPort'
// KEY=value, where the key carries SECRET/TOKEN/KEY/PASSWORD. The separator is
// limited to spaces and tabs so the match cannot jump over a line break, and a
// quoted value is swallowed whole instead of being cut at its first space.
const SECRET_KEY =
  /\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Za-z0-9_.-]*)[ \t]*=[ \t]*("[^"\n]*"?|'[^'\n]*'?|\S+)/gi

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

const sh = (cmd, cwd) => {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8' })
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

const runGate = (dir, commands) => {
  for (const cmd of commands) {
    const r = sh(cmd, dir)
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
  const r = runGate(dir, commands)
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

  const results = queue.map(e => ({
    id: e.id, status: 'NOT_MERGED', merge_sha: null, conflict_files: [], gate_tail: '',
  }))
  const isAncestor = sha => !!sha && git('merge-base', '--is-ancestor', sha, 'HEAD').ok

  if (flags['state-only']) {
    abortMergeDebris()
    queue.forEach((e, i) => { results[i].status = isAncestor(e.head_sha) ? 'ALREADY_MERGED' : 'NOT_MERGED' })
    const g = runGate(gateDir, commands)
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
      const g = runGate(gateDir, commands)
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

    const g = runGate(gateDir, commands)
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

const cleanup = flags => {
  const merged = listOption(flags, 'merged')
  const worktrees = listOption(flags, 'worktrees')
  if (!merged || !worktrees) return usage('cleanup requires --merged <json array> and --worktrees <json array>')

  const out = { deleted: [], kept: [], worktrees_removed: [], errors: [] }
  // Worktrees first: a merged branch is normally still checked out in a worktree
  // of the same run, and git refuses to delete a branch a worktree holds. The
  // other order fails every deletion and leaves the branches for a second call.
  for (const path of worktrees) {
    if (!existsSync(path)) continue
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
  emit(out)
}

// ------------------------------------------------------------------ accounting

// One call against the ConPort tasks API. The key travels in the header only, so
// it never appears in an error message; a body echoed back by the server is
// scrubbed where the report is built. Every call carries its own deadline: an
// unreachable or silent server must degrade to an error the caller can act on,
// never leave a workflow waiting forever.
const conport = (base, key) => async (method, path, body) => {
  const headers = { 'X-API-Key': key, Accept: 'application/json' }
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, ERROR_BODY_CHARS)}`)
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
  let texts = null
  const load = async () => {
    if (texts) return texts
    const entries = []
    for (let page = 0; page < PAGE_CAP; page++) {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) })
      const r = await api('GET', `/projects/${project}/progress?${qs}`)
      const batch = (r && r.entries) || []
      entries.push(...batch)
      if (batch.length < PAGE || entries.length >= ((r && r.total) ?? entries.length)) break
    }
    texts = entries.flatMap(e => [e.title, e.description].filter(t => typeof t === 'string'))
    return texts
  }
  return {
    has: async match => (await load()).some(match),
    log: async description => {
      await api('POST', `/projects/${project}/progress`, { description })
      if (texts) texts.push(description)
    },
  }
}

// The state every accounting run shares: the API client, the report's action log
// and the failed-call list. A failed item is recorded and stepped over — the
// remaining items still run.
const accounting = (table, key) => {
  const api = conport(process.env.CONPORT_API_URL || API_BASE, key)
  const project = table.project_id
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
  return { api, project, actions, failed_calls, act, failed, taskPath: id => `/projects/${project}/tasks/${id}` }
}

// The three steps both table shapes share, written once. A task run closes one
// task and blocks one; an epic run does the same for every child of its table —
// the mechanics, the guard read and the wording of the actions are identical.

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
  } catch (e) { c.failed('close', id, 'close task-' + id, e); return false }
}

// Blocks one task, appending the reason: the original description is kept.
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
  } catch (e) { c.failed('block', id, 'block task-' + id, e) }
}

// The open tails epic carrying this title, created when there is none. Returns
// its id, or null when the lookup or the creation failed — the caller then files
// nothing under it. The step name differs between the two shapes, so it travels
// with the epic's own fields.
const ensureTailsEpic = async (c, { step, title, description, priority }) => {
  try {
    const open = await listTasks(c.api, c.project, { kind: 'epic', status: 'TODO,IN_PROGRESS,BLOCKED', include_snoozed: 'true' })
    const found = open.find(t => t.title === title)
    if (found) { c.act(step, found.id, 'skipped_already', 'tails epic already open'); return found.id }
    const created = await c.api('POST', `/projects/${c.project}/tasks`, { title, description, kind: 'epic', priority })
    c.act(step, created.id, 'done', 'tails epic created')
    return created.id
  } catch (e) { c.failed(step, null, 'tails epic lookup or create', e); return null }
}

// Executes the accounting table of a task run: close, block, minors umbrella.
// Every item is guarded by a read first, so a rerun of the same table changes
// nothing.
const accountTask = async (table, c) => {
  const { api, project, act, failed } = c
  const out = { via: VIA, actions: c.actions, minors_created: [], task_closed: false, failed_calls: c.failed_calls }

  if (table.close) out.task_closed = await closeOne(c, table.close.id, table.close.resolution)

  if (table.block) await blockOne(c, table.block.id, table.block.reason)

  if (table.minors_umbrella) {
    const { title, description } = table.minors_umbrella
    const epic = await ensureTailsEpic(c, {
      step: 'minors_epic', title: TAILS_EPIC_TITLE, description: TAILS_EPIC_DESCRIPTION, priority: 4,
    })

    if (epic === null) act('minors_child', null, 'failed', 'no tails epic to attach the umbrella to')
    else {
      try {
        const kids = await listTasks(api, project, { parent_task_id: String(epic), status: 'ALL', include_snoozed: 'true' })
        const same = kids.find(t => t.title === title)
        if (same) act('minors_child', same.id, 'skipped_already', 'umbrella already filed')
        else {
          const created = await api('POST', `/projects/${project}/tasks`,
            { title, description, priority: 4, parent_task_id: epic })
          out.minors_created.push(created.id)
          act('minors_child', created.id, 'done', 'umbrella filed under the tails epic')
        }
      } catch (e) { failed('minors_child', null, 'minors umbrella under epic ' + epic, e) }
    }
  }
  return out
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
    via: VIA, actions: c.actions, tails_epic_id: null, tails_children: [], epic_progress: null,
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

  const minors = table.minors ?? []
  if (minors.length) {
    const tails = await ensureTailsEpic(c, {
      step: 'tails_epic', title: EPIC_TAILS_TITLE(epicId), description: EPIC_TAILS_DESCRIPTION, priority: 3,
    })
    out.tails_epic_id = tails

    if (tails === null) act('tails_child', null, 'failed', 'no tails epic to attach the entries to')
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
            { title: entry.title, description: entry.description, priority: entry.priority, parent_task_id: tails })
          kids.push(created)                    // two entries of one table sharing a title are filed once
          out.tails_children.push(created.id)
          act('tails_child', created.id, 'done', 'entry filed under the tails epic')
        } catch (e) { failed('tails_child', null, 'tails entry "' + entry.title + '"', e) }
      }
    }
  }

  {
    // Logged for every epic run, as the accountant prompt does it: the summary is
    // the run's trace in the journal and does not depend on the epic being closable.
    const summary = `${prefix} result: ${table.close_resolution ?? ''}`
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
          await api('PATCH', taskPath(epicId), { status: 'DONE', resolution: table.close_resolution })
          out.epic_closed = true
          act('epic_close', epicId, 'done', 'epic closed with the run resolution')
        }
      }
    } catch (e) { out.epic_close_error = failed('epic_close', epicId, 'close epic ' + epicId, e) }
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

  const c = accounting(table, key)
  emit(fits(TASK_TABLE_KEYS) ? await accountTask(table, c) : await accountEpic(table, c))
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

// The mechanical half of the scout: the task from ConPort, its plan slice, the
// constraints, the gate and the spec reference. Nothing here is a judgement —
// compressing and digesting is left to the caller.
const scout = async flags => {
  const taskId = Number(flags.task)
  if (!Number.isInteger(taskId)) return usage('scout requires --task <id>')

  const key = apiKey()
  if (!key) sentinel('no api key')
  const project = typeof flags.project === 'string' ? flags.project : process.env.CONPORT_PROJECT_NAME
  if (!project) sentinel('no project')

  const api = conport(process.env.CONPORT_API_URL || API_BASE, key)
  const scrub = text => mask(String(text)).split(key).join('***')
  let projectId
  let task
  try {
    projectId = (await api('GET', '/projects/' + encodeURIComponent(project))).id
    task = await api('GET', `/projects/${projectId}/tasks/${taskId}`)
  } catch (e) { errorOut(scrub(e && e.message ? e.message : e)) }

  const root = typeof flags['repo-root'] === 'string' ? flags['repo-root'] : process.cwd()
  const given = typeof flags.plan === 'string' ? flags.plan : null
  const planPath = given && !existsSync(given) ? join(root, given) : (given ?? findPlan(root, taskId))
  const text = planPath && existsSync(planPath) ? readFileSync(planPath, 'utf8') : null

  const section = text ? planSection(text, taskId) : null
  const gc = text ? globalConstraints(text) : ''
  emit({
    via: VIA,
    project_id: projectId,
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
    spec_doc_id: docRef(task.description) ?? (text ? docRef(planHeader(text)) : null),
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
  else if (cmd === 'account') await account(flags)
  else if (cmd === 'scout') await scout(flags)
  else usage('usage: wf-helper.mjs <preflight|gate|merge|cleanup|account|scout|--version> [options]')
}
