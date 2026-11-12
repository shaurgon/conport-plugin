import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, epicRun } from './run-workflow.mjs'

// An epic run is not ready while a finding is open. Every finding the run left
// open becomes a child of the epic before the acceptance gives its verdict: a
// review minor still open after its fix round and a gap the verifier confirmed run
// the whole road — brief, implementer, review, merge; a gap nobody could verify and
// a Note, which is a question, are filed and held for the person, never run. The
// review of a finding task reports every severity, and all of it is fixed before
// that task merges: nothing it finds is filed again or dropped. A finding that got
// no child holds the epic open.

const MINOR = { severity: 'MINOR', file: 'a.js', line: 9, what: 'a nit', fix: 'tidy it' }
const CLEAN = { verdict: 'APPROVED', findings: [] }
const FIXED = { status: 'DONE', head_sha: 'eee4', per_finding: [{ idx: 0, action: 'FIXED' }] }
const SHOULD_FIX = { gid: 2, claim: 'no env carrier', evidence: 'ev', severity: 'should_fix',
  min_action: { title: 'Add the setting to every carrier', note: 'the example env file too' }, check_hint: 'grep FOO .env.example' }
const UNSURE = { gid: 3, claim: 'maybe slow', evidence: 'ev', severity: 'should_fix', min_action: { title: 'Measure the slow path' } }
const NOTE = { gid: 4, claim: 'X is not offered to admins', evidence: 'ev', severity: 'note',
  min_action: { title: 'Offer X to admins' }, question: 'Should admins get X at all?' }

// The creation agent: one child per entry of MISSING, numbered from 601 in order.
const missingOf = prompt => JSON.parse(/MISSING (.*)\n/.exec(prompt)[1])
const created = prompt => ({ created: missingOf(prompt).map((m, i) => ({ plan_index: m.plan_index, conport_id: 601 + i })) })
const accountTable = prompt => JSON.parse(/TABLE: (.*)\n/.exec(prompt)[1])

// A review minor the fixer could not close: the fixer dies twice, so the minor is left open.
const leftMinor = {
  'rev-501': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-501': null, 'fix-501-r2': null,
}
const findingRoad = id => ({
  [`impl-${id}`]: { status: 'DONE', branch: `epic500/t${id}`, head_sha: 'fff' + id, worktree_path: '/tmp/wt-' + id },
  [`rev-${id}`]: CLEAN,
})
const run = over => runWorkflow('epic.js', { epic: 500 }, epicRun(over).answers)

