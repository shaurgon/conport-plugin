// The hooks take the project and the Superpowers overlay from the project
// settings (.conport.json, .conport.local.json, then CONPORT_PROJECT_NAME),
// worked out once at the start of a session and cached by its session id. The
// session start tells the agent and the user the project, the lines of the
// settings and where old settings are still kept. Every hook runs as the real
// script in a child process, in a temporary folder outside this repository,
// against a local stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isolatedDir, isolatedEnv, REPO_ROOT } from './support/isolated.mjs'
import { overlayNotice } from './support/overlay-notice.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const TESTS = join(SCRIPTS, 'test')
const MOVE_DOC = 'https://conport.app/docs/projects/project-settings.md'
const { findOldPlaces, oldSettingsLine } = createRequire(import.meta.url)('../old-settings.js')
const { RETIRED_PROJECT_ID } = createRequire(import.meta.url)('../_common.js')

// A path as a word of a command and of a refusal: the hook reads commands by
// shell rules, where `\` escapes, and quotes a refusal path that holds one —
// so a Windows path is single-quoted, a POSIX temp path stays as it is.
const WINDOWS = process.platform === 'win32'
const word = (p) => (WINDOWS ? `'${p}'` : p)

// Records the path and team header of every call, and answers the routes the
// hooks read; `conventions` is the deny-list served next.
async function startApi() {
  const api = { requests: [], conventions: [] }
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      api.requests.push(req.url)
      res.setHeader('content-type', 'application/json')
      if (req.url.endsWith('/epic-tails')) res.end('{"tails": []}')
      else if (req.url.includes('/tasks?')) res.end('{"tasks": [], "total": 0}')
      else if (req.url.endsWith('/milestones')) res.end('[]')
      else res.end(JSON.stringify({ conventions: api.conventions }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  api.close = () => new Promise((resolve) => server.close(resolve))
  return api
}

async function withSession(fn) {
  const api = await startApi()
  const data = isolatedDir()
  const env = (extra = {}) => {
    const e = isolatedEnv({ CLAUDE_PLUGIN_DATA: data, CONPORT_URL: api.url, CONPORT_API_KEY: 'cport_test_key', ...extra })
    delete e.CLAUDE_PLUGIN_OPTION_API_KEY
    return e
  }
  try {
    await fn({ api, data, env })
  } finally {
    await api.close()
  }
}

// A git repository in a new temporary folder holding `files`.
function repo(files = {}) {
  const dir = isolatedDir(files)
  execFileSync('git', ['-C', dir, 'init', '-q'], { env: isolatedEnv(), stdio: 'ignore' })
  return dir
}

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { env: isolatedEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function put(dir, rel, text) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text))
}

function runHook(ctx, script, payload, { cwd, vars = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env: ctx.env(vars), cwd: cwd || isolatedDir() })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(JSON.stringify(payload))
  })
}

const start = (ctx, cwd, { session = 's1', source = 'startup', vars } = {}) =>
  runHook(ctx, 'session-start.js', { session_id: session, source, cwd }, { cwd, vars })
const prompt = (ctx, cwd, session = 's1') =>
  runHook(ctx, 'user-prompt-submit.js', { session_id: session, prompt: 'hi', cwd }, { cwd })
const bash = (ctx, cwd, command, session = 's1') =>
  runHook(ctx, 'check-command.js', { session_id: session, cwd, tool_input: { command } }, { cwd })
const stop = (ctx, cwd, session = 's1') =>
  runHook(ctx, 'stop-epic-tails.js', { session_id: session, stop_hook_active: false, cwd }, { cwd })

// What the session start said: the user's message and the agent's context,
// each as lines (null: not said).
function told(res) {
  assert.equal(res.code, 0, res.err)
  if (!res.out) return { user: null, agent: null }
  const parsed = JSON.parse(res.out)
  return {
    user: parsed.systemMessage ?? null,
    agent: parsed.hookSpecificOutput?.additionalContext ?? null,
  }
}

const cachePath = (ctx, session = 's1') => join(ctx.data, 'hook_state', `settings_${session}.json`)
const tailsOf = (ctx) => ctx.api.requests.filter((u) => u.endsWith('/epic-tails'))
const conventionsOf = (ctx) => ctx.api.requests.filter((u) => u.startsWith('/api/v1/hooks/conventions'))
const DENY = [{ pattern: '^forbidden-tool\\b', reason: 'not here' }]

function denyList(ctx, project, conventions = DENY) {
  writeFileSync(join(ctx.data, `deny-list_${encodeURIComponent(project)}.json`), JSON.stringify({ conventions }))
}

