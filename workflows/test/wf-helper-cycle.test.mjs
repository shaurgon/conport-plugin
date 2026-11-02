import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKFLOWS } from './fenced-region.mjs'
import { JOURNAL_AUTHORS, JOURNAL_BODY_MAX, fitBody, journalBody } from '../wf-helper.mjs'

// The `cycle` command writes one step of a task's review cycle: a journal entry
// and the status change that goes with it. These tests run the helper against a
// local stand-in for the tasks and journal REST surface that holds the server's
// cycle rules — which entry a status takes, what REVIEW, the return and DONE
// need — so a sequence of steps is checked against the same refusals the server
// gives. The production API is never touched.

const HELPER = join(WORKFLOWS, 'wf-helper.mjs')
const KEY = 'test_key_never_printed'
const PROJECT = 42                                 // a neutral id: no real project is implied

// ------------------------------------------------------------------ REST mock

const KINDS_BY_STATUS = {
  TODO: ['brief'], IN_PROGRESS: ['brief', 'report', 'fix'], BLOCKED: ['brief'], REVIEW: ['brief', 'review'],
}
const refusal = (error, message) => ({ status: 409, body: { detail: { error, message, context: {} } } })

const startMock = async (opts = {}) => {
  const state = { tasks: new Map(), journal: [], requests: [], nextEntry: 1 }
  for (const t of opts.tasks ?? [])
    state.tasks.set(t.id, { kind: 'task', description: '', review_round: 1, ...t })
  for (const e of opts.journal ?? []) state.journal.push({ id: state.nextEntry++, round: 1, ...e })
  const fail = opts.fail ?? (() => null)

  const round = t => state.journal.filter(e => e.task_id === t.id && e.round === t.review_round)
  const lastVerdict = t => round(t).filter(e => e.kind === 'review').map(e => e.verdict).pop() ?? null
  const cycled = t => state.journal.some(e => e.task_id === t.id && ['report', 'fix', 'review'].includes(e.kind))

  const addEntry = (t, body) => {
    if (['DONE', 'CANCELLED'].includes(t.status)) return refusal('journal_task_closed', 'Reopen the task first.')
    if (!KINDS_BY_STATUS[t.status].includes(body.kind)) return refusal('journal_kind_not_allowed', 'Move the task first.')
    if ((body.kind === 'review') !== (body.verdict != null)) return { status: 422, body: { detail: { error: 'invalid_verdict' } } }
    const norm = s => s.trim().toLowerCase()
    if (body.kind === 'review' && round(t).some(e => ['report', 'fix'].includes(e.kind) && norm(e.author) === norm(body.author)))
      return refusal('reviewer_is_author', 'A review is written by a different agent than the one that wrote the report of this round.')
    const entry = { id: state.nextEntry++, task_id: t.id, round: t.review_round, verdict: null, ...body }
    state.journal.push(entry)
    return { status: 201, body: entry }
  }

  const patch = (t, body) => {
    const to = body.status
    if (to === undefined || to === t.status) { Object.assign(t, body); return { status: 200, body: t } }
    if (to === 'REVIEW') {
      if (t.status !== 'IN_PROGRESS') return refusal('review_from_in_progress_only', 'Move it to IN_PROGRESS first.')
      if (!round(t).some(e => e.kind === 'report' || e.kind === 'fix')) return refusal('review_needs_report', 'Add a report first.')
    } else if (t.status === 'REVIEW') {
      if (to === 'DONE' && lastVerdict(t) !== 'approve') return refusal('done_needs_approval', 'Approve first.')
      if (to === 'IN_PROGRESS' && lastVerdict(t) !== 'changes_requested') return refusal('return_needs_review', 'Request changes first.')
      if (!['DONE', 'IN_PROGRESS', 'CANCELLED'].includes(to)) return refusal('review_exit_not_allowed', 'Finish the review first.')
      if (to === 'IN_PROGRESS') t.review_round += 1
    } else if (to === 'DONE' && cycled(t)) return refusal('done_needs_review', 'Move it to REVIEW first.')
    t.status = to
    if (body.resolution) t.description += '\n\n## Resolution\n' + body.resolution
    return { status: 200, body: t }
  }

  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const send = ({ status, body }) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      const url = new URL(req.url, 'http://localhost')
      const body = raw ? JSON.parse(raw) : null
      const rec = { method: req.method, path: url.pathname, body, key: req.headers['x-api-key'] }
      state.requests.push(rec)
      const injected = fail(rec)
      if (injected) return send(injected)
      const m = url.pathname.match(new RegExp(`^/api/v1/projects/${PROJECT}/tasks/(\\d+)(/journal)?$`))
      const t = m && state.tasks.get(Number(m[1]))
      if (!t) return send({ status: 404, body: { detail: 'Task not found' } })
      if (m[2] && req.method === 'POST') return send(addEntry(t, body))
      if (!m[2] && req.method === 'GET') return send({ status: 200, body: t })
      if (!m[2] && req.method === 'PATCH') return send(patch(t, body))
      return send({ status: 405, body: { detail: 'method not allowed' } })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${server.address().port}/api/v1`
  state.close = () => new Promise(resolve => server.close(resolve))
  return state
}

const withMock = (opts, body) => async () => {
  const mock = await startMock(opts)
  try { await body(mock) } finally { await mock.close() }
}

// ------------------------------------------------------------------ invocation

const jsonFile = (name, value) => {
  const path = join(mkdtempSync(join(tmpdir(), 'wfc-')), name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

// Spawned asynchronously: the mock answers on this process's event loop.
const runHelper = (env, ...argv) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [HELPER, ...argv], { env })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', c => { stdout += c })
  p.stderr.on('data', c => { stderr += c })
  p.on('error', reject)
  p.on('close', code => resolve({ code, stdout, stderr }))
})

const runStep = async (mock, step) => {
  const env = { ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY }
  const r = await runHelper(env, 'cycle', '--step', jsonFile('step.json', { project_id: PROJECT, task_id: 7, ...step }))
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  assert.ok(!r.stdout.includes(KEY), 'the api key must never reach stdout')
  return JSON.parse(r.stdout)
}
const runAccount = async (mock, table) => {
  const env = { ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY }
  const r = await runHelper(env, 'account', '--table', jsonFile('table.json', table))
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  return JSON.parse(r.stdout)
}

const writes = mock => mock.requests.filter(r => r.method !== 'GET')
const results = out => out.actions.map(a => `${a.step}:${a.result}`)

const IMPL = { status: 'DONE', branch: 'task/t7', head_sha: 'bbb1', worktree_path: '/tmp/wt-7',
  files_changed: ['a.js'], checks_summary: 'lint green', concerns: ['slow path'] }
const HARD = { verdict: 'NEEDS_FIXES', findings: [{ severity: 'IMPORTANT', file: 'a.js', line: 3, what: 'drops the guard', fix: 'restore it' }] }
const CLEAN = { verdict: 'APPROVED', findings: [] }
const FIXED = { status: 'DONE', head_sha: 'eee4', per_finding: [{ idx: 0, action: 'FIXED', note: 'restored' }], checks_summary: 'green' }
const CLOSE = { project_id: PROJECT, close: { id: 7, resolution: 'merged as ccc2' }, block: null, minors_umbrella: null }

// ------------------------------------------------------------------ authors and bodies

test('the journal authors: orchestrator writes the brief, implementer the report and the fix, reviewer the review', () => {
  assert.deepEqual({ ...JOURNAL_AUTHORS }, { brief: 'orchestrator', report: 'implementer', fix: 'implementer', review: 'reviewer' })
  assert.ok(Object.isFrozen(JOURNAL_AUTHORS), 'one place, not a value a caller can rewrite')
  assert.notEqual(JOURNAL_AUTHORS.review.trim().toLowerCase(), JOURNAL_AUTHORS.report.trim().toLowerCase())
  assert.notEqual(JOURNAL_AUTHORS.review.trim().toLowerCase(), JOURNAL_AUTHORS.fix.trim().toLowerCase())
})

test('the body limit is the server journal schema limit', () => {
  assert.equal(JOURNAL_BODY_MAX, 200000)
})

test('fitBody: a body on the limit travels whole, one character past it is cut with a marker', () => {
  const on = 'x'.repeat(JOURNAL_BODY_MAX)
  assert.equal(fitBody(on), on)
  const past = fitBody('x'.repeat(JOURNAL_BODY_MAX + 1))
  assert.equal(Array.from(past).length, JOURNAL_BODY_MAX)
  assert.match(past, /\[truncated by the workflow helper: the full text had 200001 characters\]$/)
  assert.equal(fitBody('short'), 'short')
})

test('fitBody: counts characters, not UTF-16 units, and never splits one in two', () => {
  const emoji = '😀'
  const on = emoji.repeat(JOURNAL_BODY_MAX)        // twice the limit in UTF-16 units, on the limit in characters
  assert.equal(fitBody(on), on)
  const past = fitBody(emoji.repeat(JOURNAL_BODY_MAX + 3))
  assert.equal(Array.from(past).length, JOURNAL_BODY_MAX)
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(past), 'no lone surrogate')
})

test('journalBody: the report, the review and the fix are written from the agents\' structured results', () => {
  const report = journalBody({ step: 'report', result: IMPL })
  for (const part of ['DONE', 'task/t7', 'bbb1', 'a.js', 'lint green', 'slow path']) assert.ok(report.includes(part), part)
  const review = journalBody({ step: 'review', verdict: 'changes_requested', result: HARD, note: 'Re-review after the fix' })
  for (const part of ['Re-review after the fix', 'changes_requested', 'NEEDS_FIXES', '[IMPORTANT] a.js:3', 'drops the guard', 'restore it'])
    assert.ok(review.includes(part), part)
  assert.match(journalBody({ step: 'review', verdict: 'approve', result: CLEAN }), /Findings: none/)
  const fix = journalBody({ step: 'fix', result: FIXED })
  for (const part of ['DONE', 'eee4', '#0 FIXED', 'restored', 'green']) assert.ok(fix.includes(part), part)
  assert.equal(journalBody({ step: 'brief', body: 'the assignment' }), 'the assignment')
})

// ------------------------------------------------------------------ the steps

test('brief: one journal entry on the task path, signed by the orchestrator', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  const out = await runStep(mock, { step: 'brief', body: 'Implement task-7' })
  assert.deepEqual(results(out), ['brief:done'])
  assert.equal(out.via, 'wf-helper')
  assert.deepEqual(writes(mock).map(r => [r.method, r.path, r.body]),
    [['POST', `/api/v1/projects/${PROJECT}/tasks/7/journal`, { kind: 'brief', author: 'orchestrator', body: 'Implement task-7' }]])
  assert.equal(mock.tasks.get(7).status, 'TODO', 'a brief changes no status')
}))

test('report: a TODO task is started, the report written, and the task moved to REVIEW', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  const out = await runStep(mock, { step: 'report', result: IMPL })
  assert.deepEqual(results(out), ['start:done', 'report:done', 'to_review:done'])
  const w = writes(mock)
  assert.deepEqual(w.map(r => [r.method, r.path]), [
    ['PATCH', `/api/v1/projects/${PROJECT}/tasks/7`], ['POST', `/api/v1/projects/${PROJECT}/tasks/7/journal`],
    ['PATCH', `/api/v1/projects/${PROJECT}/tasks/7`]])
  assert.deepEqual(w[0].body, { status: 'IN_PROGRESS' })
  assert.equal(w[1].body.kind, 'report')
  assert.equal(w[1].body.author, 'implementer')
  assert.equal(w[1].body.body, journalBody({ step: 'report', result: IMPL }))
  assert.equal('verdict' in w[1].body, false, 'only a review carries a verdict')
  assert.deepEqual(w[2].body, { status: 'REVIEW' })
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
}))

test('report: a task already IN_PROGRESS is not moved before the report', withMock({ tasks: [{ id: 7, status: 'IN_PROGRESS' }] }, async mock => {
  const out = await runStep(mock, { step: 'report', result: IMPL })
  assert.deepEqual(results(out), ['report:done', 'to_review:done'])
}))

for (const status of ['DONE', 'CANCELLED', 'REVIEW'])
  test(`report: a ${status} task is never moved to IN_PROGRESS — the report is refused and nothing else is tried`, withMock({ tasks: [{ id: 7, status }] }, async mock => {
    const out = await runStep(mock, { step: 'report', result: IMPL })
    assert.equal(out.actions.length, 1)
    assert.equal(out.actions[0].step, 'report')
    assert.equal(out.actions[0].result, 'failed')
    assert.deepEqual(out.failed_calls, [], 'the task state refused the entry: not a call to retry')
    assert.equal(writes(mock).filter(r => r.method === 'PATCH').length, 0)
    assert.equal(mock.tasks.get(7).status, status)
  }))

test('review approve: the verdict is written by the reviewer and the task stays in REVIEW', withMock({
  tasks: [{ id: 7, status: 'REVIEW' }], journal: [{ task_id: 7, kind: 'report', author: 'implementer', body: 'r' }],
}, async mock => {
  const out = await runStep(mock, { step: 'review', verdict: 'approve', result: CLEAN })
  assert.deepEqual(results(out), ['review:done'])
  const [post] = writes(mock)
  assert.deepEqual({ kind: post.body.kind, author: post.body.author, verdict: post.body.verdict },
    { kind: 'review', author: 'reviewer', verdict: 'approve' })
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
}))

test('review changes_requested: the verdict is written and the task returned to IN_PROGRESS in the next round', withMock({
  tasks: [{ id: 7, status: 'REVIEW' }], journal: [{ task_id: 7, kind: 'report', author: 'implementer', body: 'r' }],
}, async mock => {
  const out = await runStep(mock, { step: 'review', verdict: 'changes_requested', result: HARD })
  assert.deepEqual(results(out), ['review:done', 'return:done'])
  assert.deepEqual(writes(mock)[1].body, { status: 'IN_PROGRESS' })
  assert.equal(mock.tasks.get(7).status, 'IN_PROGRESS')
  assert.equal(mock.tasks.get(7).review_round, 2)
}))

test('fix: the fix report is written by the implementer and the task moved back to REVIEW', withMock({
  tasks: [{ id: 7, status: 'IN_PROGRESS', review_round: 2 }],
}, async mock => {
  const out = await runStep(mock, { step: 'fix', result: FIXED })
  assert.deepEqual(results(out), ['fix:done', 'to_review:done'])
  assert.deepEqual([writes(mock)[0].body.kind, writes(mock)[0].body.author], ['fix', 'implementer'])
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
}))

// ------------------------------------------------------------------ whole runs

test('a clean run: brief, report, REVIEW, approve, then the accounting close lands from REVIEW', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  for (const step of [{ step: 'brief', body: 'b' }, { step: 'report', result: IMPL }, { step: 'review', verdict: 'approve', result: CLEAN }])
    assert.ok((await runStep(mock, step)).actions.every(a => a.result === 'done'), step.step)
  const acc = await runAccount(mock, CLOSE)
  assert.equal(acc.task_closed, true)
  assert.equal(mock.tasks.get(7).status, 'DONE')
  assert.deepEqual(mock.journal.map(e => [e.kind, e.author, e.verdict]),
    [['brief', 'orchestrator', null], ['report', 'implementer', null], ['review', 'reviewer', 'approve']])
}))

test('a run with a fix round: changes requested, the return, the fix, REVIEW, approve, then DONE', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  for (const step of [
    { step: 'brief', body: 'b' }, { step: 'report', result: IMPL },
    { step: 'review', verdict: 'changes_requested', result: HARD }, { step: 'fix', result: FIXED },
    { step: 'review', verdict: 'approve', result: CLEAN, note: 'Re-review after the fix' },
  ]) assert.ok((await runStep(mock, step)).actions.every(a => a.result === 'done'), step.step)
  assert.equal((await runAccount(mock, CLOSE)).task_closed, true)
  assert.deepEqual(mock.journal.map(e => [e.kind, e.round]),
    [['brief', 1], ['report', 1], ['review', 1], ['fix', 2], ['review', 2]])
}))

const MINORS = { verdict: 'NEEDS_FIXES', findings: [{ severity: 'MINOR', file: 'a.js', line: 9, what: 'a nit' }] }
const allDone = async (mock, steps) => {
  for (const step of steps)
    assert.deepEqual((await runStep(mock, step)).actions.filter(a => a.result !== 'done'), [], step.note ?? step.step)
}
const BLOCK = { project_id: PROJECT, close: null, block: { id: 7, reason: 'MERGE_CONFLICT' }, minors_umbrella: null }

test('minor findings only: an approval, a second approval in REVIEW after the polish, then DONE', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  await allDone(mock, [
    { step: 'brief', body: 'b' }, { step: 'report', result: IMPL },
    { step: 'review', verdict: 'approve', result: MINORS },
    { step: 'review', verdict: 'approve', result: CLEAN, note: 'Re-review after the fix' },
  ])
  assert.equal(mock.tasks.get(7).status, 'REVIEW')
  assert.equal((await runAccount(mock, CLOSE)).task_closed, true)
  assert.deepEqual(mock.journal.map(e => [e.kind, e.verdict, e.round]),
    [['brief', null, 1], ['report', null, 1], ['review', 'approve', 1], ['review', 'approve', 1]])
}))

// An earlier run stopped after its report: the task waits in REVIEW, and the
// round already holds that report.
const RESUMED = { tasks: [{ id: 7, status: 'REVIEW' }], journal: [{ task_id: 7, kind: 'report', author: 'implementer', body: 'r' }] }

test('a resumed task: the review lands in the round that holds the report, then DONE', withMock(RESUMED, async mock => {
  await allDone(mock, [{ step: 'review', verdict: 'approve', result: CLEAN, note: 'Review of the branch an earlier run left' }])
  assert.equal((await runAccount(mock, CLOSE)).task_closed, true)
  assert.equal(mock.tasks.get(7).status, 'DONE')
}))

test('a resumed task with changes requested: return, fix, REVIEW, approval, then DONE', withMock(RESUMED, async mock => {
  await allDone(mock, [
    { step: 'review', verdict: 'changes_requested', result: HARD }, { step: 'fix', result: FIXED },
    { step: 'review', verdict: 'approve', result: CLEAN, note: 'Re-review after the fix' },
  ])
  assert.equal((await runAccount(mock, CLOSE)).task_closed, true)
  assert.deepEqual(mock.journal.map(e => [e.kind, e.round]), [['report', 1], ['review', 1], ['fix', 2], ['review', 2]])
}))

test('the review after a rebase: a further approval in REVIEW still closes', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  await allDone(mock, [
    { step: 'report', result: IMPL }, { step: 'review', verdict: 'approve', result: CLEAN },
    { step: 'review', verdict: 'approve', result: CLEAN, note: 'Review after the rebase onto main' },
  ])
  assert.equal((await runAccount(mock, CLOSE)).task_closed, true)
}))

test('a review after a rebase that requests changes returns the task, so the failed run can block it', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  await allDone(mock, [
    { step: 'report', result: IMPL }, { step: 'review', verdict: 'approve', result: CLEAN },
    { step: 'review', verdict: 'changes_requested', result: HARD, note: 'Review after the rebase onto main' },
  ])
  assert.equal(mock.tasks.get(7).status, 'IN_PROGRESS')
  const acc = await runAccount(mock, BLOCK)
  assert.equal(acc.actions.find(a => a.step === 'block').result, 'done')
  assert.equal(mock.tasks.get(7).status, 'BLOCKED')
}))

// ------------------------------------------------------------------ refusals

// The codes of the review cycle a step can meet. Each is the task's state, not a
// broken call: the step reports it like a refused close, stops, and leaves the
// failed-call list empty.
for (const code of ['review_needs_report', 'return_needs_review', 'reviewer_is_author', 'review_exit_not_allowed',
  'review_from_in_progress_only', 'journal_kind_not_allowed', 'journal_task_closed'])
  test(`a ${code} refusal is reported as refused, not a failed call, and the step stops there`, withMock({
    tasks: [{ id: 7, status: 'REVIEW' }],
    fail: rec => (rec.method === 'POST' ? refusal(code, 'Do the one thing.') : null),
  }, async mock => {
    const out = await runStep(mock, { step: 'review', verdict: 'changes_requested', result: HARD })
    assert.deepEqual(out.actions, [{ step: 'review', target: 7, result: 'failed',
      detail: `${code}: the entry is not written — Do the one thing.` }])
    assert.deepEqual(out.failed_calls, [])
    assert.equal(writes(mock).length, 1, 'neither retried nor followed by the return')
  }))

test('a refused status change after a written entry is reported as refused', withMock({
  tasks: [{ id: 7, status: 'IN_PROGRESS' }],
  fail: rec => (rec.method === 'PATCH' ? refusal('review_needs_report', 'Add a report first.') : null),
}, async mock => {
  const out = await runStep(mock, { step: 'fix', result: FIXED })
  assert.deepEqual(results(out), ['fix:done', 'to_review:failed'])
  assert.equal(out.actions[1].detail, 'review_needs_report: the task keeps its status — Add a report first.')
  assert.deepEqual(out.failed_calls, [])
}))

test('a 409 with a code outside the cycle stays a failed call', withMock({
  tasks: [{ id: 7, status: 'TODO' }],
  fail: rec => (rec.method === 'POST' ? refusal('epic_not_ready', 'x') : null),
}, async mock => {
  const out = await runStep(mock, { step: 'brief', body: 'b' })
  assert.equal(out.actions[0].result, 'failed')
  assert.equal(out.failed_calls.length, 1)
}))

test('a body past the server limit is cut with a marker before it is sent', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  const out = await runStep(mock, { step: 'brief', body: 'y'.repeat(JOURNAL_BODY_MAX + 10) })
  assert.deepEqual(results(out), ['brief:done'])
  const sent = writes(mock)[0].body.body
  assert.equal(Array.from(sent).length, JOURNAL_BODY_MAX)
  assert.match(sent, /\[truncated by the workflow helper: the full text had 200010 characters\]$/)
}))

// ------------------------------------------------------------------ misuse and the key

test('no api key: the fallback sentinel is printed and nothing is called', withMock({ tasks: [{ id: 7, status: 'TODO' }] }, async mock => {
  const env = { ...process.env, CONPORT_API_URL: mock.url }
  delete env.CONPORT_API_KEY
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  const r = await runHelper(env, 'cycle', '--step', jsonFile('step.json', { project_id: PROJECT, task_id: 7, step: 'brief', body: 'b' }))
  assert.equal(r.code, 0)
  assert.equal(r.stdout, '{"error": "no api key"}\n')
  assert.equal(mock.requests.length, 0)
}))

for (const [what, step] of [
  ['an unknown step', { project_id: PROJECT, task_id: 7, step: 'close', body: 'b' }],
  ['a review without a verdict', { project_id: PROJECT, task_id: 7, step: 'review', result: CLEAN }],
  ['a review with an unknown verdict', { project_id: PROJECT, task_id: 7, step: 'review', verdict: 'APPROVED', result: CLEAN }],
  ['a brief without a body', { project_id: PROJECT, task_id: 7, step: 'brief', body: '  ' }],
  ['a report without a result', { project_id: PROJECT, task_id: 7, step: 'report' }],
  ['a step without a task id', { project_id: PROJECT, step: 'brief', body: 'b' }],
])
  test(`cycle: ${what} is CLI misuse — exit 2, nothing printed`, async () => {
    const env = { ...process.env, CONPORT_API_URL: 'http://127.0.0.1:9/api/v1', CONPORT_API_KEY: KEY }
    const r = await runHelper(env, 'cycle', '--step', jsonFile('step.json', step))
    assert.equal(r.code, 2)
    assert.equal(r.stdout, '')
  })
