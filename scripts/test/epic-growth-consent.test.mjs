// The person's consent to grow an epic that has a plan: the UserPromptSubmit
// hook records it from a message that is exactly `allow epic <N> in <project>`
// (or `allow epic <N>` when the session has a project), the consent module
// reads and spends it, and the Bash hook refuses any command that names the
// consent file.
// The hooks run as the real scripts in child processes, in a folder outside
// this repository, against a local stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs, { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isolatedDir, isolatedEnv, REPO_ROOT } from './support/isolated.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const consent = require('../epic-growth-consent.js')
const {
  parseConsentPhrase, writeConsent, takeConsent, withinBudget, CONSENT_FILE,
} = consent
const { parseProject } = require('../_common.js')

const HANDLE = 'prk7m2qx9d'
const TEAM = 'k7m2qx9d'
const TEAM_HANDLE = 'prq3wz8m4t'
const PROMPT_FIXTURES = join(REPO_ROOT, 'cli', 'conport', 'test', 'fixtures', 'prompt')
const REFUSAL = 'BLOCKED: only the person gives this consent; ask them to reply: allow epic <N> in <project>.'

// Records every request and answers the routes the prompt hook reads: the
// project `api` resolves to one handle in the Private Team and to another in
// the team the header names, `my project` (a name with a space) to the first
// handle; `silent` accepts the request and never answers; `broken` fails
// with 500 (its body carries a handle, which is not to be taken) and
// `nohandle` answers 200 with no handle; any other project is unknown (404).
async function startApi() {
  const api = { requests: [] }
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const team = req.headers['x-conport-team-id']
      api.requests.push({ url: req.url, team, auth: req.headers.authorization })
      res.setHeader('content-type', 'application/json')
      if (req.url.endsWith('/epic-tails')) return res.end('{"tails": []}')
      if (req.url === '/api/v1/projects/silent') return undefined
      if (req.url === '/api/v1/projects/broken') {
        res.statusCode = 500
        return res.end(JSON.stringify({ detail: 'boom', handle: TEAM_HANDLE }))
      }
      if (req.url === '/api/v1/projects/nohandle') return res.end('{"canonical_name": "nohandle"}')
      if (req.url === '/api/v1/projects/my%20project') {
        return res.end(JSON.stringify({ handle: HANDLE, canonical_name: 'my project' }))
      }
      if (req.url === '/api/v1/projects/api') {
        return res.end(JSON.stringify({ handle: team === TEAM ? TEAM_HANDLE : HANDLE, canonical_name: 'api' }))
      }
      res.statusCode = 404
      res.end('{"detail": "not found"}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  // A request left unanswered keeps its connection open: end it on close.
  api.close = () => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  })
  return api
}

// An address nothing listens on: the server does not answer.
async function deadUrl() {
  const api = await startApi()
  await api.close()
  return api.url
}

function run(script, payload, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env, cwd })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(JSON.stringify(payload))
  })
}

// One prompt hook run: `vars` is the whole project addressing of the run.
async function prompt(ctx, text, vars = {}) {
  const env = isolatedEnv({
    CLAUDE_PLUGIN_DATA: ctx.dataDir,
    CONPORT_URL: ctx.url,
    CONPORT_API_KEY: 'cport_test_key',
    ...vars,
  })
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  const res = await run('user-prompt-submit.js', { session_id: 's1', cwd: ctx.cwd, prompt: text }, { cwd: ctx.cwd, env })
  assert.equal(res.code, 0, res.err)
  const context = res.out ? JSON.parse(res.out).hookSpecificOutput.additionalContext : ''
  return { ...res, context }
}

