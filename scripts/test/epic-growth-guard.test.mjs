// The epic growth hook: PreToolUse on ConPort `add_task` and `update_task`
// holds a new task in an epic that has a plan — and an `update_task` that
// attaches a task with no epic to one — until the description says why it is
// not a fix round and the person said yes. The hook runs as the real script in
// a child process, in a folder outside this repository, against a local
// stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isolatedDir, isolatedEnv } from './support/isolated.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const HANDLE = 'prk7m2qx9d'
const OTHER_HANDLE = 'prq3wz8m4t'
const TEAM = 'k7m2qx9d'
const ADD = 'mcp__plugin_conport_conport__add_task'
const UPDATE = 'mcp__plugin_conport_conport__update_task'
const PREFIX = 'Why not a fix round: the goal needs a migration no plan task holds.'

// The refusals, word for word.
const R1 = (p) => `A new task in epic task-${p} grows an epic that has a plan. A finding is a fix round of ` +
  "the task it came from; a final review's or gap hunt's finding is a fix round of the " +
  "epic's final-review task (or, in an epic without one, of the task whose code it is in); " +
  "a finding outside the epic's goal goes to the tails epic of the release. Only for new " +
  "work the goal needs: start the description with 'Why not a fix round:' and call again."
const R2 = (p, project) => `A new task in epic task-${p} needs the person's yes. Ask them in a plain ` +
  'message, not with a question tool, in one line why this is not a fix round and to ' +
  `reply: allow epic ${p} in ${project}. Then call again; a refused call needs a new yes. ` +
  'Never write that reply or the consent file yourself.'
const R3 = (p) => `A subagent does not grow epic task-${p}. Put the task you would file, with its ` +
  "'Why not a fix round:' line, into your answer; the session that dispatched you decides."
const R4 = (p) => `ConPort did not say whether epic task-${p} has a plan; call again in a minute.`

// A task as GET /projects/{project}/tasks/{id} answers it.
function epic(id, { plan_started = false, plan_document = false, title = 'Billing', project = HANDLE } = {}) {
  return {
    id, project, kind: 'epic', title, description: '', status: 'IN_PROGRESS', parent_task_id: null,
    epic_progress: {
      epic_id: id, epic_title: title, open_children: 3, total_children: 5, closable: false,
      plan_started, plan_document,
    },
  }
}
function leaf(id, { parent = null, description = '', project = HANDLE } = {}) {
  return { id, project, kind: 'task', title: `Task ${id}`, description, status: 'TODO', parent_task_id: parent }
}

// Answers GET /api/v1/projects/<segment>/tasks/<id> from `api.tasks`, keyed
// by `<segment>/<id>`: a value is a body (200), or { status, raw, hang, drop }
// (`drop` closes the connection unanswered), or { delayMs, body } — the body
// answered after a delay. Records every request with its team header and key.
async function startApi() {
  const api = { requests: [], tasks: {} }
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      api.requests.push({ url: req.url, team: req.headers['x-conport-team-id'], auth: req.headers.authorization })
      const m = /^\/api\/v1\/projects\/([^/]+)\/tasks\/(\d+)$/.exec(req.url)
      const entry = m ? api.tasks[`${m[1]}/${m[2]}`] : undefined
      if (entry && entry.hang) return undefined
      if (entry && entry.drop) return req.socket.destroy()
      if (entry && entry.delayMs) {
        return setTimeout(() => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(entry.body))
        }, entry.delayMs)
      }
      res.setHeader('content-type', 'application/json')
      if (entry === undefined) {
        res.statusCode = 404
        return res.end('{"detail": "not found"}')
      }
      if (entry && entry.raw !== undefined) {
        res.statusCode = entry.status || 200
        return res.end(entry.raw)
      }
      res.end(JSON.stringify(entry))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  api.close = () => new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  })
  return api
}

// `flag` leaves the mark the prompt hook writes on a session's first message;
// the guard does not depend on it, and a test without it shows that.
async function withApi(fn, { flag = true } = {}) {
  const api = await startApi()
  const root = isolatedDir()
  const dataDir = join(root, 'data')
  mkdirSync(join(dataDir, 'session_logs'), { recursive: true })
  if (flag) writeFileSync(join(dataDir, 'session_logs', 's1_restored.flag'), '')
  try {
    await fn({ api, root, dataDir })
  } finally {
    await api.close()
  }
}

