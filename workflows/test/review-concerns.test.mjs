import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'
import { journalBody } from '../wf-helper.mjs'

// An implementer that finishes DONE_WITH_CONCERNS hands its doubts to the run. They
// reach the reviewer of the task through a brief of their own, written before the
// review, and the reviewer rules on every one: a real defect goes into findings with
// its severity and takes the ordinary road (fix round, re-review, carried minors),
// anything else is "not a finding" with its reason. A review that leaves a concern
// without a ruling is not accepted.

const STEP_FILE = /<<<BEGIN step\.json — [^\n]*>>>\n([^\n]*)\n<<<END step\.json>>>/

// A stand-in for the helper's cycle command that keeps the step files it was handed.
const helper = () => {
  const steps = []
  const answer = (prompt, opts) => {
    const s = JSON.parse(STEP_FILE.exec(prompt)[1])
    steps.push({ label: opts.label, ...s })
    return { via: 'wf-helper', task: s.task_id, step: s.step, failed_calls: [],
      actions: [{ step: s.step, target: s.task_id, result: 'done', detail: 'written' }] }
  }
  return { steps, answer }
}
const withHelper = (answers, h) =>
  new Proxy(answers, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && k.startsWith('j-') ? h.answer : undefined)) })
const go = async (file, { args, answers }) => {
  const h = helper()
  const r = await runWorkflow(file, args, withHelper(answers, h))
  const call = label => r.calls.find(c => c.label === label)
  return { ...r, steps: h.steps, labels: r.calls.map(c => c.label), call }
}

const CONCERNS = ['the retry may double-write the row', 'the fixture skips the cache']
const IMPORTANT = { severity: 'IMPORTANT', file: 'a.js', line: 3, what: 'the retry double-writes the row', fix: 'guard it' }
const RULED = {
  verdict: 'NEEDS_FIXES', findings: [IMPORTANT],
  concern_rulings: [
    { idx: 0, ruling: 'FINDING', finding_idx: 0, reason: 'a.js:3 writes twice on a retry' },
    { idx: 1, ruling: 'NOT_A_FINDING', reason: 'the production path has no cache either' },
  ],
}
const FIXED = { status: 'DONE', head_sha: 'eee4', per_finding: [{ idx: 0, action: 'FIXED' }] }
const CLEAN = { verdict: 'APPROVED', findings: [] }

// Both workflows, the labels of one task's road in each.
const ROADS = [
  { file: 'task.js', run: taskRun, k: '', impl: 'impl', base: taskRun().answers.impl, merged: 'MERGED' },
  { file: 'epic.js', run: epicRun, k: '-501', impl: 'impl-501', base: epicRun().answers['impl-501'], merged: 'EPIC_CLOSED' },
]
const withConcerns = (base, concerns = CONCERNS) => ({ ...base, status: 'DONE_WITH_CONCERNS', concerns })
const outcomeOf = (file, ledger) => (file === 'task.js' ? ledger.outcome : ledger.tasks['501'].state)
const failOf = (file, ledger) => (file === 'task.js' ? ledger.fail_reason : ledger.tasks['501'].reason)

