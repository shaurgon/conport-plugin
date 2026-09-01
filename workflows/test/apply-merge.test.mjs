import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Same extraction technique as the other parity tests: applyMerge stays inline in
// epic.js (the workflow runner gives the script neither import nor fs) between
// stable markers, and this test evaluates exactly that source — the code under
// test is the shipped code, verbatim.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const EPIC = join(WORKFLOWS, 'epic.js')
const TASK = join(WORKFLOWS, 'task.js')
const BEGIN = 'APPLY_MERGE_BEGIN'
const END = 'APPLY_MERGE_END'

const applyMerge = () => {
  const src = readFileSync(EPIC, 'utf8')
  const from = src.indexOf(BEGIN)
  const to = src.indexOf(END)
  assert.ok(from >= 0, `marker ${BEGIN} missing from epic.js`)
  assert.ok(to > from, `marker ${END} missing from epic.js or out of order`)
  const block = src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
  assert.match(block, /function applyMerge/, 'the marked region is not applyMerge')
  // matchId is defined outside the region; the queue rows here carry plain ids.
  return new Function(`const matchId = t => t.id\n${block}\nreturn applyMerge`)()
}
const A = applyMerge()

// A ledger stub that records which transition each status took. The real ledger
// helpers are exercised by the workflow itself; what this test pins is the
// mapping status -> transition, which is where a missing branch hides.
const ledger = () => {
  const calls = []
  return {
    calls,
    done: (t, sha) => calls.push(['done', t.id, sha]),
    conflict: (t, files) => calls.push(['conflict', t.id, files]),
    fail: (t, reason, detail) => calls.push(['fail', t.id, reason, detail]),
    abortRun: (reason, detail) => calls.push(['abortRun', reason, detail]),
  }
}
const row = id => ({ id, key: 't' + id })
const apply = (results, opts) => {
  const L = ledger()
  A(L, results.map(r => row(r.id)), { results }, opts)
  return L.calls
}
// Same, with the queue given explicitly — for the case where a result names a
// row the queue does not contain.
const apply2 = (results, queue, opts) => {
  const L = ledger()
  A(L, queue, { results }, opts)
  return L.calls
}

test('MERGED and ALREADY_MERGED both close the row with the merge sha', () => {
  assert.deepEqual(apply([{ id: 1, status: 'MERGED', merge_sha: 'abc' }]), [['done', 1, 'abc']])
  assert.deepEqual(apply([{ id: 2, status: 'ALREADY_MERGED', merge_sha: 'def' }]), [['done', 2, 'def']])
})

test('CONFLICT records the conflicted files', () => {
  assert.deepEqual(
    apply([{ id: 3, status: 'CONFLICT', conflict_files: ['a.py'] }]),
    [['conflict', 3, ['a.py']]],
  )
})

test('GATE_RED fails the row with the gate tail', () => {
  assert.deepEqual(
    apply([{ id: 4, status: 'GATE_RED', gate_tail: 'E   assert 1 == 2' }]),
    [['fail', 4, 'GATE_RED', 'E   assert 1 == 2']],
  )
})

// The defect this file exists for: NOT_MERGED used to fall through every branch,
// leaving the row in its pre-merge state — recorded in no accounting list, and
// invisible to skip propagation, so dependants were dispatched onto a base that
// never received the merge. From a real merge attempt there is no retry left.
test('NOT_MERGED from a merge attempt fails the row instead of falling through', () => {
  assert.deepEqual(
    apply([{ id: 5, status: 'NOT_MERGED', gate_tail: 'batch stopped earlier' }]),
    [['fail', 5, 'NOT_MERGED', 'batch stopped earlier']],
  )
})

// The other half of the same status, and the reason the disposition cannot be
// status-wide: a --state-only reading is the survey the retry queue is built
// from, so an unmerged row must stay untouched there. Failing it here would
// empty the retry and turn every reviewed, gate-green branch of the wave into a
// blocked task.
test('NOT_MERGED from a --state-only survey leaves the row untouched for the retry', () => {
  assert.deepEqual(
    apply([{ id: 5, status: 'NOT_MERGED', gate_tail: '' }], { stateOnly: true }),
    [],
  )
})