function runScript(script, payload, ctx, vars = {}) {
  const env = isolatedEnv()
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  delete env.CONPORT_EPIC_GROWTH_GUARD
  Object.assign(env, {
    CLAUDE_PLUGIN_DATA: ctx.dataDir,
    CONPORT_URL: ctx.api.url,
    CONPORT_API_KEY: 'cport_test_key',
    ...vars,
  })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env, cwd: ctx.root })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  })
}

const runGuard = (payload, ctx, vars) => runScript('guard-epic-growth.js', payload, ctx, vars)

const call = (tool, toolInput, extra = {}) => ({
  session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, ...extra,
})
const add = (toolInput, extra) => call(ADD, { project: HANDLE, title: 'New', ...toolInput }, extra)
const update = (toolInput, extra) => call(UPDATE, { project: HANDLE, ...toolInput }, extra)

function reason(res) {
  assert.equal(res.code, 0)
  const out = JSON.parse(res.out)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  return out.hookSpecificOutput.permissionDecisionReason
}
function passes(res) {
  assert.equal(res.code, 0)
  assert.equal(res.out, '')
}

const consentFile = (ctx) => join(ctx.dataDir, 'epic-growth-allow.json')
const giveConsent = (ctx, project, epicId) =>
  writeFileSync(consentFile(ctx), JSON.stringify({ project, epic: epicId }))

// --- the switch and the calls the hook leaves alone -------------------------

test('CONPORT_EPIC_GROWTH_GUARD=off passes every call without a request', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3)
    passes(await runGuard(add({ parent_task_id: 7 }), ctx, { CONPORT_EPIC_GROWTH_GUARD: 'off' }))
    passes(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx, { CONPORT_EPIC_GROWTH_GUARD: 'off' }))
    assert.deepEqual(ctx.api.requests, [])
  })
})

test('another value of the switch leaves the hook on', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    for (const value of ['on', 'OFF', 'no', '']) {
      assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx, { CONPORT_EPIC_GROWTH_GUARD: value })), R1(7))
    }
  })
})

test('add_task without a positive parent passes before any request', async () => {
  await withApi(async (ctx) => {
    for (const parent of [undefined, null, 0, -3, 1.5, '0', 'seven', false]) {
      const input = parent === undefined ? {} : { parent_task_id: parent }
      passes(await runGuard(add(input), ctx))
    }
    assert.deepEqual(ctx.api.requests, [])
  })
})

test('a parent that is not an epic passes: the server answers parent_not_epic itself', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = leaf(7)
    passes(await runGuard(add({ parent_task_id: 7 }), ctx))
    assert.equal(ctx.api.requests.length, 1)
  })
})

test('the tails epic of a release passes even with a plan', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { title: 'Tails of release 49', plan_document: true, plan_started: true })
    passes(await runGuard(add({ parent_task_id: 7 }), ctx))
  })
})

test('an epic without a plan passes: a container epic grows freely', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7)
    passes(await runGuard(add({ parent_task_id: 7 }), ctx))
  })
})

// --- R1 ---------------------------------------------------------------------

test('a plan document or a started plan holds a task without the prefix: R1', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    ctx.api.tasks[`${HANDLE}/8`] = epic(8, { plan_started: true })
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx)), R1(7))
    assert.equal(reason(await runGuard(add({ parent_task_id: 8, description: 'Fix the review finding' }), ctx)), R1(8))
  })
})

test('the prefix counts only at the very start of the description', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    for (const description of [` ${PREFIX}`, PREFIX.toLowerCase(), `Note. ${PREFIX}`, 'Why not a fix round']) {
      assert.equal(reason(await runGuard(add({ parent_task_id: 7, description }), ctx)), R1(7))
    }
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
  })
})

