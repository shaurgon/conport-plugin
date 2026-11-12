import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, epicRun } from './run-workflow.mjs'

// After the merges of an epic run the code on the default branch changed, so the
// run checks the anchors of the project model itself: `conport arch check` in the
// repository root, when the project has portions with anchors. The outcome is part
// of the run's report (the ledger); a check that did not run never fails the epic,
// and it names the one command that does it by hand.
const CHECK_BY_HAND = 'run npx -y conport@^0.7 arch check -p prk7m2qx9d in the repository root on main'
const CHECKED = { status: 'CHECKED', line: 'found 3, missing 1, unchecked 2' }
const labelsOf = calls => calls.map(c => c.label)

const go = async over => {
  const { args, answers } = epicRun(over)
  return runWorkflow('epic.js', args, answers)
}

test('epic.js: the anchor check runs after the last merge and before the acceptance', async () => {
  const { calls } = await go({ anchors: CHECKED })
  const labels = labelsOf(calls)
  const at = labels.indexOf('anchors')
  assert.ok(at >= 0, 'the run reached the anchor check')
  assert.ok(at > labels.indexOf('merge-w0'), 'after the merge of the wave')
  assert.ok(at > labels.indexOf('hunt'), 'after the gap hunt, whose criticals merge too')
  assert.ok(at < labels.indexOf('goal'), 'before the acceptance')
})

test('epic.js: the anchor check also follows the merge of a fixed critical gap', async () => {
  const gap = { gid: 1, claim: 'a missing piece', evidence: 'ev', severity: 'blocker', min_action: { title: 'close it' } }
  const { calls, ledger } = await go({
    anchors: CHECKED,
    hunt: { gaps: [gap] },
    gapverify: { verdicts: [{ gid: 1, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen' }] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': { verdict: 'APPROVED', findings: [] },
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  const labels = labelsOf(calls)
  assert.ok(labels.indexOf('anchors') > labels.indexOf('gapmerge-1'), 'after the gap fix landed')
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: the anchor check prompt runs the CLI in the repository root only for portions with anchors', async () => {
  const { prompt } = await go({ anchors: CHECKED })
  const text = prompt('anchors')
  assert.match(text, /arch_sources/, 'it reads the portions of the project')
  assert.match(text, /arch_source\b/, 'and a document portion, for its anchors')
  assert.match(text, /npx -y conport@\^0\.7 arch check -p prk7m2qx9d/, 'the one command, for the run project')
  assert.match(text, /repository root/)
  assert.match(text, /NO_ANCHORS/, 'a project without anchors answers without running the CLI')
  assert.ok(text.includes('arch_sources is not among your tools -> return {"status": "FAILED", ' +
    '"line": "the connection has no tool group arch"}'), 'a connection narrowed below arch answers one line, no improvising')
})

test('epic.js: the outcome of the anchor check is in the report', async () => {
  const { ledger } = await go({ anchors: CHECKED })
  assert.deepEqual(ledger.anchor_check, CHECKED)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a project without anchors is reported as such, with no action', async () => {
  const { ledger } = await go({ anchors: { status: 'NO_ANCHORS', line: 'no portion carries anchors' } })
  assert.deepEqual(ledger.anchor_check, { status: 'NO_ANCHORS', line: 'no portion carries anchors' })
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a failed anchor check names the command to run by hand and does not fail the epic', async () => {
  const { ledger } = await go({ anchors: { status: 'FAILED', line: 'Error 404: project not found' } })
  assert.deepEqual(ledger.anchor_check,
    { status: 'FAILED', line: 'Error 404: project not found', action: CHECK_BY_HAND })
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: a dead anchor-check agent is retried once, then reported with the command to run by hand', async () => {
  const { ledger, calls } = await go({})
  assert.deepEqual(labelsOf(calls).filter(l => l.startsWith('anchors')), ['anchors', 'anchors-r2'])
  assert.deepEqual(ledger.anchor_check, { status: 'AGENT_FAILED', line: '', action: CHECK_BY_HAND })
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
})

test('epic.js: the retry answers for a dead first agent', async () => {
  const { ledger } = await go({ anchors: null, 'anchors-r2': CHECKED })
  assert.deepEqual(ledger.anchor_check, CHECKED)
})

test('epic.js: Anchors is a phase of the run, between the findings round and the acceptance', async () => {
  const { source } = await import('./run-workflow.mjs')
  const titles = [...source('epic.js').matchAll(/\{ title: '([^']+)' \}/g)].map(m => m[1])
  assert.deepEqual(titles.slice(titles.indexOf('Fix criticals'), titles.indexOf('Acceptance') + 1),
    ['Fix criticals', 'Findings', 'Anchors', 'Acceptance'])
})
