import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, epicRun, source } from './run-workflow.mjs'

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

// ------------------------------------------------ every path of a finding ends in a task or a question
//
// A finding the run verified is a task of this epic and is worked in this run,
// whatever its level: a critical the capped critical-fix round could not close —
// its fix failed, or it came beyond the cap — runs in the findings round like any
// other finding, never parked in a tails epic of its own. A Note and a finding no
// one could verify are questions to the person, and the ledger hands them to the
// session to ask. What a reviewer could not verify is checked: by the gap hunt
// when it comes before it, by the person when it comes after.

const BLOCKER = { gid: 1, claim: 'the goal is not reached', evidence: 'ev', severity: 'blocker',
  min_action: { title: 'Reach the goal', note: 'wire it' }, check_hint: 'grep it' }
const critical = gid => ({ gid, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen ' + gid })
const IMPORTANT = { severity: 'IMPORTANT', file: 'g.js', line: 3, what: 'the guard is inverted', fix: 'flip it' }
const goalLedger = prompt => JSON.parse(/<<<BEGIN ledger[^\n]*>>>\n([^\n]*)\n<<<END ledger>>>/.exec(prompt)[1])
const merged = (n, id) => ({ [`merge-f${n}`]: { results: [{ id, status: 'MERGED', merge_sha: 'm' + id }] } })

test('epic.js: a Blocker whose fix fails in the critical-fix round becomes a task of this epic and runs in the findings round', async () => {
  const { ledger, calls, prompt } = await run({
    hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] },
    'create-findings': created, ...findingRoad(601), ...merged(0, 601),
  })
  const [entry] = missingOf(prompt('create-findings'))
  assert.equal(entry.title, 'Reach the goal')
  assert.equal(entry.priority, 1, 'a critical is filed at the top priority')
  for (const text of ['the goal is not reached', 'wire it', 'seen 1', 'grep it', 'failed at impl'])
    assert.ok(entry.brief.includes(text), text)
  const labels = calls.map(c => c.label)
  const road = ['gapimpl-1-r2', 'create-findings', 'impl-601', 'rev-601', 'merge-f0', 'goal', 'account']
  assert.deepEqual(labels.filter(l => road.includes(l)), road)
  assert.deepEqual(ledger.findings, [{ key: '601', id: 601, source: 'critical', title: 'Reach the goal', gid: 1 }])
  assert.deepEqual(ledger.unresolved_criticals, [{ gid: 1, claim: 'the goal is not reached', stage: 'impl' }], 'the record of the round stays')
  assert.deepEqual(goalLedger(prompt('goal')).unresolved_criticals, [], 'closed by its task: the acceptor is not told it is open')
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.minors, [], 'nothing is parked in a tails epic')
  assert.match(table.close_resolution, /; criticals fixed 1 of 1; /)
  assert.equal(table.may_close, true)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a critical beyond the cap of the critical-fix round becomes a task of this epic and runs', async () => {
  const gaps = [1, 2, 3, 4, 5, 6].map(gid => ({ ...BLOCKER, gid, min_action: { title: 'Close gap ' + gid } }))
  const roads = Object.assign({}, ...[0, 1, 2, 3, 4, 5].map(i => ({ ...findingRoad(601 + i), ...merged(i, 601 + i) })))
  const { ledger, prompt } = await run({
    hunt: { gaps }, gapverify: { verdicts: gaps.map(g => critical(g.gid)) },
    'create-findings': created, ...roads,
  })
  assert.deepEqual(ledger.escalations.map(g => g.gid), [6])
  const escalated = missingOf(prompt('create-findings')).find(m => m.title === 'Close gap 6')
  assert.ok(escalated.brief.includes('beyond the cap'), escalated.brief)
  assert.equal(escalated.priority, 1)
  assert.deepEqual(ledger.findings.filter(f => f.gid === 6).map(f => [f.source, ledger.tasks[f.key].state]), [['critical', 'DONE']])
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.minors, [])
  assert.match(table.close_resolution, /; criticals fixed 6 of 6; /)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a critical whose task fails too stays open: the task is blocked and the epic is not closed', async () => {
  const { ledger, prompt } = await run({
    hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] }, 'create-findings': created,
  })
  assert.deepEqual([ledger.tasks['601'].state, ledger.tasks['601'].reason], ['FAILED', 'IMPL_DEAD'])
  assert.equal(goalLedger(prompt('goal')).unresolved_criticals.length, 1)
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.failed.map(f => f.id), [601], 'the task carries the critical, blocked')
  assert.deepEqual(table.minors, [])
  assert.equal(table.may_close, false)
  assert.match(table.close_resolution, /; criticals fixed 0 of 1; /)
  assert.equal(ledger.outcome, 'DONE_WITH_UNRESOLVED_CRITICALS')
})

test('epic.js: a critical the findings round could not file is filed at the accounting under this epic, at the top priority', async () => {
  const { ledger, prompt } = await run({ hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] } })
  assert.deepEqual(ledger.unfiled_findings.map(f => f.title), ['Reach the goal'])
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.minors.map(m => [m.title, m.parent, m.priority]), [['Reach the goal', 500, 1]])
  assert.equal(ledger.outcome, 'DONE_WITH_UNRESOLVED_CRITICALS')
})