test('session start names the project and its source to the agent and the user', () => withSession(async (ctx) => {
  const dir = repo({ '.conport.json': '{"project_name": "prk7m2qx9d"}' })
  const line = 'ConPort project: prk7m2qx9d (from .conport.json)'
  assert.deepEqual(told(await start(ctx, dir)), { user: line, agent: line })
  assert.deepEqual(conventionsOf(ctx), ['/api/v1/hooks/conventions?project=prk7m2qx9d'])

  const local = repo({
    '.conport.json': '{"project_name": "shared-proj"}',
    '.conport.local.json': '{"project_name": "mine"}',
    '.gitignore': '.conport.local.json\n',
  })
  const lines = [
    'ConPort project: mine (from .conport.local.json)',
    'project_name from .conport.local.json (mine) overrides .conport.json (shared-proj)',
  ].join('\n')
  assert.deepEqual(told(await start(ctx, local, { session: 's2' })), { user: lines, agent: lines })

  const variable = isolatedDir()
  const fromEnv = told(await start(ctx, variable, { session: 's3', vars: { CONPORT_PROJECT_NAME: 'pers/my-proj' } }))
  assert.equal(fromEnv.agent.split('\n')[0], 'ConPort project: pers/my-proj (from CONPORT_PROJECT_NAME)')
  assert.equal(fromEnv.user, fromEnv.agent)
}))

test('a resumed session tells the agent only', () => withSession(async (ctx) => {
  const dir = repo({ '.conport.json': '{"project_name": "prk7m2qx9d", "units": 3}' })
  const lines = 'ConPort project: prk7m2qx9d (from .conport.json)\n.conport.json: units must be a list — fix it'
  for (const source of ['resume', 'clear', 'compact']) {
    assert.deepEqual(told(await start(ctx, dir, { source })), { user: null, agent: lines }, source)
  }
  for (const source of ['startup', undefined, 'other']) {
    assert.deepEqual(told(await start(ctx, dir, { source })), { user: lines, agent: lines }, String(source))
  }
}))

test('the cache is written once and read by the other hooks', () => withSession(async (ctx) => {
  const dir = repo({ '.conport.json': '{"project_name": "prk7m2qx9d"}' })
  await start(ctx, dir)
  const cached = JSON.parse(readFileSync(cachePath(ctx), 'utf8'))
  assert.equal(cached.project, 'prk7m2qx9d')
  assert.equal(cached.source, '.conport.json')
  assert.deepEqual(cached.lines, [])
  const written = readFileSync(cachePath(ctx), 'utf8')
  const mtime = statSync(cachePath(ctx)).mtimeMs

  // The file now names another project: a hook that worked the settings out
  // again would follow it, a hook that reads the cache does not.
  put(dir, '.conport.json', '{"project_name": "other"}')
  denyList(ctx, 'prk7m2qx9d')
  assert.equal((await prompt(ctx, dir)).code, 0)
  assert.deepEqual(tailsOf(ctx), ['/api/v1/projects/prk7m2qx9d/epic-tails'])
  const blocked = await bash(ctx, dir, 'forbidden-tool --now')
  assert.equal(blocked.code, 2)
  assert.match(blocked.err, /BLOCKED: not here/)
  mkdirSync(join(ctx.data, 'hook_state'), { recursive: true })
  writeFileSync(join(ctx.data, 'hook_state', 'session_epics_s1.jsonl'),
    JSON.stringify({ project: 'prk7m2qx9d', epic_id: 50, title: 'Epic 50' }) + '\n')
  assert.equal((await stop(ctx, dir)).code, 0)
  assert.ok(ctx.api.requests.includes('/api/v1/projects/prk7m2qx9d/milestones'), ctx.api.requests.join('\n'))

  assert.equal(readFileSync(cachePath(ctx), 'utf8'), written)
  assert.equal(statSync(cachePath(ctx)).mtimeMs, mtime)
  assert.deepEqual(readdirSync(join(ctx.data, 'hook_state')).filter((f) => f.startsWith('settings_')), ['settings_s1.json'])

  // Without a session id nothing is cached: the hook works the settings out.
  const res = await runHook(ctx, 'user-prompt-submit.js', { prompt: 'hi', cwd: dir }, { cwd: dir })
  assert.equal(res.code, 0)
  assert.equal(tailsOf(ctx).at(-1), '/api/v1/projects/other/epic-tails')
  assert.deepEqual(readdirSync(join(ctx.data, 'hook_state')).filter((f) => f.startsWith('settings_')), ['settings_s1.json'])
}))

