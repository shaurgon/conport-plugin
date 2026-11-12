import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'
import { source } from './fenced-region.mjs'

// A run takes every task it executes through the review cycle of the server: the
// brief, the implementer's report and REVIEW, the reviewer's verdict, a return
// and a fix when changes are requested, and the close from REVIEW. Each step is
// one `cycle` command of the helper; these tests run both workflows end to end
// with a stand-in for the agents and read the step files the run handed over.

const STEP_FILE = /<<<BEGIN step\.json — [^\n]*>>>\n([^\n]*)\n<<<END step\.json>>>/

// A stand-in for the helper's cycle command: it reads the quoted step file and
// answers with every write landed — or, for the labels in `refuse`, refused.
const helper = (refuse = []) => {
  const steps = []
  const answer = (prompt, opts) => {
    const m = STEP_FILE.exec(prompt)
    assert.ok(m, `${opts.label}: the step file is not quoted in the prompt`)
    assert.ok(prompt.includes('node <helper> cycle --step <tmp>/step.json'), `${opts.label}: not a cycle command`)
    const s = JSON.parse(m[1])
    steps.push({ label: opts.label, ...s })
    const result = refuse.includes(opts.label) ? 'failed' : 'done'
    return { via: 'wf-helper', task: s.task_id, step: s.step, failed_calls: [],
      actions: [{ step: s.step, target: s.task_id, result, detail: result === 'done' ? 'written' : 'review_needs_report: refused' }] }
  }
  return { steps, answer }
}

// Every label of a cycle step starts with "j-"; the rest of the answers stay as given.
const withHelper = (answers, h) =>
  new Proxy(answers, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && k.startsWith('j-') ? h.answer : undefined)) })

const go = async (file, { args, answers }, h = helper()) => {
  const r = await runWorkflow(file, args, withHelper(answers, h))
  return { ...r, steps: h.steps, labels: r.calls.map(c => c.label) }
}

// The labels in the order the run called them, restricted to the given ones.
const order = (labels, wanted) => labels.filter(l => wanted.includes(l))
const brief = s => ({ label: s.label, step: s.step, task: s.task_id, ...(s.verdict ? { verdict: s.verdict } : {}) })

const IMPORTANT = { severity: 'IMPORTANT', file: 'a.js', line: 3, what: 'drops the guard', fix: 'restore it' }
const MINOR = { severity: 'MINOR', file: 'a.js', line: 9, what: 'a nit' }
const FIXED = { status: 'DONE', head_sha: 'eee4', per_finding: [{ idx: 0, action: 'FIXED' }] }
const CLEAN = { verdict: 'APPROVED', findings: [] }
const accountTable = prompt => JSON.parse(/TABLE: (.*)\n/.exec(prompt)[1])

// ------------------------------------------------------------------ task.js

test('task.js: a clean run writes brief, report and REVIEW, an approval, then closes', async () => {
  const { ledger, steps, labels, prompt } = await go('task.js', taskRun())
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(brief), [
    { label: 'j-brief', step: 'brief', task: 7 },
    { label: 'j-report', step: 'report', task: 7 },
    { label: 'j-review', step: 'review', task: 7, verdict: 'approve' },
  ])
  assert.deepEqual(order(labels, ['j-brief', 'impl', 'j-report', 'rev', 'j-review', 'merge', 'account']),
    ['j-brief', 'impl', 'j-report', 'rev', 'j-review', 'merge', 'account'])
  assert.ok(steps.every(s => s.project === 'prk7m2qx9d' && !('project_id' in s)))
  assert.deepEqual(steps[1].result, taskRun().answers.impl, 'the report is the implementer\'s own result')
  assert.deepEqual(steps[2].result, taskRun().answers.rev, 'the review is the reviewer\'s own result')
  assert.match(steps[0].body, /task-7 "the thing"/)
  assert.match(steps[0].body, /Acceptance: accept/)
  // the dispatch is the task and how to read its journal, never the task's text
  for (const label of ['impl', 'rev']) {
    assert.ok(prompt(label).includes('Your task is task-7; its brief is in the task\'s ConPort journal.'), label)
    assert.ok(prompt(label).includes('get_task_journal_entry(task_id=7, kind="brief")'), label)
    for (const text of ['<<<BEGIN task description', '<<<BEGIN spec digest', '<<<BEGIN global constraints', 'Acceptance: accept'])
      assert.ok(!prompt(label).includes(text), `${label}: ${text}`)
  }
  assert.ok(prompt('impl').includes('git checkout -b task/t7 '))
  assert.equal(accountTable(prompt('account')).close.id, 7, 'the close is the accounting step, as before')
  assert.ok(ledger.journal.every(j => j.ok), 'the ledger names each step and its outcome')
})

test('task.js: changes requested -> return, fix, REVIEW, re-review, then the close', async () => {
  const { ledger, steps, labels } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: CLEAN,
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(brief), [
    { label: 'j-brief', step: 'brief', task: 7 },
    { label: 'j-report', step: 'report', task: 7 },
    { label: 'j-review', step: 'review', task: 7, verdict: 'changes_requested' },
    { label: 'j-brief-fix', step: 'brief', task: 7 },
    { label: 'j-fix', step: 'fix', task: 7 },
    { label: 'j-brief-rereview', step: 'brief', task: 7 },
    { label: 'j-review2', step: 'review', task: 7, verdict: 'approve' },
  ])
  const wanted = ['j-review', 'j-brief-fix', 'fix', 'j-fix', 'j-brief-rereview', 'rev2', 'j-review2', 'merge']
  assert.deepEqual(order(labels, wanted), wanted)
  assert.deepEqual(steps[4].result, FIXED, 'the fix entry is the fixer\'s own result')
  assert.match(steps[6].note, /re-review/i)
})

test('task.js: a minor finding alone requests changes too — the fix entry and the re-review are recorded', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [MINOR] }, fix: FIXED, rev2: CLEAN,
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'report', 'changes_requested', 'brief', 'fix', 'brief', 'approve'])
})