test('epic.js: a minor of the gap-fix review becomes a task of this epic and runs', async () => {
  const { ledger, prompt } = await run({
    hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': { verdict: 'APPROVED', findings: [MINOR] },
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
    'create-findings': created, ...findingRoad(601), ...merged(0, 601),
  })
  const [entry] = missingOf(prompt('create-findings'))
  assert.equal(entry.title, 'Review minors left on the fix of gap 1')
  assert.ok(entry.brief.includes('a.js:9 — a nit (fix: tidy it)'), entry.brief)
  assert.deepEqual(ledger.findings.map(f => [f.id, f.source]), [[601, 'review']])
  assert.equal(ledger.tasks['601'].state, 'DONE')
  assert.match(accountTable(prompt('account')).close_resolution, /; criticals fixed 1 of 1; /)
})

test('epic.js: an Important finding of the gap-fix review leaves the critical open — its task carries the finding', async () => {
  const { ledger, prompt } = await run({
    hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] },
    'create-findings': created, ...findingRoad(601), ...merged(0, 601),
  })
  assert.deepEqual(ledger.unresolved_criticals.map(u => [u.gid, u.stage]), [[1, 'review']])
  const [entry] = missingOf(prompt('create-findings'))
  assert.ok(entry.brief.includes('g.js:3 — the guard is inverted'), entry.brief)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

const UNVERIFIED_501 = { 'rev-501': { verdict: 'APPROVED', findings: [], unverifiable: ['the caller in b.js'] } }
const ASK_501 = { task: 501, title: 'Not verified by the review of task-501',
  question: 'The reviewer could not verify this from the diff alone — is it real, and what closes it? the caller in b.js' }

test('epic.js: what a task reviewer could not verify goes to the gap hunt — settled there, it is no question', async () => {
  const { ledger, prompt, calls } = await run({ ...UNVERIFIED_501, hunt: { gaps: [], settled: [{ index: 0, covered: 'b.js:3 calls it right' }] } })
  assert.match(prompt('hunt'), /<<<BEGIN unverified by the reviews[^\n]*>>>\n[^\n]*"index":0[^\n]*the caller in b\.js/)
  assert.ok(prompt('hunt').includes('settled'), 'the hunter is told to account for each item')
  assert.ok(calls.find(c => c.label === 'hunt').opts.schema.properties.settled, 'the schema carries settled')
  assert.deepEqual(ledger.questions, [], 'the hunt settled it: no question is left')
  assert.equal(ledger.questions_action, null)
})

test('epic.js: an item the hunt did not settle stays a question, whatever else the hunt returned', async () => {
  const { ledger } = await run({ ...UNVERIFIED_501, hunt: { gaps: [] } })
  assert.deepEqual(ledger.questions, [ASK_501])
})

test('epic.js: an item settled as a gap the hunt did not return, or covered by nothing, stays a question', async () => {
  const { ledger } = await run({ ...UNVERIFIED_501, hunt: { gaps: [], settled: [{ index: 0, gid: 9 }, { index: 0, covered: ' ' }] } })
  assert.deepEqual(ledger.questions, [ASK_501])
})

test('epic.js: an item the hunt settled as a gap it returned is checked by the verifier, not asked', async () => {
  const { ledger } = await run({ ...UNVERIFIED_501,
    hunt: { gaps: [{ ...SHOULD_FIX }], settled: [{ index: 0, gid: 2 }] },
    gapverify: { verdicts: [{ gid: 2, verdict: 'REJECTED', proof: 'refuted' }] } })
  assert.deepEqual(ledger.questions, [])
})

test('epic.js: what the reviewers could not verify becomes a question when no hunt checks it', async () => {
  const { ledger } = await run({ ...UNVERIFIED_501, hunt: null })
  assert.deepEqual(ledger.questions, [ASK_501])
  assert.match(ledger.questions_action, /^questions holds what only the user can settle/)
})

test('epic.js: what the review of a finding task could not verify is a question to the person', async () => {
  const { ledger } = await run({
    ...leftMinor, 'create-findings': created, ...findingRoad(601),
    'rev-601': { verdict: 'APPROVED', findings: [], unverifiable: ['the cache of c.js'] }, ...merged(0, 601),
  })
  assert.deepEqual(ledger.questions.map(q => [q.task, q.title]), [[601, 'Not verified by the review of task-601']])
  assert.ok(ledger.questions[0].question.endsWith('the cache of c.js'))
})

test('epic.js: a held Note and an unverified gap are handed to the session as questions to ask', async () => {
  const { ledger } = await run({
    hunt: { gaps: [NOTE, UNSURE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }, { gid: 3, verdict: 'UNVERIFIABLE' }] },
    'create-findings': created,
  })
  assert.deepEqual(ledger.questions, [
    { task: 601, title: 'Offer X to admins', question: 'Should admins get X at all?' },
    { task: 602, title: 'Measure the slow path', question: 'Is this gap real, and what closes it?' },
  ])
  assert.ok(ledger.questions_action.includes('/conport:task <id>'), ledger.questions_action)
})

test('epic.js: a child held by an earlier run is a question too, named by its task', async () => {
  const r = epicRun({})
  const sc = r.answers.scout
  const plan = { ...sc.tasks[0], lines: null, coverage: 'conport_only' }
  r.answers.scout = { ...sc, plan_path: null, tasks: [plan, { ...plan, conport_id: 610, title: 'Held',
    acceptance: 'Held for the person: a Note is a question only the person can answer.\nQ' }] }
  const { ledger } = await runWorkflow('epic.js', { ...r.args, allowNoPlan: true }, r.answers)
  assert.deepEqual(ledger.questions, [{ task: 610, title: 'Held', question: 'the question in the description of task-610' }])
})

