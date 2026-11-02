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
  assert.ok(steps.every(s => s.project_id === 42))
  assert.deepEqual(steps[1].result, taskRun().answers.impl, 'the report is the implementer\'s own result')
  assert.deepEqual(steps[2].result, taskRun().answers.rev, 'the review is the reviewer\'s own result')
  assert.match(steps[0].body, /task-7 "the thing"/)
  assert.match(steps[0].body, /branch task\/t7\b/)
  assert.match(steps[0].body, /Acceptance: accept/)
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
    { label: 'j-fix', step: 'fix', task: 7 },
    { label: 'j-review2', step: 'review', task: 7, verdict: 'approve' },
  ])
  assert.deepEqual(order(labels, ['j-review', 'fix', 'j-fix', 'rev2', 'j-review2', 'merge']),
    ['j-review', 'fix', 'j-fix', 'rev2', 'j-review2', 'merge'])
  assert.deepEqual(steps[3].result, FIXED, 'the fix entry is the fixer\'s own result')
  assert.match(steps[4].note, /re-review/i)
})

test('task.js: minor findings alone are an approval — the fixer polishes, no fix entry, the re-review is recorded', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [MINOR] }, fix: FIXED, rev2: CLEAN,
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'report', 'approve', 'approve'])
})

test('task.js: a re-review that still finds a serious defect requests changes again and the run fails', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] },
  }))
  assert.equal(ledger.fail_reason, 'RED_AFTER_FIX')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'report', 'changes_requested', 'fix', 'changes_requested'])
})

test('task.js: a failed fix of a serious finding writes no fix entry', async () => {
  const { ledger, steps } = await go('task.js', taskRun({
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: { status: 'BLOCKED', head_sha: 'x' },
  }))
  assert.equal(ledger.fail_reason, 'FIX_FAILED')
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['brief', 'report', 'changes_requested'])
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

test('task.js: a helper that answers nothing leaves the outcome alone and tries no step after the report', async () => {
  const { args, answers } = taskRun()
  const { ledger, calls } = await runWorkflow('task.js', args, answers)
  assert.equal(ledger.outcome, 'MERGED')
  // the brief is exempt from the stop rule, the report is not
  assert.deepEqual(calls.filter(c => c.label.startsWith('j-')).map(c => c.label), ['j-brief', 'j-report'])
})

// The server takes a report without a brief: a brief that did not land is
// recorded, and the cycle goes on.
test('task.js: a brief that does not land does not stop the cycle', async () => {
  const { ledger, steps } = await go('task.js', taskRun(), helper(['j-brief']))
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(steps.map(s => s.label), ['j-brief', 'j-report', 'j-review'])
  assert.deepEqual(ledger.journal.map(j => [j.label, j.ok]), [['j-brief', false], ['j-report', true], ['j-review', true]])
})

// A previous run stopped after its report: the task waits in REVIEW.
const inReview = over => {
  const run = taskRun(over)
  run.answers.scout = { ...run.answers.scout, task: { ...run.answers.scout.task, status: 'REVIEW' } }
  return run
}

test('task.js: a task found in REVIEW skips Execute and is reviewed on the branch the earlier run left', async () => {
  const { ledger, steps, labels, prompt } = await go('task.js', inReview({
    branch: { exists: true, branch: 'task/t7-r2', head_sha: 'bbb9' },
  }))
  assert.equal(ledger.outcome, 'MERGED')
  assert.ok(!labels.some(l => l.startsWith('impl')), 'no implementer for work that is already reported')
  assert.deepEqual(steps.map(brief), [{ label: 'j-review', step: 'review', task: 7, verdict: 'approve' }])
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
  assert.deepEqual(steps.map(s => s.verdict ?? s.step), ['changes_requested', 'fix', 'approve'])
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
  assert.match(steps[0].body, /branch epic500\/t501\b/)
  assert.deepEqual(accountTable(prompt('account')).done.map(d => d.id), [501])
})

test('epic.js: changes requested -> return, fix, REVIEW, re-review', async () => {
  const { ledger, steps, labels } = await go('epic.js', epicRun({
    'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': FIXED, 'rev2-501': CLEAN,
  }))
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.deepEqual(steps.map(s => [s.label, s.verdict ?? s.step]), [
    ['j-brief-501', 'brief'], ['j-report-501', 'report'], ['j-review-501', 'changes_requested'],
    ['j-fix-501', 'fix'], ['j-review2-501', 'approve']])
  assert.deepEqual(order(labels, ['j-review-501', 'fix-501', 'j-fix-501', 'rev2-501', 'j-review2-501', 'merge-w0']),
    ['j-review-501', 'fix-501', 'j-fix-501', 'rev2-501', 'j-review2-501', 'merge-w0'])
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
    ['j-brief-501', 'brief'], ['j-report-501', 'report'], ['j-review-501', 'approve'], ['j-review-rb-501', 'approve']])
  assert.match(steps.at(-1).note, /rebase/i)
})

const epicInReview = over => {
  const run = epicRun(over)
  const sc = run.answers.scout
  run.answers.scout = { ...sc, tasks: [{ ...sc.tasks[0], conport_status: 'REVIEW' }] }
  return run
}

test('epic.js: a child found in REVIEW skips its implementer and is reviewed on its existing branch', async () => {
  const { ledger, steps, labels, prompt } = await go('epic.js', epicInReview({
    'branch-501': { exists: true, branch: 'epic500/t501', head_sha: 'bbb9' },
  }))
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assert.ok(!labels.some(l => l.startsWith('impl-')), 'no implementer for work that is already reported')
  assert.deepEqual(steps.map(brief), [{ label: 'j-review-501', step: 'review', task: 501, verdict: 'approve' }])
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

test('epic.js: a brief that does not land does not stop the cycle of that child', async () => {
  const { steps } = await go('epic.js', epicRun(), helper(['j-brief-501']))
  assert.deepEqual(steps.map(s => s.label), ['j-brief-501', 'j-report-501', 'j-review-501'])
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

test('epic.js: the implementer leaves a child in REVIEW as it is', async () => {
  const { prompt } = await go('epic.js', epicRun())
  assert.ok(prompt('impl-501').includes('if already IN_PROGRESS, REVIEW or DONE, leave it'))
})
