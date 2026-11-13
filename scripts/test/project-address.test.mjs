// How the hooks address a project: here the settings name none, so the source
// is CONPORT_PROJECT_NAME (a handle or a name); a `team/project` name is split
// into the team header and the short path segment, CONPORT_PROJECT_ID is no
// longer read — the session start says so in one line — and without a name no
// hook reaches the server. Every hook runs as the real script in a child
// process, in a repository in a temporary folder outside this one, against a
// local stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { projectAddress } from '../../workflows/wf-helper.mjs'
import { isolatedDir, isolatedEnv } from './support/isolated.mjs'
import { realGit } from './support/real-git.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const TEAM_HEADER = 'x-conport-team-id'
const { parseProject } = createRequire(import.meta.url)('../_common.js')
const REAL_GIT = realGit()

// Records the raw request line and headers of every call, and answers the
// routes the hooks read; `conventions` is the deny-list served next.
async function startApi() {
  const api = { requests: [], conventions: [] }
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      api.requests.push({ url: req.url, team: req.headers[TEAM_HEADER] })
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

// A working directory that is a git repository with an origin remote and no
// ConPort settings, and a `git` first on PATH that logs its arguments and runs
// the real one. A hook that falls back to the repository name is caught by the
// request the name would produce, and — unless it is the one query of the
// settings for the root, which the log allows — by the log too. The logging
// git is a shell script, which Windows does not start as `git` without a
// shell: there the hooks run the real git, and only the request catches a
// guess (LOGGING_GIT).
const LOGGING_GIT = process.platform !== 'win32'
function makeRepo(root) {
  const repo = join(root, 'some-repo')
  mkdirSync(repo)
  execFileSync(REAL_GIT, ['-C', repo, 'init', '-q'], { env: isolatedEnv(), stdio: 'ignore' })
  execFileSync(REAL_GIT, ['-C', repo, 'remote', 'add', 'origin', 'https://example.com/acme/some-repo.git'],
    { env: isolatedEnv(), stdio: 'ignore' })
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const marker = join(root, 'git-was-run')
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${marker}'\nexec '${REAL_GIT}' "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  return { repo, bin, marker }
}

// The git calls a hook made other than the one query of the settings, which
// only asks git for the worktree roots. Anything else — a remote, a config
// value — is a project guessed from the repository.
const SETTINGS_GIT = /^-C .+ rev-parse --show-toplevel --git-common-dir$/
function projectGuesses(ctx) {
  if (!existsSync(ctx.marker)) return []
  return readFileSync(ctx.marker, 'utf8').split('\n').filter((l) => l && !SETTINGS_GIT.test(l))
}
function assertNoGuesses(ctx, message) {
  if (LOGGING_GIT) assert.deepEqual(projectGuesses(ctx), [], message)
}

async function withEnv(fn) {
  const api = await startApi()
  const root = isolatedDir()
  const dataDir = join(root, 'data')
  mkdirSync(dataDir)
  try {
    await fn({ api, root, dataDir, ...makeRepo(root) })
  } finally {
    await api.close()
  }
}

// `vars` is the whole project addressing of the run: isolatedEnv removes both
// variables, so a test names exactly the ones it means.
function runHook(script, payload, ctx, vars = {}) {
  const env = isolatedEnv()
  // One PATH under one spelling: Windows names it `Path` in process.env.
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k]
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  Object.assign(env, {
    CLAUDE_PLUGIN_DATA: ctx.dataDir,
    CONPORT_URL: ctx.api.url,
    CONPORT_API_KEY: 'cport_test_key',
    PATH: LOGGING_GIT ? `${ctx.bin}:/usr/bin:/bin` : process.env.PATH,
    ...vars,
  })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env, cwd: ctx.repo })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload))  // a string is raw stdin
  })
}

const prompt = (ctx, vars, session = 's1') =>
  runHook('user-prompt-submit.js', { session_id: session, prompt: 'hi' }, ctx, vars)
const sessionStart = (ctx, vars, source = 'startup') => runHook('session-start.js', { source }, ctx, vars)

// The session record the PostToolUse hook leaves: one epic this session changed.
function recordEpic(ctx, project, session = 's1') {
  mkdirSync(join(ctx.dataDir, 'hook_state'), { recursive: true })
  writeFileSync(join(ctx.dataDir, 'hook_state', `session_epics_${session}.jsonl`),
    JSON.stringify({ project, epic_id: 50, title: 'Epic 50' }) + '\n')
}
const stop = (ctx, vars, session = 's1') =>
  runHook('stop-epic-tails.js', { session_id: session, stop_hook_active: false }, ctx, vars)