test('epic.js: an unmet criterion of the acceptance becomes a task of this epic at the accounting', async () => {
  const { prompt } = await run({ goal: { verdict: 'NOT_READY', checks: [], unmet: ['the export is not observed'] } })
  assert.ok(prompt('goal').replace(/\s+/g, ' ').includes('unmet names only what the goal lacks that no task of the ledger carries'))
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.minors, [{ title: 'Acceptance unmet: the export is not observed', priority: 2, parent: 500,
    description: 'The acceptance of epic task-500 observed this criterion of its goal unmet: the export is not observed' }])
  assert.match(table.close_resolution, /findings filed at the accounting 1;/)
})

test('epic.js: an unverifiable criterion of the acceptance is a question, not an unmet task', async () => {
  const { ledger, prompt } = await run({ goal: { verdict: 'NOT_READY', checks: [],
    unmet: ['unverifiable: the export reaches the partner', 'the export is not observed'] } })
  assert.ok(prompt('goal').includes("'unverifiable: <criterion>'"), 'the acceptor is told the mark')
  assert.deepEqual(accountTable(prompt('account')).minors.map(m => m.title), ['Acceptance unmet: the export is not observed'])
  assert.deepEqual(ledger.questions, [{ task: null, title: 'Acceptance could not observe: the export reaches the partner',
    question: 'The acceptance found no way to observe this criterion of the goal — is it met, and how is it shown?' }])
})

test('epic.js: the acceptor is handed the open unmet children and repeats their title, so a rerun files no twin', async () => {
  const r = epicRun({ goal: { verdict: 'NOT_READY', checks: [], unmet: ['the export is not observed'] } })
  const sc = r.answers.scout
  r.answers.scout = { ...sc, tasks: [...sc.tasks,
    { conport_id: 610, plan_index: null, kind: 'work', title: 'Acceptance unmet: the export is not observed', conport_status: 'TODO',
      lines: null, files: null, consumes: [], produces: [], deps: [], acceptance: 'x', spec_card: '', coverage: 'conport_only' },
    { conport_id: 611, plan_index: null, kind: 'work', title: 'Acceptance unmet: an old one', conport_status: 'DONE',
      lines: null, files: null, consumes: [], produces: [], deps: [], acceptance: 'x', spec_card: '', coverage: 'already_done' }] }
  const { prompt } = await runWorkflow('epic.js', r.args, r.answers)
  const goal = prompt('goal')
  assert.match(goal, /<<<BEGIN open unmet children[^\n]*>>>\n\["Acceptance unmet: the export is not observed"\]\n/)
  assert.ok(goal.replace(/\s+/g, ' ').includes('the text after "Acceptance unmet: " VERBATIM'))
  assert.deepEqual(accountTable(prompt('account')).minors.map(m => m.title), ['Acceptance unmet: the export is not observed'])
})

test('epic.js: a defect is never sent to the tails epic; the accountant keeps it only for ordinary work beyond the ceiling', async () => {
  const { prompt, calls } = await run({ hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] } })
  assert.ok(accountTable(prompt('account')).minors.every(m => m.parent === 500), 'the unfiled critical names its epic')
  const text = prompt('account').replace(/\s+/g, ' ')
  assert.ok(!/Tails of epic/.test(text), 'no tails epic of one epic: one per release')
  assert.ok(text.includes("'Tails of release <title of M>'"), 'branch B finds the tails epic of the release')
  assert.ok(text.includes('the next OPEN milestone by sequence after M'), text)
  assert.ok(text.includes('ordinary work beyond the ceiling'), text)
  const props = calls.find(c => c.label === 'account').opts.schema.properties
  assert.ok(props.tails_epic_id && props.tails_epic_needs_milestone)
})

test('epic.js: branch B files the tails epic only in a release milestone right after a release, at priority 1, and asks otherwise', async () => {
  const { prompt } = await run({ hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] } })
  const text = prompt('account').replace(/\s+/g, ' ')
  assert.ok(!text.includes('Tails of release of epic'), 'no title without a release milestone')
  for (const part of [
    "M is a release milestone (is_release=true)",
    "the title 'Tails of release <title of M>' written literally, never translated",
    'add_task(kind="epic", priority=1,',
    'only when N is a release milestone too (is_release=true)',
    'M is missing or not a release, N is missing or a standing list (is_release=false: the waiting milestone, the backlog without a date)',
    'create no tails epic and file none of these entries: set tails_epic_id=null and tails_epic_needs_milestone=true',
    // the waiting work is kept in ConPort, and the resolution says where the work went
    "log_progress(description='[epic-run:500] tails waiting for a milestone: the owner is asked which milestone the tails epic of the release goes to;",
    "linked_item_type='task', linked_item_id=500",
    'tails_waiting_progress_id=<its id>',
    "'; ordinary work filed in the tails epic task-<id>: <n>'",
    "'; ordinary work filed in the tails epic task-<id>: <k> of <n>, the rest not filed: a call failed'",
    'counting only the entries filed or found already filed there (k)',
    "'; ordinary work waiting for the owner's answer on its milestone: <n>, recorded in progress-<id>'",
    "'; ordinary work not filed: <n>, the tails epic could not be found or made'",
  ]) assert.ok(text.includes(part), part)
  assert.ok(!text.includes('rewording resolutions'), 'the one rewording allowed is named, not forbidden wholesale')
  const props = (await run({})).calls.find(c => c.label === 'account').opts.schema.properties
  assert.deepEqual(props.tails_waiting_progress_id, { type: ['integer', 'null'] })
})

