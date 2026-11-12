import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKFLOWS, fencedRegion, secondMarker, source, withSecond } from './fenced-region.mjs'

const HELPER = join(WORKFLOWS, 'wf-helper.mjs')
const KEY = 'test_key_never_printed'
const PROJECT = 'prk7m2qx9d'                       // a neutral handle: no real project is implied

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
  // `hold` runs before a request is answered: it may wait (a barrier between two
  // parallel runs) or change the state (another run's write landing in between).
  const hold = opts.hold ?? (() => null)
  const send = (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', async () => {
      const url = new URL(req.url, 'http://localhost')
      const body = raw ? JSON.parse(raw) : null
      const rec = { method: req.method, path: url.pathname, query: url.searchParams, body, key: req.headers['x-api-key'] }
      state.requests.push(rec)
      await hold(rec, state)

      const injected = fail(rec)
      if (injected) return send(res, injected.status, injected.body)

      if (url.pathname === `/api/v1/projects/${PROJECT}/milestones`) {
        if (req.method !== 'GET') return send(res, 405, { detail: 'method not allowed' })
        const closed = url.searchParams.get('include_closed') === 'true'
        return send(res, 200, (opts.milestones ?? []).filter(m => closed || m.status === 'OPEN'))
      }

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
        if (body.kind === 'task' && state.tasks.get(body.parent_task_id)?.refuse_ordinary)
          return send(res, 409, { detail: { error: 'epic_growth_ceiling', message: 'Full' } })
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
  const opts = typeof argv[argv.length - 1] === 'object' ? argv.pop() : {}
  const p = spawn(process.execPath, [HELPER, ...argv], { env, ...opts })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', c => { stdout += c })
  p.stderr.on('data', c => { stderr += c })
  p.on('error', reject)
  p.on('close', code => resolve({ code, stdout, stderr }))
})

const accountEnv = mock => ({ ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY })
const runAccount = async (mock, table, opts = {}) => {
  const r = await runHelper(accountEnv(mock), 'account', '--table', tableFile(table), opts)
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

const UMBRELLA = { title: 'Review minors left on task-7', description: 'Review minors left open by the /conport:task run of task-7:\n- a.js — nit', task: 7 }
// Only an epic carries a milestone, so a task with no epic has no release: the umbrella
// of its minors waits for the person to name the milestone. Past the ceiling of an epic
// in Release A, the umbrella goes to the tails epic of that release, attached to the
// next OPEN milestone.
const TASK_MILESTONES = [
  { id: 1, title: 'Release A', sequence: 1, status: 'OPEN', is_release: true },
  { id: 2, title: 'After A', sequence: 2, status: 'OPEN', is_release: true },
]

// --------------------------------------------------------------------- close

test('close: an open task is closed with the resolution passed as its own field', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO', description: 'spec body' }] }, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'merged as abc123' }, block: null, minors_umbrella: null })

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
  const { out } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'merged as abc123' }, block: null, minors_umbrella: null })

  assert.equal(step(out, 'close').result, 'skipped_already')
  assert.equal(out.task_closed, true)
  assert.deepEqual(writes(mock), [])
}))

// A task that went through review closes only after an approval with a
// resolution: the server refuses DONE with one of three codes. A retry cannot
// succeed — the task needs a review entry first — so each refusal is reported
// with the server's message, stays out of failed_calls, and the run goes on.
const closeRefusal = (code, message) => rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/5'))
  ? { status: 409, body: { detail: { error: code, message, context: { task_id: 5, status: 'REVIEW', review_round: 2 } } } } : null

for (const code of ['done_needs_approval', 'done_needs_review', 'done_needs_resolution']) {
  test(`close: a ${code} refusal is reported, not a failed call, and the run goes on`, withMock({
    tasks: [{ id: 5, title: 'T', status: 'REVIEW', description: 'spec body' }, { id: 7, title: 'B', status: 'TODO', description: 'keep me' }],
    fail: closeRefusal(code, 'Do the one prescribed thing.'),
  }, async mock => {
    const { out } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'merged as abc123' }, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

    const close = step(out, 'close')
    assert.equal(close.result, 'failed')
    assert.equal(close.target, 5)
    assert.equal(close.detail, code + ': the task is not closed — Do the one prescribed thing.')
    assert.equal(out.task_closed, false)
    assert.deepEqual(out.failed_calls, [], 'a refusal by the review rules is not a failed call to retry')
    assert.equal(writes(mock).filter(r => r.path.endsWith('/tasks/5')).length, 1, 'the refused close is not retried')
    assert.equal(mock.tasks.get(5).status, 'REVIEW')
    assert.equal(mock.tasks.get(5).description, 'spec body')
    assert.equal(step(out, 'block').result, 'done', 'the later items are executed anyway')
  }))
}

test('close: a closing refusal without a message leaves no dangling separator', withMock({
  tasks: [{ id: 5, title: 'T', status: 'REVIEW', description: 'spec body' }],
  fail: closeRefusal('done_needs_approval', ''),
}, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })

  assert.equal(step(out, 'close').detail, 'done_needs_approval: the task is not closed')
}))

// The mechanism is the code: another 409 on close stays a failed call.
test('close: a 409 with another code stays a failed call', withMock({
  tasks: [{ id: 5, title: 'T', status: 'IN_PROGRESS', description: 'spec body' }],
  fail: closeRefusal('some_other_conflict', 'other'),
}, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })

  assert.equal(step(out, 'close').result, 'failed')
  assert.equal(out.task_closed, false)
  assert.equal(out.failed_calls.length, 1)
  assert.equal(out.failed_calls[0].call, 'close task-5')
  assert.ok(out.failed_calls[0].error.includes('409'), out.failed_calls[0].error)
}))

// --------------------------------------------------------------------- block

test('block: the status changes and the reason is appended, keeping the description', withMock({ tasks: [{ id: 7, title: 'T', status: 'IN_PROGRESS', description: 'original spec' }] }, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').result, 'done')
  assert.equal(out.task_closed, false)
  const patch = writes(mock).find(r => r.method === 'PATCH')
  assert.equal(patch.body.status, 'BLOCKED')
  assert.equal(patch.body.description, 'original spec\n\n## Blocked: GATE_RED')
}))

test('block: a task already BLOCKED is skipped, with no write at all', withMock({ tasks: [{ id: 7, title: 'T', status: 'BLOCKED', description: 'original spec\n\n## Blocked: GATE_RED' }] }, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').result, 'skipped_already')
  assert.deepEqual(writes(mock), [])
}))

// A task in REVIEW leaves it only through a review verdict or a cancellation:
// the server answers BLOCKED with 409 review_exit_not_allowed. That is a rule
// of the task's state, not a broken call — the step reports the refusal with
// the server's message, writes nothing else, and the remaining items still run.
const REVIEW_EXIT = {
  status: 409,
  body: { detail: {
    error: 'review_exit_not_allowed',
    message: 'A task in REVIEW leaves it through a review verdict or a cancellation.',
    context: { task_id: 7, status: 'REVIEW', review_round: 1 },
  } },
}
const refuseReviewExit = rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/7')) ? REVIEW_EXIT : null

test('block: a task in REVIEW refused with review_exit_not_allowed is reported, not a failed call', withMock({
  tasks: [{ id: 7, title: 'T', status: 'REVIEW', description: 'original spec' }],
  fail: refuseReviewExit,
}, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: UMBRELLA })

  const block = step(out, 'block')
  assert.equal(block.result, 'failed')
  assert.equal(block.target, 7)
  assert.equal(block.detail,
    'review_exit_not_allowed: the task is in REVIEW and stays there — A task in REVIEW leaves it through a review verdict or a cancellation.')
  assert.deepEqual(out.failed_calls, [], 'a refusal by the task state is not a failed call to retry')
  assert.equal(writes(mock).filter(r => r.method === 'PATCH').length, 1, 'the refused write is not retried')
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
  assert.equal(mock.tasks.get(7).description, 'original spec', 'the reason is not appended anywhere')
  assert.equal(step(out, 'tails_waiting').result, 'done', 'the later items are executed anyway')
}))

