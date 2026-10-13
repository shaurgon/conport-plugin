// How the hooks address a project: the only sources are CONPORT_PROJECT_ID and
// CONPORT_PROJECT_NAME, a `team/project` name is split into the team header and
// the short path segment, and without either variable no hook reaches the
// server. Every hook runs as the real script in a child process against a
// local stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { projectAddress } from '../../workflows/wf-helper.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const TEAM_HEADER = 'x-conport-team-id'
const { parseProject } = createRequire(import.meta.url)('../_common.js')

// Records the raw request line and headers of every call, and answers the
// routes the hooks read; `conventions` is the deny-list served next.
async function startApi() {
  const api = { requests: [], bodies: [], waiting: [], conventions: [] }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      api.requests.push({ url: req.url, team: req.headers[TEAM_HEADER] })
      if (body) api.bodies.push(JSON.parse(body))
      for (const resolve of api.waiting.splice(0)) resolve()
      res.setHeader('content-type', 'application/json')
      if (req.url.endsWith('/epic-tails')) res.end('{"tails": []}')
      else if (req.url.includes('/tasks?')) res.end('{"tasks": [], "total": 0}')
      else if (req.url.endsWith('/milestones')) res.end('[]')
      else res.end(JSON.stringify({ conventions: api.conventions }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  // The reflection is posted by a detached child after its hook has exited.
  api.nextRequest = () => new Promise((resolve) => api.waiting.push(resolve))
  api.close = () => new Promise((resolve) => server.close(resolve))
  return api
}

// A working directory that is a git repository with an origin remote, and a
// stand-in `git` first on PATH: it answers with a repository URL and leaves a
// marker, so a hook that falls back to the repository name is caught twice —
// by the marker and by the request the name would produce.
function makeRepo(root) {
  const repo = join(root, 'some-repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(repo, '.git', 'config'),
    '[remote "origin"]\n\turl = https://example.com/acme/some-repo.git\n')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const marker = join(root, 'git-was-run')
  writeFileSync(join(bin, 'git'),
    `#!/bin/sh\necho run >> '${marker}'\necho https://example.com/acme/some-repo.git\n`)
  chmodSync(join(bin, 'git'), 0o755)
  return { repo, bin, marker }
}

async function withEnv(fn) {
  const api = await startApi()
  const root = mkdtempSync(join(tmpdir(), 'conport-address-'))
  const dataDir = join(root, 'data')
  mkdirSync(dataDir)
  try {
    await fn({ api, root, dataDir, ...makeRepo(root) })
  } finally {
    await api.close()
    rmSync(root, { recursive: true, force: true })
  }
}

// `vars` is the whole project addressing of the run: both variables are
// removed first, so a test names exactly the ones it means.
function runHook(script, payload, ctx, vars = {}) {
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  delete env.CONPORT_PROJECT_ID
  delete env.CONPORT_PROJECT_NAME
  Object.assign(env, {
    CLAUDE_PLUGIN_DATA: ctx.dataDir,
    CONPORT_URL: ctx.api.url,
    CONPORT_API_KEY: 'cport_test_key',
    PATH: `${ctx.bin}:/usr/bin:/bin`,
    ...vars,
  })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env, cwd: ctx.repo })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(JSON.stringify(payload))
  })
}

const prompt = (ctx, vars, session = 's1') =>
  runHook('user-prompt-submit.js', { session_id: session, prompt: 'hi' }, ctx, vars)
const sessionStart = (ctx, vars) => runHook('session-start.js', {}, ctx, vars)