test('a torn settings cache is computed again', () => withSession(async (ctx) => {
  const dir = repo({ '.conport.json': '{"project_name": "prk7m2qx9d"}' })
  for (const torn of ['{"project": "stale", "lin', '', '[]', '{"project": "stale"}']) {
    mkdirSync(join(ctx.data, 'hook_state'), { recursive: true })
    writeFileSync(cachePath(ctx), torn)
    const res = await prompt(ctx, dir)
    assert.equal(res.code, 0, res.out)
    assert.equal(tailsOf(ctx).at(-1), '/api/v1/projects/prk7m2qx9d/epic-tails', JSON.stringify(torn))
    assert.equal(JSON.parse(readFileSync(cachePath(ctx), 'utf8')).project, 'prk7m2qx9d')
  }
  // No temporary file of the write is left behind.
  assert.deepEqual(readdirSync(join(ctx.data, 'hook_state')).filter((f) => f.startsWith('settings_')), ['settings_s1.json'])
}))

test('cd into another repository does not change the project', () => withSession(async (ctx) => {
  const a = repo({ '.conport.json': '{"project_name": "proj-a"}' })
  const b = repo({ '.conport.json': '{"project_name": "proj-b"}' })
  await start(ctx, a)
  denyList(ctx, 'proj-a')
  denyList(ctx, 'proj-b', [{ pattern: '^other-tool\\b', reason: 'b only' }])

  await prompt(ctx, b)
  assert.deepEqual(tailsOf(ctx), ['/api/v1/projects/proj-a/epic-tails'])
  assert.equal((await bash(ctx, b, 'forbidden-tool --now')).code, 2)
  assert.equal((await bash(ctx, b, 'other-tool --now')).code, 0)

  // The session's root is CLAUDE_PROJECT_DIR when the harness sets it.
  const started = told(await start(ctx, b, { session: 's2', vars: { CLAUDE_PROJECT_DIR: a } }))
  assert.equal(started.agent, 'ConPort project: proj-a (from .conport.json)')
}))

test('the overlay follows plugins.superpowers and the local file can turn it off', () => withSession(async (ctx) => {
  const dir = repo({
    '.conport.json': '{"plugins": {"superpowers": true}}',
    '.gitignore': '.conport.local.json\n',
  })
  assert.deepEqual(told(await start(ctx, dir)), { user: null, agent: overlayNotice('settings') })

  put(dir, '.conport.local.json', { plugins: { superpowers: false } })
  assert.deepEqual(told(await start(ctx, dir)), { user: null, agent: null })

  // The local file alone can turn it on; the notice names both files.
  put(dir, '.conport.json', {})
  put(dir, '.conport.local.json', { plugins: { superpowers: true } })
  assert.deepEqual(told(await start(ctx, dir)), { user: null, agent: overlayNotice('settings') })

  // The key decides over the old place.
  put(dir, '.conport.local.json', { plugins: { superpowers: false } })
  put(dir, '.superpowers/config.json', { conport: { superpowers: true } })
  assert.ok(!(told(await start(ctx, dir)).agent || '').includes('Superpowers overlay'))
}))

test('the overlay falls back to .superpowers/config.json', () => withSession(async (ctx) => {
  const main = repo({ '.superpowers/config.json': '{"conport": {"superpowers": true}}', 'README.md': 'x\n' })
  git(main, 'add', 'README.md')
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  // Without .conport.json the notice names the old place, never .conport.json.
  const agent = told(await start(ctx, main)).agent
  assert.ok(agent.endsWith(`\n\n${overlayNotice('old')}`), agent.slice(0, 300))
  assert.doesNotMatch(overlayNotice('old'), /\.conport\.json/)

  // A linked worktree reads the old place of the main worktree.
  const wt = join(isolatedDir(), 'linked')
  git(main, 'worktree', 'add', '-q', '-b', 'linked', wt)
  assert.ok(told(await start(ctx, wt, { session: 's2' })).agent.endsWith(overlayNotice('old')))

  // With .conport.json and no plugins.superpowers the old place still decides.
  put(wt, '.conport.json', '{"project_name": "prk7m2qx9d"}')
  assert.ok(told(await start(ctx, wt, { session: 's3' })).agent.endsWith(overlayNotice('old')))
  put(main, '.superpowers/config.json', { conport: { superpowers: false } })
  assert.ok(!told(await start(ctx, wt, { session: 's4' })).agent.includes('Superpowers overlay'))
}))