test('block: a review_exit_not_allowed refusal without a message leaves no dangling separator', withMock({
  tasks: [{ id: 7, title: 'T', status: 'REVIEW', description: 'original spec' }],
  fail: rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/7'))
    ? { status: 409, body: { detail: { error: 'review_exit_not_allowed', message: '', context: {} } } } : null,
}, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').detail, 'review_exit_not_allowed: the task is in REVIEW and stays there')
  assert.deepEqual(out.failed_calls, [])
}))

// The mechanism is the code, not the status: any other 409 stays a failed call.
test('block: a 409 with another code stays a failed call', withMock({
  tasks: [{ id: 7, title: 'T', status: 'IN_PROGRESS', description: 'original spec' }],
  fail: rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/7'))
    ? { status: 409, body: { detail: { error: 'some_other_conflict', message: 'other', context: {} } } } : null,
}, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: { id: 7, reason: 'GATE_RED' }, minors_umbrella: null })

  assert.equal(step(out, 'block').result, 'failed')
  assert.equal(out.failed_calls.length, 1)
  assert.equal(out.failed_calls[0].call, 'block task-7')
  assert.ok(out.failed_calls[0].error.includes('409'), out.failed_calls[0].error)
}))

// ------------------------------------------------------------------ umbrella

const RELEASE_TAILS = 'Tails of release Release A'
const umbrellaOf = over => ({ ...UMBRELLA, task: 5, ...over })

const PLAN_EPIC = 40
const kid = (id, title, over = {}) => ({ id, title, status: 'TODO', parent_task_id: PLAN_EPIC, description: 'work', ...over })
const epicOf = kids => [{ id: PLAN_EPIC, title: 'The task epic', status: 'IN_PROGRESS', kind: 'epic', milestone_id: 1, refuse_ordinary: true }, ...kids]
const ceilingTable = { project: PROJECT, close: null, block: null, minors_umbrella: umbrellaOf({ title: 'Review minors left on task-11', parent: PLAN_EPIC }) }
const tailsEpicOf = mock => [...mock.tasks.values()].find(t => t.kind === 'epic' && String(t.title).startsWith('Tails of release'))
// An epic in Release A whose ceiling of 3 is used up by its ordinary children, with no plan:
// the umbrella of its task goes to the tails epic of that release.
const FULL_KIDS = [kid(41, 'Review minors left on task-12'), kid(42, 'Review minors left on task-13'), kid(43, 'Note answer: Offer Y')]
const pastCeiling = over => umbrellaOf({ parent: PLAN_EPIC, ...over })

test('umbrella: past the ceiling of its epic it is filed under the tails epic of the release, once; the rerun skips both', withMock({
  tasks: [{ id: 5, title: 'T', status: 'IN_PROGRESS', parent_task_id: PLAN_EPIC }, ...epicOf(FULL_KIDS)], milestones: TASK_MILESTONES,
}, async mock => {
  const table = { project: PROJECT, close: null, block: null, minors_umbrella: pastCeiling() }
  const { out: first } = await runAccount(mock, table)

  assert.equal(step(first, 'tails_epic').result, 'done')
  assert.equal(step(first, 'minors_child').result, 'done')
  assert.equal(first.minors_created.length, 1)
  const epic = tailsEpicOf(mock)
  assert.equal(epic.title, RELEASE_TAILS)
  assert.equal(epic.milestone_id, 2, 'attached to the milestone right after the release')
  assert.equal(first.tails_epic_id, epic.id)
  assert.equal(first.tails_epic_needs_milestone, false)
  const child = mock.tasks.get(first.minors_created[0])
  assert.equal(child.parent_task_id, epic.id)
  assert.equal(child.title, UMBRELLA.title)
  assert.equal(child.description, UMBRELLA.description, 'the umbrella body is stored verbatim')
  assert.equal(child.priority, 4)
  assert.equal([...mock.tasks.values()].filter(t => t.title === 'Workflow run tails').length, 0, 'the old tails epic is gone')

  const before = mock.tasks.size
  const { out: second } = await runAccount(mock, table)
  assert.equal(step(second, 'tails_epic').result, 'skipped_already')
  assert.equal(step(second, 'minors_child').result, 'skipped_already')
  assert.deepEqual(second.minors_created, [])
  assert.equal(mock.tasks.size, before, 'the rerun creates nothing')
}))

// A task of an epic with no plan and no other child: the ceiling is 3 and none of it is
// used, so the umbrella is a task of that epic — no tails epic is looked up or created.
test('umbrella: with a parent epic within its ceiling the child is filed under it once, and no tails epic is touched', withMock({
  tasks: [{ id: 40, title: 'The task epic', status: 'IN_PROGRESS', kind: 'epic' }],
}, async mock => {
  const table = { project: PROJECT, close: null, block: null, minors_umbrella: umbrellaOf({ parent: 40 }) }
  const { out: first } = await runAccount(mock, table)
  assert.equal(first.actions.filter(a => a.step === 'tails_epic').length, 0, 'no tails epic step')
  assert.equal(step(first, 'minors_child').result, 'done')
  assert.match(step(first, 'minors_child').detail, /under epic task-40/)
  const child = mock.tasks.get(first.minors_created[0])
  assert.equal(child.parent_task_id, 40)
  assert.equal(child.description, UMBRELLA.description)
  assert.equal(tailsEpicOf(mock), undefined)
  const before = mock.tasks.size
  const { out: second } = await runAccount(mock, table)
  assert.equal(step(second, 'minors_child').result, 'skipped_already')
  assert.equal(mock.tasks.size, before, 'the rerun creates nothing')
}))

// The list endpoint caps a page at 200, so a project with more open epics than
// that hides the tails epic behind an offset. A lookup stopping at the first
// page would not find it and would file a second tails epic of the release.
const PAGED_EPICS = [
  { id: 5, title: 'T', status: 'IN_PROGRESS', parent_task_id: PLAN_EPIC }, ...epicOf(FULL_KIDS),
  ...Array.from({ length: 249 }, (_, i) => ({ id: 100 + i, title: 'Filler epic ' + i, status: 'TODO', kind: 'epic' })),
  { id: 500, title: RELEASE_TAILS, status: 'TODO', kind: 'epic', milestone_id: 2, description: 'Work of the release beyond what its epics took in, taken into work first after the push' },
]

test('umbrella: a tails epic sitting past the first page is found, not duplicated', withMock({ tasks: PAGED_EPICS, milestones: TASK_MILESTONES }, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: null, minors_umbrella: pastCeiling() })

  assert.equal(step(out, 'tails_epic').result, 'skipped_already', 'the epic on the last page is seen')
  assert.equal(step(out, 'tails_epic').target, 500)
  const epics = [...mock.tasks.values()].filter(t => t.title === RELEASE_TAILS)
  assert.equal(epics.length, 1, 'no second tails epic is created')

  const offsets = mock.requests
    .filter(r => r.method === 'GET' && r.query.get('kind') === 'epic')
    .map(r => Number(r.query.get('offset')))
  assert.deepEqual(offsets, [0, 200], 'the listing is walked to the end, one page at a time')

  // The child is still filed — under the epic that already existed.
  assert.equal(step(out, 'minors_child').result, 'done')
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, 500)
}))

// ------------------------------------------- two parallel runs of one milestone