// A transcript long enough for the SessionEnd hook to queue a reflection.
function transcript(ctx) {
  const file = join(ctx.root, 'transcript.jsonl')
  const lines = [1, 2, 3, 4, 5, 6].map((n) => JSON.stringify({
    type: 'user', message: { content: [{ type: 'text', text: `a meaningful prompt number ${n}` }] },
  }))
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}
const sessionEnd = (ctx, vars) =>
  runHook('session-reflect.js', { session_id: 's1', transcript_path: transcript(ctx) }, ctx, vars)

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
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: ctx.dataDir, ...vars }
  for (const name of ['CONPORT_PROJECT_ID', 'CONPORT_PROJECT_NAME']) if (!(name in vars)) delete env[name]
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
    { url: '/api/v1/hooks/conventions?project_id=k7m2qx9d%2Fmy-proj', team: undefined },
  ])
}))

test('the reflection payload carries the canonical name whole', () => withEnv(async (ctx) => {
  const posted = ctx.api.nextRequest()
  const { code } = await sessionEnd(ctx, { CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  assert.equal(code, 0)
  await posted
  assert.deepEqual(ctx.api.requests, [{ url: '/api/v1/hooks/reflect-session', team: undefined }])
  assert.equal(ctx.api.bodies[0].project_id, 'k7m2qx9d/my-proj')
}))

test('without CONPORT_PROJECT_NAME no hook calls the server', () => withEnv(async (ctx) => {
  assert.equal((await sessionStart(ctx)).code, 0)
  assert.equal((await prompt(ctx)).code, 0)
  assert.equal((await sessionEnd(ctx)).code, 0)
  recordEpic(ctx, '99')
  const stopped = await stop(ctx)
  assert.equal(stopped.code, 0)
  assert.equal(stopped.out, '')

  assert.deepEqual(ctx.api.requests, [])
  assert.equal(existsSync(ctx.marker), false, 'no hook may run git to guess a project')
  assert.deepEqual(readdirSync(ctx.dataDir).filter((f) => f.startsWith('reflect-')), [],
    'no reflection is queued for a session with no project')
  assert.match(readFileSync(join(ctx.dataDir, 'session-end.log'), 'utf8'), /SKIP: no project identifier/)
  assert.deepEqual(hookState(ctx).filter((f) => /^(project_id|epic_tails)_/.test(f)), [])
  assert.deepEqual(denyLists(ctx), [])
}))

test('the Stop hook splits a recorded team/project name and sends a recorded id bare', () => withEnv(async (ctx) => {
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
  await sessionStart(ctx, { CONPORT_PROJECT_ID: '99' })
  assert.deepEqual(denyLists(ctx), ['deny-list.json', 'deny-list_99.json'])
}))

test('CONPORT_PROJECT_ID still wins and sends no team header', () => withEnv(async (ctx) => {
  await prompt(ctx, { CONPORT_PROJECT_ID: '42', CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  await sessionStart(ctx, { CONPORT_PROJECT_ID: '42', CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  assert.deepEqual(ctx.api.requests, [
    { url: '/api/v1/projects/42/epic-tails', team: undefined },
    { url: '/api/v1/hooks/conventions?project_id=42', team: undefined },
  ])
  const posted = ctx.api.nextRequest()
  await sessionEnd(ctx, { CONPORT_PROJECT_ID: '42', CONPORT_PROJECT_NAME: 'k7m2qx9d/my-proj' })
  await posted
  assert.equal(ctx.api.bodies[0].project_id, '42')
}))

test('a CONPORT_PROJECT_ID that is not a number is read as a name', () => withEnv(async (ctx) => {
  await prompt(ctx, { CONPORT_PROJECT_ID: 'k7m2qx9d/my-proj' }, 's1')
  await prompt(ctx, { CONPORT_PROJECT_ID: 'a/b/c', CONPORT_PROJECT_NAME: 'other' }, 's2')
  assert.deepEqual(ctx.api.requests, [{ url: '/api/v1/projects/my-proj/epic-tails', team: 'k7m2qx9d' }])
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
    assert.equal((await sessionEnd(ctx, { CONPORT_PROJECT_NAME: name })).code, 0)
    assert.deepEqual(ctx.api.requests, [])
    assert.equal(existsSync(ctx.marker), false)
  }))
}
