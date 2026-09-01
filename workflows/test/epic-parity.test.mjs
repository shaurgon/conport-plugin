import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The workflow runner evaluates epic.js with injected globals and gives it neither
// import nor fs, so the parity core cannot live in a module epic.js would import.
// It stays inline in epic.js between stable markers, and this test extracts exactly
// that source and evaluates it — the code under test is the shipped code, verbatim.
const EPIC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'epic.js')
const BEGIN = 'PARITY_BLOCK_BEGIN'
const END = 'PARITY_BLOCK_END'

const parityCore = () => {
  const src = readFileSync(EPIC, 'utf8')
  const from = src.indexOf(BEGIN)
  const to = src.indexOf(END)
  assert.ok(from >= 0, `marker ${BEGIN} missing from epic.js`)
  assert.ok(to > from, `marker ${END} missing from epic.js or out of order`)
  // whole lines only: the markers themselves live inside comments
  const block = src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
  return new Function(`${block}\nreturn { planOnly, titleKey, matchPlanToChildren, applyCreated, applyParity }`)()
}
const P = parityCore()

const planTask = (i, title, extra = {}) =>
  ({ plan_index: i, title, coverage: 'plan_only', conport_id: null, ...extra })
const bothTask = (i, title, id) =>
  ({ plan_index: i, title, coverage: 'both', conport_id: id })
const child = (id, title, status = 'TODO') => ({ id, title, status, kind: 'task' })
const ledger = () => ({ parity_failed: [], notes: [] })

// ------------------------------------------------------------------- matching

test('match: a plan task takes the child carrying its title', () => {
  const out = P.matchPlanToChildren([planTask(1, 'Wire the gate')], [child(7, 'Wire the gate')])
  assert.deepEqual(out.created, [{ plan_index: 1, conport_id: 7, existed: true }])
  assert.deepEqual(out.failed, [])
  assert.deepEqual(out.unplanned, [])
  assert.deepEqual(out.closed, [])
})

test('match: titles compare case- and whitespace-insensitively', () => {
  const out = P.matchPlanToChildren([planTask(1, '  Wire   the Gate ')], [child(7, 'wire the gate')])
  assert.deepEqual(out.created, [{ plan_index: 1, conport_id: 7, existed: true }])
})

test('mismatch: no child with this title -> failed, child stays unplanned', () => {
  const out = P.matchPlanToChildren([planTask(1, 'Wire the gate')], [child(9, 'Something else')])
  assert.deepEqual(out.created, [])
  assert.equal(out.failed.length, 1)
  assert.equal(out.failed[0].plan_index, 1)
  assert.equal(out.failed[0].title, 'Wire the gate')
  assert.deepEqual(out.unplanned, ['9 Something else'])
})

test('empty and undefined children lists both fail every plan task', () => {
  for (const kids of [[], undefined, null]) {
    const out = P.matchPlanToChildren([planTask(1, 'A'), planTask(2, 'B')], kids)
    assert.deepEqual(out.created, [])
    assert.deepEqual(out.failed.map(f => f.plan_index), [1, 2])
    assert.deepEqual(out.unplanned, [])
  }
})

test('children without an id are ignored, not matched', () => {
  const out = P.matchPlanToChildren([planTask(1, 'A')], [{ title: 'A', status: 'TODO' }, null])
  assert.deepEqual(out.created, [])
  assert.equal(out.failed.length, 1)
})

test('a closed child is matched and reported as closed', () => {
  const out = P.matchPlanToChildren([planTask(1, 'A'), planTask(2, 'B')],
    [child(7, 'A', 'done'), child(8, 'B', 'CANCELLED')])
  assert.deepEqual(out.created.map(c => c.conport_id), [7, 8])
  assert.deepEqual(out.closed, ['7 A (done)', '8 B (CANCELLED)'])
})

test('non-plan_only tasks are not matched', () => {
  const out = P.matchPlanToChildren(
    [{ plan_index: 1, title: 'A', coverage: 'already_done', conport_id: null }], [child(7, 'A')])
  assert.deepEqual(out.created, [])
  assert.deepEqual(out.failed, [])
  assert.deepEqual(out.unplanned, ['7 A'])
})

// ------------------------------------------------------ duplicates and consumed

test('a duplicate-title child is never silently dropped: it is reported unplanned', () => {
  const out = P.matchPlanToChildren([planTask(1, 'A')], [child(7, 'A'), child(8, 'A')])
  assert.deepEqual(out.created, [{ plan_index: 1, conport_id: 7, existed: true }])
  assert.deepEqual(out.unplanned, ['8 A'])
})

test('two plan tasks with the same title cannot share one child', () => {
  const out = P.matchPlanToChildren([planTask(1, 'A'), planTask(2, 'A')], [child(7, 'A')])
  assert.deepEqual(out.created, [{ plan_index: 1, conport_id: 7, existed: true }])
  assert.deepEqual(out.failed.map(f => f.plan_index), [2])
  assert.deepEqual(out.unplanned, [])
})