// The lookup comes before the creation, so two runs of one release can both miss
// the tails epic and both create one. Each run re-reads the open epics of that title
// in that milestone after creating its own, keeps the oldest (lowest id), moves what
// sits under its own duplicate there and cancels the duplicate.
const tailsOf = mock => [...mock.tasks.values()].filter(t => t.kind === 'epic' && t.title === RELEASE_TAILS)
const openOf = epics => epics.filter(t => !['DONE', 'CANCELLED'].includes(t.status))
const isEpicListing = rec => rec.method === 'GET' && rec.query.get('kind') === 'epic'
const isEpicCreate = rec => rec.method === 'POST' && rec.body && rec.body.kind === 'epic'
// A task of an epic in Release A whose ceiling is used up: its umbrella goes to the
// tails epic of the release (a task with no epic has no release milestone at all).
const RACE_TASKS = [{ id: 5, title: 'T', status: 'IN_PROGRESS', parent_task_id: PLAN_EPIC }, ...epicOf(FULL_KIDS)]
const RACE_TABLE = { project: PROJECT, close: null, block: null, minors_umbrella: pastCeiling() }
const raceRun = (mock, table) => runAccount(mock, table)

// The first two epic listings — the lookup of each run — are answered only once both
// have arrived, so both lookups find nothing and both runs create an epic.
const bothLookupsFirst = () => {
  let arrived = 0
  let release
  const both = new Promise(resolve => { release = resolve })
  return async rec => {
    if (!isEpicListing(rec) || rec.query.get('offset') !== '0' || arrived >= 2) return
    if (++arrived === 2) release()
    await both
  }
}

test('race: two runs that both find no tails epic and both create one leave one open, the oldest', withMock({
  tasks: [{ id: 6, title: 'T6', status: 'IN_PROGRESS', parent_task_id: PLAN_EPIC }, ...RACE_TASKS],
  milestones: TASK_MILESTONES, hold: bothLookupsFirst(),
}, async mock => {
  const tableOf = task => ({ project: PROJECT, close: null, block: null,
    minors_umbrella: pastCeiling({ task, title: 'Review minors left on task-' + task }) })
  const [{ out: a }, { out: b }] = await Promise.all([raceRun(mock, tableOf(5)), raceRun(mock, tableOf(6))])

  const all = tailsOf(mock)
  assert.equal(all.length, 2, 'both runs created a tails epic: the race happened')
  const open = openOf(all)
  assert.equal(open.length, 1, 'one tails epic of the release stays open')
  const oldest = Math.min(...all.map(t => t.id))
  assert.equal(open[0].id, oldest, 'the oldest one is kept')
  const dup = all.find(t => t.id !== oldest)
  assert.equal(dup.status, 'CANCELLED')
  assert.ok(dup.description.endsWith('## Resolution\nduplicate of task-' + oldest), dup.description)

  assert.equal(a.tails_epic_id, oldest)
  assert.equal(b.tails_epic_id, oldest)
  for (const out of [a, b]) {
    assert.deepEqual(out.failed_calls, [])
    assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, oldest, 'each umbrella is under the kept epic')
  }
  assert.equal([...mock.tasks.values()].filter(t => t.parent_task_id === dup.id).length, 0, 'nothing is left under the duplicate')
}))

// Another run's epic of the same title lands between this run's lookup and its
// creation; a third run files under this run's epic before the re-read.
const RIVAL = 850
test('race: an older epic of another run is kept — what sits under this run\'s epic moves there, its own epic is cancelled', withMock({
  tasks: RACE_TASKS, milestones: TASK_MILESTONES,
  hold: (() => {
    let created = null
    return (rec, state) => {
      if (isEpicCreate(rec)) {
        state.tasks.set(RIVAL, { id: RIVAL, title: RELEASE_TAILS, kind: 'epic', status: 'TODO', milestone_id: 2, parent_task_id: null, description: '', priority: 1 })
        created = state.nextId
      } else if (created !== null && isEpicListing(rec)) {
        state.tasks.set(860, { id: 860, title: 'Filed by a third run', kind: 'task', status: 'TODO', parent_task_id: created, description: '', priority: 4 })
        created = null
      }
    }
  })(),
}, async mock => {
  const { out } = await raceRun(mock, RACE_TABLE)

  const own = tailsOf(mock).find(t => t.id !== RIVAL)
  assert.equal(step(out, 'tails_epic').target, own.id, 'this run created its own epic first')
  assert.equal(own.status, 'CANCELLED')
  assert.ok(own.description.endsWith('## Resolution\nduplicate of task-' + RIVAL), own.description)
  assert.equal(mock.tasks.get(RIVAL).status, 'TODO', 'the kept epic is not touched')
  assert.equal(mock.tasks.get(860).parent_task_id, RIVAL, 'the task under the duplicate moves to the kept epic')
  const dedup = step(out, 'tails_epic_duplicate')
  assert.equal(dedup.result, 'done')
  assert.equal(dedup.target, own.id)
  assert.match(dedup.detail, new RegExp('duplicate of task-' + RIVAL))
  assert.equal(out.tails_epic_id, RIVAL)
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, RIVAL, 'the umbrella goes to the kept epic')
  assert.deepEqual(out.failed_calls, [])
}))

// The boundaries of the re-read: a newer epic of the same title is the other run's
// duplicate, not this run's to cancel; an older one in another milestone is not the
// tails epic of this release.
for (const [name, rival] of [
  ['a newer epic of the same title in the same milestone', { id: 990, milestone_id: 2 }],
  ['an older epic of the same title in another milestone', { id: RIVAL, milestone_id: 1 }],
  ['an older epic of the same title already cancelled', { id: RIVAL, milestone_id: 2, status: 'CANCELLED' }],
]) {
  test('race: ' + name + ' leaves this run\'s epic open and the other one untouched', withMock({
    tasks: RACE_TASKS, milestones: TASK_MILESTONES,
    hold: (() => {
      let done = false
      return (rec, state) => {
        if (done || !isEpicCreate(rec)) return
        done = true
        state.tasks.set(rival.id, { title: RELEASE_TAILS, kind: 'epic', status: 'TODO', parent_task_id: null, description: '', priority: 1, ...rival })
      }
    })(),
  }, async mock => {
    const { out } = await raceRun(mock, RACE_TABLE)
    const own = tailsOf(mock).find(t => t.id !== rival.id)
    assert.equal(own.status, 'TODO', 'this run\'s epic stays open')
    assert.equal(mock.tasks.get(rival.id).status, rival.status ?? 'TODO', 'the other epic is not touched')
    assert.equal(out.tails_epic_id, own.id)
    assert.equal(step(out, 'tails_epic_duplicate'), undefined, 'nothing is cancelled')
    assert.equal(writes(mock).filter(r => r.method === 'PATCH').length, 0, 'no task is changed')
    assert.deepEqual(out.failed_calls, [])
  }))
}

// A failed re-read is a failed call: the run's epic stays open and takes the umbrella.
test('race: a failed re-read after the create is a failed call, and the run files under its own epic', withMock({
  tasks: RACE_TASKS, milestones: TASK_MILESTONES,
  fail: (() => {
    let listings = 0
    return rec => (isEpicListing(rec) && ++listings === 2) ? { status: 500, body: { detail: 'boom' } } : null
  })(),
}, async mock => {
  const { out } = await raceRun(mock, RACE_TABLE)
  const own = tailsOf(mock)[0]
  assert.equal(own.status, 'TODO')
  assert.deepEqual(out.failed_calls.map(f => f.call), ['tails epic re-read after create'])
  assert.equal(step(out, 'tails_epic_duplicate').result, 'failed')
  assert.equal(out.tails_epic_id, own.id)
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, own.id)
}))