test('epic.js: a tails epic of the release left without a milestone is a question to the person', async () => {
  const { ledger } = await run({ account: { via: 'wf-helper', actions: [], epic_closed: false, tails_epic_id: 777, tails_epic_needs_milestone: true } })
  assert.deepEqual(ledger.questions, [{ task: 777, title: 'The tails epic of the release has no milestone',
    question: 'Epic task-500 has no milestone after its release to attach the tails epic task-777 to: which milestone should it go to — the one right after the release?' }])
})

// The session is told the one action for the answer to that question, in the words task.js uses.
test('epic.js: a milestone answer for the tails epic is attached with update_task, as task.js says it', async () => {
  const MILESTONE_ANSWER = 'An answer that names a milestone for a tails epic: update_task(<that epic>, milestone_id=<that milestone>). '
  assert.ok(source('task.js').includes(MILESTONE_ANSWER), 'task.js carries the action word for word')
  const { ledger } = await run({ account: { via: 'wf-helper', actions: [], epic_closed: false, tails_epic_id: 777, tails_epic_needs_milestone: true } })
  assert.ok(ledger.questions_action.replace(/\s+/g, ' ').includes(MILESTONE_ANSWER), ledger.questions_action)
})

// The task of that question is the tails epic itself, and the release rule never closes it as CANCELLED.
test('epic.js: an answer that no work is needed never cancels the tails epic of the release', async () => {
  const { ledger } = await run({ account: { via: 'wf-helper', actions: [], epic_closed: false, tails_epic_id: 777, tails_epic_needs_milestone: true } })
  assert.ok(ledger.questions_action.replace(/\s+/g, ' ').includes(
    'An answer that no work is needed: cancel the task with the answer as its resolution — except the tails epic of the release, which is never cancelled.'),
  ledger.questions_action)
})

const TAILS_ASKED = 'The tails of the release have no milestone to go to'
const TAILS_WHY = 'Epic task-500 has ordinary work past its growth ceiling for the tails epic of the release, and no tails epic was filed: ' +
  'the epic is not in a release milestone, or the open milestone right after its release is not a release (a standing list such as ' +
  'the waiting milestone or the backlog without a date) or there is none. Which milestone should the tails go to? File there the epic ' +
  "'Tails of release <title of the release milestone>' (the title written literally) at priority 1, and under it "
const waitingAcc = id => ({ account: { via: 'wf-helper', actions: [], epic_closed: false, tails_epic_id: null,
  tails_epic_needs_milestone: true, tails_waiting_progress_id: id } })

test('epic.js: ordinary work with no tails epic filed is a question to the person, pointing at the progress entry that holds it', async () => {
  const { ledger } = await planRun(10, 4, waitingAcc(701))
  assert.deepEqual(ledger.questions.filter(q => q.title === TAILS_ASKED), [{ task: null, title: TAILS_ASKED,
    question: TAILS_WHY + 'one task per entry of progress-701 (its title, priority and description): "Review minors left on task-504".' }])
})

test('epic.js: with no progress entry recorded, the question carries the waiting work itself', async () => {
  const { ledger } = await planRun(10, 4, waitingAcc(null))
  const [asked] = ledger.questions.filter(q => q.title === TAILS_ASKED)
  assert.ok(asked.question.startsWith(TAILS_WHY + 'one task per entry below (its title and description): "Review minors left on task-504" — '),
    asked.question)
  assert.ok(asked.question.includes(ledger.tails[0].brief.slice(0, 200)), 'the description travels with the title')
})

test('epic.js: the answer to the tails question is a milestone, never a child of this epic', async () => {
  const { ledger } = await planRun(10, 4, waitingAcc(701))
  const action = ledger.questions_action.replace(/\s+/g, ' ')
  for (const part of [
    'a question with no task, other than the one about the tails of the release, gets a new child of the epic',
    "The question '" + TAILS_ASKED + "' is answered with a milestone, never with a child of this epic: in that milestone " +
      "look for the open epic titled 'Tails of release <title of the release milestone>' (written literally, never translated) — " +
      'found -> use it (several open -> the oldest, lowest id); else add_task(kind="epic", priority=1, that title, milestone_id=<that milestone>). ',
    'Under that epic file one task per entry of progress-701 (its title, priority and description), skipping an entry already filed under it.',
  ]) assert.ok(action.includes(part), part)
  const { ledger: other } = await planRun(10, 3, {
    hunt: { gaps: [NOTE] }, gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] } })
  assert.ok(!other.questions_action.includes("The question '" + TAILS_ASKED), 'said only when that question is asked')
})

test('epic.js: a tails epic of the release with its milestone asks nothing', async () => {
  const { ledger } = await run({ account: { via: 'wf-helper', actions: [], epic_closed: true, tails_epic_id: 777, tails_epic_needs_milestone: false } })
  assert.deepEqual(ledger.questions, [])
})