function storedConsent(ctx) {
  const file = join(ctx.dataDir, CONSENT_FILE)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

async function withApi(fn) {
  const api = await startApi()
  const cwd = isolatedDir()
  const dataDir = isolatedDir()
  try {
    await fn({ api, url: api.url, cwd, dataDir })
  } finally {
    await api.close()
  }
}

// --- the phrase ---------------------------------------------------------------

test('parseConsentPhrase matches only the whole message, in any case, with spaces at the ends', () => {
  const session = parseProject(HANDLE)
  assert.deepEqual(parseConsentPhrase('allow epic 7', session), { project: HANDLE, epic: 7 })
  assert.deepEqual(parseConsentPhrase('  Allow Epic 7 \n', session), { project: HANDLE, epic: 7 })
  assert.deepEqual(parseConsentPhrase('allow epic 7', null), { needsProject: true, epic: 7 })
  assert.deepEqual(parseConsentPhrase('allow epic 7 in api', null), { project: 'api', epic: 7 })
  assert.deepEqual(parseConsentPhrase('allow epic 7 in k7m2qx9d/api', session), { project: 'k7m2qx9d/api', epic: 7 })
  assert.deepEqual(parseConsentPhrase('ALLOW EPIC 7 IN PRK7M2QX9D', null), { project: HANDLE, epic: 7 })
  // The project is the rest of the line: a name may hold spaces.
  assert.deepEqual(parseConsentPhrase('allow epic 7 in my project', null), { project: 'my project', epic: 7 })
  assert.deepEqual(parseConsentPhrase('allow epic 7 in  k7m2qx9d/my project ', null),
    { project: 'k7m2qx9d/my project', epic: 7 })
  for (const text of [
    'please allow epic 7 later', 'allow epic 7 later', 'allow epic 7.', 'allow epic 0', 'allow epic -7',
    'allow epic seven', 'allow epic 7 in', 'allow epic 7 in a/b/c', 'allow epic 7 in /api', 'allow epic',
    'allow epic 7\nallow epic 8', 'allow epic 99999999999999999999', '',
  ]) {
    assert.equal(parseConsentPhrase(text, session), null, JSON.stringify(text))
  }
  assert.equal(parseConsentPhrase(undefined, session), null)
})

// --- the prompt hook ---------------------------------------------------------

test('allow epic 7 with a session project writes the handle', async () => {
  await withApi(async (ctx) => {
    const res = await prompt(ctx, '  Allow Epic 7 ', { CONPORT_PROJECT_NAME: HANDLE })
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
    assert.ok(res.context.includes('consent for epic task-7 recorded'), res.context)
    // A handle needs no lookup.
    assert.deepEqual(ctx.api.requests.filter((r) => r.url === `/api/v1/projects/${HANDLE}`), [])
  })
})

test('allow epic 7 with a session project named by name writes its handle', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7', { CONPORT_PROJECT_NAME: 'api' })
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
  })
})

test('allow epic 7 without a session project writes nothing and asks for the full form', async () => {
  await withApi(async (ctx) => {
    const res = await prompt(ctx, 'allow epic 7')
    assert.equal(storedConsent(ctx), null)
    assert.ok(res.context.includes('say: allow epic 7 in <project>'), res.context)
    assert.ok(!res.context.includes('recorded'), res.context)
  })
})

test('allow epic 7 in api resolves the name to the handle', async () => {
  await withApi(async (ctx) => {
    const res = await prompt(ctx, 'allow epic 7 in api')
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
    assert.ok(res.context.includes('consent for epic task-7 recorded'), res.context)
    const lookup = ctx.api.requests.find((r) => r.url === '/api/v1/projects/api')
    assert.ok(lookup, 'the name is looked up')
    assert.equal(lookup.team, undefined)
    assert.equal(lookup.auth, 'Bearer cport_test_key')
  })
})

test('allow epic 7 in api without an answer from the server stores the project as named', async () => {
  await withApi(async (ctx) => {
    const res = await prompt({ ...ctx, url: await deadUrl() }, 'allow epic 7 in api')
    assert.deepEqual(storedConsent(ctx), { project: 'api', epic: 7 })
    assert.ok(res.context.includes('consent for epic task-7 recorded'), res.context)
  })
})