// A cancel that fails is a failed call; the umbrella still goes to the kept epic.
test('race: a failed cancel of the duplicate is a failed call, and the run still files under the oldest', withMock({
  tasks: RACE_TASKS, milestones: TASK_MILESTONES,
  hold: (rec, state) => {
    if (isEpicCreate(rec) && !state.tasks.has(RIVAL))
      state.tasks.set(RIVAL, { id: RIVAL, title: RELEASE_TAILS, kind: 'epic', status: 'TODO', milestone_id: 2, parent_task_id: null, description: '', priority: 1 })
  },
  fail: rec => (rec.method === 'PATCH' && rec.body && rec.body.status === 'CANCELLED') ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await raceRun(mock, RACE_TABLE)
  const own = tailsOf(mock).find(t => t.id !== RIVAL)
  assert.equal(own.status, 'TODO', 'the cancel did not happen')
  assert.deepEqual(out.failed_calls.map(f => f.call), ['cancel the duplicate tails epic task-' + own.id])
  assert.equal(out.tails_epic_id, RIVAL)
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, RIVAL)
}))

// Two open epics of the title left by an earlier race (its cancel failed): the
// lookup takes the oldest, whatever order the listing returns them in.
test('lookup: of two open tails epics of the release the oldest is reused', withMock({
  tasks: [
    ...RACE_TASKS,
    { id: 520, title: RELEASE_TAILS, status: 'TODO', kind: 'epic', milestone_id: 2 },
    { id: 510, title: RELEASE_TAILS, status: 'TODO', kind: 'epic', milestone_id: 2 },
  ], milestones: TASK_MILESTONES,
}, async mock => {
  const { out } = await raceRun(mock, RACE_TABLE)
  assert.equal(step(out, 'tails_epic').result, 'skipped_already')
  assert.equal(out.tails_epic_id, 510)
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, 510)
}))

// The server refuses ordinary work; the client never reads a plan to decide.
test('umbrella: an existing child is reused without posting again', withMock({
  tasks: epicOf([kid(24, 'Review minors left on task-11')]), milestones: TASK_MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, ceilingTable)
  assert.equal(step(out, 'minors_child').target, 24)
  assert.equal(writes(mock).length, 0)
}))

// ------------------------------------- the umbrella first, the close naming where it went

const MINOR_CLOSE = 'merged as abc123; review clean; full gate green; 1 review minor(s) left open, for one follow-up task'
const closeWith = umbrella => ({ project: PROJECT, close: { id: 5, resolution: MINOR_CLOSE }, block: null, minors_umbrella: umbrella })
const resolutionOf = mock => mock.tasks.get(5).description.split('## Resolution\n')[1]

test('umbrella: filed before the close, whose resolution names the task it became in the tails epic', withMock({
  tasks: [{ id: 5, title: 'T', status: 'REVIEW', parent_task_id: PLAN_EPIC }, ...epicOf(FULL_KIDS)], milestones: TASK_MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, closeWith(pastCeiling()))
  assert.deepEqual(out.actions.map(a => a.step), ['tails_epic', 'minors_child', 'close'], 'the umbrella first, then the close')
  assert.equal(resolutionOf(mock), 'merged as abc123; review clean; full gate green; 1 review minor(s) left open, filed as task-' +
    out.minors_created[0] + ' in the tails epic task-' + out.tails_epic_id)
}))

test('umbrella: within the ceiling, the resolution names the task it became under the epic', withMock({
  tasks: [{ id: 5, title: 'T', status: 'REVIEW' }, { id: 40, title: 'The task epic', status: 'IN_PROGRESS', kind: 'epic' }],
}, async mock => {
  const { out } = await runAccount(mock, closeWith(umbrellaOf({ parent: 40 })))
  assert.equal(resolutionOf(mock), 'merged as abc123; review clean; full gate green; 1 review minor(s) left open, filed as task-' +
    out.minors_created[0] + ' under epic task-40')
}))

// The release rule: the open milestone after the release is a standing list, so no tails
// epic is filed past the ceiling of an epic, and the umbrella waits for the owner's answer.
const STANDING_AFTER = [
  { id: 1, title: 'Release A', sequence: 1, status: 'OPEN', is_release: true },
  { id: 2, title: 'Waiting', sequence: 2, status: 'OPEN', is_release: false },
]
// Only an epic carries a milestone, so a task with no epic has no release milestone: no
// milestone is read and no tails epic is filed or reused, even while the tails epic of a
// release is open. The umbrella waits in one progress entry linked to the task, the close
// says so, and the owner is asked which milestone the tails go to.
test('umbrella: a task with no epic has no release milestone — its own why, the umbrella waits in progress, once', withMock({
  tasks: [{ id: 5, title: 'T', status: 'REVIEW' },
    { id: 500, title: RELEASE_TAILS, status: 'TODO', kind: 'epic', milestone_id: 2 }],
  milestones: TASK_MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, closeWith(umbrellaOf()))
  assert.equal(step(out, 'tails_epic').result, 'failed')
  assert.equal(step(out, 'tails_epic').detail,
    'not filed: task-5 has no epic, so no release milestone — the person is asked which milestone the tails go to')
  assert.deepEqual(out.failed_calls, [], 'a question, not a broken call')
  assert.equal(mock.requests.filter(r => r.path.includes('/milestones')).length, 0, 'no milestone is read')
  assert.equal(writes(mock).filter(r => r.path.endsWith('/tasks/500')).length, 0, 'the open tails epic is left alone')
  assert.equal([...mock.tasks.values()].filter(t => t.parent_task_id === 500).length, 0, 'nothing is filed under it')
  assert.equal([...mock.tasks.values()].filter(t => t.kind === 'epic').length, 1, 'no tails epic is made')
  assert.deepEqual(out.minors_created, [])
  assert.equal(out.tails_epic_id, null)
  assert.equal(out.tails_epic_needs_milestone, true)
  assert.equal(mock.progress.length, 1)
  const entry = mock.progress[0]
  assert.ok(entry.description.startsWith('[task-run:5] tails waiting for a milestone: '), entry.description)
  assert.ok(entry.description.includes('- ' + UMBRELLA.title + ' (priority 4): ' + UMBRELLA.description), entry.description)
  assert.equal(entry.linked_item_type, 'task')
  assert.equal(entry.linked_item_id, 5)
  assert.equal(out.tails_waiting_progress_id, entry.id)
  assert.equal(resolutionOf(mock), "merged as abc123; review clean; full gate green; 1 review minor(s) left open, waiting for the owner's answer on their milestone, recorded in progress-" + entry.id)

  const { out: second } = await runAccount(mock, { ...closeWith(umbrellaOf()), close: null })
  assert.equal(step(second, 'tails_waiting').result, 'skipped_already')
  assert.equal(second.tails_waiting_progress_id, entry.id)
  assert.equal(mock.progress.length, 1, 'the rerun records nothing new')
}))

// With neither an epic nor a task there is nothing to mark and link the waiting entry by.
test('umbrella: with no epic and no task nothing is filed or recorded, and the close says so', withMock({
  tasks: [{ id: 5, title: 'T', status: 'REVIEW' }],
}, async mock => {
  const { out } = await runAccount(mock, closeWith({ ...UMBRELLA, task: undefined }))
  assert.equal(step(out, 'minors_child').detail, 'no epic and no task to record the waiting tails by')
  assert.equal(mock.progress.length, 0)
  assert.equal(resolutionOf(mock), 'merged as abc123; review clean; full gate green; 1 review minor(s) left open, not filed: no task to record the waiting tails by')
}))

// A task of an epic past the ceiling: its umbrella waits linked to the epic, not the task.
test('umbrella: no next release files the work without a milestone and asks, then reuses it', withMock({
  tasks: epicOf(FULL_KIDS), milestones: STANDING_AFTER,
}, async mock => {
  const table = { project: PROJECT, minors_umbrella: pastCeiling() }
  const { out } = await runAccount(mock, table)
  const tails = mock.tasks.get(out.tails_epic_id)
  assert.equal(tails.milestone_id, undefined)
  assert.equal(tails.priority, 1)
  assert.equal(out.tails_epic_needs_milestone, true)
  assert.equal(mock.tasks.get(out.minors_created[0]).parent_task_id, tails.id)
  assert.equal(mock.progress.length, 0, 'work is filed, not parked in progress')
  const { out: again } = await runAccount(mock, table)
  assert.equal(again.tails_epic_id, tails.id)
  assert.equal(again.tails_epic_needs_milestone, true)
  assert.deepEqual(again.minors_created, [])
}))