// ------------------------------------------------ the ceiling of ordinary work added after the plan
//
// Ordinary work — a review minor left after its fix round, a minor of a gap fix's
// review — counts toward a ceiling of max(3, floor(0.3 × plan tasks)) tasks added
// after the plan. Within it, it is a task of this epic and runs; beyond it, it is not
// run here: it is filed under the tails epic of the release, taken first after the
// push. A defect — a critical, a Blocker or Should-fix the verifier confirmed —
// never counts and is never moved.

// A plan of n tasks, 501.., each on its own file; `left` of them leave a minor open.
const planRun = (n, left, over = {}, extra = [], { noPlan = false } = {}) => {
  const ids = Array.from({ length: n }, (_, i) => 501 + i)
  const answers = {}
  for (const id of ids) {
    answers[`impl-${id}`] = { status: 'DONE', branch: `epic500/t${id}`, head_sha: 'b' + id, worktree_path: '/tmp/wt-' + id }
    answers[`rev-${id}`] = CLEAN
  }
  for (const id of ids.slice(0, left)) Object.assign(answers, { [`rev-${id}`]: { verdict: 'APPROVED', findings: [{ ...MINOR, file: 'f' + id + '.js' }] } })
  // every merge, of a wave or of a finding task, merges what its queue holds
  const mergeAll = p => ({ results: JSON.parse(/queue\.json: (\[.*\])/.exec(p)[1]).map(q => ({ id: q.id, status: 'MERGED', merge_sha: 'm' + q.id })) })
  for (let i = 0; i < 20; i++) { answers['merge-w' + i] = mergeAll; answers['merge-f' + i] = mergeAll }
  for (let id = 601; id < 620; id++) Object.assign(answers, findingRoad(id))
  const r = epicRun({ ...answers, 'create-findings': created, ...over })
  const sc = r.answers.scout
  r.answers.scout = { ...sc, ...(noPlan ? { plan_path: null } : {}), tasks: ids.map((id, i) => ({ ...sc.tasks[0], conport_id: id,
    plan_index: i + 1, title: 'plan task ' + id, files: { modify: ['f' + id + '.js'], test: [] },
    ...(noPlan ? { lines: null, coverage: 'conport_only' } : {}) })).concat(extra) }
  return runWorkflow('epic.js', noPlan ? { ...r.args, allowNoPlan: true } : r.args, r.answers)
}
// An ordinary finding task an earlier run of the epic added: a child without a plan section.
const priorChild = (id, title, coverage = 'conport_only') => ({ conport_id: id, plan_index: null, kind: 'work', title,
  lines: null, files: null, consumes: [], produces: [], deps: [], acceptance: 'x', spec_card: '', coverage })
const ordinaryOf = ledger => ledger.findings.filter(f => f.source === 'review').map(f => f.title)

// floor, not ceil: 11 plan tasks still allow 3; 13 too; 14 allow 4
for (const [n, left, ceiling] of [[10, 2, 3], [10, 3, 3], [11, 3, 3], [14, 4, 4]]) {
  test(`epic.js: ${left} ordinary findings under a ceiling of ${ceiling} (${n} plan tasks) all run in this epic`, async () => {
    const { ledger, prompt } = await planRun(n, left)
    assert.equal(ordinaryOf(ledger).length, left)
    assert.ok(ledger.findings.every(f => ledger.tasks[f.key].state === 'DONE'))
    assert.deepEqual(ledger.tails, [])
    const table = accountTable(prompt('account'))
    assert.ok(table.minors.every(m => m.parent === 500))
    assert.match(table.close_resolution, new RegExp(`; ordinary tasks added ${left} of ${ceiling}, defect fixes 0; ordinary work to the tails epic 0;`))
  })
}

for (const [n, left] of [[11, 4], [13, 4], [14, 5]]) {
  const ceiling = left - 1
  test(`epic.js: ${n} plan tasks allow ${ceiling} ordinary tasks — the ${left}th goes to the tails epic of the release`, async () => {
    const { ledger, prompt } = await planRun(n, left)
    assert.equal(ordinaryOf(ledger).length, ceiling)
    assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-' + (500 + left)])
    assert.match(accountTable(prompt('account')).close_resolution,
      new RegExp(`; ordinary tasks added ${ceiling} of ${ceiling}, defect fixes 0; ordinary work to the tails epic 1;`))
  })
}

// Without a plan the base is the children with work: the finding tasks earlier runs
// filed — a critical, a gap, an unmet criterion, ordinary work — are not plan tasks.
test('epic.js: without a plan, the finding tasks of earlier runs do not enter the base of the ceiling', async () => {
  // The briefs arrive the way the scout's contract carries them: the description verbatim,
  // the acceptance compressed (here to a word that carries no mark).
  const earlier = [
    { ...priorChild(901, 'Close the critical', 'already_done'), description: 'A confirmed critical gap of this epic, left open because it was confirmed beyond the cap of the critical-fix round; close it in this run.\nClose it.' },
    { ...priorChild(902, 'Add the carrier', 'already_done'), description: 'Add the carrier.\nThe gap: no env carrier' },
    { ...priorChild(903, 'Acceptance unmet: the export is not observed', 'already_done'), description: 'The acceptance of epic task-500 observed this criterion of its goal unmet: x' },
    { ...priorChild(904, 'Offer X to admins', 'already_done'), description: 'Held for the person: a Note is a question only the person can answer.\nQ' },
  ]
  // 10 children with work: a ceiling of 3; counted with the four above it would be 4
  const { ledger, prompt } = await planRun(10, 4, {}, earlier, { noPlan: true })
  assert.equal(ordinaryOf(ledger).length, 3)
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, /)
})

