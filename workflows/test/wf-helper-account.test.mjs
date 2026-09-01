import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const HELPER = join(WORKFLOWS, 'wf-helper.mjs')
const KEY = 'test_key_never_printed'
const PROJECT = 42                                 // a neutral id: no real project is implied

// ------------------------------------------------------------------ REST mock

// A local stand-in for the tasks and progress REST surface: the routes the
// accountant uses (get / update / list / create a task, list / create a progress
// entry), fixed answers, every request recorded. The production API is never
// touched by these tests.
const startMock = async (opts = {}) => {
  const state = { tasks: new Map(), progress: [], nextId: 900, nextEntryId: 700, requests: [] }
  for (const t of opts.tasks ?? [])
    state.tasks.set(t.id, { description: '', priority: 3, kind: 'task', parent_task_id: null, ...t })
  for (const e of opts.progress ?? [])
    state.progress.push({ id: state.nextEntryId++, title: null, ...e })

  const fail = opts.fail ?? (() => null)
  const send = (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      const body = raw ? JSON.parse(raw) : null
      const rec = { method: req.method, path: url.pathname, query: url.searchParams, body, key: req.headers['x-api-key'] }
      state.requests.push(rec)

      const injected = fail(rec)
      if (injected) return send(res, injected.status, injected.body)

      if (url.pathname === `/api/v1/projects/${PROJECT}/progress`) {
        if (req.method === 'GET') {
          const offset = Number(url.searchParams.get('offset') ?? 0)
          const limit = Number(url.searchParams.get('limit') ?? 50)
          return send(res, 200, { entries: state.progress.slice(offset, offset + limit), total: state.progress.length })
        }
        if (req.method === 'POST') {
          const entry = { id: state.nextEntryId++, title: null, ...body }
          state.progress.push(entry)
          return send(res, 201, entry)
        }
        return send(res, 405, { detail: 'method not allowed' })
      }

      const m = url.pathname.match(new RegExp(`^/api/v1/projects/${PROJECT}/tasks(?:/(\\d+))?$`))
      if (!m) return send(res, 404, { detail: 'no route ' + url.pathname })
      const id = m[1] ? Number(m[1]) : null

      if (id !== null) {
        const task = state.tasks.get(id)
        if (!task) return send(res, 404, { detail: 'Task not found' })
        if (req.method === 'GET') return send(res, 200, task)
        if (req.method === 'PATCH') {
          for (const [k, v] of Object.entries(body ?? {})) if (k !== 'resolution') task[k] = v
          if (body && body.resolution) task.description = task.description + '\n\n## Resolution\n' + body.resolution
          return send(res, 200, task)
        }
        return send(res, 405, { detail: 'method not allowed' })
      }

      if (req.method === 'GET') {
        const q = url.searchParams
        const status = (q.get('status') ?? 'TODO,IN_PROGRESS').toUpperCase()
        const parent = q.get('parent_task_id')
        const kind = q.get('kind')
        const tasks = [...state.tasks.values()].filter(t =>
          (status === 'ALL' || status.split(',').includes(t.status)) &&
          (parent === null || String(t.parent_task_id) === parent) &&
          (kind === null || t.kind === kind))
        const offset = Number(q.get('offset') ?? 0)
        const limit = Number(q.get('limit') ?? 50)
        return send(res, 200, { tasks: tasks.slice(offset, offset + limit), total: tasks.length })
      }
      if (req.method === 'POST') {
        const task = { id: state.nextId++, description: '', priority: 3, kind: 'task', parent_task_id: null, status: 'TODO', ...body }
        state.tasks.set(task.id, task)
        return send(res, 201, task)
      }
      return send(res, 405, { detail: 'method not allowed' })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${server.address().port}/api/v1`
  state.close = () => new Promise(resolve => server.close(resolve))
  return state
}

// ------------------------------------------------------------------ invocation

const tableFile = table => {
  const path = join(mkdtempSync(join(tmpdir(), 'wfa-')), 'table.json')
  writeFileSync(path, JSON.stringify(table))
  return path
}

// The mock serves from this very process, so the helper must be spawned
// asynchronously: a synchronous spawn would block the event loop the server
// answers on, and the two would wait for each other forever.
const runHelper = (env, ...argv) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [HELPER, ...argv], { env })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', c => { stdout += c })
  p.stderr.on('data', c => { stderr += c })
  p.on('error', reject)
  p.on('close', code => resolve({ code, stdout, stderr }))
})

const runAccount = async (mock, table) => {
  const env = { ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY }
  const r = await runHelper(env, 'account', '--table', tableFile(table))
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  assert.ok(!r.stdout.includes(KEY), 'the api key must never reach stdout')
  return { out: JSON.parse(r.stdout), stdout: r.stdout }
}

// The server must be closed even when an assertion throws, or the test file
// hangs on an open handle instead of reporting the failure.
const withMock = (opts, body) => async () => {
  const mock = await startMock(opts)
  try { await body(mock) } finally { await mock.close() }
}

const writes = mock => mock.requests.filter(r => r.method !== 'GET')
const step = (out, name) => out.actions.find(a => a.step === name)

const UMBRELLA = { title: 'Review minors: task-5 run', description: 'Deferred review minors from the run of task-5:\n- a.js — nit' }

// --------------------------------------------------------------------- close

test('close: an open task is closed with the resolution passed as its own field', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO', description: 'spec body' }] }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: { id: 5, resolution: 'merged as abc123' }, block: null, minors_umbrella: null })

  assert.deepEqual(step(out, 'close').result, 'done')
  assert.equal(step(out, 'close').target, 5)
  assert.equal(out.task_closed, true)
  assert.deepEqual(out.failed_calls, [])
  const patch = writes(mock).find(r => r.method === 'PATCH')
  assert.deepEqual(patch.body, { status: 'DONE', resolution: 'merged as abc123' },
    'the description is never sent — the server appends the resolution section itself')
  assert.equal(patch.key, KEY, 'the key travels in X-API-Key')
  assert.ok(mock.tasks.get(5).description.startsWith('spec body'), 'the original description survives')
}))

test('close: a task already DONE is skipped, with no write at all', withMock({ tasks: [{ id: 5, title: 'T', status: 'DONE', description: 'spec body' }] }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: { id: 5, resolution: 'merged as abc123' }, block: null, minors_umbrella: null })

  assert.equal(step(out, 'close').result, 'skipped_already')
  assert.equal(out.task_closed, true)
  assert.deepEqual(writes(mock), [])
}))

// --------------------------------------------------------------------- block

test('block: the status changes and the reason is appended, keeping the description', withMock({ tasks: [{ id: 7, title: 'T', status: 'IN_PROGRESS', description: 'original spec' }] }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').result, 'done')
  assert.equal(out.task_closed, false)
  const patch = writes(mock).find(r => r.method === 'PATCH')
  assert.equal(patch.body.status, 'BLOCKED')
  assert.equal(patch.body.description, 'original spec\n\n## Blocked: GATE_RED')
}))

test('block: a task already BLOCKED is skipped, with no write at all', withMock({ tasks: [{ id: 7, title: 'T', status: 'BLOCKED', description: 'original spec\n\n## Blocked: GATE_RED' }] }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').result, 'skipped_already')
  assert.deepEqual(writes(mock), [])
}))

// ------------------------------------------------------------------ umbrella

test('umbrella: the tails epic and its child are created once, the rerun skips both', withMock({ tasks: [] }, async mock => {
  const { out: first } = await runAccount(mock, { project_id: PROJECT, close: null, block: null, minors_umbrella: UMBRELLA })

  assert.equal(step(first, 'minors_epic').result, 'done')
  assert.equal(step(first, 'minors_child').result, 'done')
  assert.equal(first.minors_created.length, 1)
  const epic = [...mock.tasks.values()].find(t => t.kind === 'epic')
  assert.equal(epic.title, 'Workflow run tails')
  assert.equal(epic.priority, 4)
  assert.equal(epic.description, 'Deferred review minors from workflow runs')
  const child = mock.tasks.get(first.minors_created[0])
  assert.equal(child.parent_task_id, epic.id)
  assert.equal(child.title, UMBRELLA.title)
  assert.equal(child.description, UMBRELLA.description, 'the umbrella body is stored verbatim')
  assert.equal(child.priority, 4)

  const before = mock.tasks.size
  const { out: second } = await runAccount(mock, { project_id: PROJECT, close: null, block: null, minors_umbrella: UMBRELLA })
  assert.equal(step(second, 'minors_epic').result, 'skipped_already')
  assert.equal(step(second, 'minors_child').result, 'skipped_already')
  assert.deepEqual(second.minors_created, [])
  assert.equal(mock.tasks.size, before, 'the rerun creates nothing')
}))

// The list endpoint caps a page at 200, so a project with more open epics than
// that hides the tails epic behind an offset. A lookup stopping at the first
// page would not find it and would file a second 'Workflow run tails' epic.
const PAGED_EPICS = [
  ...Array.from({ length: 249 }, (_, i) => ({ id: 100 + i, title: 'Filler epic ' + i, status: 'TODO', kind: 'epic' })),
  { id: 500, title: 'Workflow run tails', status: 'TODO', kind: 'epic', description: 'Deferred review minors from workflow runs' },
]

test('umbrella: a tails epic sitting past the first page is found, not duplicated', withMock({ tasks: PAGED_EPICS }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: null, block: null, minors_umbrella: UMBRELLA })

  assert.equal(step(out, 'minors_epic').result, 'skipped_already', 'the epic on the last page is seen')
  assert.equal(step(out, 'minors_epic').target, 500)
  const epics = [...mock.tasks.values()].filter(t => t.title === 'Workflow run tails')
  assert.equal(epics.length, 1, 'no second tails epic is created')

  const offsets = mock.requests
    .filter(r => r.method === 'GET' && r.query.get('kind') === 'epic')
    .map(r => Number(r.query.get('offset')))
  assert.deepEqual(offsets, [0, 200], 'the listing is walked to the end, one page at a time')

  // The child is still filed — under the epic that already existed.
  assert.equal(step(out, 'minors_child').result, 'done')
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, 500)
}))

// -------------------------------------------------------- failure isolation

test('a failing item lands in failed_calls while the remaining items still run', withMock({
  tasks: [{ id: 5, title: 'T', status: 'TODO' }, { id: 7, title: 'B', status: 'TODO', description: 'keep me' }],
  fail: rec => (rec.method === 'GET' && rec.path.endsWith('/tasks/5')) ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, {
    project_id: PROJECT,
    close: { id: 5, resolution: 'merged as abc123' },
    block: { id: 7, reason: 'GATE_RED' },
    minors_umbrella: UMBRELLA,
  })

  assert.equal(step(out, 'close').result, 'failed')
  assert.equal(out.task_closed, false)
  assert.equal(out.failed_calls.length, 1)
  assert.ok(out.failed_calls[0].error.includes('500'), 'the status code is reported: ' + out.failed_calls[0].error)
  assert.equal(step(out, 'block').result, 'done', 'the later items are executed anyway')
  assert.equal(step(out, 'minors_child').result, 'done')
  assert.equal(mock.tasks.get(7).status, 'BLOCKED')
}))

// ------------------------------------------------------------- key handling

test('no api key in either variable: the fallback sentinel is printed and nothing is called', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const table = tableFile({ project_id: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
  const env = { ...process.env, CONPORT_API_URL: mock.url }
  delete env.CONPORT_API_KEY
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  const r = await runHelper(env, 'account', '--table', table)

  assert.equal(r.code, 0, 'a missing key is a fallback signal, not a CLI failure')
  assert.equal(r.stdout.trim(), '{"error": "no api key"}')
  assert.deepEqual(mock.requests, [])
}))

// An installed plugin never sets CONPORT_API_KEY: the harness exposes the
// configured key as CLAUDE_PLUGIN_OPTION_API_KEY, exactly as scripts/_common.js
// reads it. Accepting only the manual variable left every install keyless.
test('the harness key alone drives the accounting run', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const table = tableFile({ project_id: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
  const env = { ...process.env, CONPORT_API_URL: mock.url, CLAUDE_PLUGIN_OPTION_API_KEY: KEY }
  delete env.CONPORT_API_KEY
  const r = await runHelper(env, 'account', '--table', table)

  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  assert.ok(!r.stdout.includes(KEY), 'the api key must never reach stdout')
  const out = JSON.parse(r.stdout)
  assert.equal(out.task_closed, true)
  assert.deepEqual(out.failed_calls, [])
  assert.equal(mock.requests[0].key, KEY, 'the harness key travels in X-API-Key')
}))

// A server that accepts the connection and never answers it. Without a deadline
// per call the run would wait on it forever, and a workflow that hangs cannot
// fall back to doing the accounting itself.
test('a server that never answers: the call lands in failed_calls instead of hanging', { timeout: 20000 }, async () => {
  const server = createServer(() => {})            // the request is received and never answered
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const table = tableFile({ project_id: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
  const env = {
    ...process.env,
    CONPORT_API_URL: `http://127.0.0.1:${server.address().port}/api/v1`,
    CONPORT_API_KEY: KEY,
    CONPORT_TIMEOUT_MS: '300',
  }
  try {
    const r = await runHelper(env, 'account', '--table', table)

    assert.equal(r.code, 0, 'a dead server is a fallback signal, not a CLI failure')
    const out = JSON.parse(r.stdout)
    assert.equal(out.failed_calls.length, 1, 'the timed-out call is reported: ' + r.stdout)
    assert.equal(out.failed_calls[0].call, 'close task-5')
    assert.equal(out.task_closed, false)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('a key echoed back by the server is masked out of failed_calls', withMock({
  tasks: [{ id: 5, title: 'T', status: 'TODO' }],
  fail: rec => rec.method === 'GET' ? { status: 401, body: { detail: 'bad key ' + KEY } } : null,
}, async mock => {
  const { out, stdout } = await runAccount(mock, { project_id: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })

  assert.equal(out.failed_calls.length, 1)
  assert.ok(!stdout.includes(KEY), 'the key value never leaves the process')
  assert.ok(out.failed_calls[0].error.includes('***'), 'it is masked: ' + out.failed_calls[0].error)
}))

// ------------------------------------------------------------ table shapes

test('an empty table does nothing and still reports the S_ACC shape', withMock({ tasks: [] }, async mock => {
  const { out } = await runAccount(mock, { project_id: PROJECT, close: null, block: null, minors_umbrella: null })

  assert.deepEqual(out, { via: 'wf-helper', actions: [], minors_created: [], task_closed: false, failed_calls: [] })
  assert.deepEqual(mock.requests, [])
}))

test('a table carrying steps this command does not implement is refused, not half-executed', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const { stdout } = await runAccount(mock, { project_id: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null, skipped: [{ id: 9, dep: 8 }] })

  assert.equal(stdout.trim(), '{"error": "unsupported table"}')
  assert.deepEqual(mock.requests, [], 'nothing is executed from a table only partly understood')
}))