// A minor the fix round leaves open does not hold the merge, but the journal says
// so: a fix entry and an approving review of the run's own name the open minors
// and where they went, so the task leaves REVIEW with its findings on record.
for (const [file, run, k, over] of [
  ['task.js', taskRun, '', { rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null }],
  ['epic.js', epicRun, '-501', { 'rev-501': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-501': null, 'fix-501-r2': null }],
]) {
  test(`${file}: a minor left open after a dead fixer is journalled changes_requested, then carried with a fix and an approval`, async () => {
    const { ledger, steps } = await go(file, run(over))
    assert.deepEqual(steps.filter(s => s.step !== 'brief').map(s => [s.label, s.verdict ?? s.step]), [
      ['j-report' + k, 'report'], ['j-review' + k, 'changes_requested'],
      ['j-carry-fix' + k, 'fix'], ['j-carry-review' + k, 'approve']])
    const carriedFix = steps.find(s => s.label === 'j-carry-fix' + k).body
    assert.match(carriedFix, /^Fix report: the review findings below are left open after the fix round and carried on — /)
    assert.ok(carriedFix.includes('- [MINOR] a.js:9 — a nit'), carriedFix)
    assert.match(steps.find(s => s.label === 'j-carry-review' + k).body, /^Verdict: approve — the run accepts the task with its open review findings carried on: /)
    assert.ok(ledger.journal.every(j => j.ok))
  })

  test(`${file}: a minor the re-review still finds is journalled changes_requested, then carried`, async () => {
    const r = file === 'task.js'
      ? { rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: FIXED, rev2: { verdict: 'APPROVED', findings: [MINOR] } }
      : { 'rev-501': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-501': FIXED, 'rev2-501': { verdict: 'APPROVED', findings: [MINOR] } }
    const { steps } = await go(file, run(r))
    assert.deepEqual(steps.filter(s => s.step !== 'brief').map(s => [s.label, s.verdict ?? s.step]), [
      ['j-report' + k, 'report'], ['j-review' + k, 'changes_requested'], ['j-fix' + k, 'fix'],
      ['j-review2' + k, 'changes_requested'], ['j-carry-fix' + k, 'fix'], ['j-carry-review' + k, 'approve']])
  })
}

test('epic.js: the carry of a plan task names the findings round of the epic', async () => {
  const { steps } = await go('epic.js', epicRun({ 'rev-501': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-501': null, 'fix-501-r2': null }))
  assert.ok(steps.find(s => s.label === 'j-carry-fix-501').body.includes(
    'they become a task of this epic: in its findings round, or at its accounting when that round could not file them'))
})

// No finding is left as a line: a minor task.js leaves open becomes a follow-up
// task — the umbrella task the accounting files — without any argument asking for it.
// A task with no epic has no release milestone (only an epic carries one): the follow-up
// task waits in a progress entry until the person names the milestone of the tails.
test('task.js: a minor left open by a task with no epic becomes a follow-up task waiting for the milestone, and the carry says so', async () => {
  const { steps, prompt } = await go('task.js', taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null }))
  assert.ok(steps.find(s => s.label === 'j-carry-fix').body.includes(
    "the task has no epic, so no release milestone: they become one follow-up task, waiting in a progress entry for the owner's answer on its milestone"))
  const table = accountTable(prompt('account'))
  assert.ok(table.minors_umbrella, 'the umbrella is filed without fileMinors')
  assert.equal(table.minors_umbrella.title, 'Review minors left on task-7', 'the title an epic run counts as ordinary work')
  assert.equal(table.minors_umbrella.parent, undefined, 'no epic: no release milestone')
  assert.equal(table.minors_umbrella.task, 7, 'the waiting entry is marked and linked by the task')
  assert.ok(table.minors_umbrella.description.includes('a.js:9'), table.minors_umbrella.description)
  assert.match(table.close.resolution, /; 1 review minor\(s\) left open, for one follow-up task$/, 'the accountant names where it went: filed only when filed')
  const flat = prompt('account').replace(/\s+/g, ' ')
  assert.ok(!flat.includes('Workflow run tails'), 'the old tails epic is gone from branch B')
  assert.ok(flat.includes('1) MINORS (one umbrella, never scattered tasks): task-7 has no epic, so no release milestone'), flat)
  assert.ok(!flat.includes('get_task(7) -> its milestone M'), 'no release is looked up by a task')
  assert.ok(!flat.includes("'Tails of release <title of M>'"), 'branch B looks for no tails epic without an epic')
  for (const text of ['tails_epic_id=null and tails_epic_needs_milestone=true', "'[task-run:7] tails waiting for a milestone: ",
    "linked_item_type='task', linked_item_id=7", 'tails_waiting_progress_id=<its id>'])
    assert.ok(flat.includes(text), text)
})

// No tails epic was filed because there is no release at all: the
// umbrella waits in a progress entry, and the owner is asked which milestone the tails go to.
test('task.js: review minors waiting for a milestone are handed to the session as the tails question', async () => {
  const { ledger } = await go('task.js', taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null,
    account: { via: 'wf-helper', actions: [], task_closed: true, tails_epic_id: null, tails_epic_needs_milestone: true, tails_waiting_progress_id: 88 } }))
  const q = ledger.questions.find(x => x.title === 'The tails of the release have no milestone to go to')
  assert.ok(q, JSON.stringify(ledger.questions))
  assert.equal(q.task, null)
  assert.ok(q.question.includes('progress-88'), q.question)
  assert.ok(q.question.includes('no tails epic of the release was filed: a task with no epic has no release milestone, or the epic is not in a release milestone.'), q.question)
  assert.ok(q.question.includes("'Tails of release <title of the release milestone>'"), q.question)
  const action = ledger.questions_action.replace(/\s+/g, ' ')
  assert.ok(action.includes('is answered with a milestone'), action)
  assert.ok(action.includes('priority=1'), action)
})

// With no progress entry recorded, the question itself carries the minors left open,
// as epic.js carries its tails entries with their descriptions.
test('task.js: the tails question lists the minors left open when no progress entry was recorded', async () => {
  const { ledger } = await go('task.js', taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null,
    account: { via: 'wf-helper', actions: [], task_closed: true, tails_epic_id: null, tails_epic_needs_milestone: true, tails_waiting_progress_id: null } }))
  const q = ledger.questions.find(x => x.title === 'The tails of the release have no milestone to go to')
  assert.ok(q, JSON.stringify(ledger.questions))
  assert.ok(!q.question.includes('progress-'), q.question)
  assert.ok(q.question.includes("'Review minors left on task-7' with these minors (its description): - a.js:9 — a nit"), q.question)
})