const DENY = [{ pattern: '^forbidden-tool\\b', reason: 'not here' }]
const bash = (ctx, vars) => new Promise((resolve, reject) => {
  const env = isolatedEnv({ CLAUDE_PLUGIN_DATA: ctx.dataDir, ...vars })
  const child = spawn(process.execPath, [join(SCRIPTS, 'check-command.js')], { env, cwd: ctx.repo })
  let err = ''
  child.stderr.on('data', (d) => { err += d })
  child.on('error', reject)
  child.on('close', (code) => resolve({ code, err }))
  child.stdin.end(JSON.stringify({ tool_input: { command: 'forbidden-tool --now' } }))
})
const denyLists = (ctx) => readdirSync(ctx.dataDir).filter((f) => f.startsWith('deny-list')).sort()

const hookState = (ctx) => {
  const dir = join(ctx.dataDir, 'hook_state')
  return existsSync(dir) ? readdirSync(dir) : []
}
const tailsRequests = (ctx) => ctx.api.requests.filter((r) => r.url.endsWith('/epic-tails'))

test('a canonical name is split into the team header and the short path segment', () => withEnv(async (ctx) => {
  const { code } = await prompt(ctx, { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  assert.equal(code, 0)
  assert.deepEqual(tailsRequests(ctx), [{ url: '/api/v1/projects/my-proj/epic-tails', team: 'k7m2qx9d' }])
}))

test('pers/<name> sends the pers header and a bare name sends none', () => withEnv(async (ctx) => {
  await prompt(ctx, { CONPORT_PROJECT_NAME: 'pers/my-proj' }, 's1')
  await prompt(ctx, { CONPORT_PROJECT_NAME: 'my-proj' }, 's2')
  assert.deepEqual(tailsRequests(ctx), [
    { url: '/api/v1/projects/my-proj/epic-tails', team: 'pers' },
    { url: '/api/v1/projects/my-proj/epic-tails', team: undefined },
  ])
}))

test('the conventions hook sends the canonical name whole', () => withEnv(async (ctx) => {
  const { code } = await sessionStart(ctx, { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  assert.equal(code, 0)
  assert.deepEqual(ctx.api.requests, [
    { url: '/api/v1/hooks/conventions?project=k7m2qx9d%2Fmy-proj', team: undefined },
  ])
}))

test('without CONPORT_PROJECT_NAME no hook calls the server', () => withEnv(async (ctx) => {
  assert.equal((await sessionStart(ctx)).code, 0)
  assert.equal((await prompt(ctx)).code, 0)
  recordEpic(ctx, '99')
  const stopped = await stop(ctx)
  assert.equal(stopped.code, 0)
  assert.equal(stopped.out, '')

  assert.deepEqual(ctx.api.requests, [])
  assertNoGuesses(ctx, 'no hook may run git to guess a project')
  assert.deepEqual(hookState(ctx).filter((f) => /^(project_id|epic_tails)_/.test(f)), [])
  assert.deepEqual(denyLists(ctx), [])
}))

// A record of an earlier version names the project by its number: it is sent as
// it is and the server answers 404, which passes with the next session.
test('the Stop hook splits a recorded team/project name and sends any other record as it is', () => withEnv(async (ctx) => {
  const vars = { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' }
  recordEpic(ctx, 'k7m2qx9d/my-proj', 's1')
  assert.equal((await stop(ctx, vars, 's1')).code, 0)
  recordEpic(ctx, '99', 's2')
  assert.equal((await stop(ctx, vars, 's2')).code, 0)

  assert.deepEqual(ctx.api.requests.map((r) => [r.url.split('?')[0], r.team]), [
    ['/api/v1/projects/my-proj/milestones', 'k7m2qx9d'],
    ['/api/v1/projects/my-proj/tasks', 'k7m2qx9d'],
    ['/api/v1/projects/99/milestones', undefined],
    ['/api/v1/projects/99/tasks', undefined],
  ])
}))

test('the Stop hook skips a recorded project that is not a name', () => withEnv(async (ctx) => {
  recordEpic(ctx, 'a/b/c')
  assert.equal((await stop(ctx, { CONPORT_PROJECT_NAME: 'my-proj' })).code, 0)
  assert.deepEqual(ctx.api.requests, [])
}))

test('the deny-list is kept per canonical name and never read across projects', () => withEnv(async (ctx) => {
  const team = { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' }
  const own = { CONPORT_PROJECT_NAME: 'my-proj' }
  ctx.api.conventions = DENY
  await sessionStart(ctx, team)
  ctx.api.conventions = []
  await sessionStart(ctx, own)
  assert.deepEqual(denyLists(ctx), ['deny-list_k7m2qx9d%2Fmy-proj.json', 'deny-list_my-proj.json'])

  const blocked = await bash(ctx, team)
  assert.equal(blocked.code, 2)
  assert.match(blocked.err, /BLOCKED: not here/)
  assert.equal((await bash(ctx, own)).code, 0, 'the same short name in another team has its own list')
  assert.equal((await bash(ctx, {})).code, 0, 'no project: no list, nothing is blocked')
  assert.equal((await bash(ctx, { CONPORT_PROJECT_NAME: 'a/b/c' })).code, 0)
}))

test('the machine-wide deny-list of earlier versions is neither read nor removed', () => withEnv(async (ctx) => {
  const legacy = join(ctx.dataDir, 'deny-list.json')
  writeFileSync(legacy, JSON.stringify({ conventions: DENY }))
  assert.equal((await bash(ctx, {})).code, 0)
  assert.equal((await bash(ctx, { CONPORT_PROJECT_NAME: 'my-proj' })).code, 0)
  assert.equal((await bash(ctx, { CONPORT_PROJECT_ID: '99' })).code, 0)
  await sessionStart(ctx, { CONPORT_PROJECT_NAME: 'my-proj' })
  assert.deepEqual(denyLists(ctx), ['deny-list.json', 'deny-list_my-proj.json'])
}))

// The line names the one place a project is set now: project_name of .conport.json.
const RETIRED = 'CONPORT_PROJECT_ID is no longer read — set project_name in .conport.json to the project\'s handle or name'

// What the session start told the session: the lines the user is shown and the
// context the agent is given (null: none). The line about CONPORT_PROJECT_ID
// has one channel — the user.
function startNotice(out) {
  if (!out) return { user: null, agent: null }
  const parsed = JSON.parse(out)
  return { user: parsed.systemMessage ?? null, agent: parsed.hookSpecificOutput?.additionalContext ?? null }
}
const saysRetired = (out) => (startNotice(out).user ?? '').split('\n').includes(RETIRED)

// The line is said once per session: at its start, not again when the same
// session is resumed, cleared or compacted. The agent is still told the project.
for (const source of ['resume', 'clear', 'compact']) {
  test(`a session start from ${source} does not say the line again`, () => withEnv(async (ctx) => {
    const started = await sessionStart(ctx, { CONPORT_PROJECT_ID: '42', CONPORT_PROJECT_NAME: 'my-proj' }, source)
    assert.equal(started.code, 0)
    const told = startNotice(started.out)
    assert.equal(told.user, null)
    assert.ok(!told.agent.includes(RETIRED))
    assert.equal(told.agent.split('\n')[0], 'ConPort project: my-proj (from CONPORT_PROJECT_NAME)')
    assert.deepEqual(ctx.api.requests, [{ url: '/api/v1/hooks/conventions?project=my-proj', team: undefined }])
  }))
}

// Only a known re-entry is silent: a host that sends no `source`, a value this
// hook does not know, or stdin it cannot read still gets the line — silence
// there would hide it for good.
for (const [what, stdin] of [
  ['a null source', { source: null }], ['no source', {}], ['an unknown source', { source: 'other' }],
  ['empty stdin', ''], ['stdin that is not JSON', '{broken'], ['stdin that is not an object', '"startup"'],
]) {
  test(`a session start with ${what} says the line`, () => withEnv(async (ctx) => {
    const started = await runHook('session-start.js', stdin, ctx, { CONPORT_PROJECT_ID: '42' })
    assert.equal(started.code, 0)
    assert.deepEqual(startNotice(started.out), { user: RETIRED, agent: null })
  }))
}

test('CONPORT_PROJECT_ID alone names no project, and the session start says so in one line', () => withEnv(async (ctx) => {
  const vars = { CONPORT_PROJECT_ID: '42' }
  const started = await sessionStart(ctx, vars)
  assert.equal(started.code, 0)
  assert.deepEqual(startNotice(started.out), { user: RETIRED, agent: null })
  assert.equal((await prompt(ctx, vars)).code, 0)
  recordEpic(ctx, '42')
  assert.equal((await stop(ctx, vars)).out, '')
  assert.equal((await bash(ctx, vars)).code, 0)
  assert.deepEqual(ctx.api.requests, [], 'no hook reaches the server by the number')
  assertNoGuesses(ctx)
  assert.deepEqual(denyLists(ctx), [])
}))

test('with both variables the name addresses the project and the session start still says the line', () => withEnv(async (ctx) => {
  const vars = { CONPORT_PROJECT_ID: '42', CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' }
  await prompt(ctx, vars)
  const started = await sessionStart(ctx, vars)
  const told = startNotice(started.out)
  assert.equal(told.user.split('\n')[0], RETIRED)
  assert.ok(told.user.includes('ConPort project: k7m2qx9d/my-proj (from CONPORT_PROJECT_NAME)'))
  assert.ok(!told.agent.includes(RETIRED), 'the line about the retired variable is for the user only')
  assert.deepEqual(ctx.api.requests, [
    { url: '/api/v1/projects/my-proj/epic-tails', team: 'k7m2qx9d' },
    { url: '/api/v1/hooks/conventions?project=k7m2qx9d%2Fmy-proj', team: undefined },
  ])
}))

test('the line is said only when CONPORT_PROJECT_ID holds a value', () => withEnv(async (ctx) => {
  for (const vars of [{}, { CONPORT_PROJECT_ID: '' }, { CONPORT_PROJECT_ID: '   ' },
    { CONPORT_PROJECT_NAME: 'my-proj' }, { CONPORT_PROJECT_NAME: 'my-proj', CONPORT_PROJECT_ID: ' ' }]) {
    const started = await sessionStart(ctx, vars)
    assert.equal(started.code, 0)
    assert.equal(saysRetired(started.out), false, JSON.stringify(vars))
  }
  // Any value counts, a name-shaped one too: the variable is not read as a project.
  const named = await sessionStart(ctx, { CONPORT_PROJECT_ID: 'my-proj' })
  assert.deepEqual(startNotice(named.out), { user: RETIRED, agent: null })
  assert.equal(ctx.api.requests.filter((r) => !r.url.endsWith('?project=my-proj')).length, 0)
}))

test('a handle in CONPORT_PROJECT_NAME is the path segment, with no team header', () => withEnv(async (ctx) => {
  const vars = { CONPORT_PROJECT_NAME: 'prk7m2qx9d' }
  await prompt(ctx, vars)
  await sessionStart(ctx, vars)
  assert.deepEqual(ctx.api.requests, [
    { url: '/api/v1/projects/prk7m2qx9d/epic-tails', team: undefined },
    { url: '/api/v1/hooks/conventions?project=prk7m2qx9d', team: undefined },
  ])
}))

// The workflow helper cannot import the hooks' module, so the rule lives in
// two places; the same names must come out the same from both.
test('the hooks and the workflow helper split a name by one rule', () => {
  const names = ['my-proj', '99', ' my-proj ', 'pers/my-proj', 'k7m2qx9d/my-proj',
    '', '   ', '/', '/my-proj', 'pers/', 'a/b/c', 'a//b', undefined, null]
  for (const name of names) {
    const hook = parseProject(name)
    assert.deepEqual(projectAddress(name), hook && { team: hook.team, project: hook.project }, JSON.stringify(name))
  }
  assert.deepEqual(parseProject('k7m2qx9d/my-proj'), { raw: 'k7m2qx9d/my-proj', team: 'k7m2qx9d', project: 'my-proj' })
  assert.equal(parseProject('a/b/c'), null)
})

test('the tails cache is keyed by the canonical name', () => withEnv(async (ctx) => {
  await prompt(ctx, { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' }, 's1')
  await prompt(ctx, { CONPORT_PROJECT_NAME: 'my-proj' }, 's2')
  const files = hookState(ctx)
  assert.deepEqual(files.filter((f) => f.startsWith('epic_tails_')).sort(),
    ['epic_tails_k7m2qx9d%2Fmy-proj.json', 'epic_tails_my-proj.json'])
  assert.deepEqual(files.filter((f) => f.startsWith('project_id_')), [])
  assert.equal(tailsRequests(ctx).length, 2, 'the second name is not served from the first one\'s cache')
}))

for (const name of ['a/b/c', '/my-proj', 'pers/', '/']) {
  test(`an invalid name is treated as no project: ${name}`, () => withEnv(async (ctx) => {
    assert.equal((await sessionStart(ctx, { CONPORT_PROJECT_NAME: name })).code, 0)
    assert.equal((await prompt(ctx, { CONPORT_PROJECT_NAME: name })).code, 0)
    assert.deepEqual(ctx.api.requests, [])
    assertNoGuesses(ctx)
  }))
}