// ------------------------------------------------------------- the epic table

const EPIC = 100
const RESOLUTION = 'plan tasks 1/3 merged; criticals fixed 0 of 0; tails filed 1; gate green; acceptance READY'
const CRITICAL = { title: 'UNRESOLVED CRITICAL: the gate is not observed', priority: 1, description: 'Critical gap not fixed in the run (failed at impl).' }

// A run with one merged, one failed and one skipped child: may_close is false,
// because two children are still open.
const epicTable = over => ({
  project_id: PROJECT, epic: EPIC,
  done: [{ id: 5, resolution: 'merged as abc123' }],
  failed: [{ id: 7, reason: 'GATE_RED' }],
  skipped: [{ id: 9, dep: 7 }],
  parity_failed: [{ plan_index: 3, title: 'Wire the gate' }],
  minors: [CRITICAL],
  verdict: 'NOT_READY', may_close: false, close_resolution: RESOLUTION,
  ...over,
})
const epicTasks = kids => [
  { id: EPIC, title: 'The epic', status: 'IN_PROGRESS', kind: 'epic' },
  ...kids,
]
const RUN_CHILDREN = [
  { id: 5, title: 'A', status: 'TODO', parent_task_id: EPIC, description: 'spec of A' },
  { id: 7, title: 'B', status: 'TODO', parent_task_id: EPIC, description: 'spec of B' },
  { id: 9, title: 'C', status: 'TODO', parent_task_id: EPIC, description: 'spec of C' },
]
const steps = (out, name) => out.actions.filter(a => a.step === name)
const descriptions = mock => mock.progress.map(e => e.description)
const tailsEpic = mock => [...mock.tasks.values()].find(t => t.title === 'Tails of epic task-' + EPIC)