// The branch B accountant files the umbrella first and names in the close where it went;
// the tails epic follows the release rule of the epic accountant.
test('task.js: branch B files the umbrella before the close and follows the release rule for the tails epic', async () => {
  const run = taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null })
  run.answers.scout = { ...run.answers.scout, task: { ...run.answers.scout.task, parent_epic_id: 40 } }
  const { prompt } = await go('task.js', run)
  const flat = prompt('account').replace(/\s+/g, ' ')
  assert.ok(flat.indexOf('1) MINORS') < flat.indexOf('2) CLOSE') && flat.indexOf('2) CLOSE') < flat.indexOf('3) BLOCK'), 'minors, close, block')
  for (const text of ['(is_release=true)', 'priority=1', "'[task-run:7] tails waiting for a milestone: ", 'tails_waiting_progress_id',
    "'; <n> review minor(s) left open, for one follow-up task'", "filed as task-<id> in the tails epic task-<tails epic>",
    "waiting for the owner's answer on their milestone, recorded in progress-<id>"])
    assert.ok(flat.includes(text), text)
  assert.ok(!flat.includes('Tails of release of epic task-'), 'no tails epic without a release')
})

// A tails epic of the release with no milestone to attach it to is a question to the person.
test('task.js: a tails epic of the release without a milestone is handed to the session as a question', async () => {
  const { ledger } = await go('task.js', taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null,
    account: { via: 'wf-helper', actions: [], task_closed: true, tails_epic_id: 777, tails_epic_needs_milestone: true } }))
  assert.deepEqual(ledger.questions, [{ task: 777, title: 'The tails epic of the release has no milestone',
    question: 'Task-7 has no milestone after its release to attach the tails epic task-777 to: which milestone should it go to — the one right after the release?' }])
  assert.match(ledger.questions_action, /^questions holds what only the user can settle/)
})

// What a reviewer could not verify from the diff alone is not left in the journal
// only: the run hands it to the session as a question, and the answer is a task.
test('task.js: what a review could not verify is handed to the session as a question to ask', async () => {
  const { ledger } = await go('task.js', taskRun({
    rev: { verdict: 'APPROVED', findings: [MINOR], unverifiable: ['the caller in b.js'] }, fix: FIXED,
    rev2: { verdict: 'APPROVED', findings: [], unverifiable: ['the caller in b.js', 'the cache of c.js'] } }))
  const ask = item => ({ task: 7, title: 'Not verified by the review of task-7',
    question: 'The reviewer could not verify this from the diff alone — is it real, and what closes it? ' + item })
  assert.deepEqual(ledger.questions, [ask('the caller in b.js'), ask('the cache of c.js')], 'every review, each item once')
  assert.match(ledger.questions_action, /^questions holds what only the user can settle/)
})

test('task.js: a run whose reviews verified everything asks nothing', async () => {
  const { ledger } = await go('task.js', taskRun())
  assert.deepEqual(ledger.questions, [])
  assert.equal(ledger.questions_action, null)
})

test('task.js: the reviewer is told where a minor left open goes — the epic of the task, or a follow-up task waiting for its milestone without one', async () => {
  const own = taskRun()
  own.answers.scout = { ...own.answers.scout, task: { ...own.answers.scout.task, parent_epic_id: 40 } }
  const flat = s => s.replace(/\s+/g, ' ')
  assert.ok(flat((await go('task.js', own)).prompt('rev')).includes(
    'becomes a task of epic task-40 (beyond its ceiling of work added after the plan, of the tails epic of the release)'))
  assert.ok(flat((await go('task.js', taskRun())).prompt('rev')).includes(
    'becomes a follow-up task waiting for the person to name its milestone (a task with no epic has no release milestone)'))
})

// A task of an epic: its leftover minor is a finding of that epic, filed under it.
test('task.js: a minor left open by a task of an epic becomes a task of that epic, and the carry says so', async () => {
  const run = taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null })
  run.answers.scout = { ...run.answers.scout, task: { ...run.answers.scout.task, parent_epic_id: 40 } }
  const { steps, prompt } = await go('task.js', run)
  assert.ok(steps.find(s => s.label === 'j-carry-fix').body.includes(
    'they become one task of epic task-40, filed by this run — beyond its ceiling of work added after the plan, a task of the tails epic of the release'))
  const table = accountTable(prompt('account'))
  assert.equal(table.minors_umbrella.parent, 40)
  assert.equal(table.minors_umbrella.title, 'Review minors left on task-7')
  assert.match(table.close.resolution, /; 1 review minor\(s\) left open, for one follow-up task$/)
  const flat = prompt('account').replace(/\s+/g, ' ')
  assert.ok(flat.includes('minors_umbrella.parent'), 'branch B is told where the umbrella goes')
  for (const text of ["kind='task'", 'epic_growth_ceiling', "'Tails of release <title of M>'"])
    assert.ok(flat.includes(text), 'branch B follows the server refusal: ' + text)

})



test('task.js: a run with no minor left files no follow-up task', async () => {
  const { prompt } = await go('task.js', taskRun())
  assert.equal(accountTable(prompt('account')).minors_umbrella, null)
})

test('task.js: a re-review that still finds a serious defect requests changes again and the run fails', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] },
  }))
  assert.equal(ledger.fail_reason, 'RED_AFTER_FIX')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step),
    ['brief', 'report', 'changes_requested', 'brief', 'fix', 'brief', 'changes_requested'])
})

test('task.js: a failed fix of a serious finding writes no fix entry', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: { status: 'BLOCKED', head_sha: 'x' },
  }))
  assert.equal(ledger.fail_reason, 'FIX_FAILED')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'report', 'changes_requested', 'brief'])
})

test('task.js: an implementer that does not finish leaves a brief and no report', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    impl: { status: 'BLOCKED', branch: 'task/t7', head_sha: 'b', worktree_path: '/tmp/wt-7', concerns: ['fork'] },
  }))
  assert.equal(ledger.fail_reason, 'BLOCKED')
  assert.deepEqual(steps.map(s => s.step), ['brief'])
})

test('task.js: the review after a rebase is recorded too', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb': CLEAN,
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.equal(ledger.outcome, 'MERGED')
  const last = steps.at(-1)
  assert.deepEqual([last.label, last.verdict], ['j-review-rb', 'approve'])
  assert.match(last.note, /rebase/i)
})