test('a child already carried by a both-task is not re-matched', () => {
  const out = P.matchPlanToChildren([bothTask(1, 'A', 7), planTask(2, 'A')], [child(7, 'A')])
  assert.deepEqual(out.created, [])
  assert.deepEqual(out.failed.map(f => f.plan_index), [2])
  assert.deepEqual(out.unplanned, [], 'a child held by a both-task is planned, not unplanned')
})

test('children of both-tasks stay out of unplanned even with other titles', () => {
  const out = P.matchPlanToChildren([bothTask(1, 'A', 7), planTask(2, 'B')],
    [child(7, 'A'), child(8, 'B'), child(9, 'C')])
  assert.deepEqual(out.created, [{ plan_index: 2, conport_id: 8, existed: true }])
  assert.deepEqual(out.unplanned, ['9 C'])
})

// ------------------------------------------------------------------- creation

test('created ids move out of failed and are flagged existed:false', () => {
  const par = P.matchPlanToChildren([planTask(1, 'A'), planTask(2, 'B')], [child(7, 'A')])
  assert.deepEqual(par.failed.map(f => f.plan_index), [2])
  P.applyCreated(par, [{ plan_index: 2, conport_id: 42 }])
  assert.deepEqual(par.failed, [])
  assert.deepEqual(par.created, [
    { plan_index: 1, conport_id: 7, existed: true },
    { plan_index: 2, conport_id: 42, existed: false },
  ])
})

test('creation results that are junk or for unknown tasks change nothing', () => {
  const par = P.matchPlanToChildren([planTask(1, 'A')], [])
  P.applyCreated(par, [null, { plan_index: 1 }, { conport_id: 5 }, { plan_index: 99, conport_id: 5 }])
  assert.deepEqual(par.created, [])
  assert.deepEqual(par.failed.map(f => f.plan_index), [1])
  P.applyCreated(par, undefined)
  assert.deepEqual(par.failed.map(f => f.plan_index), [1])
})

test('a creation result reusing an already-claimed id leaves its task failed', () => {
  // two plan tasks share a title, the epic carries one child with it: the second
  // task fails the match, and idempotency-by-title hands the same id back again
  const tasks = [planTask(1, 'A'), planTask(2, 'A'), planTask(3, 'B')]
  const par = P.matchPlanToChildren(tasks, [child(7, 'A')])
  assert.deepEqual(par.failed.map(f => f.plan_index), [2, 3])
  P.applyCreated(par, [{ plan_index: 2, conport_id: 7 }, { plan_index: 3, conport_id: 9 }])
  assert.deepEqual(par.created, [
    { plan_index: 1, conport_id: 7, existed: true },
    { plan_index: 3, conport_id: 9, existed: false },
  ], 'the duplicate id is not claimed twice')
  assert.deepEqual(par.failed.map(f => f.plan_index), [2],
    'the task whose id was already taken stays failed')
  const L = ledger()
  const out = P.applyParity(tasks, par, L)
  assert.deepEqual(out.map(t => t.key), ['7', undefined, '9'], 'no two tasks share a ledger key')
  assert.deepEqual(L.parity_failed, [{ plan_index: 2, title: 'A' }])
})

test('two creation results carrying the same fresh id: only the first is taken', () => {
  const par = P.matchPlanToChildren([planTask(1, 'A'), planTask(2, 'B')], [])
  P.applyCreated(par, [{ plan_index: 1, conport_id: 42 }, { plan_index: 2, conport_id: 42 }])
  assert.deepEqual(par.created, [{ plan_index: 1, conport_id: 42, existed: false }])
  assert.deepEqual(par.failed.map(f => f.plan_index), [2])
})

// ------------------------------------------------------------------ applyParity

test('applyParity gives matched and created tasks their id, and only them', () => {
  const tasks = [planTask(1, 'A'), planTask(2, 'B'), planTask(3, 'C')]
  const par = P.matchPlanToChildren(tasks, [child(7, 'A')])
  P.applyCreated(par, [{ plan_index: 2, conport_id: 42 }])
  const L = ledger()
  const out = P.applyParity(tasks, par, L)
  assert.deepEqual(out.map(t => t.conport_id), [7, 42, null])
  assert.deepEqual(out.map(t => t.key), ['7', '42', undefined])
  assert.deepEqual(L.parity_failed, [{ plan_index: 3, title: 'C' }],
    'only the task that got no id at all is reported failed')
})

test('applyParity with no parity data fails every plan task', () => {
  const tasks = [planTask(1, 'A'), bothTask(2, 'B', 5)]
  const L = ledger()
  const out = P.applyParity(tasks, null, L)
  assert.deepEqual(out, tasks)
  assert.deepEqual(L.parity_failed, [{ plan_index: 1, title: 'A' }])
})