test('epic table: every step is executed in order, the epic itself is left alone', withMock({ tasks: epicTasks(RUN_CHILDREN) }, async mock => {
  const { out } = await runAccount(mock, epicTable())

  assert.deepEqual(out.actions.map(a => a.step),
    ['close', 'block', 'skipped', 'parity_progress', 'tails_epic', 'tails_child', 'run_summary'],
    'the table is executed in the order of the accountant steps')
  assert.deepEqual(out.failed_calls, [])

  assert.equal(mock.tasks.get(5).status, 'DONE')
  assert.deepEqual(writes(mock).find(r => r.path.endsWith('/tasks/5')).body,
    { status: 'DONE', resolution: 'merged as abc123' }, 'the resolution is its own field')
  assert.equal(mock.tasks.get(7).status, 'BLOCKED')
  assert.equal(mock.tasks.get(7).description, 'spec of B\n\n## Blocked: GATE_RED')
  assert.equal(mock.tasks.get(9).status, 'TODO', 'a skipped task waits for the next run')
  assert.equal(mock.tasks.get(9).description, 'spec of C\n\n## Skipped: dependency task-7 failed')

  assert.deepEqual(descriptions(mock), [
    '[epic-run:100] plan task without a child: Wire the gate — no child task in ConPort',
    '[epic-run:100] result: ' + RESOLUTION,
  ])

  const tails = tailsEpic(mock)
  assert.equal(tails.kind, 'epic')
  assert.equal(tails.priority, 3)
  assert.equal(tails.description, 'Findings deferred from the epic run')
  assert.equal(out.tails_epic_id, tails.id)
  const child = [...mock.tasks.values()].find(t => t.title === CRITICAL.title)
  assert.ok(child, 'the tails entry of the table is filed under its own title')
  assert.deepEqual(out.tails_children, [child.id], 'the report names the task actually created')
  assert.equal(child.parent_task_id, tails.id)
  assert.equal(child.description, CRITICAL.description)
  assert.equal(child.priority, 1, 'the entry keeps the priority the table gave it')

  assert.equal(out.epic_closed, false)
  assert.equal(out.epic_close_error, null)
  assert.equal(out.epic_progress, null)
  assert.equal(writes(mock).some(r => r.path.endsWith('/tasks/' + EPIC)), false,
    'may_close is false — the epic is not written to')
}))