test('task.js: a step that does not land stops the journal of the task; the run itself goes on', async () => {
  const { ledger, steps, labels } = await go('task.js', taskRun(), helper(['j-report']))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(s => s.label), ['j-brief', 'j-report'], 'no review is written for a task that never reached REVIEW')
  assert.ok(!labels.includes('j-review'), 'the skipped step costs no agent call')
  assert.deepEqual(ledger.journal.map(j => [j.label, j.ok, !!j.skipped]),
    [['j-brief', true, false], ['j-report', false, false], ['j-review', false, true]])
})

test('task.js: a helper that answers nothing for the brief aborts before any agent works', async () => {
  const { args, answers } = taskRun()
  const { ledger, calls } = await runWorkflow('task.js', args, { ...answers, 'j-*': null })
  assert.equal(ledger.abort_reason, 'ABORTED_NO_BRIEF')
  assert.deepEqual(calls.filter(c => c.label.startsWith('j-')).map(c => c.label), ['j-brief'])
  assert.ok(!calls.some(c => c.label.startsWith('impl')), 'no implementer without its brief')
})

// Every agent reads its brief from the journal: a brief that did not land stops
// the dispatch it was written for.
test('task.js: a brief that does not land aborts the run before the implementer, naming the one action', async () => {
  const { ledger, steps, labels } = await go('task.js', taskRun(), helper(['j-brief']))
  assert.equal(ledger.outcome, 'ABORTED')
  assert.equal(ledger.abort_reason, 'ABORTED_NO_BRIEF')
  assert.match(ledger.abort_detail, /brief did not reach the task journal .*run again/)
  assert.deepEqual(steps.map(s => s.label), ['j-brief'])
  assert.ok(!labels.some(l => l.startsWith('impl') || l === 'account'), 'nothing is dispatched or accounted')
})

test('task.js: a fix brief that does not land dispatches no fixer and fails the run with its own reason', async () => {
  const { ledger, labels } = await go('task.js', taskRun({ rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED }),
    helper(['j-brief-fix']))
  assert.equal(ledger.fail_reason, 'BRIEF_NOT_WRITTEN')
  assert.equal(ledger.fail_detail, 'j-brief-fix')
  assert.ok(!labels.includes('fix'), 'no fixer without its brief')
})

test('task.js: a re-review brief that does not land dispatches no re-reviewer', async () => {
  const { ledger, labels } = await go('task.js', taskRun({ rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: CLEAN }),
    helper(['j-brief-rereview']))
  assert.equal(ledger.fail_reason, 'BRIEF_NOT_WRITTEN')
  assert.ok(!labels.includes('rev2'))
})