// The lookup has its own budget: a server that takes the request and never
// answers neither holds the person's message past it nor loses the consent.
test('allow epic 7 in a project the server never answers for stores it as named within the budget', async () => {
  await withApi(async (ctx) => {
    const started = Date.now()
    const res = await prompt(ctx, 'allow epic 7 in silent')
    const elapsed = Date.now() - started
    assert.ok(ctx.api.requests.some((r) => r.url === '/api/v1/projects/silent'), 'the name is looked up')
    assert.deepEqual(storedConsent(ctx), { project: 'silent', epic: 7 })
    assert.ok(res.context.includes('consent for epic task-7 recorded'), res.context)
    assert.ok(elapsed < 5000, `the hook took ${elapsed} ms`)
  })
})

test('allow epic 7 in my project resolves a name with a space', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7 in my project')
    assert.ok(ctx.api.requests.some((r) => r.url === '/api/v1/projects/my%20project'), 'the whole name is looked up')
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
  })
})

// A 404 is an answer: the project does not exist, and a consent kept under
// its name could never match. Nothing is written, an earlier consent stays.
const notFoundLine = (name) => `consent not recorded: no project "${name}"; say: allow epic 7 in <project handle>`

test('allow epic 7 in an unknown project writes nothing and names the handle form', async () => {
  await withApi(async (ctx) => {
    const res = await prompt(ctx, 'allow epic 7 in web')
    assert.ok(ctx.api.requests.some((r) => r.url === '/api/v1/projects/web'))
    assert.equal(storedConsent(ctx), null)
    assert.ok(res.context.includes(notFoundLine('web')), res.context)
    assert.ok(!res.context.includes('consent for epic'), res.context)
  })
})

test('allow epic 7 in api, thanks writes nothing and names the handle form', async () => {
  await withApi(async (ctx) => {
    const res = await prompt(ctx, 'allow epic 7 in api, thanks')
    assert.ok(ctx.api.requests.some((r) => r.url === '/api/v1/projects/api%2C%20thanks'))
    assert.equal(storedConsent(ctx), null)
    assert.ok(res.context.includes(notFoundLine('api, thanks')), res.context)
    assert.ok(!res.context.includes('consent for epic'), res.context)
  })
})

test('a 404 in a named team leaves an earlier consent in place', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7 in prk7m2qx9d')
    const res = await prompt(ctx, 'allow epic 7 in k7m2qx9d/web')
    const lookup = ctx.api.requests.find((r) => r.url === '/api/v1/projects/web')
    assert.equal(lookup.team, TEAM)
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
    assert.ok(res.context.includes(notFoundLine('k7m2qx9d/web')), res.context)
    assert.ok(!res.context.includes('consent for epic'), res.context)
  })
})

// Anything but a 404 or a handle is no answer: the project is kept as named.
test('a failing server or an answer without a handle stores the project as named', async () => {
  for (const name of ['broken', 'nohandle']) {
    await withApi(async (ctx) => {
      const res = await prompt(ctx, `allow epic 7 in ${name}`)
      assert.ok(ctx.api.requests.some((r) => r.url === `/api/v1/projects/${name}`))
      assert.deepEqual(storedConsent(ctx), { project: name, epic: 7 }, name)
      assert.ok(res.context.includes('consent for epic task-7 recorded'), res.context)
    })
  }
})

test('a consent the data folder cannot take is said, and the rest of the answer stays', async () => {
  const phrase = `allow epic 7 in ${HANDLE}`
  let recorded
  await withApi(async (ctx) => {
    recorded = await prompt(ctx, phrase)
    assert.ok(recorded.context.includes('consent for epic task-7 recorded'), recorded.context)
  })
  await withApi(async (ctx) => {
    // A folder where the consent file goes: writing it fails on every system.
    mkdirSync(join(ctx.dataDir, CONSENT_FILE))
    const res = await prompt(ctx, phrase)
    const lines = res.context.split('\n\n')
    const failed = lines.find((l) => l.startsWith('consent for epic task-7 not recorded: '))
    assert.match(failed || '', /^consent for epic task-7 not recorded: \S+$/, res.context)
    assert.ok(!res.context.includes('consent for epic task-7 recorded'), res.context)
    assert.deepEqual(lines.filter((l) => l !== failed),
      recorded.context.split('\n\n').filter((l) => l !== 'consent for epic task-7 recorded'))
  })
})