test("the commit guard reads the settings of the command's folder", () => withSession(async (ctx) => {
  const session = repo()
  await start(ctx, session)
  const other = repo({ '.conport.json': '{"plugins": {"superpowers": true}}', 'docs/superpowers/specs/new.md': 'x\n' })
  git(other, 'add', 'docs/superpowers/specs/new.md')
  const file = word(join(other, 'docs/superpowers/specs/new.md'))
  const res = await bash(ctx, session, `cd ${word(other)} && git commit -m x`)
  assert.equal(res.code, 2, res.err)
  assert.equal(res.err, `BLOCKED: ${file} is a new Superpowers spec, and with the ConPort overlay on specs live in ConPort: ` +
    `run \`npx -y conport@^0.11.0 documents upload ${file} --doc-type spec\`, then remove the file.\n`)

  // The other way round: the session's overlay is on, the command's folder has none.
  const on = repo({ '.conport.json': '{"plugins": {"superpowers": true}}' })
  await start(ctx, on, { session: 's2' })
  const off = repo({ 'docs/superpowers/specs/new.md': 'x\n' })
  git(off, 'add', 'docs/superpowers/specs/new.md')
  const passed = await bash(ctx, on, `git -C ${word(off)} commit -m x`, 's2')
  assert.equal(passed.code, 0, passed.err)
}))

test('old places without .conport.json give the move line', () => withSession(async (ctx) => {
  const dir = repo({
    '.claude/settings.local.json': '{"env": {"CONPORT_PROJECT_NAME": "prk7m2qx9d"}, "permissions": {}}',
    '.claude/settings.json': '{"env": {"CONPORT_PROJECT_NAME": "prk7m2qx9d"}}',
    '.superpowers/config.json': '{"conport": {"superpowers": false}}',
    '.conport/units.json': '[]',
  })
  const move = 'ConPort settings are in the old places (CONPORT_PROJECT_NAME in the environment, ' +
    'env.CONPORT_PROJECT_NAME in .claude/settings.local.json, env.CONPORT_PROJECT_NAME in .claude/settings.json, ' +
    `conport in .superpowers/config.json, .conport/units.json): move them to .conport.json — ${MOVE_DOC}`
  const lines = `ConPort project: prk7m2qx9d (from CONPORT_PROJECT_NAME)\n${move}`
  assert.deepEqual(told(await start(ctx, dir, { vars: { CONPORT_PROJECT_NAME: 'prk7m2qx9d' } })), { user: lines, agent: lines })

  // One old place is enough; a settings file without the key is none.
  const one = repo({ '.conport/units.json': '[]', '.claude/settings.json': '{"env": {"OTHER": "1"}}' })
  const moveUnits = `ConPort settings are in the old places (.conport/units.json): move them to .conport.json — ${MOVE_DOC}`
  assert.deepEqual(told(await start(ctx, one, { session: 's2' })), { user: moveUnits, agent: moveUnits })
  // No old place, no .conport.json: nothing is said.
  assert.deepEqual(told(await start(ctx, repo(), { session: 's3' })), { user: null, agent: null })

  // The old overlay flag counts in the main worktree too.
  const main = isolatedDir({ '.superpowers/config.json': '{"conport": {}}' })
  const wt = isolatedDir()
  assert.deepEqual(findOldPlaces({ root: wt, mainRoot: main, env: {} }), ['conport in .superpowers/config.json'])
  assert.deepEqual(findOldPlaces({ root: wt, mainRoot: null, env: { CONPORT_PROJECT_NAME: '  ' } }), [])
  assert.equal(oldSettingsLine({ hasShared: false, places: [] }), null)
}))

test('old personal places beside .conport.json give the leftover line without units.json', () => withSession(async (ctx) => {
  const dir = repo({
    '.conport.json': '{"project_name": "prk7m2qx9d"}',
    '.claude/settings.local.json': '{"env": {"CONPORT_PROJECT_NAME": "prk7m2qx9d"}}',
    '.superpowers/config.json': '{"conport": {"superpowers": false}}',
    '.conport/units.json': '[]',
  })
  const lines = 'ConPort project: prk7m2qx9d (from .conport.json)\n' +
    'Old ConPort settings left (env.CONPORT_PROJECT_NAME in .claude/settings.local.json, ' +
    `conport in .superpowers/config.json): remove them — ${MOVE_DOC}`
  assert.deepEqual(told(await start(ctx, dir, { vars: { CONPORT_PROJECT_NAME: 'prk7m2qx9d' } })), { user: lines, agent: lines })
  assert.equal(oldSettingsLine({ hasShared: true, places: ['CONPORT_PROJECT_NAME in the environment', '.conport/units.json'] }), null)
}))