test('epic.js: a review minor left open becomes a child of the epic and runs before the verdict', async () => {
  const { ledger, calls, prompt } = await run({
    ...leftMinor,
    'create-findings': created,
    ...findingRoad(601),
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  const labels = calls.map(c => c.label)
  const missing = missingOf(prompt('create-findings'))
  assert.equal(missing.length, 1)
  assert.equal(missing[0].title, 'Review minors left on task-501')
  assert.ok(missing[0].brief.includes('a.js:9 — a nit (fix: tidy it)'), missing[0].brief)
  // The whole road of a task, and all of it before the acceptance.
  // The anchor check comes after the merge of the finding task: it sees the code that task changed.
  const road = ['create-findings', 'j-brief-601', 'impl-601', 'j-report-601', 'rev-601', 'j-review-601', 'merge-f0', 'anchors', 'goal', 'account']
  assert.deepEqual(labels.filter(l => road.includes(l)), road)
  assert.ok(prompt('j-brief-601').includes('a finding of this epic run'), 'the brief says where the task came from')
  assert.ok(prompt('j-brief-601').includes('a nit'), 'the brief carries the finding')
  assert.ok(prompt('impl-601').includes('git checkout -b epic500/t601 '))
  // The minor is a task now, not a deferred line; the table closes the child.
  assert.deepEqual(ledger.minors, [])
  assert.deepEqual(ledger.findings, [{ key: '601', id: 601, source: 'review', title: 'Review minors left on task-501' }])
  assert.equal(ledger.tasks['601'].state, 'DONE')
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.done.map(d => d.id), [501, 601])
  assert.match(table.close_resolution, /^plan tasks 1\/1 merged; finding tasks 1\/1 merged; findings held for the person 0; /)
  assert.match(table.close_resolution, /findings filed at the accounting 0;/)
  assert.equal(table.may_close, true)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a confirmed gap runs as a child; an unverifiable one is filed and held for the person, never run', async () => {
  const { ledger, calls, prompt } = await run({
    hunt: { gaps: [SHOULD_FIX, UNSURE] },
    gapverify: { verdicts: [
      { gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'no FOO in .env.example' },
      { gid: 3, verdict: 'UNVERIFIABLE' }] },
    'create-findings': created,
    ...findingRoad(601),
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  const missing = missingOf(prompt('create-findings'))
  assert.deepEqual(missing.map(m => m.title), ['Add the setting to every carrier', 'Measure the slow path'])
  for (const text of ['no env carrier', 'the example env file too', 'no FOO in .env.example', 'grep FOO .env.example'])
    assert.ok(missing[0].brief.includes(text), text)
  assert.match(missing[1].brief, /^Held for the person: the verifier could not confirm this finding by observation\./)
  assert.ok(missing[1].brief.includes('maybe slow'))
  const labels = calls.map(c => c.label)
  assert.ok(labels.indexOf('merge-f0') < labels.indexOf('goal'), 'the gap task merges before the verdict')
  assert.ok(!labels.some(l => l.endsWith('-602')), 'a held child is not run')
  assert.deepEqual(ledger.findings.map(f => [f.id, f.source, f.held ?? null]), [[601, 'gap', null], [602, 'gap', 'unverified']])
  assert.deepEqual(ledger.gap_minors, [], 'no gap is left as a ledger line')
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.done.map(d => d.id), [501, 601])
  assert.equal(table.may_close, false, 'a held child keeps the epic open')
  assert.match(table.close_resolution, /findings held for the person 1;/)
})

test('epic.js: a gap verified as unverifiable by a dead verifier is filed and held too', async () => {
  const { ledger, prompt } = await run({ hunt: { gaps: [SHOULD_FIX] }, 'create-findings': created })
  assert.deepEqual(missingOf(prompt('create-findings')).map(m => m.title), ['Add the setting to every carrier'])
  assert.deepEqual(ledger.findings.map(f => [f.id, f.held]), [[601, 'unverified']])
  assert.equal(ledger.tasks['601'], undefined, 'not run')
})

test('epic.js: a confirmed Note is a question — filed with it and held for the person, never run', async () => {
  const { ledger, calls, prompt } = await run({
    hunt: { gaps: [NOTE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': created,
  })
  const [entry] = missingOf(prompt('create-findings'))
  assert.equal(entry.title, 'Offer X to admins')
  assert.match(entry.brief, /^Held for the person: a Note is a question only the person can answer\./)
  assert.ok(entry.brief.includes('Question: Should admins get X at all?'), entry.brief)
  assert.ok(!calls.some(c => c.label === 'impl-601'))
  assert.deepEqual(ledger.findings, [{ key: '601', id: 601, source: 'gap', title: 'Offer X to admins', held: 'question', question: 'Should admins get X at all?' }])
  assert.equal(accountTable(prompt('account')).may_close, false)
})

test('epic.js: the hunter is asked for the question of each Note', async () => {
  const { prompt, calls } = await run({})
  assert.ok(prompt('hunt').replace(/\s+/g, ' ').includes('a note carries in question the one question for the owner'))
  assert.ok(calls.find(c => c.label === 'hunt').opts.schema.properties.gaps.items.properties.question)
})

test('epic.js: a finding the creation agent did not settle holds the epic open and stays in the ledger', async () => {
  const { ledger, calls, prompt } = await run({ ...leftMinor })
  const labels = calls.map(c => c.label)
  assert.deepEqual(labels.filter(l => l.startsWith('create-findings')), ['create-findings', 'create-findings-r2'])
  assert.ok(!labels.some(l => l.startsWith('impl-6')), 'no task, no implementer')
  assert.deepEqual(ledger.minors.map(m => m.what), ['a nit'])
  assert.deepEqual(ledger.findings, [])
  // The unfiled finding keeps what makes it a task: its title, its brief and its question.
  assert.equal(ledger.unfiled_findings.length, 1)
  const [unfiled] = ledger.unfiled_findings
  assert.equal(unfiled.title, 'Review minors left on task-501')
  assert.ok(unfiled.brief.includes('a.js:9 — a nit (fix: tidy it)'), unfiled.brief)
  assert.equal(unfiled.question, null)
  assert.ok(labels.includes('goal'))
  const table = accountTable(prompt('account'))
  assert.equal(table.may_close, false)
  // Not a line only: the accounting files it as a child of this epic, one per finding, none in the tails epic.
  assert.deepEqual(table.minors, [{ title: 'Review minors left on task-501', description: unfiled.brief, priority: 3, parent: 500 }])
  assert.match(table.close_resolution, /findings filed at the accounting 1;/)
})

test('epic.js: an unfiled Note keeps its question for the accounting and the lead session', async () => {
  const { ledger, prompt } = await run({
    hunt: { gaps: [NOTE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
  })
  const [unfiled] = ledger.unfiled_findings
  assert.equal(unfiled.question, 'Should admins get X at all?')
  assert.ok(unfiled.brief.includes('Question: Should admins get X at all?'))
  assert.deepEqual(accountTable(prompt('account')).minors.map(m => [m.title, m.parent]), [['Offer X to admins', 500]])
})

test('epic.js: the review of a finding task reports every severity and its minors are fixed before the merge', async () => {
  const { ledger, calls, prompt } = await run({
    ...leftMinor,
    'create-findings': created,
    ...findingRoad(601),
    'rev-601': { verdict: 'APPROVED', findings: [{ ...MINOR, what: 'another nit' }] }, 'fix-601': FIXED, 'rev2-601': CLEAN,
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  assert.ok(prompt('rev-601').includes('This task was filed from a finding: report every severity'), 'the reviewer is told')
  assert.ok(!prompt('rev-501').includes('filed from a finding'), 'a plan task is reviewed as before')
  const labels = calls.map(c => c.label)
  const road = ['rev-601', 'fix-601', 'rev2-601', 'merge-f0']
  assert.deepEqual(labels.filter(l => road.includes(l)), road)
  assert.equal(calls.filter(c => c.label === 'create-findings').length, 1, 'one findings round')
  assert.deepEqual(ledger.minors, [])
  assert.equal(ledger.tasks['601'].state, 'DONE')
  // The journal tells the same: the minor requests changes, the fix is recorded, the re-review approves.
  const journal = ledger.journal.filter(j => j.task === 601 && j.step !== 'brief').map(j => [j.label, j.verdict ?? j.step])
  assert.deepEqual(journal, [['j-report-601', 'report'], ['j-review-601', 'changes_requested'], ['j-fix-601', 'fix'], ['j-review2-601', 'approve']])
})

test('epic.js: a minor a finding task could not fix holds its merge — it is neither filed again nor dropped', async () => {
  const { ledger, calls } = await run({
    ...leftMinor,
    'create-findings': created,
    ...findingRoad(601),
    'rev-601': { verdict: 'APPROVED', findings: [{ ...MINOR, what: 'another nit' }] }, 'fix-601': null, 'fix-601-r2': null,
  })
  assert.equal(calls.filter(c => c.label === 'create-findings').length, 1)
  assert.deepEqual([ledger.tasks['601'].state, ledger.tasks['601'].reason], ['FAILED', 'FIX_FAILED'])
  assert.ok(!calls.some(c => c.label === 'merge-f0'), 'not merged with the minor open')
  assert.deepEqual(ledger.minors, [], 'the minor of a finding task is not a ledger line')
  const journal = ledger.journal.filter(j => j.task === 601 && j.step !== 'brief').map(j => [j.label, j.verdict ?? j.step])
  assert.deepEqual(journal, [['j-report-601', 'report'], ['j-review-601', 'changes_requested']], 'no carry: the finding task is not accepted')
})

test('epic.js: a minor the re-review of a finding task still finds holds its merge', async () => {
  const { ledger, calls } = await run({
    ...leftMinor,
    'create-findings': created,
    ...findingRoad(601),
    'rev-601': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-601': FIXED,
    'rev2-601': { verdict: 'APPROVED', findings: [{ ...MINOR, what: 'still there' }] },
  })
  assert.deepEqual([ledger.tasks['601'].state, ledger.tasks['601'].reason], ['FAILED', 'RED_AFTER_FIX'])
  assert.ok(!calls.some(c => c.label === 'merge-f0'))
  const verdicts = ledger.journal.filter(j => j.task === 601 && j.step === 'review').map(j => [j.label, j.verdict])
  assert.deepEqual(verdicts, [['j-review-601', 'changes_requested'], ['j-review2-601', 'changes_requested']])
})

test('epic.js: a minor left on a plan task still merges that task — the finding task carries it', async () => {
  const { ledger } = await run({ ...leftMinor, 'create-findings': created, ...findingRoad(601),
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] } })
  assert.equal(ledger.tasks['501'].state, 'DONE')
})

test('epic.js: a run with no open finding files nothing', async () => {
  const { calls } = await runWorkflow('epic.js', { epic: 500 }, epicRun().answers)
  assert.ok(!calls.some(c => c.label.startsWith('create-findings')))
})

test('epic.js: a child id the run already holds is not taken for a finding — the finding stays open and holds the epic', async () => {
  // The creation agent hands back the plan task's own child: a title it carries already.
  const { ledger, calls, prompt } = await run({
    ...leftMinor,
    'create-findings': p => ({ created: missingOf(p).map(m => ({ plan_index: m.plan_index, conport_id: 501 })) }),
  })
  assert.deepEqual(ledger.findings, [])
  assert.deepEqual(ledger.minors.map(m => m.what), ['a nit'])
  assert.equal(calls.filter(c => c.label === 'j-brief-501').length, 1, 'the plan task is not run a second time')
  assert.deepEqual(ledger.unfiled_findings.map(f => f.title), ['Review minors left on task-501'])
  assert.equal(accountTable(prompt('account')).may_close, false)
})

test('epic.js: two findings handed one child id — one task is filed, the other stays open and holds the epic', async () => {
  const { ledger, calls, prompt } = await run({
    ...leftMinor,
    hunt: { gaps: [SHOULD_FIX] },
    gapverify: { verdicts: [{ gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': p => ({ created: missingOf(p).map(m => ({ plan_index: m.plan_index, conport_id: 601 })) }),
    ...findingRoad(601),
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  assert.deepEqual(ledger.findings.map(f => f.id), [601])
  assert.equal(calls.filter(c => c.label === 'impl-601').length, 1, 'no second run on the same child')
  assert.deepEqual(ledger.unfiled_findings.map(f => f.title), ['Add the setting to every carrier'])
  assert.deepEqual(ledger.gap_minors.map(g => g.gid), [2])
  assert.equal(accountTable(prompt('account')).may_close, false)
})

test('epic.js: findings that share a title are handed to the creation agent under distinct titles', async () => {
  const twin = { ...SHOULD_FIX, gid: 5, claim: 'the second carrier' }
  const { prompt } = await run({
    hunt: { gaps: [SHOULD_FIX, twin] },
    gapverify: { verdicts: [2, 5].map(gid => ({ gid, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' })) },
  })
  assert.deepEqual(missingOf(prompt('create-findings')).map(m => m.title),
    ['Add the setting to every carrier', 'Add the setting to every carrier (2)'])
})

// A finding titled like a task of the plan would make the creation agent hand
// back that task by its title: the finding is renamed before it is handed over.
test('epic.js: a finding titled like a plan task goes to the creation agent under a title of its own and runs', async () => {
  const clash = { ...SHOULD_FIX, min_action: { title: 'the thing' } }
  // The creation agent settles by title, as its step 1 says: the plan task's own title answers 501.
  const byTitle = p => ({ created: missingOf(p).map((m, i) => ({ plan_index: m.plan_index, conport_id: m.title === 'the thing' ? 501 : 601 + i })) })
  const { ledger, calls, prompt } = await run({
    hunt: { gaps: [clash] },
    gapverify: { verdicts: [{ gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': byTitle,
    ...findingRoad(601),
    'merge-f0': { results: [{ id: 601, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  assert.deepEqual(missingOf(prompt('create-findings')).map(m => m.title), ['the thing (2)'])
  assert.deepEqual(ledger.findings.map(f => [f.id, f.title]), [[601, 'the thing (2)']])
  assert.deepEqual(ledger.unfiled_findings, [])
  assert.ok(calls.some(c => c.label === 'impl-601'))
})

// A child of the epic with no plan section — a finding task of an earlier run —
// is the same finding reported again: it is reused by its title, never twinned.
test('epic.js: a re-reported finding reuses the child an earlier run filed for it, no twin is filed', async () => {
  const r = epicRun({
    hunt: { gaps: [NOTE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': p => ({ created: missingOf(p).map(m => ({ plan_index: m.plan_index, conport_id: m.title === 'Offer X to admins' ? 610 : 699 })) }),
  })
  const sc = r.answers.scout
  r.answers.scout = { ...sc, tasks: [...sc.tasks, { conport_id: 610, plan_index: null, kind: 'work', title: 'Offer X to admins',
    lines: null, files: null, consumes: [], produces: [], deps: [], acceptance: '', spec_card: '', coverage: 'conport_only' }] }
  const { ledger, prompt } = await runWorkflow('epic.js', r.args, r.answers)
  assert.deepEqual(missingOf(prompt('create-findings')).map(m => m.title), ['Offer X to admins'])
  assert.deepEqual(ledger.findings.map(f => [f.id, f.held]), [[610, 'question']])
  assert.deepEqual(ledger.unfiled_findings, [])
})

// A held child carries the person's question, not work: run from ConPort briefs
// alone (allowNoPlan), it is still never handed to an implementer. It waits for the
// person until a plan section binds it, and the run's summary names it.
test('epic.js: without a plan a held child is not run and the summary names it as waiting for the person', async () => {
  const r = epicRun({ 'create-findings': created })
  const sc = r.answers.scout
  const plan = { ...sc.tasks[0], lines: null, coverage: 'conport_only' }
  const held = { ...plan, conport_id: 610, title: 'Offer X to admins',
    acceptance: 'Held for the person: a Note is a question only the person can answer.\nOffer X to admins.\nQuestion: Should admins get X at all?' }
  r.answers.scout = { ...sc, plan_path: null, tasks: [plan, held] }
  const { ledger, calls, prompt } = await runWorkflow('epic.js', { ...r.args, allowNoPlan: true }, r.answers)
  const labels = calls.map(c => c.label)
  assert.ok(labels.includes('impl-501'), 'the task with work is run')
  assert.ok(!labels.some(l => l.endsWith('-610')), 'the held child is not dispatched')
  assert.deepEqual(ledger.waiting_for_person, [{ id: 610, title: 'Offer X to admins' }])
  const table = accountTable(prompt('account'))
  assert.match(table.close_resolution, /; waiting for the person: task-610$/)
  assert.equal(table.may_close, false)
})

test('epic.js: a held finding of this run is named in the summary as waiting for the person too', async () => {
  const { prompt } = await run({
    hunt: { gaps: [NOTE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': created,
  })
  assert.match(accountTable(prompt('account')).close_resolution, /; waiting for the person: task-601$/)
})

// The mark of a held child must reach the script whole: both branches of the scout
// keep such a child conport_only, never uncovered, with its description verbatim.
test('epic.js: the scout keeps a held child conport_only with its description verbatim, in both branches', async () => {
  const { source } = await import('./run-workflow.mjs')
  const rule = 'A child whose description starts with \'Held for the person:\' waits for the person: ' +
    'coverage conport_only (never uncovered) unless a plan section binds it; its acceptance and its description are that ' +
    'description VERBATIM, never compressed.'
  const text = source('epic.js').replace(/\s+/g, ' ')
  assert.equal(text.split(rule).length - 1, 2, 'in STEP 2 and in branch B alike')
  const { calls } = await run({})
  assert.ok(calls.find(c => c.label === 'scout').opts.schema.properties.tasks.items.properties.description, 'the schema carries it')
})

// The script does not rely on the scout's acceptance alone: a held mark in the
// description, or a held child the scout called uncovered, still waits.
for (const [name, over] of [
  ['the mark only in the description', { acceptance: 'compressed', description: 'Held for the person: a Note is a question only the person can answer.\nQ' }],
  ['a held child called uncovered', { acceptance: '', coverage: 'uncovered', description: 'Held for the person: the verifier could not confirm this finding by observation.' }],
]) {
  test(`epic.js: ${name} still waits for the person`, async () => {
    const r = epicRun({})
    const sc = r.answers.scout
    const plan = { ...sc.tasks[0], lines: null, coverage: 'conport_only' }
    r.answers.scout = { ...sc, plan_path: null, tasks: [plan, { ...plan, conport_id: 610, title: 'Held', ...over }] }
    const { ledger, calls } = await runWorkflow('epic.js', { ...r.args, allowNoPlan: true }, r.answers)
    assert.ok(!calls.some(c => c.label.endsWith('-610')))
    assert.deepEqual(ledger.waiting_for_person, [{ id: 610, title: 'Held' }])
    assert.deepEqual(ledger.uncovered, [])
  })
}