test('a --state-only survey still records what it does know', () => {
  assert.deepEqual(
    apply([
      { id: 1, status: 'ALREADY_MERGED', merge_sha: 'abc' },
      { id: 2, status: 'NOT_MERGED', gate_tail: '' },
    ], { stateOnly: true }),
    [['done', 1, 'abc']],
  )
})

test('RED_BASELINE and DIRTY_ABORTED abort the whole run, not one row', () => {
  assert.deepEqual(
    apply([{ id: 6, status: 'RED_BASELINE', gate_tail: 'red before we started' }]),
    [['abortRun', 'RED_BASELINE', 'red before we started']],
  )
  assert.deepEqual(
    apply([{ id: 7, status: 'DIRTY_ABORTED', gate_tail: 'src/x.py' }]),
    [['abortRun', 'DIRTY_ABORTED', 'src/x.py']],
  )
})

test('a result whose id is not in the queue is ignored', () => {
  assert.deepEqual(apply2([{ id: 99, status: 'MERGED', merge_sha: 'abc' }], [row(1)]), [])
})

// The guard against the defect class rather than the one instance: every status
// the merge schema can carry must move the row somewhere. It pins reachability
// only — that a branch exists, not which one — so it deliberately does not
// catch a status routed to the wrong disposition; the per-status tests above do.
test('every status of the merge schema has a branch', () => {
  const src = readFileSync(EPIC, 'utf8')
  // Several schemas in the file declare a `status` enum; the merge one is the
  // enum that carries MERGED. Anchoring on content rather than on order keeps
  // this test pointed at S_MG when the schemas move.
  const enumLine = [...src.matchAll(/enum: \[([^\]]+)\]/g)]
    .map(m => m[1])
    .find(body => body.includes("'MERGED'"))
  assert.ok(enumLine, 'the merge status enum (the one carrying MERGED) not found in epic.js')
  const statuses = [...enumLine.matchAll(/'([A-Z_]+)'/g)].map(m => m[1])
  assert.ok(statuses.length >= 7, `expected the full status set, got ${statuses.join(', ')}`)
  for (const status of statuses) {
    const calls = apply([{ id: 9, status, merge_sha: null, gate_tail: '' }])
    assert.equal(calls.length, 1, `status ${status} reaches no branch of applyMerge`)
  }
})

// The recovery block in epic.js is not extractable — it awaits agents inside the
// wave loop — so its ordering is pinned by source shape instead. Weaker than
// executing it, and deliberately narrow: it pins only that the abort check sits
// between the survey and the retry queue. That order is the whole point. A
// survey that reports RED_BASELINE has found a base the run has given up on;
// with the check below the retry, the aborted row is the only one left pending,
// so it would be the one thing re-merged.
test('the state-only survey aborts before it builds the retry queue', () => {
  const src = readFileSync(EPIC, 'utf8')
  const survey = src.indexOf('{ stateOnly: true }')
  const abort = src.indexOf('L.aborted', survey)
  const retry = src.indexOf('L.pendingMerge(t)', survey)
  assert.ok(survey >= 0, 'the state-only application is gone from epic.js')
  assert.ok(retry > survey, 'the retry queue is no longer built after the survey')
  assert.ok(abort > survey && abort < retry,
    'the abort check must sit between the survey and the retry queue, or an aborted run re-merges onto a base it gave up on')
})

// task.js has no extractable seam (its dispatch is inline in the run's control
// flow), so the guard there is textual: the branch must exist for every status
// that names one row, and it must fail the run rather than leave it unset.
test('task.js dispatches NOT_MERGED to a failure', () => {
  const src = readFileSync(TASK, 'utf8')
  assert.match(src, /res\.status === 'NOT_MERGED'\) fail\('NOT_MERGED'/,
    'task.js leaves NOT_MERGED unhandled — the run would end UNKNOWN and touch nothing in ConPort')
})