test('epic table: a rerun of the same table changes nothing', withMock({ tasks: epicTasks(RUN_CHILDREN) }, async mock => {
  await runAccount(mock, epicTable())
  const tasksBefore = mock.tasks.size
  const entriesBefore = mock.progress.length
  mock.requests.length = 0

  const { out } = await runAccount(mock, epicTable())
  assert.deepEqual(out.actions.map(a => a.result),
    ['skipped_already', 'skipped_already', 'skipped_already', 'skipped_already', 'skipped_already', 'skipped_already', 'skipped_already'])
  assert.deepEqual(writes(mock), [], 'the rerun writes nothing at all')
  assert.equal(mock.tasks.size, tasksBefore)
  assert.equal(mock.progress.length, entriesBefore)
}))

// -------------------------------------------------------------- epic closing

const CLOSED_CHILD = [{ id: 5, title: 'A', status: 'DONE', parent_task_id: EPIC, description: 'spec of A' }]
const closingTable = over => ({
  project_id: PROJECT, epic: EPIC, done: [{ id: 5, resolution: 'merged as abc123' }],
  failed: [], skipped: [], parity_failed: [], minors: [],
  verdict: 'READY', may_close: true, close_resolution: RESOLUTION, ...over,
})

test('may_close true with every child closed: the epic is closed with the run resolution', withMock({ tasks: epicTasks(CLOSED_CHILD) }, async mock => {
  const { out } = await runAccount(mock, closingTable())

  assert.equal(out.epic_closed, true)
  assert.equal(out.epic_close_error, null)
  assert.deepEqual(out.epic_progress, { open: 0, closed: 1 })
  assert.deepEqual(steps(out, 'epic_close')[0], { step: 'epic_close', target: EPIC, result: 'done', detail: 'epic closed with the run resolution' })
  const patch = writes(mock).find(r => r.path.endsWith('/tasks/' + EPIC))
  assert.deepEqual(patch.body, { status: 'DONE', resolution: RESOLUTION })

  mock.requests.length = 0
  const { out: second } = await runAccount(mock, closingTable())
  assert.equal(steps(second, 'epic_close')[0].result, 'skipped_already')
  assert.equal(second.epic_closed, true, 'an epic already DONE counts as closed')
  assert.deepEqual(writes(mock), [])
}))