test('a parent given as a string of digits is held like the number', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    assert.equal(reason(await runGuard(add({ parent_task_id: '7' }), ctx)), R1(7))
    // The server reads these as 7 too (pydantic, lax), and "7_0" as 70.
    for (const parent of [' 7 ', '7\n', '\u00857', '7\u0085', '+7', '7.0', '+7.00', '07']) {
      assert.equal(reason(await runGuard(add({ parent_task_id: parent }), ctx)), R1(7), JSON.stringify(parent))
    }
    ctx.api.tasks[`${HANDLE}/70`] = epic(70, { plan_document: true })
    assert.equal(reason(await runGuard(add({ parent_task_id: '7_0' }), ctx)), R1(70))
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: '7.0' }), ctx)), R4(7))
    // What the server refuses is no parent here either: the call passes to it.
    const before = ctx.api.requests.length
    for (const parent of ['7.5', '-7', '0x7', '7.', '7__0', '_7', '+ 7', '1e1', '0.0', '+0']) {
      passes(await runGuard(add({ parent_task_id: parent }), ctx))
    }
    assert.equal(ctx.api.requests.length, before)
  })
})

test('a parent given as true is held like epic 1, as the server reads it', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/1`] = epic(1, { plan_document: true })
    assert.equal(reason(await runGuard(add({ parent_task_id: true }), ctx)), R1(1))
    assert.deepEqual(ctx.api.requests.map((r) => r.url), [`/api/v1/projects/${HANDLE}/tasks/1`])
  })
})

// --- R2 and the consent -------------------------------------------------------

test('the prefix without the person\'s yes is R2 with the handle from the answer', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks['api/7'] = epic(7, { plan_document: true })
    assert.equal(reason(await runGuard(add({ project: 'api', parent_task_id: 7, description: PREFIX }), ctx)),
      R2(7, HANDLE))
  })
})

test('R2 names the phrase even in a session the prompt hook has not marked', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    assert.equal(existsSync(join(ctx.dataDir, 'session_logs', 's1_restored.flag')), false)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
  }, { flag: false })
})

test('the consent for this project and epic lets the call through and is spent', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    giveConsent(ctx, HANDLE, 7)
    passes(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx))
    assert.equal(existsSync(consentFile(ctx)), false)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
  })
})

test('a file named as the consent without .json lets nothing through', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    writeFileSync(join(ctx.dataDir, 'epic-growth-allow'), `${HANDLE}:7\n`)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
  })
})

test('a consent for another epic or another project is R2 and stays where it is', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    for (const [project, epicId] of [[HANDLE, 8], [OTHER_HANDLE, 7]]) {
      giveConsent(ctx, project, epicId)
      assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
      assert.deepEqual(JSON.parse(readFileSync(consentFile(ctx), 'utf8')), { project, epic: epicId })
    }
  })
})

test('consent named by the handle matches a call that names the project by name', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks['api/7'] = epic(7, { plan_document: true })
    ctx.api.tasks['api/9'] = epic(9, { plan_document: true })
    giveConsent(ctx, HANDLE, 7)
    passes(await runGuard(add({ project: 'api', parent_task_id: 7, description: PREFIX }), ctx))
    assert.equal(existsSync(consentFile(ctx)), false)
    giveConsent(ctx, HANDLE, 9)
    passes(await runGuard(add({ project: `${TEAM}/api`, parent_task_id: 9, description: PREFIX }), ctx))
    assert.equal(existsSync(consentFile(ctx)), false)
  })
})

test('a handle in the answer spelled in capitals matches the consent kept in lower case', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true, project: HANDLE.toUpperCase() })
    giveConsent(ctx, HANDLE, 7)
    passes(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx))
  })
})

// --- R3 -----------------------------------------------------------------------

test('a call from a subagent is R3 and leaves the consent in place', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    giveConsent(ctx, HANDLE, 7)
    const res = await runGuard(add({ parent_task_id: 7, description: PREFIX }, { agent_id: 'a1b2c3', agent_type: 'general' }), ctx)
    assert.equal(reason(res), R3(7))
    assert.deepEqual(JSON.parse(readFileSync(consentFile(ctx), 'utf8')), { project: HANDLE, epic: 7 })
  })
})

test('a subagent without the prefix is told R1 first', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }, { agent_id: 'a1b2c3' }), ctx)), R1(7))
  })
})

// --- R4 -----------------------------------------------------------------------

test('a 404 of the epic is R4', async () => {
  await withApi(async (ctx) => {
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R4(7))
  })
})

test('an answer the hook cannot read is R4', async () => {
  const progress = epic(7, { plan_document: true }).epic_progress
  const cases = {
    'a server error': { status: 500, raw: '{"detail": "boom"}' },
    'not JSON': { raw: '<html>gateway</html>' },
    'epic_progress null': { ...epic(7), epic_progress: null },
    'no epic_progress key': (() => { const e = epic(7); delete e.epic_progress; return e })(),
    'no plan_document field': { ...epic(7), epic_progress: { ...progress, plan_document: undefined } },
    'no plan_started field': { ...epic(7), epic_progress: { ...progress, plan_started: undefined } },
    'a field that is not a boolean': { ...epic(7), epic_progress: { ...progress, plan_started: 'yes' } },
    'no kind': (() => { const e = epic(7); delete e.kind; return e })(),
    'no title': (() => { const e = epic(7, { plan_document: true }); delete e.title; return e })(),
    'a title that is not a string': { ...epic(7, { plan_document: true }), title: 42 },
    'no project in the answer': (() => { const e = epic(7, { plan_document: true }); delete e.project; return e })(),
  }
  await withApi(async (ctx) => {
    for (const [name, entry] of Object.entries(cases)) {
      ctx.api.tasks[`${HANDLE}/7`] = entry
      assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R4(7), name)
    }
  })
})

test('no server at the address is R4', async () => {
  await withApi(async (ctx) => {
    const res = await runGuard(add({ parent_task_id: 7 }), ctx, { CONPORT_URL: 'http://127.0.0.1:9' })
    assert.equal(reason(res), R4(7))
  })
})

// A read has its own budget, scaled like every hook budget. Shrunk to a
// twentieth (150 ms) it is spent long before an answer sent after LATE_MS;
// unscaled (3 s) that answer would be read, and the call refused as R1, not R4.
const SHRUNK = { CONPORT_HOOK_TIME_SCALE: '0.05' }
const SHRUNK_BUDGET_MS = 150
const LATE_MS = 2000

test('an answer later than the request budget is R4', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = { delayMs: LATE_MS, body: epic(7, { plan_document: true }) }
    const started = Date.now()
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx, SHRUNK)), R4(7))
    // A timer never fires early: the hook waited out the whole budget, it did not fail at once.
    const took = Date.now() - started
    assert.ok(took >= SHRUNK_BUDGET_MS, `took ${took} ms`)
    // The log of R4 names the cause.
    const log = readFileSync(join(ctx.dataDir, 'epic-growth-guard.log'), 'utf8')
    assert.match(log, / epic 7: no answer for task 7\n$/)
  })
})

// The test's own timeout turns a wait the budget does not end into a failure, not a hang.
test('a server that never answers is R4 once the request budget is spent', { timeout: 30000 }, async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = { hang: true }
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx, SHRUNK)), R4(7))
    const log = readFileSync(join(ctx.dataDir, 'epic-growth-guard.log'), 'utf8')
    assert.match(log, / epic 7: no answer for task 7\n$/)
  })
})

test('update_task reads the task, then the epic, and refuses when the epic gets no answer', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3)
    ctx.api.tasks[`${HANDLE}/7`] = { drop: true }
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx)), R4(7))
    assert.deepEqual(ctx.api.requests.map((r) => r.url),
      [`/api/v1/projects/${HANDLE}/tasks/3`, `/api/v1/projects/${HANDLE}/tasks/7`])
    const log = readFileSync(join(ctx.dataDir, 'epic-growth-guard.log'), 'utf8')
    assert.match(log, / epic 7: no answer for task 7\n$/)
  })
})

test('a call that names no project, or no readable input, is R4', async () => {
  await withApi(async (ctx) => {
    assert.equal(reason(await runGuard(call(ADD, { parent_task_id: 7 }), ctx)), R4(7))
    assert.equal(reason(await runGuard(call(ADD, { project: 'a/b/c', parent_task_id: 7 }), ctx)), R4(7))
    assert.equal(reason(await runGuard('not json', ctx)), R4('?'))
    assert.deepEqual(ctx.api.requests, [])
  })
})

test('an exception inside the script is R4, not a pass', async () => {
  await withApi(async (ctx) => {
    // An answer that is not JSON makes JSON.parse throw.
    ctx.api.tasks[`${HANDLE}/7`] = { raw: '{"kind": "epic",' }
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R4(7))
  })
})

test('a plugin data folder the hook cannot read gives no consent: R2, not a pass', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    const blocked = join(ctx.root, 'not-a-folder')
    writeFileSync(blocked, '')
    const res = await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx, { CLAUDE_PLUGIN_DATA: blocked })
    assert.equal(reason(res), R2(7, HANDLE))
  })
})

// --- the log of R4 --------------------------------------------------------------

const logFile = (ctx) => join(ctx.dataDir, 'epic-growth-guard.log')
const logLines = (ctx) => readFileSync(logFile(ctx), 'utf8').split('\n').filter(Boolean)
const LINE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (\S+) epic (\S+): (.+)$/

test('every R4 writes one line with the time, the tool, the epic and the cause', async () => {
  await withApi(async (ctx) => {
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R4(7))
    ctx.api.tasks[`${HANDLE}/8`] = { hang: true }
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 8 }), ctx)), R4(8))
    ctx.api.tasks[`${HANDLE}/9`] = { ...epic(9), epic_progress: { ...epic(9).epic_progress, plan_started: undefined } }
    assert.equal(reason(await runGuard(add({ parent_task_id: 9 }), ctx)), R4(9))
    ctx.api.tasks[`${HANDLE}/9`] = { ...epic(9), kind: 42 }
    assert.equal(reason(await runGuard(add({ parent_task_id: 9 }), ctx)), R4(9))
    ctx.api.tasks[`${HANDLE}/9`] = { raw: '<html>gateway</html>' }
    assert.equal(reason(await runGuard(add({ parent_task_id: 9 }), ctx)), R4(9))
    ctx.api.tasks[`${HANDLE}/9`] = []
    assert.equal(reason(await runGuard(add({ parent_task_id: 9 }), ctx)), R4(9))
    assert.equal(reason(await runGuard('not json', ctx)), R4('?'))
    const lines = logLines(ctx).map((line) => {
      const m = LINE.exec(line)
      assert.ok(m, line)
      return m.slice(1)
    })
    assert.deepEqual(lines, [
      [ADD, '7', 'HTTP 404 for task 7'],
      // The task is not there (404) before the epic is asked.
      [UPDATE, '8', 'HTTP 404 for task 3'],
      [ADD, '9', 'missing field plan_started'],
      [ADD, '9', 'bad type kind'],
      [ADD, '9', 'SyntaxError'],
      [ADD, '9', 'bad type body of task 9'],
      ['?', '?', 'SyntaxError'],
    ])
  })
})

test('a passed or held call writes no log line', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    ctx.api.tasks[`${HANDLE}/8`] = epic(8)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx)), R1(7))
    passes(await runGuard(add({ parent_task_id: 8 }), ctx))
    passes(await runGuard(add({}), ctx))
    assert.equal(existsSync(logFile(ctx)), false)
  })
})

test('a log past 64 KiB keeps its newer half, cut at a whole line', async () => {
  await withApi(async (ctx) => {
    // 1039 lines of 63 bytes: 79 bytes under the limit, which the new line passes.
    const old = Array.from({ length: 1039 }, (_, i) => `old line ${String(i).padStart(4, '0')} ${'x'.repeat(48)}`)
    writeFileSync(logFile(ctx), `${old.join('\n')}\n`)
    assert.equal(statSync(logFile(ctx)).size, 64 * 1024 - 79)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx)), R4(7))
    const size = statSync(logFile(ctx)).size
    assert.ok(size <= 32 * 1024 && size > 30 * 1024, `${size} bytes`)
    const lines = logLines(ctx)
    assert.match(lines[0], /^old line \d{4} x{48}$/)
    assert.match(lines.at(-1), / epic 7: HTTP 404 for task 7$/)
  })
})

test('the log is cut only past 64 KiB: exactly at the limit it stays whole', async () => {
  await withApi(async (ctx) => {
    // The line this call appends: a fixed-width ISO time, the tool, the epic, the cause.
    const line = Buffer.byteLength(`2026-01-01T00:00:00.000Z ${ADD} epic 7: HTTP 404 for task 7\n`)
    // One old line of `bytes` bytes, its line break included.
    const old = (bytes) => writeFileSync(logFile(ctx), `${'x'.repeat(bytes - 1)}\n`)
    old(64 * 1024 - line)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx)), R4(7))
    assert.equal(statSync(logFile(ctx)).size, 64 * 1024)
    assert.equal(logLines(ctx).length, 2)
    // One byte over: the newer half is kept, from the first whole line in it.
    old(64 * 1024 - line + 1)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7 }), ctx)), R4(7))
    assert.equal(logLines(ctx).length, 1)
    assert.match(logLines(ctx)[0], / epic 7: HTTP 404 for task 7$/)
  })
})

test('a log that cannot be written leaves R4 as it is', async () => {
  await withApi(async (ctx) => {
    // The log is a folder: appending to it fails.
    mkdirSync(logFile(ctx))
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R4(7))
    // The plugin data folder is a file: dataDir() fails.
    const blocked = join(ctx.root, 'not-a-folder')
    writeFileSync(blocked, '')
    const res = await runGuard(add({ parent_task_id: 7 }), ctx, { CLAUDE_PLUGIN_DATA: blocked })
    assert.equal(reason(res), R4(7))
    assert.equal(readFileSync(blocked, 'utf8'), '')
  })
})

// --- from the person's phrase to the hook ----------------------------------------

test("the person's phrase recorded by the prompt hook lets one call through the guard", async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    const prompt = await runScript('user-prompt-submit.js',
      { session_id: 's1', cwd: ctx.root, prompt: `allow epic 7 in ${HANDLE}` }, ctx)
    assert.equal(prompt.code, 0)
    assert.ok(existsSync(consentFile(ctx)), 'the prompt hook recorded the consent')
    passes(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx))
    assert.equal(existsSync(consentFile(ctx)), false)
    assert.equal(reason(await runGuard(add({ parent_task_id: 7, description: PREFIX }), ctx)), R2(7, HANDLE))
  }, { flag: false })
})

// --- update_task --------------------------------------------------------------

test('update_task attaching a root task to an epic with a plan is held', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3, { description: 'An old note' })
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx)), R1(7))
    // The new description of the call counts over the task's own.
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 7, description: PREFIX }), ctx)),
      R2(7, HANDLE))
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3, { description: PREFIX })
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx)), R2(7, HANDLE))
    giveConsent(ctx, HANDLE, 7)
    passes(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx))
    assert.equal(existsSync(consentFile(ctx)), false)
  })
})

test('update_task moving a task between epics passes', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3, { parent: 5 })
    passes(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx))
    assert.deepEqual(ctx.api.requests.map((r) => r.url), [`/api/v1/projects/${HANDLE}/tasks/3`])
  })
})

test('update_task without a positive parent passes before any request', async () => {
  await withApi(async (ctx) => {
    for (const parent of [undefined, null, 0]) {
      const input = parent === undefined ? { task_id: 3, title: 'x' } : { task_id: 3, parent_task_id: parent }
      passes(await runGuard(update(input), ctx))
    }
    assert.deepEqual(ctx.api.requests, [])
  })
})

test('update_task of a task the server does not answer is R4', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7, { plan_document: true })
    assert.equal(reason(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx)), R4(7))
    assert.equal(reason(await runGuard(update({ parent_task_id: 7 }), ctx)), R4(7))
  })
})

test('update_task of a root task under an epic without a plan passes', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7)
    ctx.api.tasks[`${HANDLE}/3`] = leaf(3)
    passes(await runGuard(update({ task_id: 3, parent_task_id: 7 }), ctx))
  })
})

// --- addressing -----------------------------------------------------------------

test('the project and team of the call address the request, with the key', async () => {
  await withApi(async (ctx) => {
    ctx.api.tasks[`${HANDLE}/7`] = epic(7)
    ctx.api.tasks['api/7'] = epic(7)
    passes(await runGuard(add({ parent_task_id: 7 }), ctx))
    passes(await runGuard(add({ project: 'api', parent_task_id: 7 }), ctx))
    passes(await runGuard(add({ project: `${TEAM}/api`, parent_task_id: 7 }), ctx))
    passes(await runGuard(add({ project: 'api', team: TEAM, parent_task_id: 7 }), ctx))
    assert.deepEqual(ctx.api.requests, [
      { url: `/api/v1/projects/${HANDLE}/tasks/7`, team: undefined, auth: 'Bearer cport_test_key' },
      { url: '/api/v1/projects/api/tasks/7', team: undefined, auth: 'Bearer cport_test_key' },
      { url: '/api/v1/projects/api/tasks/7', team: TEAM, auth: 'Bearer cport_test_key' },
      { url: '/api/v1/projects/api/tasks/7', team: TEAM, auth: 'Bearer cport_test_key' },
    ])
  })
})

// --- the entry in hooks.json ----------------------------------------------------

test('hooks.json sends ConPort add_task and update_task to the hook, with a timeout that blocks', () => {
  const hooks = JSON.parse(readFileSync(join(dirname(SCRIPTS), 'hooks', 'hooks.json'), 'utf8'))
  const entries = hooks.hooks.PreToolUse.filter((e) => e.hooks.some((h) => h.command.includes('guard-epic-growth.js')))
  assert.equal(entries.length, 1)
  const [entry] = entries
  assert.equal(entry.matcher, '^mcp__.*[Cc]on[Pp]ort.*__(add_task|update_task)$')
  const [handler] = entry.hooks
  assert.equal(handler.command, 'node ${CLAUDE_PLUGIN_ROOT}/scripts/guard-epic-growth.js')
  assert.equal(handler.timeout, 10)
  assert.equal(handler.onFailure, 'block')
  const matcher = new RegExp(entry.matcher)
  for (const tool of ['mcp__plugin_conport_conport__add_task', 'mcp__conport__update_task',
    'mcp__ConPort__add_task', 'mcp__claude_ai_Conport__update_task']) {
    assert.match(tool, matcher)
  }
  for (const tool of ['mcp__plugin_conport_conport__delete_task', 'mcp__plugin_conport_conport__get_task',
    'mcp__plugin_conport_conport__add_linked_task', 'mcp__other__add_task']) {
    assert.doesNotMatch(tool, matcher)
  }
})

// update_task reads twice, each read within its own budget: the worst case,
// both budgets spent, still ends inside the hook timeout with time left for
// Node to start. Read as the hook runs it outside a test run — with a user's
// stretch in the environment, which hook-time.js cuts to 1.
test('two spent request budgets fit the hook timeout, whatever scale a user sets', () => {
  const hooks = JSON.parse(readFileSync(join(dirname(SCRIPTS), 'hooks', 'hooks.json'), 'utf8'))
  const [handler] = hooks.hooks.PreToolUse.flatMap((e) => e.hooks)
    .filter((h) => h.command.includes('guard-epic-growth.js'))
  const saved = { scale: process.env.CONPORT_HOOK_TIME_SCALE, mark: process.env.CONPORT_SETTINGS_FORBID_ROOT }
  process.env.CONPORT_HOOK_TIME_SCALE = '20'
  delete process.env.CONPORT_SETTINGS_FORBID_ROOT
  let REQUEST_TIMEOUT_MS
  try {
    ({ REQUEST_TIMEOUT_MS } = createRequire(import.meta.url)('../guard-epic-growth.js'))
  } finally {
    for (const [name, value] of [['CONPORT_HOOK_TIME_SCALE', saved.scale], ['CONPORT_SETTINGS_FORBID_ROOT', saved.mark]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  const START_MS = 2000
  assert.ok(2 * REQUEST_TIMEOUT_MS + START_MS <= handler.timeout * 1000,
    `${2 * REQUEST_TIMEOUT_MS} ms of reads and ${START_MS} ms to start pass ${handler.timeout} s`)
})