// The scout is held to carry that description: in both of its branches.
test('epic.js: the scout returns the description of every child without a plan section verbatim, in both branches', async () => {
  const rule = 'Every child without a plan section (conport_only, and already_done without one) carries description = ' +
    "that child's description VERBATIM, never compressed: by it the run knows a finding task an earlier run filed."
  assert.equal(source('epic.js').replace(/\s+/g, ' ').split(rule).length - 1, 2, 'in STEP 2 and in branch B alike')
})

// A Note's answer is ordinary work too: its task is marked by its title, takes a place
// of the ceiling in every later run, and past the ceiling the task itself moves to the
// tails epic of the release, so the readiness of this epic does not wait for it.
test('epic.js: a task made from a Note answer, marked by its title, takes a place of the ceiling in a later run', async () => {
  const { ledger } = await planRun(10, 3, {}, [priorChild(901, 'Note answer: Offer X to admins', 'already_done')])
  assert.equal(ordinaryOf(ledger).length, 2)
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-503'])
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 0, tails: 1 })
})

test('epic.js: the session is told to mark a Note answer as ordinary work and, past the ceiling, move its task to the tails epic of the release', async () => {
  const { ledger } = await planRun(10, 3, {
    hunt: { gaps: [NOTE] },
    gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
  })
  const action = ledger.questions_action.replace(/\s+/g, ' ')
  assert.ok(action.includes('ordinary tasks added 3 of ceiling 3'), action)
  for (const text of ["rename it 'Note answer: <its title>'",
    'update_task(parent_task_id=<the tails epic of the release>)',
    "'Tails of release <title of M>'", 'list_milestones(include_closed=true)',
    'when M is a release milestone (is_release=true)', 'add_task(kind="epic", priority=1,',
    'only when N is a release milestone too', 'with no tails epic found or made, ask the user which milestone the tails go to',
    'the readiness of this epic does not wait for it'])
    assert.ok(action.includes(text), text)
  assert.ok(!action.includes('Tails of release of epic'), 'no title without a release milestone')
})

test('epic.js: a tails epic the accounting already holds is named to the session by its id', async () => {
  const { ledger } = await run({
    hunt: { gaps: [NOTE] }, gapverify: { verdicts: [{ gid: 4, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
    'create-findings': created,
    account: { via: 'wf-helper', actions: [], epic_closed: false, tails_epic_id: 777, tails_epic_needs_milestone: false },
  })
  const action = ledger.questions_action.replace(/\s+/g, ' ')
  assert.ok(action.includes('the tails epic of the release is task-777'), action)
  assert.ok(!action.includes('list_milestones'), 'nothing to look up')
})

test('epic.js: one ordinary finding above the ceiling is not run here — it goes to the tails epic of the release', async () => {
  const { ledger, calls, prompt } = await planRun(10, 4)
  assert.deepEqual(ordinaryOf(ledger), ['Review minors left on task-501', 'Review minors left on task-502', 'Review minors left on task-503'])
  assert.deepEqual(missingOf(prompt('create-findings')).map(m => m.title), ordinaryOf(ledger), 'the overflow is not created in the epic')
  assert.equal(calls.filter(c => /^impl-6/.test(c.label)).length, 3)
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-504'])
  assert.deepEqual(ledger.minors, [], 'not a ledger line either')
  const table = accountTable(prompt('account'))
  const tail = table.minors.find(m => m.title === 'Review minors left on task-504')
  assert.equal(tail.parent, undefined, 'no parent: the accountant files it under the tails epic')
  assert.ok(tail.description.includes('f504.js:9 — a nit'), tail.description)
  assert.equal(table.may_close, true, 'the tails epic does not hold this epic open')
  assert.match(table.close_resolution, /; ordinary tasks added 3 of 3, defect fixes 0; ordinary work to the tails epic 1;/)
})

test('epic.js: defects never count toward the ceiling and are never moved to the tails epic', async () => {
  const gaps = [{ ...SHOULD_FIX, gid: 2 }, { ...SHOULD_FIX, gid: 5, min_action: { title: 'Another carrier' } }, BLOCKER]
  const { ledger, prompt } = await planRun(10, 3, {
    hunt: { gaps }, gapverify: { verdicts: [critical(1),
      { gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }, { gid: 5, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
  })
  assert.equal(ordinaryOf(ledger).length, 3)
  assert.deepEqual(ledger.findings.filter(f => f.source !== 'review').map(f => f.source).sort(), ['critical', 'gap', 'gap'])
  assert.deepEqual(ledger.tails, [])
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, defect fixes 3; ordinary work to the tails epic 0;/)
})

test('epic.js: the ordinary tasks an earlier run added use the ceiling too; the same finding again takes no new slot', async () => {
  const prior = [priorChild(900, 'Review minors left on task-800', 'already_done'), priorChild(901, 'Review minors left on task-503')]
  const { ledger, prompt } = await planRun(10, 3, {}, prior)
  // two slots used before the run; task-503's minors reuse their child of the earlier run
  assert.deepEqual(ordinaryOf(ledger), ['Review minors left on task-501', 'Review minors left on task-503'])
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-502'])
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, /)
})

// New scope is ordinary work as well: a child added to the epic by hand, with no plan
// section and none of the words a run writes into a defect, took a place of the ceiling.
test('epic.js: a child added by hand without a plan section takes a place of the ceiling', async () => {
  const { ledger, prompt } = await planRun(10, 3, {}, [priorChild(901, 'Rename the export flag')])
  assert.deepEqual(ordinaryOf(ledger), ['Review minors left on task-501', 'Review minors left on task-502'])
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-503'])
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 0, tails: 1 })
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, /)
})

// One place is left, the boundary: a hand-added child done already counts the same way.
test('epic.js: a closed child added by hand counts too — one place is left under the ceiling', async () => {
  const { ledger } = await planRun(10, 2, {}, [priorChild(901, 'Rename the export flag', 'already_done')])
  assert.deepEqual(ordinaryOf(ledger), ['Review minors left on task-501', 'Review minors left on task-502'])
  assert.deepEqual(ledger.tails, [])
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 0, tails: 0 })
})