// -------------------------------------------------------- failure isolation

test('a failing item lands in failed_calls while the remaining items still run', withMock({
  tasks: [{ id: 5, title: 'T', status: 'TODO' }, { id: 7, title: 'B', status: 'TODO', description: 'keep me' }],
  fail: rec => (rec.method === 'GET' && rec.path.endsWith('/tasks/5')) ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, {
    project: PROJECT,
    close: { id: 5, resolution: 'merged as abc123' },
    block: { id: 7, reason: 'GATE_RED' },
    minors_umbrella: UMBRELLA,
  })

  assert.equal(step(out, 'close').result, 'failed')
  assert.equal(out.task_closed, false)
  assert.equal(out.failed_calls.length, 1)
  assert.ok(out.failed_calls[0].error.includes('500'), 'the status code is reported: ' + out.failed_calls[0].error)
  assert.equal(step(out, 'block').result, 'done', 'the later items are executed anyway')
  assert.equal(step(out, 'tails_waiting').result, 'done')
  assert.equal(mock.tasks.get(7).status, 'BLOCKED')
}))

// ------------------------------------------------------------- key handling

test('no api key in either variable: the fallback sentinel is printed and nothing is called', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const table = tableFile({ project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
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
  const table = tableFile({ project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
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
  const table = tableFile({ project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })
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
  const { out, stdout } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null })

  assert.equal(out.failed_calls.length, 1)
  assert.ok(!stdout.includes(KEY), 'the key value never leaves the process')
  assert.ok(out.failed_calls[0].error.includes('***'), 'it is masked: ' + out.failed_calls[0].error)
}))

// ------------------------------------------------------------ table shapes

test('an empty table does nothing and still reports the S_ACC shape', withMock({ tasks: [] }, async mock => {
  const { out } = await runAccount(mock, { project: PROJECT, close: null, block: null, minors_umbrella: null })

  assert.deepEqual(out, { via: 'wf-helper', actions: [], minors_created: [], task_closed: false,
    tails_epic_id: null, tails_epic_needs_milestone: false, tails_waiting_progress_id: null, failed_calls: [] })
  assert.deepEqual(mock.requests, [])
}))

test('a table carrying steps this command does not implement is refused, not half-executed', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const { stdout } = await runAccount(mock, { project: PROJECT, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null, skipped: [{ id: 9, dep: 8 }] })

  assert.equal(stdout.trim(), '{"error": "unsupported table"}')
  assert.deepEqual(mock.requests, [], 'nothing is executed from a table only partly understood')
}))

// ------------------------------------------------------------- the epic table

const EPIC = 100
const RESOLUTION = 'plan tasks 1/3 merged; criticals fixed 0 of 0; findings filed at the accounting 0; ordinary tasks added 3 of ceiling 3; bug fixes 0; ordinary work to the tails epic 1; gate green; acceptance READY'
// An entry naming no parent: ordinary work beyond the epic's ceiling, for the tails epic.
const CRITICAL = { title: 'Review minors left on task-9', priority: 3, description: 'The review minors of task-9 left open after its fix round; fix each.' }

// A run with one merged, one failed and one skipped child: may_close is false,
// because two children are still open.
const epicTable = over => ({
  project: PROJECT, epic: EPIC,
  done: [{ id: 5, resolution: 'merged as abc123' }],
  failed: [{ id: 7, reason: 'GATE_RED' }],
  skipped: [{ id: 9, dep: 7 }],
  parity_failed: [{ plan_index: 3, title: 'Wire the gate' }],
  minors: [CRITICAL],
  verdict: 'NOT_READY', may_close: false, close_resolution: RESOLUTION,
  ...over,
})
// The epic belongs to the release milestone RELEASE; the tails epic of that release goes to
// the next OPEN milestone by sequence (AFTER), past a closed one in between — a release
// milestone itself, never a standing list.
const RELEASE = 502
const AFTER = 504
const MILESTONES = [
  { id: 501, title: 'Release 1.0', sequence: 1, status: 'DONE', is_release: true },
  { id: RELEASE, title: 'Release 1.1', sequence: 2, status: 'OPEN', is_release: true },
  { id: 503, title: 'Closed in between', sequence: 3, status: 'DONE', is_release: true },
  { id: AFTER, title: 'Release 1.2', sequence: 4, status: 'OPEN', is_release: true },
]
// The standing lists of a roadmap: the waiting milestone and the backlog without a
// date are not releases (is_release=false), and here they stand right after the release.
const WAITING = 505
const MISSING = 599                                   // a milestone id the roadmap does not hold
const STANDING = [
  { id: 501, title: 'Release 1.0', sequence: 1, status: 'DONE', is_release: true },
  { id: RELEASE, title: 'Release 1.1', sequence: 2, status: 'OPEN', is_release: true },
  { id: WAITING, title: 'Waiting', sequence: 3, status: 'OPEN', is_release: false },
  { id: 506, title: 'Backlog without a date', sequence: 4, status: 'OPEN', is_release: false },
  { id: AFTER, title: 'Release 1.2', sequence: 5, status: 'OPEN', is_release: true },
]
const epicTasks = (kids, milestone = RELEASE) => [
  { id: EPIC, title: 'The epic', status: 'IN_PROGRESS', kind: 'epic', milestone_id: milestone },
  ...kids,
]
const RUN_CHILDREN = [
  { id: 5, title: 'A', status: 'TODO', parent_task_id: EPIC, description: 'spec of A' },
  { id: 7, title: 'B', status: 'TODO', parent_task_id: EPIC, description: 'spec of B' },
  { id: 9, title: 'C', status: 'TODO', parent_task_id: EPIC, description: 'spec of C' },
]
const steps = (out, name) => out.actions.filter(a => a.step === name)
const descriptions = mock => mock.progress.map(e => e.description)
const tailsEpic = mock => [...mock.tasks.values()].find(t => t.kind === 'epic' && String(t.title).startsWith('Tails of release'))
// The resolution names where the ordinary work went: the tails epic it was filed in,
// the progress entry that holds it while the person is asked, or that it was not filed.
const TAILS_PART = '; ordinary work to the tails epic 1;'
const filedIn = id => RESOLUTION.replace(TAILS_PART, `; ordinary work filed in the tails epic task-${id}: 1;`)
const waitingIn = id => RESOLUTION.replace(TAILS_PART,
  `; ordinary work waiting for the owner's answer on its milestone: 1, recorded in progress-${id};`)
const notFiledAt = RESOLUTION.replace(TAILS_PART, '; ordinary work not filed: 1, the tails epic could not be found or made;')