test('without an API key the project is stored as named without a lookup', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7 in web', { CONPORT_API_KEY: '' })
    assert.deepEqual(ctx.api.requests.filter((r) => r.url.startsWith('/api/v1/projects/web')), [])
    assert.deepEqual(storedConsent(ctx), { project: 'web', epic: 7 })
  })
})

test('allow epic 7 in prk7m2qx9d writes the handle without a lookup', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7 in prk7m2qx9d')
    assert.deepEqual(storedConsent(ctx), { project: HANDLE, epic: 7 })
    assert.deepEqual(ctx.api.requests.filter((r) => r.url.startsWith('/api/v1/projects/pr')), [])
  })
})

test('allow epic 7 in k7m2qx9d/api looks the name up in that team', async () => {
  await withApi(async (ctx) => {
    await prompt(ctx, 'allow epic 7 in k7m2qx9d/api', { CONPORT_PROJECT_NAME: HANDLE })
    const lookup = ctx.api.requests.find((r) => r.url === '/api/v1/projects/api')
    assert.ok(lookup, 'the name is looked up')
    assert.equal(lookup.team, TEAM)
    assert.deepEqual(storedConsent(ctx), { project: TEAM_HANDLE, epic: 7 })
  })
})

test('please allow epic 7 later writes nothing', async () => {
  await withApi(async (ctx) => {
    for (const text of ['please allow epic 7 later', 'allow epic 7 in api\nthanks', 'allow epic 0 in api']) {
      const res = await prompt(ctx, text, { CONPORT_PROJECT_NAME: HANDLE })
      assert.equal(storedConsent(ctx), null, text)
      assert.ok(!res.context.includes('consent for epic'), res.context)
      assert.ok(!res.context.includes('say: allow epic'), res.context)
    }
  })
})

test('no conport prompt fixture grants consent', async () => {
  const fixtures = readdirSync(PROMPT_FIXTURES).filter((f) => f.endsWith('.txt'))
  assert.ok(fixtures.length > 0, 'the conport prompt fixtures are there')
  await withApi(async (ctx) => {
    for (const name of fixtures) {
      const text = readFileSync(join(PROMPT_FIXTURES, name), 'utf8')
      const res = await prompt(ctx, text, { CONPORT_PROJECT_NAME: HANDLE })
      assert.equal(storedConsent(ctx), null, name)
      assert.ok(!res.context.includes('consent for epic'), name)
      // A start text that carries the phrase on a line of its own is still not
      // the person's message as a whole.
      for (const phrase of ['allow epic 7', `allow epic 7 in ${HANDLE}`]) {
        await prompt(ctx, `${text}\n${phrase}\n`, { CONPORT_PROJECT_NAME: HANDLE })
        await prompt(ctx, `${phrase}\n${text}`, { CONPORT_PROJECT_NAME: HANDLE })
        assert.equal(storedConsent(ctx), null, `${name} with ${phrase}`)
      }
    }
  })
})

// --- the consent module ------------------------------------------------------

// The test's own timeout turns a budget that never ends into a failure, not a hang.
test('withinBudget answers null for a promise that never settles, within the budget', { timeout: 2000 }, async () => {
  const started = Date.now()
  assert.equal(await withinBudget(new Promise(() => {}), 50), null)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 40 && elapsed < 1000, `took ${elapsed} ms`)
})

test('withinBudget passes a value through and turns a rejection into null', async () => {
  assert.deepEqual(await withinBudget(Promise.resolve({ status: 200 }), 1000), { status: 200 })
  assert.equal(await withinBudget(Promise.reject(new Error('refused')), 1000), null)
})