test('may_close false with the same closed children: the epic is not touched', withMock({ tasks: epicTasks(CLOSED_CHILD) }, async mock => {
  const { out } = await runAccount(mock, closingTable({ may_close: false, verdict: 'NOT_READY' }))

  assert.equal(out.epic_closed, false)
  assert.equal(out.epic_progress, null)
  assert.deepEqual(steps(out, 'epic_close'), [], 'the closing step does not run at all')
  assert.deepEqual(mock.requests.filter(r => r.path.endsWith('/tasks/' + EPIC)), [],
    'the epic is neither read nor written')
}))

test('may_close true but a child is still open: the epic stays open and the count is reported', withMock({
  tasks: epicTasks([...CLOSED_CHILD, { id: 7, title: 'B', status: 'TODO', parent_task_id: EPIC }]),
}, async mock => {
  const { out } = await runAccount(mock, closingTable())

  assert.equal(out.epic_closed, false)
  assert.deepEqual(out.epic_progress, { open: 1, closed: 1 })
  assert.equal(steps(out, 'epic_close')[0].result, 'failed')
  assert.ok(out.epic_close_error.includes('7'), 'the open child is named: ' + out.epic_close_error)
  assert.equal(writes(mock).some(r => r.path.endsWith('/tasks/' + EPIC)), false)
  assert.deepEqual(out.failed_calls, [], 'no call was made, so nothing failed')
}))