test('epic table: every step is executed in order, the epic itself is left alone', withMock({ tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES }, async mock => {
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

  // one tails epic per release: named by the epic's milestone, attached to the one after it
  const tails = tailsEpic(mock)
  assert.deepEqual(descriptions(mock), [
    '[epic-run:100] plan task without a child: Wire the gate — no child task in ConPort',
    '[epic-run:100] result: ' + filedIn(tails.id),
  ], 'the summary names the tails epic the work was filed in')
  assert.equal(out.tails_waiting_progress_id, null, 'nothing waits for the person')
  assert.equal(tails.title, 'Tails of release Release 1.1')
  assert.equal(tails.milestone_id, AFTER, 'the next OPEN milestone by sequence, a closed one skipped')
  assert.equal(tails.priority, 1, 'the tails epic is taken into work first after the push')
  assert.equal(tails.description, 'Work of the release beyond what its epics took in, taken into work first after the push')
  assert.equal(out.tails_epic_id, tails.id)
  assert.equal(out.tails_epic_needs_milestone, false)
  const child = [...mock.tasks.values()].find(t => t.title === CRITICAL.title)
  assert.ok(child, 'the tails entry of the table is filed under its own title')
  assert.deepEqual(out.tails_children, [child.id], 'the report names the task actually created')
  assert.equal(child.parent_task_id, tails.id)
  assert.equal(child.description, CRITICAL.description)
  assert.equal(child.priority, 3, 'the entry keeps the priority the table gave it')

  assert.equal(out.epic_closed, false)
  assert.equal(out.epic_close_error, null)
  assert.equal(out.epic_progress, null)
  assert.equal(writes(mock).some(r => r.path.endsWith('/tasks/' + EPIC)), false,
    'may_close is false — the epic is not written to')
}))

test('epic table: the open tails epic of the release is reused — one per release, whichever epic filed it', withMock({
  tasks: epicTasks(RUN_CHILDREN).concat([{ id: 300, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: AFTER }]),
  milestones: MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(out.tails_epic_id, 300)
  assert.equal(steps(out, 'tails_epic')[0].result, 'skipped_already')
  assert.equal([...mock.tasks.values()].filter(t => String(t.title).startsWith('Tails of release')).length, 1)
  assert.equal([...mock.tasks.values()].find(t => t.title === CRITICAL.title).parent_task_id, 300)
}))

// No tails epic is filed where the release or its next milestone is unknown: the
// person is asked which milestone the tails go to, and the entries wait for the answer.
const notFiled = (mock, out) => {
  assert.equal(tailsEpic(mock), undefined, 'no tails epic is created')
  assert.equal(out.tails_epic_id, null)
  assert.equal(out.tails_epic_needs_milestone, true, 'the person is asked')
  assert.deepEqual(out.tails_children, [])
  assert.equal([...mock.tasks.values()].some(t => t.title === CRITICAL.title), false, 'the entry is not filed anywhere')
  assert.deepEqual(steps(out, 'tails_child'), [])
  const step = steps(out, 'tails_epic')
  assert.equal(step.length, 1)
  assert.equal(step[0].result, 'failed')
  assert.match(step[0].detail, /^not filed: .+ — the person is asked which milestone the tails go to$/)
  assert.deepEqual(out.failed_calls, [], 'no call failed: it is a question, not a broken call')
  // the work waits in ConPort, not only in the run: one progress entry linked to the
  // epic holds each entry with its title, priority and description
  const record = mock.progress.find(e => e.id === out.tails_waiting_progress_id)
  assert.ok(record, 'the waiting tails are recorded as a progress entry')
  assert.equal(record.description, '[epic-run:100] tails waiting for a milestone: the owner is asked which milestone ' +
    "the tails epic of the release goes to; under it, 'Tails of release <title of the release milestone>' at priority 1, " +
    'each entry below becomes a task.\n\n' +
    '- ' + CRITICAL.title + ' (priority 3): ' + CRITICAL.description)
  assert.equal(record.linked_item_type, 'task')
  assert.equal(record.linked_item_id, EPIC)
  assert.deepEqual(steps(out, 'tails_waiting').map(a => [a.target, a.result]), [[record.id, 'done']])
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' + waitingIn(record.id),
    'the summary says the work waits for the owner, and where it is')
  return step[0].detail
}

test('epic table: without a release waiting work is recorded once', withMock({
  tasks: epicTasks(RUN_CHILDREN, null), milestones: STANDING,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  notFiled(mock, out)
  const entries = mock.progress.length
  const { out: second } = await runAccount(mock, epicTable())
  assert.equal(mock.progress.length, entries, 'no second record, no second summary')
  assert.equal(second.tails_waiting_progress_id, out.tails_waiting_progress_id)
  assert.equal(steps(second, 'tails_waiting')[0].result, 'skipped_already')
}))

test('epic table: an epic whose milestone is not found gets no tails epic, and the person is asked', withMock({
  tasks: epicTasks(RUN_CHILDREN, MISSING), milestones: MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.match(notFiled(mock, out), new RegExp(`milestone ${MISSING} of epic task-100 is not found`))
}))

test('epic table: a failed lookup of the tails epic after a standing list is a failed call, and nothing is asked', withMock({
  tasks: epicTasks(RUN_CHILDREN), milestones: STANDING,
  fail: rec => (rec.method === 'GET' && rec.path.endsWith('/tasks') && rec.query.get('kind') === 'epic')
    ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(out.tails_epic_id, null)
  assert.equal(out.tails_epic_needs_milestone, false, 'a broken call is not a question')
  assert.equal(out.failed_calls.length, 1)
  assert.equal(out.failed_calls[0].call, 'tails epic lookup or create')
  assert.deepEqual(steps(out, 'tails_child').map(a => [a.result, a.detail]), [['failed', 'no tails epic to attach the entries to']])
  assert.deepEqual(steps(out, 'tails_waiting'), [])
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' + notFiledAt)
}))

test('epic table: a waiting record that cannot be written is a failed call, the person is still asked, and the summary says not filed', withMock({
  tasks: epicTasks(RUN_CHILDREN, null), milestones: STANDING,
  fail: rec => (rec.method === 'POST' && rec.path.endsWith('/progress') &&
    String(rec.body && rec.body.description).startsWith('[epic-run:100] tails waiting for a milestone: '))
    ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(out.tails_epic_id, null)
  assert.equal(out.tails_epic_needs_milestone, true, 'the question is still asked')
  assert.equal(out.tails_waiting_progress_id, null)
  assert.deepEqual(out.failed_calls.map(f => f.call), ['record the tails waiting for a milestone'])
  assert.equal(steps(out, 'tails_waiting')[0].result, 'failed')
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' +
    RESOLUTION.replace(TAILS_PART, '; ordinary work not filed: 1, the owner is asked which milestone the tails go to;'))
}))

test('epic table: entries that could not be filed under the tails epic are not called filed', withMock({
  tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES,
  // the children of the tails epic (the first id the mock gives) cannot be listed
  fail: rec => (rec.method === 'GET' && rec.path.endsWith('/tasks') && rec.query.get('parent_task_id') === '900')
    ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(out.tails_epic_id, 900)
  assert.deepEqual(out.tails_children, [])
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' +
    RESOLUTION.replace(TAILS_PART, '; ordinary work filed in the tails epic task-900: 0 of 1, the rest not filed: a call failed;'))
}))

test('epic table: an entry already under the tails epic counts as filed, a failed one does not', withMock({
  tasks: epicTasks(RUN_CHILDREN).concat([
    { id: 300, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: AFTER },
    { id: 301, title: CRITICAL.title, status: 'TODO', parent_task_id: 300 },
  ]),
  milestones: MILESTONES,
  fail: rec => (rec.method === 'POST' && rec.path.endsWith('/tasks') && rec.body && rec.body.title === 'Second entry')
    ? { status: 500, body: { detail: 'boom' } } : null,
}, async mock => {
  const two = epicTable({ minors: [CRITICAL, { ...CRITICAL, title: 'Second entry' }] })
  two.close_resolution = RESOLUTION.replace(TAILS_PART, '; ordinary work to the tails epic 2;')
  const { out } = await runAccount(mock, two)
  assert.deepEqual(steps(out, 'tails_child').map(a => a.result), ['skipped_already', 'failed'])
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' +
    RESOLUTION.replace(TAILS_PART, '; ordinary work filed in the tails epic task-300: 1 of 2, the rest not filed: a call failed;'))
}))