function withDataDir(fn) {
  const before = process.env.CLAUDE_PLUGIN_DATA
  const dir = isolatedDir()
  process.env.CLAUDE_PLUGIN_DATA = dir
  try {
    return fn(dir)
  } finally {
    if (before === undefined) delete process.env.CLAUDE_PLUGIN_DATA
    else process.env.CLAUDE_PLUGIN_DATA = before
  }
}

test('the consent file lives in the data dir of the plugin', () => {
  withDataDir((dir) => {
    assert.equal(CONSENT_FILE, 'epic-growth-allow.json')
    writeConsent({ project: HANDLE, epic: 7 })
    assert.deepEqual(JSON.parse(readFileSync(join(dir, CONSENT_FILE), 'utf8')), { project: HANDLE, epic: 7 })
  })
})

test('takeConsent spends a consent once', () => {
  withDataDir((dir) => {
    writeConsent({ project: HANDLE, epic: 7 })
    assert.equal(takeConsent(HANDLE, 7), true)
    assert.equal(existsSync(join(dir, CONSENT_FILE)), false)
    assert.equal(takeConsent(HANDLE, 7), false)
  })
})

test('takeConsent leaves a consent for another project or epic in place', () => {
  withDataDir((dir) => {
    writeConsent({ project: HANDLE, epic: 7 })
    assert.equal(takeConsent(HANDLE, 8), false)
    assert.equal(takeConsent(TEAM_HANDLE, 7), false)
    assert.equal(takeConsent('prk7m2qx9', 7), false)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, CONSENT_FILE), 'utf8')), { project: HANDLE, epic: 7 })
  })
})

// Two calls read the same consent at once: the one whose removal finds the file
// already gone did not spend it and is not let through.
test('takeConsent answers false when a parallel call spent the consent first', () => {
  withDataDir(() => {
    const realUnlink = fs.unlinkSync
    fs.unlinkSync = (file) => {
      realUnlink(file) // the parallel call removes it first
      realUnlink(file)
    }
    try {
      writeConsent({ project: HANDLE, epic: 7 })
      assert.equal(takeConsent(HANDLE, 7), false)
    } finally {
      fs.unlinkSync = realUnlink
    }
  })
})

test('takeConsent with no consent and with an unreadable one answers false', () => {
  withDataDir((dir) => {
    assert.equal(takeConsent(HANDLE, 7), false)
    writeFileSync(join(dir, CONSENT_FILE), '{not json')
    assert.equal(takeConsent(HANDLE, 7), false)
    writeFileSync(join(dir, CONSENT_FILE), JSON.stringify({ project: HANDLE, epic: '7' }))
    assert.equal(takeConsent(HANDLE, 7), false)
    // A file named as the consent without `.json` is no consent.
    writeFileSync(join(dir, 'epic-growth-allow'), `${HANDLE}:7\n`)
    assert.equal(takeConsent(HANDLE, 7), false)
    assert.equal(existsSync(join(dir, 'epic-growth-allow')), true)
  })
})

// --- the Bash hook -----------------------------------------------------------

function bash(command) {
  const cwd = isolatedDir()
  const env = isolatedEnv()
  return run('check-command.js', { cwd, tool_input: { command } }, { cwd, env })
}

test('check-command refuses a command naming epic-growth-allow', async () => {
  for (const command of [
    `echo ${HANDLE}:7 > ~/.claude/plugin-data/conport/epic-growth-allow`,
    `printf '{"project":"${HANDLE}","epic":7}' > "$CLAUDE_PLUGIN_DATA/epic-growth-allow.json"`,
    'cat /tmp/x | tee EPIC-GROWTH-ALLOW',
  ]) {
    const res = await bash(command)
    assert.equal(res.code, 2, command)
    assert.equal(res.err, `${REFUSAL}\n`)
  }
})

test('check-command lets other commands through as before', async () => {
  for (const command of ['ls -la', 'echo epic growth allow', 'cat epic-growth.json']) {
    const res = await bash(command)
    assert.equal(res.code, 0, `${command}: ${res.err}`)
    assert.equal(res.err, '')
  }
})