test('task.js: the questions of NEEDS_CONTEXT go into a new brief before the second implementer', async () => {
  const asked = { status: 'NEEDS_CONTEXT', branch: 'task/t7', head_sha: 'b', worktree_path: '/tmp/wt-7', questions: ['which table?'] }
  const { ledger, steps, labels, prompt } = await go('task.js', taskRun({ impl: asked, 'impl-ctx': taskRun().answers.impl }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(order(labels, ['impl', 'j-brief-ctx', 'impl-ctx']), ['impl', 'j-brief-ctx', 'impl-ctx'])
  const ctx = steps.find(s => s.label === 'j-brief-ctx')
  assert.ok(ctx.body.includes('["which table?"]') && ctx.body.includes('Acceptance: accept'), 'the whole brief plus the questions')
  assert.ok(!prompt('impl-ctx').includes('which table?'))
})

test('task.js: NEEDS_CONTEXT whose new brief does not land fails with BRIEF_NOT_WRITTEN and dispatches no second implementer', async () => {
  const asked = { status: 'NEEDS_CONTEXT', branch: 'task/t7', head_sha: 'b', worktree_path: '/tmp/wt-7', questions: ['q'] }
  const { ledger, labels } = await go('task.js', taskRun({ impl: asked }), helper(['j-brief-ctx']))
  assert.deepEqual([ledger.fail_reason, ledger.fail_detail], ['BRIEF_NOT_WRITTEN', 'j-brief-ctx'])
  assert.ok(!labels.includes('impl-ctx'))
})

// A conflict at the merge: the rebaser reads a brief of its own, the rebase
// assignment, and its reviewer the conflicted files — each written first.
const taskConflict = over => taskRun({
  merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
  rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
  'rev-rb': CLEAN,
  'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  ...over,
})

test('task.js: the rebaser is dispatched on a rebase brief of its own, not on the latest fix brief', async () => {
  const { ledger, steps, labels } = await go('task.js', taskConflict({
    rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: FIXED, rev2: CLEAN }))
  assert.equal(ledger.outcome, 'MERGED')
  const briefsBefore = steps.slice(0, steps.findIndex(s => s.label === 'j-brief-rebase') + 1).filter(s => s.step === 'brief')
  assert.equal(briefsBefore.at(-1).label, 'j-brief-rebase')
  const rb = briefsBefore.at(-1).body
  assert.match(rb, /=== REBASE: the branch task\/t7 conflicts with main ===/)
  assert.match(rb, /semantic_choice=true/)
  assert.ok(!rb.includes('REVIEW FINDINGS TO FIX'), 'the rebase brief is not the fix brief')
  assert.deepEqual(order(labels, ['j-brief-rebase', 'rebase', 'j-brief-rb', 'rev-rb']), ['j-brief-rebase', 'rebase', 'j-brief-rb', 'rev-rb'])
})

test('task.js: a rebase brief that does not land dispatches no rebaser and fails with BRIEF_NOT_WRITTEN', async () => {
  const { ledger, labels } = await go('task.js', taskConflict(), helper(['j-brief-rebase']))
  assert.deepEqual([ledger.fail_reason, ledger.fail_detail], ['BRIEF_NOT_WRITTEN', 'j-brief-rebase'])
  assert.ok(!labels.includes('rebase') && !labels.includes('rev-rb'))
})

test('task.js: a brief for the review after the rebase that does not land fails with BRIEF_NOT_WRITTEN, not MERGE_CONFLICT', async () => {
  const { ledger, labels } = await go('task.js', taskConflict(), helper(['j-brief-rb']))
  assert.deepEqual([ledger.fail_reason, ledger.fail_detail], ['BRIEF_NOT_WRITTEN', 'j-brief-rb'])
  assert.ok(labels.includes('rebase') && !labels.includes('rev-rb'))
})

test('task.js: a rebase that fails is still MERGE_CONFLICT', async () => {
  const { ledger, labels } = await go('task.js', taskConflict({ rebase: { status: 'BLOCKED', head_sha: 'b', conflict_files: ['a.js'] } }))
  assert.equal(ledger.fail_reason, 'MERGE_CONFLICT')
  assert.ok(!labels.includes('j-brief-rb'))
})

// A resumed task's first reviewer owes concern_rulings: its concerns are only in the
// report entry, so the run asks for the rulings without knowing how many there are.
// These fixtures have a report entry with no concerns: an empty list.
const ruledNone = (answers, labels) => {
  for (const l of labels)
    if (answers[l] && typeof answers[l] === 'object' && !('concern_rulings' in answers[l]))
      answers[l] = { ...answers[l], concern_rulings: [] }
  return answers
}

// A previous run stopped after its report: the task waits in REVIEW.
const inReview = over => {
  const run = taskRun(over)
  run.answers.scout = { ...run.answers.scout, task: { ...run.answers.scout.task, status: 'REVIEW' } }
  ruledNone(run.answers, ['rev', 'rev-r2'])
  return run
}

test('task.js: a task found in REVIEW skips Execute and is reviewed on the branch the earlier run left', async () => {
  const { ledger, steps, labels, prompt } = await go('task.js', inReview({
    branch: { exists: true, branch: 'task/t7-r2', head_sha: 'bbb9' },
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.ok(!labels.some(l => l.startsWith('impl')), 'no implementer for work that is already reported')
  assert.deepEqual(steps.map(brief), [
    { label: 'j-brief', step: 'brief', task: 7 },
    { label: 'j-review', step: 'review', task: 7, verdict: 'approve' }], 'its reviewer reads a brief written for it')
  assert.ok(prompt('branch').includes('node <helper> branch --names \'["task/t7-ctx","task/t7-r2","task/t7"]\''))
  assert.ok(prompt('rev').includes('git diff main...task/t7-r2'))
  assert.ok(prompt('merge').includes('"branch":"task/t7-r2","head_sha":"bbb9"'))
  assert.equal(ledger.branch, 'task/t7-r2')
})

test('task.js: a task found in REVIEW whose fix needs a worktree is told to make one', async () => {
  const { prompt, steps } = await go('task.js', inReview({
    branch: { exists: true, branch: 'task/t7', head_sha: 'bbb9' },
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: CLEAN,
  }))
  assert.ok(!/\bnull\b/.test(prompt('fix')), 'the fixer is not sent to a worktree named null')
  assert.ok(prompt('fix').includes('git worktree add <a sibling directory outside the primary working tree> task/t7'))
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'changes_requested', 'brief', 'fix', 'brief', 'approve'])
})

test('task.js: a task found in REVIEW without its branch aborts before any work, naming the one action', async () => {
  const { ledger, labels, steps } = await go('task.js', inReview({ branch: { exists: false, branch: null, head_sha: null } }))
  assert.equal(ledger.outcome, 'ABORTED')
  assert.equal(ledger.abort_reason, 'ABORTED_IN_REVIEW_NO_BRANCH')
  assert.match(ledger.abort_detail, /task-7 is in REVIEW/)
  assert.match(ledger.abort_detail, /`changes_requested`/)
  // the branch may be gone because it was merged and only the close failed
  assert.match(ledger.abort_detail, /already merged, close the task DONE from REVIEW .*verdict `approve`/)
  assert.ok(!labels.includes('baseline') && !labels.some(l => l.startsWith('impl')), 'nothing is dispatched')
  assert.deepEqual(steps, [])
})

// The resumed branch has no worktree: the fixer makes one, and the run takes its
// path over, so a later rebase works there and the janitor removes it.
const FIX_WT = '/tmp/wt-fix-7'
const resumedFixRun = over => inReview({
  branch: { exists: true, branch: 'task/t7', head_sha: 'bbb9' },
  rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: { ...FIXED, worktree_path: FIX_WT }, rev2: CLEAN,
  ...over,
})

test('task.js: the worktree a fixer made for a resumed task reaches the janitor', async () => {
  const { ledger, prompt } = await go('task.js', resumedFixRun())
  assert.equal(ledger.outcome, 'MERGED')
  assert.ok(prompt('fix').includes('worktree_path'), 'the fixer is asked for the worktree it worked in')
  assert.ok(prompt('janitor').includes(`worktrees.json: ["${FIX_WT}"]`), 'the janitor removes it')
})

test('task.js: a rebase after a fixer-made worktree works in that worktree, not in a new one', async () => {
  const { ledger, prompt } = await go('task.js', resumedFixRun({
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb': CLEAN,
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.ok(prompt('rebase').includes(`Work in worktree\n${FIX_WT}`))
  assert.ok(!prompt('rebase').includes('has no worktree yet'))
})

test('task.js: the worktree a rebaser made for a resumed task reaches the janitor', async () => {
  const { prompt } = await go('task.js', inReview({
    branch: { exists: true, branch: 'task/t7', head_sha: 'bbb9' },
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'], worktree_path: '/tmp/wt-rb-7' },
    'rev-rb': CLEAN,
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.ok(prompt('rebase').includes('worktree_path'), 'the rebaser is asked for the worktree it worked in')
  assert.ok(prompt('janitor').includes('worktrees.json: ["/tmp/wt-rb-7"]'))
})

// A task that has its worktree keeps it: a path a fixer or a rebaser reports —
// its reset working directory, say — never replaces the one the implementer made,
// or the janitor would remove the wrong tree and leave the real one behind.
const ELSEWHERE = '/tmp/the-run-checkout'
test('task.js: a worktree the implementer made stays the task\'s, whatever a fixer or rebaser reports', async () => {
  const { ledger, prompt } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: { ...FIXED, worktree_path: ELSEWHERE }, rev2: CLEAN,
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'], worktree_path: ELSEWHERE },
    'rev-rb': CLEAN,
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.ok(prompt('rebase').includes('Work in worktree\n/tmp/wt-7'))
  assert.ok(prompt('janitor').includes('worktrees.json: ["/tmp/wt-7"]'))
  // a missing worktree is restored where it was, not somewhere new
  assert.ok(prompt('fix').includes("git worktree add '/tmp/wt-7' task/t7"))
  assert.ok(!prompt('fix').includes('worktree_path'), 'a task with a worktree is not asked for another one')
})

test('task.js: a branch check that answers nothing aborts with its own reason', async () => {
  const { ledger } = await go('task.js', inReview({}))
  assert.equal(ledger.abort_reason, 'ABORTED_BRANCH_CHECK')
})

test('task.js: the implementer leaves a task in REVIEW as it is', async () => {
  const { prompt } = await go('task.js', taskRun())
  assert.ok(prompt('impl').includes('if already IN_PROGRESS, REVIEW or DONE, leave it'))
})

// ------------------------------------------------------------------ epic.js

test('epic.js: a clean run writes brief, report and REVIEW, an approval, then closes the child', async () => {
  const { ledger, steps, labels, prompt } = await go('epic.js', epicRun())
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.deepEqual(steps.map(brief), [
    { label: 'j-brief-501', step: 'brief', task: 501 },
    { label: 'j-report-501', step: 'report', task: 501 },
    { label: 'j-review-501', step: 'review', task: 501, verdict: 'approve' },
  ])
  assert.deepEqual(order(labels, ['j-brief-501', 'impl-501', 'j-report-501', 'rev-501', 'j-review-501', 'merge-w0', 'account']),
    ['j-brief-501', 'impl-501', 'j-report-501', 'rev-501', 'j-review-501', 'merge-w0', 'account'])
  assert.match(steps[0].body, /task-501 "the thing" of epic task-500/)
  for (const label of ['impl-501', 'rev-501']) {
    assert.ok(prompt(label).includes('get_task_journal_entry(task_id=501, kind="brief")'), label)
    for (const text of ['<<<BEGIN spec card', '<<<BEGIN spec digest', '<<<BEGIN global constraints', 'docs/plan.md'])
      assert.ok(!prompt(label).includes(text), `${label}: ${text}`)
  }
  assert.ok(prompt('impl-501').includes('git checkout -b epic500/t501 '))
  assert.deepEqual(accountTable(prompt('account')).done.map(d => d.id), [501])
})

test('epic.js: changes requested -> return, fix, REVIEW, re-review', async () => {
  const { ledger, steps, labels } = await go('epic.js', epicRun({
    'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': FIXED, 'rev2-501': CLEAN,
  }))
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.deepEqual(steps.map(s => [s.label, s.verdict ?? s.step]), [
    ['j-brief-501', 'brief'], ['j-report-501', 'report'], ['j-review-501', 'changes_requested'],
    ['j-brief-fix-501', 'brief'], ['j-fix-501', 'fix'], ['j-brief-rereview-501', 'brief'], ['j-review2-501', 'approve']])
  const wanted = ['j-review-501', 'j-brief-fix-501', 'fix-501', 'j-fix-501', 'j-brief-rereview-501', 'rev2-501', 'j-review2-501', 'merge-w0']
  assert.deepEqual(order(labels, wanted), wanted)
})

test('epic.js: the review after a rebase is recorded too; a gap fix, which has no task, writes nothing', async () => {
  const gap = { gid: 1, claim: 'a missing piece', evidence: 'ev', severity: 'blocker', min_action: { title: 'close it' } }
  const { ledger, steps } = await go('epic.js', epicRun({
    'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb-501': CLEAN,
    'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
    hunt: { gaps: [gap] },
    gapverify: { verdicts: [{ gid: 1, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen' }] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': CLEAN,
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  }))
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.deepEqual(steps.map(s => [s.label, s.verdict ?? s.step]), [
    ['j-brief-501', 'brief'], ['j-report-501', 'report'], ['j-review-501', 'approve'],
    ['j-brief-rebase-501', 'brief'], ['j-brief-rb-501', 'brief'], ['j-review-rb-501', 'approve']])
  assert.match(steps.find(s => s.label === 'j-brief-rebase-501').body, /=== REBASE: the branch epic500\/t501 conflicts with main ===/)
  assert.ok(steps.find(s => s.label === 'j-brief-rb-501').body.includes('["a.js"]'), 'the conflicted files are in the brief')
  assert.match(steps.at(-1).note, /rebase/i)
})

const epicInReview = over => {
  const run = epicRun(over)
  const sc = run.answers.scout
  run.answers.scout = { ...sc, tasks: [{ ...sc.tasks[0], conport_status: 'REVIEW' }] }
  ruledNone(run.answers, ['rev-501', 'rev-501-r2'])
  return run
}

test('epic.js: a child found in REVIEW skips its implementer and is reviewed on its existing branch', async () => {
  const { ledger, steps, labels, prompt } = await go('epic.js', epicInReview({
    'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' },
  }))
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.ok(!labels.some(l => l.startsWith('impl-')), 'no implementer for work that is already reported')
  assert.deepEqual(steps.map(brief), [
    { label: 'j-brief-501', step: 'brief', task: 501 },
    { label: 'j-review-501', step: 'review', task: 501, verdict: 'approve' }])
  assert.ok(prompt('branch-501').includes('\'["epic500/t501-ctx","epic500/t501-r2","epic500/t501"]\''))
  assert.ok(prompt('rev-501').includes('git diff main...epic500/t501'))
  assert.ok(prompt('merge-w0').includes('"branch":"epic500/t501","head_sha":"bbb9"'))
  assert.equal(ledger.tasks['501'].state, 'DONE')
})

test('epic.js: a child found in REVIEW without its branch is not dispatched and fails with ABORTED_IN_REVIEW_NO_BRANCH', async () => {
  const { ledger, labels, steps, prompt } = await go('epic.js', epicInReview({ 'branch-501': { exists: false, branch: null, head_sha: null } }))
  const row = ledger.tasks['501']
  assert.equal(row.state, 'FAILED')
  assert.equal(row.reason, 'ABORTED_IN_REVIEW_NO_BRANCH')
  assert.match(row.detail, /task-501 is in REVIEW/)
  assert.match(row.detail, /`changes_requested`/)
  assert.match(row.detail, /already merged, close the task DONE from REVIEW .*verdict `approve`/)
  assert.ok(!labels.some(l => l.startsWith('impl-') || l.startsWith('rev-')), 'nothing is dispatched for it')
  assert.deepEqual(steps, [])
  const table = accountTable(prompt('account'))
  assert.deepEqual(table.done, [], 'the child is not closed')
  assert.deepEqual(table.failed.map(f => [f.id, f.reason.split(':')[0]]), [[501, 'ABORTED_IN_REVIEW_NO_BRANCH']])
})

test('epic.js: the worktree a fixer made for a resumed child is used by the rebase and reaches the janitor', async () => {
  const wt = '/tmp/wt-fix-501'
  const { ledger, prompt } = await go('epic.js', epicInReview({
    'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' },
    'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': { ...FIXED, worktree_path: wt }, 'rev2-501': CLEAN,
    'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb-501': CLEAN,
    'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.equal(ledger.tasks['501'].state, 'DONE')
  assert.ok(prompt('fix-501').includes('worktree_path'))
  assert.ok(prompt('rebase-501').includes(`Work in worktree\n${wt}`))
  assert.ok(!prompt('rebase-501').includes('has no worktree yet'))
  assert.ok(prompt('janitor').includes(`worktrees.json: ["${wt}"]`))
})

test('epic.js: the worktree a rebaser made for a resumed child reaches the janitor', async () => {
  const { prompt } = await go('epic.js', epicInReview({
    'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' },
    'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'], worktree_path: '/tmp/wt-rb-501' },
    'rev-rb-501': CLEAN,
    'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.ok(prompt('janitor').includes('worktrees.json: ["/tmp/wt-rb-501"]'))
})

test('epic.js: a worktree the implementer made stays the child\'s, whatever a fixer or rebaser reports', async () => {
  const { prompt } = await go('epic.js', epicRun({
    'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': { ...FIXED, worktree_path: ELSEWHERE }, 'rev2-501': CLEAN,
    'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'], worktree_path: ELSEWHERE },
    'rev-rb-501': CLEAN,
    'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  assert.ok(prompt('rebase-501').includes('Work in worktree\n/tmp/wt-7'))
  assert.ok(prompt('janitor').includes('worktrees.json: ["/tmp/wt-7"]'))
  assert.ok(prompt('fix-501').includes("git worktree add '/tmp/wt-7' epic500/t501"))
})

// Branch B of the accountant treats the review rules' close refusals as branch A does.
for (const [file, run] of [['task.js', taskRun], ['epic.js', epicRun]])
  test(`${file}: the MCP accountant reports a review-rule close refusal as refused, not as a call to retry`, async () => {
    const { args, answers } = run()
    const { calls } = await runWorkflow(file, args, { ...answers, account: null, 'account-r2': null })
    const p = calls.find(c => c.label === 'account').prompt
    for (const code of ['done_needs_approval', 'done_needs_review', 'done_needs_resolution', 'review_exit_not_allowed'])
      assert.ok(p.includes(code), `${file}: ${code} is not named`)
    assert.ok(p.includes('<code>: the task is not closed — <message>'))
  })

test('epic.js: a child whose brief does not land is not dispatched and fails with its own reason', async () => {
  const { ledger, steps, labels } = await go('epic.js', epicRun(), helper(['j-brief-501']))
  assert.deepEqual(steps.map(s => s.label), ['j-brief-501'])
  assert.deepEqual([ledger.tasks['501'].state, ledger.tasks['501'].reason], ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(!labels.some(l => l.startsWith('impl-') || l.startsWith('rev-')))
})

const epicConflict = over => epicRun({
  'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
  'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
  'rev-rb-501': CLEAN,
  'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
  ...over,
})
const failure = (ledger, key = '501') => [ledger.tasks[key].state, ledger.tasks[key].reason]

test('epic.js: the rebaser is dispatched on a rebase brief of its own, not on the latest fix brief', async () => {
  const { steps, labels } = await go('epic.js', epicConflict({
    'rev-501': { verdict: 'APPROVED', findings: [MINOR] }, 'fix-501': FIXED, 'rev2-501': CLEAN }))
  const briefsBefore = steps.slice(0, steps.findIndex(s => s.label === 'j-brief-rebase-501') + 1).filter(s => s.step === 'brief')
  assert.equal(briefsBefore.at(-1).label, 'j-brief-rebase-501')
  assert.ok(!briefsBefore.at(-1).body.includes('REVIEW FINDINGS TO FIX'), 'the rebase brief is not the fix brief')
  const wanted = ['j-brief-rebase-501', 'rebase-501', 'j-brief-rb-501', 'rev-rb-501']
  assert.deepEqual(order(labels, wanted), wanted)
})

test('epic.js: a rebase brief that does not land dispatches no rebaser and fails with BRIEF_NOT_WRITTEN', async () => {
  const { ledger, labels } = await go('epic.js', epicConflict(), helper(['j-brief-rebase-501']))
  assert.deepEqual(failure(ledger), ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(!labels.includes('rebase-501') && !labels.includes('rev-rb-501'))
})

test('epic.js: a brief for the review after the rebase that does not land fails with BRIEF_NOT_WRITTEN, not MERGE_CONFLICT', async () => {
  const { ledger, labels } = await go('epic.js', epicConflict(), helper(['j-brief-rb-501']))
  assert.deepEqual(failure(ledger), ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(labels.includes('rebase-501') && !labels.includes('rev-rb-501'))
})

test('epic.js: a rebase that fails is still MERGE_CONFLICT', async () => {
  const { ledger, labels } = await go('epic.js', epicConflict({ 'rebase-501': { status: 'BLOCKED', head_sha: 'b', conflict_files: ['a.js'] } }))
  assert.deepEqual(failure(ledger), ['FAILED', 'MERGE_CONFLICT'])
  assert.ok(!labels.includes('j-brief-rb-501'))
})

test('epic.js: NEEDS_CONTEXT whose new brief does not land fails with BRIEF_NOT_WRITTEN and dispatches no second implementer', async () => {
  const asked = { status: 'NEEDS_CONTEXT', branch: 'epic500/t501', head_sha: 'b', worktree_path: '/tmp/wt-7', questions: ['q'] }
  const { ledger, labels } = await go('epic.js', epicRun({ 'impl-501': asked }), helper(['j-brief-ctx-501']))
  assert.deepEqual(failure(ledger), ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(!labels.includes('impl-501-ctx'))
})

test('epic.js: a child in REVIEW whose brief does not land gets no reviewer and fails with BRIEF_NOT_WRITTEN', async () => {
  const { ledger, labels } = await go('epic.js', epicInReview({ 'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' } }),
    helper(['j-brief-501']))
  assert.deepEqual(failure(ledger), ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(labels.includes('branch-501') && !labels.some(l => l.startsWith('rev-')))
})

test('epic.js: a re-review brief that does not land dispatches no re-reviewer and fails with BRIEF_NOT_WRITTEN', async () => {
  const { ledger, labels } = await go('epic.js', epicRun({ 'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': FIXED, 'rev2-501': CLEAN }),
    helper(['j-brief-rereview-501']))
  assert.deepEqual(failure(ledger), ['FAILED', 'BRIEF_NOT_WRITTEN'])
  assert.ok(labels.includes('fix-501') && !labels.includes('rev2-501'))
})

test('epic.js: a fix brief that does not land dispatches no fixer', async () => {
  const { ledger, labels } = await go('epic.js', epicRun({ 'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': FIXED }),
    helper(['j-brief-fix-501']))
  assert.equal(ledger.tasks['501'].reason, 'BRIEF_NOT_WRITTEN')
  assert.ok(!labels.includes('fix-501'))
})

test('epic.js: a plan task without a ConPort child has no journal and is not dispatched', async () => {
  const run = epicRun()
  const sc = run.answers.scout
  run.answers.scout = { ...sc, tasks: [{ ...sc.tasks[0], conport_id: null, coverage: 'plan_only' }] }
  const { ledger, labels, steps } = await go('epic.js', run)
  const row = Object.values(ledger.tasks)[0]
  assert.deepEqual([row.state, row.reason], ['FAILED', 'NO_CONPORT_TASK'])
  assert.match(row.detail, /create the child .*run again/)
  assert.ok(!labels.some(l => l.startsWith('impl-')))
  assert.deepEqual(steps, [])
})

test('epic.js: a branch check that answers nothing fails the child with its own reason', async () => {
  const { ledger } = await go('epic.js', epicInReview({}))
  assert.equal(ledger.tasks['501'].reason, 'BRANCH_CHECK_DEAD')
})

test('epic.js: the scout carries each child\'s status, which tells a child in REVIEW', () => {
  const src = source('epic.js')
  const line = 'Every task with a child carries conport_status = that child\'s status, verbatim.'
  assert.equal(src.split(line).length - 1, 2, 'in STEP 2 and in branch B alike')
})

// ------------------------------------------------------------------ the api key

// Every agent works from the journal, which lives in ConPort: without a key the
// run refuses at its start, before the tree is even looked at.
for (const [file, run] of [['task.js', taskRun], ['epic.js', epicRun]]) {
  test(`${file}: no api key refuses the run at its start with the one action`, async () => {
    const { args, answers } = run()
    const { ledger, calls } = await runWorkflow(file, args, { ...answers, preflight: { ...answers.preflight, api_key: false, clean: false } })
    assert.equal(ledger.outcome, 'ABORTED')
    assert.equal(ledger.abort_reason, 'ABORTED_NO_API_KEY')
    assert.match(ledger.abort_detail, /^set CONPORT_API_KEY \(or the api key option of the conport plugin\) and run again/)
    assert.ok(!ledger.abort_detail.includes('\n'), 'one line')
    assert.deepEqual(calls.map(c => c.label), ['preflight'], 'nothing else runs')
  })

  test(`${file}: a helper that does not say whether a key is set refuses the run, naming the update`, async () => {
    const { args, answers } = run()
    const { api_key: _key, ...stale } = answers.preflight
    const { ledger, calls } = await runWorkflow(file, args, { ...answers, preflight: stale })
    assert.equal(ledger.abort_reason, 'ABORTED_STALE_HELPER')
    assert.match(ledger.abort_detail, /^update the conport plugin/)
    assert.deepEqual(calls.map(c => c.label), ['preflight'])
  })
}

test('epic.js: the implementer leaves a child in REVIEW as it is', async () => {
  const { prompt } = await go('epic.js', epicRun())
  assert.ok(prompt('impl-501').includes('if already IN_PROGRESS, REVIEW or DONE, leave it'))
})

// ------------------------------------------------------------ project address

// The project travels as the scout's `project` — the handle — into the scout
// schema, every step file, the accounting table and the MCP hints of the prompts;
// no number of a project is asked for or passed on.
for (const [file, run, impl] of [['task.js', taskRun, 'impl'], ['epic.js', epicRun, 'impl-501']]) {
  test(`${file}: the scout schema, the steps, the table and the prompts carry the project handle`, async () => {
    const { calls, steps, prompt } = await go(file, run())
    const scout = calls.find(c => c.label === 'scout').opts.schema
    assert.deepEqual(scout.properties.project, { type: 'string' })
    assert.ok(scout.required.includes('project') && !('project_id' in scout.properties))
    assert.ok(steps.length > 0 && steps.every(s => s.project === 'prk7m2qx9d'))
    const table = accountTable(prompt('account'))
    assert.equal(table.project, 'prk7m2qx9d')
    assert.ok(!('project_id' in table))
    assert.ok(prompt(impl).includes('project=prk7m2qx9d'), 'the MCP hint names the handle')
    for (const c of calls) assert.doesNotMatch(c.prompt, /project_id/, `${c.label} still names project_id`)
  })
}

// ------------------------------------------------------------ a minor after a rebase

test('epic.js: a minor the review after a rebase finds is journalled changes_requested, carried, and the child still merges', async () => {
  const { ledger, steps } = await go('epic.js', epicConflict({ 'rev-rb-501': { verdict: 'APPROVED', findings: [MINOR] } }))
  const tail = steps.filter(s => s.step !== 'brief').slice(-3).map(s => [s.label, s.verdict ?? s.step])
  assert.deepEqual(tail, [['j-review-rb-501', 'changes_requested'], ['j-carry-fix-501', 'fix'], ['j-carry-review-501', 'approve']])
  assert.equal(ledger.tasks['501'].state, 'DONE')
  assert.deepEqual(ledger.minors.map(m => m.what), ['a nit'], 'the minor goes to the findings round')
})

test('task.js: a minor the review after a rebase finds is journalled changes_requested and carried', async () => {
  const { steps } = await go('task.js', taskRun({
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb': { verdict: 'APPROVED', findings: [MINOR] },
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  }))
  const tail = steps.filter(s => s.step !== 'brief').slice(-3).map(s => [s.label, s.verdict ?? s.step])
  assert.deepEqual(tail, [['j-review-rb', 'changes_requested'], ['j-carry-fix', 'fix'], ['j-carry-review', 'approve']])
})