test('epic table: an epic without a milestone gets no tails epic, and the person is asked where the tails go', withMock({
  tasks: epicTasks(RUN_CHILDREN, null), milestones: MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.match(notFiled(mock, out), /epic task-100 has no milestone/)
}))

test('epic table: an epic in a milestone that is not a release gets no tails epic, and the person is asked', withMock({
  tasks: epicTasks(RUN_CHILDREN, WAITING), milestones: STANDING,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.match(notFiled(mock, out), new RegExp(`milestone ${WAITING} of epic task-100 is not a release`))
}))

test('epic table: with no next open milestone it creates unassigned tails and asks', withMock({
  tasks: epicTasks(RUN_CHILDREN, AFTER), milestones: MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  const tails = mock.tasks.get(out.tails_epic_id)
  assert.equal(tails.title, 'Tails of release Release 1.2')
  assert.equal(tails.milestone_id, undefined)
  assert.equal(tails.priority, 1)
  assert.equal(out.tails_epic_needs_milestone, true)
  assert.equal(out.tails_waiting_progress_id, null)
  assert.equal(out.tails_children.length, 1)
  assert.equal(descriptions(mock).at(-1), '[epic-run:100] result: ' + filedIn(tails.id))
}))

test('epic table: a standing next milestone is not skipped to reach a later release', withMock({
  tasks: epicTasks(RUN_CHILDREN), milestones: STANDING,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(mock.tasks.get(out.tails_epic_id).milestone_id, undefined)
  assert.equal(out.tails_epic_needs_milestone, true)
  assert.equal(out.tails_children.length, 1)
  assert.equal(out.tails_waiting_progress_id, null)
}))

test('epic table: only unassigned open tails qualify when a standing list follows', withMock({
  tasks: epicTasks(RUN_CHILDREN).concat([
    { id: 299, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: AFTER },
    { id: 300, title: 'Tails of release Release 1.1', status: 'REVIEW', kind: 'epic', milestone_id: null },
    { id: 301, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: null },
  ]), milestones: STANDING,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())
  assert.equal(out.tails_epic_id, 300)
  assert.equal(out.tails_epic_needs_milestone, true)
  assert.equal(steps(out, 'tails_epic')[0].result, 'skipped_already')
  assert.equal(mock.tasks.get(out.tails_children[0]).parent_task_id, 300)
}))