// A child an earlier run filed for a defect — a critical, a gap, an unmet criterion, a
// gap held for the person — is no ordinary work: with a plan it takes no place either.
test('epic.js: with a plan, the defect children of earlier runs take no place of the ceiling', async () => {
  const earlier = [
    { ...priorChild(901, 'Close the critical'), description: 'A confirmed critical gap of this epic, left open because it was confirmed beyond the cap of the critical-fix round; close it in this run.\nClose it.' },
    { ...priorChild(902, 'Add the carrier', 'already_done'), description: 'Add the carrier.\nThe gap: no env carrier' },
    { ...priorChild(903, 'Acceptance unmet: the export is not observed'), description: 'The acceptance of epic task-500 observed this criterion of its goal unmet: x' },
    { ...priorChild(904, 'Offer X to admins'), description: 'Held for the person: a Note is a question only the person can answer.\nOffer X to admins.\nThe gap: X is not offered' },
  ]
  const { ledger } = await planRun(10, 3, {}, earlier)
  assert.equal(ordinaryOf(ledger).length, 3)
  assert.deepEqual(ledger.tails, [])
  // the three defect fixes count; the child still held for the person is no fix yet
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 3, tails: 0 })
})

// A defect filed by hand is known by the mark a run writes, at the start of its
// description: it takes no place, as a defect of a run does not.
test('epic.js: a child filed by hand whose description starts with the gap mark is a defect and takes no place', async () => {
  const { ledger } = await planRun(10, 3, {}, [{ ...priorChild(901, 'Fix the export header'),
    description: 'The gap: the export drops the header\nSeen in the nightly export.' }])
  assert.equal(ordinaryOf(ledger).length, 3)
  assert.deepEqual(ledger.tails, [])
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 1, tails: 0 })
})

// The defect fixes are counted over the whole epic, as the ordinary tasks are: every
// child the words of a defect mark, open or closed, and the defects of this run. A run
// that finds nothing new still names the defect children an earlier run filed.
const CRITICAL_CHILD = 'A confirmed critical gap of this epic, left open because it was confirmed beyond the cap of the critical-fix round; close it in this run.\nClose it.'
test('epic.js: a later run with no new finding still names the open defect children of an earlier run as defect fixes', async () => {
  const earlier = [
    { ...priorChild(901, 'Close the critical'), description: CRITICAL_CHILD },
    { ...priorChild(902, 'Fix the export header'), description: 'The gap: the export drops the header' },
  ]
  const { ledger, prompt } = await planRun(10, 0, {}, earlier)
  assert.deepEqual(ledger.findings, [])
  assert.deepEqual(ledger.growth, { ordinary: 0, ceiling: 3, defects: 2, tails: 0 })
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 0 of 3, defect fixes 2; ordinary work to the tails epic 0;/)
})

test("epic.js: the defect fixes are the earlier run's defect children plus this run's defects", async () => {
  const gaps = [{ ...SHOULD_FIX, gid: 2 }, { ...SHOULD_FIX, gid: 5, min_action: { title: 'Another carrier' } }, BLOCKER]
  const { ledger, prompt } = await planRun(10, 3, {
    hunt: { gaps }, gapverify: { verdicts: [critical(1),
      { gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }, { gid: 5, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] },
  }, [{ ...priorChild(901, 'Fix the export header', 'already_done'), description: 'The gap: the export drops the header' }])
  assert.equal(ledger.growth.defects, 4)
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, defect fixes 4; ordinary work to the tails epic 0;/)
})

// A defect reported again reuses its open child of the earlier run, settled by title:
// one child, one fix. A closed child is taken, so the same defect again gets a twin
// titled '(2)' — a second child, a second fix.
test('epic.js: a defect this run reports again with the title of an open defect child is one defect fix, not two', async () => {
  const child = { ...priorChild(901, SHOULD_FIX.min_action.title), description: 'The gap: no env carrier' }
  const verify = { hunt: { gaps: [SHOULD_FIX] }, gapverify: { verdicts: [{ gid: 2, verdict: 'CONFIRMED', severity_final: 'minor', proof: 'seen' }] } }
  const open = await planRun(10, 0, verify, [child])
  assert.deepEqual(open.ledger.findings.map(f => f.title), [SHOULD_FIX.min_action.title], 'the same title: its child is reused')
  assert.equal(open.ledger.growth.defects, 1)
  const closed = await planRun(10, 0, verify, [{ ...child, coverage: 'already_done' }])
  assert.deepEqual(closed.ledger.findings.map(f => f.title), [SHOULD_FIX.min_action.title + ' (2)'])
  assert.equal(closed.ledger.growth.defects, 2)
})