test('epic_not_ready from the server is a failed call, the rest of the table is executed', withMock({
  tasks: epicTasks(CLOSED_CHILD),
  fail: rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/' + EPIC))
    ? { status: 409, body: { detail: { error: 'epic_not_ready', message: 'epic has open children', context: { open: [7] } } } }
    : null,
}, async mock => {
  const { out } = await runAccount(mock, closingTable({ minors: [CRITICAL] }))

  assert.equal(out.epic_closed, false)
  assert.equal(out.failed_calls.length, 1)
  assert.ok(out.failed_calls[0].error.includes('epic_not_ready'), 'the server reason is kept: ' + out.failed_calls[0].error)
  assert.ok(out.epic_close_error.includes('epic_not_ready'))
  assert.equal(steps(out, 'epic_close')[0].result, 'failed')
  assert.equal(steps(out, 'tails_child')[0].result, 'done', 'the earlier steps ran regardless')
  assert.equal(mock.tasks.get(5).status, 'DONE')
}))

// ------------------------------------------------------------ epic edge cases

// A run that ends without a resolution text still leaves its trace in the
// journal: the summary is written with an empty resolution instead of the word
// 'undefined', and the steps after it keep running.
test('an epic table without close_resolution logs the run summary with an empty resolution', withMock({
  tasks: epicTasks(RUN_CHILDREN),
}, async mock => {
  const table = epicTable()
  delete table.close_resolution
  const { out } = await runAccount(mock, table)

  assert.equal(steps(out, 'run_summary')[0].result, 'done')
  assert.deepEqual(descriptions(mock), [
    '[epic-run:100] plan task without a child: Wire the gate — no child task in ConPort',
    '[epic-run:100] result: ',
  ], 'the summary carries an empty resolution, never the string undefined')
  assert.deepEqual(out.failed_calls, [])
}))

test('an epic table carrying an unknown key is refused whole, before any call', withMock({ tasks: epicTasks(RUN_CHILDREN) }, async mock => {
  const { stdout } = await runAccount(mock, epicTable({ minors_umbrella: UMBRELLA }))

  assert.equal(stdout.trim(), '{"error": "unsupported table"}')
  assert.deepEqual(mock.requests, [], 'a table mixing the two shapes is executed by neither')
}))