test('epic table: a rerun of the same table changes nothing', withMock({ tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES }, async mock => {
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

test('epic table: a failed child in REVIEW is reported as refused and every later step still runs', withMock({
  tasks: epicTasks([RUN_CHILDREN[0], { ...RUN_CHILDREN[1], status: 'REVIEW' }, RUN_CHILDREN[2]]),
  milestones: MILESTONES,
  fail: refuseReviewExit,
}, async mock => {
  const { out } = await runAccount(mock, epicTable())

  assert.deepEqual(out.actions.map(a => a.step),
    ['close', 'block', 'skipped', 'parity_progress', 'tails_epic', 'tails_child', 'run_summary'])
  assert.equal(step(out, 'block').result, 'failed')
  assert.ok(step(out, 'block').detail.startsWith('review_exit_not_allowed: '), step(out, 'block').detail)
  assert.deepEqual(out.failed_calls, [])
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
  assert.equal(mock.tasks.get(7).description, 'spec of B')
}))

// A finding the findings round could not give a child is a finding of the run's
// own epic: its entry names that epic as parent and becomes its child, one per
// finding; no tails epic is made for it.
const UNFILED = { title: 'Review minors left on task-5', description: 'The review minors of task-5 …', priority: 3, parent: EPIC }

test('epic table: an entry with a parent is filed as a child of that epic, once, and no tails epic is made for it', withMock({ tasks: epicTasks(RUN_CHILDREN) }, async mock => {
  const table = epicTable({ minors: [UNFILED] })
  const { out } = await runAccount(mock, table)
  assert.equal(tailsEpic(mock), undefined, 'no tails epic')
  assert.equal(steps(out, 'tails_epic').length, 0)
  const child = [...mock.tasks.values()].find(t => t.title === UNFILED.title)
  assert.equal(child.parent_task_id, EPIC)
  assert.equal(child.description, UNFILED.description)
  assert.equal(child.priority, 3)
  assert.deepEqual(out.epic_children, [child.id])
  assert.equal(steps(out, 'finding_child')[0].result, 'done')
  const before = mock.tasks.size
  const { out: second } = await runAccount(mock, table)
  assert.equal(steps(second, 'finding_child')[0].result, 'skipped_already')
  assert.equal(mock.tasks.size, before)
}))

// A closed child of the same title is not the finding's task: it is a task the run
// already finished (a plan task, say). Only an open child counts as already filed.
test('epic table: a closed child of the same title is not taken for the finding — a new child is filed', withMock({
  tasks: epicTasks([{ id: 5, title: UNFILED.title, status: 'DONE', parent_task_id: EPIC, description: 'a plan task' }, ...RUN_CHILDREN.slice(1)]),
}, async mock => {
  const { out } = await runAccount(mock, epicTable({ done: [], minors: [UNFILED] }))
  assert.equal(steps(out, 'finding_child')[0].result, 'done')
  const filed = [...mock.tasks.values()].filter(t => t.title === UNFILED.title)
  assert.equal(filed.length, 2)
  assert.deepEqual(out.epic_children, [filed.find(t => t.id !== 5).id])
}))

test('epic table: entries with and without a parent go each to their own epic', withMock({ tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES }, async mock => {
  const { out } = await runAccount(mock, epicTable({ minors: [CRITICAL, UNFILED] }))
  const tails = tailsEpic(mock)
  assert.equal([...mock.tasks.values()].find(t => t.title === CRITICAL.title).parent_task_id, tails.id)
  assert.equal([...mock.tasks.values()].find(t => t.title === UNFILED.title).parent_task_id, EPIC)
  assert.equal(out.tails_children.length, 1)
  assert.equal(out.epic_children.length, 1)
}))

// -------------------------------------------------------------- epic closing

const CLOSED_CHILD = [{ id: 5, title: 'A', status: 'DONE', parent_task_id: EPIC, description: 'spec of A' }]
const closingTable = over => ({
  project: PROJECT, epic: EPIC, done: [{ id: 5, resolution: 'merged as abc123' }],
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
  milestones: MILESTONES,
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

// A row that took the review cycle as a task and became an epic still closes only
// through it: done_needs_review is the epic's state, as on a task close.
test('a review-rule refusal of the epic close is reported, not a failed call', withMock({
  tasks: epicTasks(CLOSED_CHILD),
  fail: rec => (rec.method === 'PATCH' && rec.path.endsWith('/tasks/' + EPIC))
    ? { status: 409, body: { detail: { error: 'done_needs_review', message: 'Move it to REVIEW first.', context: {} } } }
    : null,
}, async mock => {
  const { out } = await runAccount(mock, closingTable())

  assert.equal(out.epic_closed, false)
  assert.deepEqual(out.failed_calls, [], 'a refusal by the review rules is not a failed call to retry')
  assert.equal(steps(out, 'epic_close')[0].detail, 'done_needs_review: the epic is not closed — Move it to REVIEW first.')
  assert.equal(out.epic_close_error, steps(out, 'epic_close')[0].detail)
}))

// ------------------------------------------------------------ epic edge cases

// A run that ends without a resolution text still leaves its trace in the
// journal: the summary is written with an empty resolution instead of the word
// 'undefined', and the steps after it keep running.
test('an epic table without close_resolution logs the run summary with an empty resolution', withMock({
  tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES,
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
  milestones: MILESTONES,
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
    '[epic-run:100] result: ' + filedIn(tailsEpic(mock).id),
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
  const region = fencedRegion(src, 'EPIC_TABLE_KEYS_BEGIN', 'EPIC_TABLE_KEYS_END', file)
  const code = region.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  return [...code.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}
const fencedKeys = file => keysInFenced(source(file), file)

// A second marker would move the reading onto lines that are not the key list.
for (const file of ['epic.js', 'wf-helper.mjs'])
  for (const marker of ['EPIC_TABLE_KEYS_BEGIN', 'EPIC_TABLE_KEYS_END'])
    test(`${file}: a second ${marker} fails the reading instead of moving the comparison`, () => {
      assert.throws(() => keysInFenced(withSecond(source(file), marker), file), secondMarker(marker, file))
    })

test('the fenced key scanner reads the key list only, not the prose around it', () => {
  const src = [
    "// EPIC_TABLE_KEYS_BEGIN — a comment naming 'project_handle' is prose",
    "  // and 'not_a_key' quoted here is prose too",
    "const EPIC_TABLE_KEYS = ['project', 'epic'] // 'trailing_prose' is prose",
    '// EPIC_TABLE_KEYS_END',
  ].join('\n')

  assert.deepEqual(keysInFenced(src, 'fixture'), ['project', 'epic'])
})

test('both accounting tables name the project by `project`, never by a number', () => {
  for (const file of ['epic.js', 'wf-helper.mjs']) {
    const keys = fencedKeys(file)
    assert.ok(keys.includes('project'), file)
    assert.ok(!keys.includes('project_id'), file)
  }
})

// A table of an earlier surface keys its project by number: it fits neither shape
// and is refused whole. A table whose `project` is not a handle string is misuse.
test('a table naming project_id is unsupported', withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
  const r = await runHelper(accountEnv(mock), 'account', '--table',
    tableFile({ project_id: 42, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null }))
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '{"error": "unsupported table"}')
  assert.deepEqual(mock.requests, [])
}))

for (const [what, project] of [['a number', 42], ['an empty string', '  '], ['no value', undefined]]) {
  test(`a table whose project is ${what} is refused before any call`, withMock({ tasks: [{ id: 5, title: 'T', status: 'TODO' }] }, async mock => {
    const r = await runHelper(accountEnv(mock), 'account', '--table',
      tableFile({ project, close: { id: 5, resolution: 'r' }, block: null, minors_umbrella: null }))
    assert.equal(r.code, 2)
    assert.match(r.stderr, /project must be the project's handle/)
    assert.deepEqual(mock.requests, [])
  }))
}

test('the epic accounting table key set is the same in epic.js and wf-helper.mjs', () => {
  const fromHelper = fencedKeys('wf-helper.mjs')
  const fromEpic = fencedKeys('epic.js')
  assert.ok(fromHelper.includes('close_resolution'), 'the fenced region is the key list')
  assert.deepEqual([...fromEpic].sort(), [...fromHelper].sort(),
    'the builder and the executor disagree on the table shape — edit both lists together')
  assert.equal(new Set(fromEpic).size, fromEpic.length, 'no key is listed twice')
})

test('a progress entry of this run already in the journal is not logged twice', withMock({
  tasks: epicTasks(RUN_CHILDREN), milestones: MILESTONES,
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

for (const kind of ['bug', 'task']) {
  test('an entry is posted with its kind: ' + kind, withMock({ tasks: epicTasks([]) }, async mock => {
    await runAccount(mock, epicTable({ done: [], failed: [], skipped: [], minors: [{ ...CRITICAL, kind, parent: EPIC }] }))
    assert.equal(writes(mock).find(r => r.method === 'POST' && r.path.endsWith('/tasks')).body.kind, kind)
  }))
}
const refuseGrowth = r => r.method === 'POST' && r.body.parent_task_id === EPIC
  ? { status: 409, body: { detail: { error: 'epic_growth_ceiling', message: 'full' } } } : null
for (const umbrella of [false, true]) {
  test(umbrella ? 'the minors umbrella refused by the ceiling goes to the tails epic' : 'a 409 epic_growth_ceiling files the entry in the release tails epic',
    withMock({ tasks: epicTasks([]), milestones: MILESTONES, fail: refuseGrowth }, async mock => {
      const table = umbrella ? { project: PROJECT, minors_umbrella: { ...UMBRELLA, kind: 'task', parent: EPIC } }
        : epicTable({ done: [], failed: [], skipped: [], minors: [{ ...CRITICAL, kind: 'task', parent: EPIC }] })
      const { out } = await runAccount(mock, table)
      assert.deepEqual(out.failed_calls, [])
      assert.equal(step(out, umbrella ? 'minors_child' : 'tails_child').result, 'done')
      const tail = [...mock.tasks.values()].find(t => t.title === 'Tails of release Release 1.1')
      const child = [...mock.tasks.values()].find(t => t.parent_task_id === tail.id)
      assert.equal(child.kind, 'task')
      await runAccount(mock, table)
      assert.equal([...mock.tasks.values()].filter(t => t.parent_task_id === tail.id).length, 1)
    }))
}

// The mock refuses ordinary additions at the ceiling regardless of their title.
// Bugs pass unchanged, and a later ordinary POST still receives the same refusal.
test('a Bug at the server ceiling stays in its epic and consumes no ordinary place', withMock({
  tasks: epicTasks([]), milestones: MILESTONES,
  fail: r => r.body?.kind === 'task' ? refuseGrowth(r) : null,
}, async mock => {
  const table = kind => epicTable({ done: [], failed: [], skipped: [],
    minors: [{ ...CRITICAL, title: kind === 'bug' ? 'Repair export' : 'Polish export', kind, parent: EPIC }] })
  const { out: bug } = await runAccount(mock, table('bug'))
  assert.equal(bug.epic_children.length, 1)
  assert.equal(bug.tails_epic_id, null)
  assert.equal(mock.tasks.get(bug.epic_children[0]).kind, 'bug')
  assert.equal(mock.tasks.get(bug.epic_children[0]).parent_task_id, EPIC)
  const { out: ordinary } = await runAccount(mock, table('task'))
  assert.equal(ordinary.epic_children.length, 0)
  assert.equal(ordinary.tails_children.length, 1)
  assert.deepEqual(writes(mock).filter(r => r.method === 'POST' && r.body.parent_task_id === EPIC)
    .map(r => r.body.kind), ['bug', 'task'])
}))

for (const failTail of [false, true]) {
  test('accounting refusal contributes to the tails total, failure=' + failTail, withMock({
    tasks: epicTasks([]), milestones: MILESTONES,
    fail: r => refuseGrowth(r) || (failTail && r.method === 'POST' && r.body?.kind === 'task'
      ? { status: 500, body: { detail: 'write failed' } } : null),
  }, async mock => {
    const { out } = await runAccount(mock, epicTable({ done: [], failed: [], skipped: [],
      minors: [{ ...CRITICAL, kind: 'task', parent: EPIC }],
      close_resolution: RESOLUTION.replace(TAILS_PART, '; ordinary work to the tails epic 0;') }))
    const summary = descriptions(mock).at(-1)
    assert.ok(summary.includes('ordinary work filed in the tails epic task-' + out.tails_epic_id +
      (failTail ? ': 0 of 1, the rest not filed: a call failed' : ': 1;')), summary)
  }))
}

test('epic table: a selected release ignores the same title in other milestones or without one', withMock({
  tasks: epicTasks([]).concat([
    { id: 298, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: null },
    { id: 299, title: 'Tails of release Release 1.1', status: 'TODO', kind: 'epic', milestone_id: RELEASE },
    { id: 300, title: 'Tails of release Release 1.1', status: 'REVIEW', kind: 'epic', milestone_id: AFTER },
  ]), milestones: MILESTONES,
}, async mock => {
  const { out } = await runAccount(mock, epicTable({ done: [], failed: [], skipped: [] }))
  assert.equal(out.tails_epic_id, 300)
  assert.equal(out.tails_epic_needs_milestone, false)
}))