test('after the move only the project line is said', () => withSession(async (ctx) => {
  const dir = repo({
    '.conport.json': '{"$schema": "https://conport.app/schema/conport.json", "project_name": "prk7m2qx9d", "units": []}',
    '.conport/units.json': '[]',
    '.claude/settings.local.json': '{"permissions": {"allow": []}}',
  })
  const line = 'ConPort project: prk7m2qx9d (from .conport.json)'
  assert.deepEqual(told(await start(ctx, dir)), { user: line, agent: line })
}))

test('an unreadable .conport.json does not stop the session start', () => withSession(async (ctx) => {
  const dir = repo()
  mkdirSync(join(dir, '.conport.json'))
  const line = '.conport.json cannot be read (EISDIR): fix it'
  assert.deepEqual(told(await start(ctx, dir, { vars: { CONPORT_PROJECT_NAME: 'prk7m2qx9d' } })), { user: line, agent: line })
  assert.deepEqual(conventionsOf(ctx), [], 'no project: the variable does not stand in')
  assert.equal(JSON.parse(readFileSync(cachePath(ctx), 'utf8')).project, null)
  assert.equal((await prompt(ctx, dir)).code, 0)
  assert.deepEqual(tailsOf(ctx), [])
}))

// The failing git is a shell script, which Windows does not start as `git` without a shell.
test('a failed git reads no old overlay flag', {
  skip: WINDOWS && 'the failing git stand-in is a shell script, which Windows does not start without a shell',
}, () => withSession(async (ctx) => {
  const dir = repo({ '.superpowers/config.json': '{"conport": {"superpowers": true}}' })
  const bin = isolatedDir()
  writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "fatal: detected dubious ownership in repository" >&2\nexit 128\n')
  chmodSync(join(bin, 'git'), 0o755)
  const line = 'git failed (fatal: detected dubious ownership in repository): ConPort settings were not read'
  const res = await start(ctx, dir, { vars: { PATH: `${bin}${delimiter}${process.env.PATH}` } })
  assert.deepEqual(told(res), { user: line, agent: line })
}))

// The skill, its overlay reference and the plugin spec quote the line about
// CONPORT_PROJECT_ID that the session start and the CLI print; a quote that
// drifts from it tells the agent of a line nothing shows.
test('the skill, its overlay reference and the plugin spec quote the hook line about CONPORT_PROJECT_ID word for word', () => {
  const opening = 'CONPORT_PROJECT_ID is no longer read — '
  for (const file of [
    join(SCRIPTS, '..', 'skills', 'conport', 'SKILL.md'),
    join(SCRIPTS, '..', 'skills', 'conport', 'references', 'superpowers-overlay.md'),
    join(REPO_ROOT, 'docs', 'conport-plugin-spec.md'),
  ]) {
    const quotes = [...readFileSync(file, 'utf8').matchAll(/`(CONPORT_PROJECT_ID is no longer read — [^`]*)`/g)].map((m) => m[1])
    assert.ok(quotes.length >= 1, `${file} does not quote the line`)
    for (const quote of quotes) assert.equal(quote, RETIRED_PROJECT_ID, file)
  }
  assert.ok(RETIRED_PROJECT_ID.startsWith(opening))
})

test('every hook test runs outside the repository', async () => {
  const hookScripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.js'))
  const offenders = []
  for (const name of readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs'))) {
    const text = readFileSync(join(TESTS, name), 'utf8')
    const runsHook = hookScripts.some((s) => text.includes(`'${s}'`) || text.includes(`"${s}"`) || text.includes(`/${s}'`))
    if (runsHook && !/from '\.\/support\/isolated\.mjs'/.test(text)) offenders.push(name)
  }
  assert.deepEqual(offenders, [])

  // And the guard bites: a hook that finds its root inside the repository refuses.
  const ctxEnv = isolatedEnv()
  const res = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, 'session-start.js')], { env: ctxEnv, cwd: join(REPO_ROOT, 'plugins') })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, err }))
    child.stdin.end(JSON.stringify({ session_id: 'inside', source: 'startup' }))
  })
  assert.notEqual(res.code, 0)
  assert.match(res.err, /is inside CONPORT_SETTINGS_FORBID_ROOT: run the test in a temporary folder/)
  assert.ok(!existsSync(join(ctxEnv.CLAUDE_PLUGIN_DATA, 'hook_state', 'settings_inside.json')))
})