test('an epic table whose first call fails runs every later step regardless', withMock({
  tasks: epicTasks(RUN_CHILDREN),
  // the very first call of the table: the read guarding the close of task-5
  fail: rec => (rec.method === 'GET' && rec.path.endsWith('/tasks/5')) ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())

  assert.equal(steps(out, 'close')[0].result, 'failed')
  assert.equal(out.failed_calls.length, 1, 'only the failing call is recorded: ' + JSON.stringify(out.failed_calls))
  assert.ok(out.failed_calls[0].error.includes('500'), 'the status code is reported: ' + out.failed_calls[0].error)
  assert.equal(mock.tasks.get(5).status, 'TODO', 'the task the read failed on is not written to')

  assert.deepEqual(out.actions.map(a => a.step),
    ['close', 'block', 'skipped', 'parity_progress', 'tails_epic', 'tails_child', 'run_summary'],
    'a failed item is stepped over, not a run cut short')
  for (const name of ['block', 'skipped', 'parity_progress', 'tails_child', 'run_summary'])
    assert.equal(steps(out, name)[0].result, 'done', name + ' still ran')
  assert.equal(mock.tasks.get(7).status, 'BLOCKED')
  assert.equal(out.tails_children.length, 1)
  assert.deepEqual(descriptions(mock), [
    '[epic-run:100] plan task without a child: Wire the gate — no child task in ConPort',
    '[epic-run:100] result: ' + RESOLUTION,
  ])
}))

// ------------------------------------------------------- the key set contract

// epic.js builds the table and wf-helper.mjs executes it; the two files never
// import each other, so their key lists are fenced by markers and compared here.
// A key added on one side only makes the helper refuse the table whole at runtime
// — that drift is a red test instead.
// The fenced region carries prose as well as code, so every `//` comment is
// dropped before the keys are read — a whole comment line and a comment trailing
// a line of code alike: a word quoted inside a comment is documentation, not a
// key of the table.
const keysInFenced = (src, file) => {
  const from = src.indexOf('EPIC_TABLE_KEYS_BEGIN')
  const to = src.indexOf('EPIC_TABLE_KEYS_END')
  assert.ok(from >= 0, 'marker EPIC_TABLE_KEYS_BEGIN missing from ' + file)
  assert.ok(to > from, 'marker EPIC_TABLE_KEYS_END missing from ' + file + ' or out of order')
  const region = src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
  const code = region.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  return [...code.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}
const fencedKeys = file => keysInFenced(readFileSync(join(WORKFLOWS, file), 'utf8'), file)

test('the fenced key scanner reads the key list only, not the prose around it', () => {
  const src = [
    "// EPIC_TABLE_KEYS_BEGIN — a comment naming 'project_id' is prose",
    "  // and 'not_a_key' quoted here is prose too",
    "const EPIC_TABLE_KEYS = ['project_id', 'epic'] // 'trailing_prose' is prose",
    '// EPIC_TABLE_KEYS_END',
  ].join('\n')

  assert.deepEqual(keysInFenced(src, 'fixture'), ['project_id', 'epic'])
})

test('the epic accounting table key set is the same in epic.js and wf-helper.mjs', () => {
  const fromHelper = fencedKeys('wf-helper.mjs')
  const fromEpic = fencedKeys('epic.js')
  assert.ok(fromHelper.includes('close_resolution'), 'the fenced region is the key list')
  assert.deepEqual([...fromEpic].sort(), [...fromHelper].sort(),
    'the builder and the executor disagree on the table shape — edit both lists together')
  assert.equal(new Set(fromEpic).size, fromEpic.length, 'no key is listed twice')
})

test('a progress entry of this run already in the journal is not logged twice', withMock({
  tasks: epicTasks(RUN_CHILDREN),
  // a journal long enough to need a second page: a guard stopping at the first
  // one would file the same entry again
  progress: [
    ...Array.from({ length: 200 }, (_, i) => ({ description: 'unrelated entry ' + i })),
    { description: '[epic-run:100] plan task without a child: Wire the gate — no child task in ConPort' },
    { description: '[epic-run:100] result: an earlier wording of the same run' },
  ],
}, async mock => {
  const { out } = await runAccount(mock, epicTable())

  assert.equal(steps(out, 'parity_progress')[0].result, 'skipped_already')
  assert.equal(steps(out, 'run_summary')[0].result, 'skipped_already')
  assert.equal(mock.progress.length, 202, 'nothing is appended to the journal')
  const offsets = mock.requests.filter(r => r.method === 'GET' && r.path.endsWith('/progress')).map(r => Number(r.query.get('offset')))
  assert.deepEqual(offsets, [0, 200], 'the journal is walked to the end once, then reused')
}))