for (const { file, run, k, impl, base, merged } of ROADS) {
  test(`${file}: the implementer's concerns reach the reviewer in a brief written before the review`, async () => {
    const { steps, labels, call } = await go(file, run({
      [impl]: withConcerns(base), ['rev' + k]: RULED, ['fix' + k]: FIXED, ['rev2' + k]: CLEAN,
    }))
    const at = l => labels.indexOf(l)
    assert.ok(at('j-brief-concerns' + k) > at('j-report' + k), 'after the report')
    assert.ok(at('j-brief-concerns' + k) < at('rev' + k), 'before the reviewer is dispatched')
    const body = steps.find(s => s.label === 'j-brief-concerns' + k).body
    assert.match(body, /=== THE IMPLEMENTER'S CONCERNS — rule on each ===/)
    assert.match(body, /\[\[QUOTE implementer concerns/, 'the concerns travel quoted')
    assert.ok(body.includes('{"idx":0,"what":"the retry may double-write the row"}'), body)
    assert.ok(body.includes('{"idx":1,"what":"the fixture skips the cache"}'), body)
    // the reviewer is told to rule on each one, and its schema makes the rulings mandatory
    const rev = call('rev' + k)
    assert.match(rev.prompt, /Rule on EVERY one in\nconcern_rulings/)
    assert.match(rev.prompt, /FINDING with finding_idx/)
    assert.match(rev.prompt, /NOT_A_FINDING with the reason/)
    assert.ok(rev.opts.schema.required.includes('concern_rulings'))
    assert.deepEqual(rev.opts.schema.properties.concern_rulings.items.properties.ruling.enum, ['FINDING', 'NOT_A_FINDING'])
  })

  test(`${file}: a concern ruled a finding takes the ordinary road — fix brief, fix, re-review, merge`, async () => {
    const { ledger, steps, labels, call } = await go(file, run({
      [impl]: withConcerns(base), ['rev' + k]: RULED, ['fix' + k]: FIXED, ['rev2' + k]: CLEAN,
    }))
    assert.equal(ledger.outcome, merged)
    assert.equal(outcomeOf(file, ledger), file === 'task.js' ? 'MERGED' : 'DONE')
    const review = steps.find(s => s.label === 'j-review' + k)
    assert.equal(review.verdict, 'changes_requested')
    assert.deepEqual(review.result.concern_rulings, RULED.concern_rulings, 'the rulings are on record in the review entry')
    assert.ok(steps.find(s => s.label === 'j-brief-fix' + k).body.includes('the retry double-writes the row'))
    assert.ok(labels.includes('rev2' + k))
    // a re-review checks the closure of findings only: it is asked for no rulings
    assert.ok(!call('rev2' + k).opts.schema.required.includes('concern_rulings'))
    assert.doesNotMatch(call('rev2' + k).prompt, /concern_rulings/)
  })

  test(`${file}: concerns all ruled not findings — the approval merges with no fix round`, async () => {
    const rulings = CONCERNS.map((_, idx) => ({ idx, ruling: 'NOT_A_FINDING', reason: 'covered by b.js:4' }))
    const { ledger, labels } = await go(file, run({ [impl]: withConcerns(base), ['rev' + k]: { ...CLEAN, concern_rulings: rulings } }))
    assert.equal(ledger.outcome, merged)
    assert.ok(!labels.includes('fix' + k))
  })

  // Each way a review can leave a concern unruled: the review is not accepted, the
  // reviewer is dispatched again, and a second such review is no review at all.
  for (const [name, rulings] of [
    ['a concern without a ruling', [RULED.concern_rulings[0]]],
    ['no rulings at all', undefined],
    // one finding: index 1 is one past the end, -1 one before the start
    ['a FINDING ruling one past the last finding', [{ idx: 0, ruling: 'FINDING', finding_idx: 1, reason: 'r' }, RULED.concern_rulings[1]]],
    ['a FINDING ruling before the first finding', [{ idx: 0, ruling: 'FINDING', finding_idx: -1, reason: 'r' }, RULED.concern_rulings[1]]],
    ['a FINDING ruling without finding_idx', [{ idx: 0, ruling: 'FINDING', reason: 'r' }, RULED.concern_rulings[1]]],
    ['a NOT_A_FINDING ruling with an empty reason', [RULED.concern_rulings[0], { idx: 1, ruling: 'NOT_A_FINDING', reason: '  ' }]],
    ['a malformed ruling beside a full set', [...RULED.concern_rulings, { idx: 1, ruling: 'FINDING', finding_idx: 7, reason: 'r' }]],
  ]) {
    test(`${file}: ${name} — the review is not accepted, the task does not merge`, async () => {
      const partial = { verdict: 'NEEDS_FIXES', findings: [IMPORTANT], ...(rulings ? { concern_rulings: rulings } : {}) }
      const { ledger, labels } = await go(file, run({
        [impl]: withConcerns(base), ['rev' + k]: partial, ['rev' + k + '-r2']: partial,
      }))
      assert.ok(labels.includes('rev' + k + '-r2'), 'the reviewer is dispatched again')
      assert.equal(failOf(file, ledger), 'REVIEW_DEAD')
      assert.ok(!labels.includes(file === 'task.js' ? 'merge' : 'merge-w0'), 'no merge without a ruled review')
      assert.ok(!labels.includes('j-review' + k), 'an unaccepted review is not journalled')
    })
  }

  test(`${file}: the second reviewer that rules on every concern is accepted`, async () => {
    const { ledger } = await go(file, run({
      [impl]: withConcerns(base), ['rev' + k]: { ...CLEAN }, ['rev' + k + '-r2']: { ...CLEAN,
        concern_rulings: CONCERNS.map((_, idx) => ({ idx, ruling: 'NOT_A_FINDING', reason: 'fine' })) },
    }))
    assert.equal(ledger.outcome, merged)
  })

  test(`${file}: a concerns brief that does not land dispatches no reviewer`, async () => {
    const answers = run({ [impl]: withConcerns(base) }).answers
    const refused = (_p, opts) => ({ via: 'wf-helper', failed_calls: [{ call: 'brief entry', error: 'boom' }],
      actions: [{ step: opts.label, result: 'failed', detail: 'refused' }] })
    const { ledger, labels } = await runWorkflow(file, run().args, { ...answers, ['j-brief-concerns' + k]: refused })
      .then(r => ({ ...r, labels: r.calls.map(c => c.label) }))
    assert.ok(!labels.includes('rev' + k))
    assert.equal(failOf(file, ledger), 'BRIEF_NOT_WRITTEN')
  })

  test(`${file}: without concerns there is no concerns brief and no ruling is asked`, async () => {
    for (const over of [{}, { [impl]: { ...base, status: 'DONE_WITH_CONCERNS', concerns: [] } },
      { [impl]: { ...base, status: 'DONE_WITH_CONCERNS', concerns: ['', '  '] } }]) {
      const { ledger, labels, call } = await go(file, run(over))
      assert.equal(ledger.outcome, merged)
      assert.ok(!labels.includes('j-brief-concerns' + k))
      assert.ok(!call('rev' + k).opts.schema.required.includes('concern_rulings'))
      assert.doesNotMatch(call('rev' + k).prompt, /concern_rulings/)
    }
  })
}

// ------------------------------------------------------- a task resumed in REVIEW

// An earlier run reported the task and stopped before its verdict (for one, after a
// concerns brief that did not land, or a review that left a concern unruled). This
// run has no implementer's answer: the concerns are only in the Concerns section of
// the report entry, and the first reviewer owes concern_rulings for them all the same.
const RESUMED = [
  { file: 'task.js', k: '', run: over => {
    const r = taskRun({ branch: { exists: true, branch: 'task/t7', head_sha: 'bbb9' }, ...over })
    r.answers.scout = { ...r.answers.scout, task: { ...r.answers.scout.task, status: 'REVIEW' } }
    return r
  } },
  { file: 'epic.js', k: '-501', run: over => {
    const r = epicRun({ 'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' }, ...over })
    r.answers.scout = { ...r.answers.scout, tasks: [{ ...r.answers.scout.tasks[0], conport_status: 'REVIEW' }] }
    return r
  } },
]

for (const { file, k, run } of RESUMED) {
  test(`${file}: the reviewer of a task resumed in REVIEW rules on the concerns of its report entry`, async () => {
    const { ledger, call, steps } = await go(file, run({ ['rev' + k]: RULED, ['fix' + k]: FIXED, ['rev2' + k]: CLEAN }))
    const rev = call('rev' + k)
    assert.match(rev.prompt, /The latest report entry of this task may list the implementer's\nconcerns under "Concerns:"/)
    assert.match(rev.prompt, /Rule on EVERY one in\nconcern_rulings/)
    assert.ok(rev.opts.schema.required.includes('concern_rulings'))
    assert.ok(!steps.some(s => s.label === 'j-brief-concerns' + k), 'no concerns brief: the run does not know them')
    assert.deepEqual(steps.find(s => s.label === 'j-review' + k).result.concern_rulings, RULED.concern_rulings)
    assert.ok(!call('rev2' + k).opts.schema.required.includes('concern_rulings'), 'the re-review owes none')
    assert.equal(ledger.outcome, file === 'task.js' ? 'MERGED' : 'EPIC_CLOSED')
  })

  test(`${file}: a resumed task's review without concern_rulings is no review — the task does not merge`, async () => {
    const { ledger, labels } = await go(file, run({ ['rev' + k]: CLEAN, ['rev' + k + '-r2']: CLEAN }))
    assert.ok(labels.includes('rev' + k + '-r2'))
    assert.equal(failOf(file, ledger), 'REVIEW_DEAD')
    assert.ok(!labels.includes(file === 'task.js' ? 'merge' : 'merge-w0'))
  })

  // The number of a resumed task's concerns is in the journal, but the form of each
  // ruling given is checked as on the ordinary road.
  for (const [name, ruling] of [
    ['a FINDING ruling one past the last finding', { idx: 0, ruling: 'FINDING', finding_idx: 1, reason: 'r' }],
    ['a FINDING ruling before the first finding', { idx: 0, ruling: 'FINDING', finding_idx: -1, reason: 'r' }],
    ['a FINDING ruling without finding_idx', { idx: 0, ruling: 'FINDING', reason: 'r' }],
    ['a NOT_A_FINDING ruling with an empty reason', { idx: 0, ruling: 'NOT_A_FINDING', reason: ' ' }],
    ['a ruling with a negative idx', { idx: -1, ruling: 'NOT_A_FINDING', reason: 'r' }],
  ]) {
    test(`${file}: a resumed task's review with ${name} is no review — the task does not merge`, async () => {
      const bad = { verdict: 'NEEDS_FIXES', findings: [IMPORTANT], concern_rulings: [ruling] }
      const { ledger, labels } = await go(file, run({ ['rev' + k]: bad, ['rev' + k + '-r2']: bad }))
      assert.ok(labels.includes('rev' + k + '-r2'))
      assert.equal(failOf(file, ledger), 'REVIEW_DEAD')
      assert.ok(!labels.includes(file === 'task.js' ? 'merge' : 'merge-w0'))
    })
  }

  test(`${file}: a resumed task whose report entry lists no concerns is accepted with an empty concern_rulings`, async () => {
    const { ledger } = await go(file, run({ ['rev' + k]: { ...CLEAN, concern_rulings: [] } }))
    assert.equal(ledger.outcome, file === 'task.js' ? 'MERGED' : 'EPIC_CLOSED')
  })
}

// ------------------------------------------------------- the critical-gap fix

const GAP = { gid: 1, claim: 'a missing piece', evidence: 'ev', severity: 'blocker', min_action: { title: 'close it' } }
const gapRun = over => epicRun({
  hunt: { gaps: [GAP] },
  gapverify: { verdicts: [{ gid: 1, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen' }] },
  'gapimpl-1': { status: 'DONE_WITH_CONCERNS', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1', concerns: ['the guard may be too wide'] },
  'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  ...over,
})

test('epic.js: the gap fixer\'s concerns are in its reviewer\'s prompt and need a ruling each', async () => {
  const ruled = { ...CLEAN, concern_rulings: [{ idx: 0, ruling: 'NOT_A_FINDING', reason: 'the guard matches the spec' }] }
  const { ledger, call } = await go('epic.js', gapRun({ 'gaprev-1': ruled }))
  const rev = call('gaprev-1')
  assert.match(rev.prompt, /<<<BEGIN implementer concerns[^\n]*>>>\n[^\n]*\{"idx":0,"what":"the guard may be too wide"\}/)
  assert.match(rev.prompt, /Rule on EVERY one in\nconcern_rulings/)
  assert.ok(rev.opts.schema.required.includes('concern_rulings'))
  assert.deepEqual(ledger.unresolved_criticals, [])
})

test('epic.js: a gap review that leaves a concern unruled is no review — the critical stays open', async () => {
  const { ledger, labels } = await go('epic.js', gapRun({ 'gaprev-1': CLEAN, 'gaprev-1-r2': CLEAN, 'create-findings': null }))
  assert.ok(labels.includes('gaprev-1-r2'))
  assert.ok(!labels.includes('gapmerge-1'), 'no merge without a ruled review')
  assert.deepEqual(ledger.unresolved_criticals.map(u => [u.gid, u.stage]), [[1, 'review']])
})

// ------------------------------------------------------- the review entry

test('wf-helper: a review entry lists the reviewer\'s ruling on each concern', () => {
  const body = journalBody({ step: 'review', verdict: 'changes_requested', result: RULED })
  assert.ok(body.includes('\nConcern rulings:\n'), body)
  assert.ok(body.includes('- #0 FINDING (finding #0) — a.js:3 writes twice on a retry'), body)
  assert.ok(body.includes('- #1 NOT_A_FINDING — the production path has no cache either'), body)
  assert.ok(!journalBody({ step: 'review', verdict: 'approve', result: CLEAN }).includes('Concern rulings'))
})