// The boundary of a child held for the person: while it waits it is no fix, as a held
// finding of this run is not; once closed it counts like any other defect child.
test('epic.js: a held child counts as a defect fix once it no longer waits for the person', async () => {
  const held = 'Held for the person: the verifier could not confirm this finding by observation.\nAdd the carrier.\nThe gap: no env carrier'
  const waiting = await planRun(10, 0, {}, [{ ...priorChild(901, 'Add the carrier'), description: held }])
  assert.deepEqual(waiting.ledger.waiting_for_person.map(w => w.id), [901])
  assert.equal(waiting.ledger.growth.defects, 0)
  const closed = await planRun(10, 0, {}, [{ ...priorChild(901, 'Add the carrier', 'already_done'), description: held }])
  assert.deepEqual(closed.ledger.waiting_for_person, [])
  assert.equal(closed.ledger.growth.defects, 1)
})

// The ordinary prefixes are read from the first line of the description as well: without
// a plan such a child is no part of the base but a place taken.
test('epic.js: without a plan, a child whose description starts with an ordinary prefix takes a place', async () => {
  const { ledger } = await planRun(10, 3, {}, [{ ...priorChild(901, 'Tidy the names'),
    description: 'Review minors left on task-800\n- a.js — a nit' }], { noPlan: true })
  assert.equal(ordinaryOf(ledger).length, 2)
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-503'])
})

// An ordinary title always takes a place, an open one bound to a plan section too —
// the way the helper of /conport:task counts it.
test('epic.js: an open child with an ordinary title and a plan section takes a place of the ceiling', async () => {
  const bound = { ...priorChild(901, 'Note answer: Offer X to admins', 'both'), plan_index: 11, lines: { from: 1, to: 2 },
    files: { modify: ['f901.js'], test: [] } }
  const { ledger } = await planRun(10, 3, findingRoad(901), [bound])
  assert.equal(ledger.tasks['901'].state, 'DONE', 'it runs as a plan task')
  assert.equal(ordinaryOf(ledger).length, 2)
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-503'])
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 0, tails: 1 })
})

// A defect a plan section binds — the Orca plugin ties every unfiled finding to a section,
// defects included — is no plan task either: ten plan tasks and four tied defects keep a
// ceiling of 3, so the fourth ordinary task goes to the tails epic of the release, as the
// helper of /conport:task counts it.
test('epic.js: defects tied to a plan section stay out of the base — plan 10 and 4 tied defects, the 4th ordinary task goes to the tails epic', async () => {
  const tied = (id, title, coverage, description, i) => ({ ...priorChild(id, title, coverage), plan_index: 11 + i,
    lines: { from: 1, to: 2 }, files: { modify: ['f' + id + '.js'], test: [] }, description })
  const defects = [
    tied(901, 'Close the critical', 'both', 'A confirmed critical gap of this epic, left open because it was confirmed beyond the cap of the critical-fix round; close it in this run.\nClose it.', 0),
    tied(902, 'Add the carrier', 'both', 'Add the carrier.\nThe gap: no env carrier', 1),
    tied(903, 'Acceptance unmet: the export is not observed', 'already_done', 'The acceptance of epic task-500 observed this criterion of its goal unmet: x', 2),
    tied(904, 'Fix the export header', 'already_done', 'The gap: the export drops the header\nSeen in the nightly export.', 3),
  ]
  const { ledger, prompt } = await planRun(10, 4, { ...findingRoad(901), ...findingRoad(902) }, defects)
  assert.equal(ledger.tasks['901'].state, 'DONE', 'a tied defect runs as a plan task')
  assert.deepEqual(ordinaryOf(ledger), ['Review minors left on task-501', 'Review minors left on task-502', 'Review minors left on task-503'])
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on task-504'])
  // the four tied defects are defect fixes of the epic, counted once each
  assert.deepEqual(ledger.growth, { ordinary: 3, ceiling: 3, defects: 4, tails: 1 })
  assert.match(accountTable(prompt('account')).close_resolution, /; ordinary tasks added 3 of 3, defect fixes 4; ordinary work to the tails epic 1;/)
})

// The marks of a tied defect sit in its child's description, which the compressed
// acceptance of its plan section may lose: the scout carries that description too.
test('epic.js: the scout returns the description of a defect a plan section binds verbatim, in both branches', async () => {
  const rule = 'A child a plan section binds whose description a run wrote for a defect — it ' +
    "starts with 'A confirmed critical gap of this epic' or 'Held for the person:', or a " +
    "line of it starts with 'The gap: ' — carries that description VERBATIM as well: by " +
    'it the run keeps a defect out of the plan tasks its ceiling is measured against.'
  assert.equal(source('epic.js').replace(/\s+/g, ' ').split(rule).length - 1, 2, 'in STEP 2 and in branch B alike')
})

test('epic.js: a minor of a gap fix review is ordinary work and counts toward the ceiling', async () => {
  const { ledger } = await planRun(10, 3, {
    hunt: { gaps: [BLOCKER] }, gapverify: { verdicts: [critical(1)] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': { verdict: 'APPROVED', findings: [MINOR] },
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  assert.deepEqual(ledger.tails.map(t => t.title), ['Review minors left on the fix of gap 1'])
})
