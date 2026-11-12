import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'

// An epic does not raise a unit version; the release step raises it once. The text
// of that rule is not enough, and the pre-push guards fire only on a push: before
// READY both workflows compare every unit version carrier with the base branch, and
// any difference refuses READY with one action. These tests pin the refusal text and
// where each workflow asks: a task run before its merge, an epic run before its verdict.

const accountTable = prompt => JSON.parse(/TABLE: (.*)\n/.exec(prompt)[1])
const labels = calls => calls.map(c => c.label)

const EQUAL = { base: 'origin/main', head: 'HEAD', equal: true, differs: [] }
const PLUGIN = { unit: 'the web app', path: 'web/package.json', base: '2.6.0', head: '2.7.0' }
const SKILL = { unit: 'the web app', path: 'web/skills/main/SKILL.md', base: '2.6.0', head: '2.7.0' }
const ORCA = { unit: 'the extension', path: 'ext/extension.json', base: '0.4.4', head: '0.4.5' }
const CLI = { unit: 'the cli', path: 'cli/package.json', base: '0.7.3', head: '0.7.4' }
const raised = (...differs) => ({ base: 'origin/main', head: 'HEAD', equal: false, differs })

const REFUSAL = 'Restore the version of the web app as origin/main has it; units are raised only at the release step.'
const UNCHECKED = 'the check of unit versions against the base branch did not answer: update the conport plugin and run again'

const task = over => { const r = taskRun(over); return runWorkflow('task.js', r.args, r.answers) }
const epic = over => { const r = epicRun(over); return runWorkflow('epic.js', r.args, r.answers) }

// ------------------------------------------------------------------ /conport:task

test('task: equal versions pass — the check runs on the reviewed head before the merge, and the task merges', async () => {
  const { ledger, calls, prompt } = await task({ versions: EQUAL })
  assert.equal(ledger.outcome, 'MERGED')
  const order = labels(calls)
  assert.ok(order.indexOf('versions') >= 0, 'the version check ran')
  assert.ok(order.indexOf('versions') < order.indexOf('merge'), 'the check comes before the merge')
  assert.match(prompt('versions'), /versions --branch 'main' --start 'aaa0' --head 'bbb1'/)
  assert.deepEqual(ledger.versions, { base: 'origin/main', differs: [], cause: 'equal', action: null })
  assert.ok(accountTable(prompt('account')).close, 'the task is closed')
})

test('task: a raised version refuses with the one action, merges nothing and blocks the task with it', async () => {
  const { ledger, calls, prompt } = await task({ versions: raised(PLUGIN) })
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'VERSION_RAISED')
  assert.equal(ledger.fail_detail, REFUSAL)
  assert.deepEqual(ledger.versions, { base: 'origin/main', differs: [PLUGIN], cause: 'raised', action: REFUSAL })
  assert.ok(!labels(calls).some(l => l.startsWith('merge') || l === 'mstate'), 'nothing is merged')
  const table = accountTable(prompt('account'))
  assert.equal(table.close, null)
  assert.equal(table.block.reason, 'VERSION_RAISED: ' + JSON.stringify(REFUSAL))
})

test('task: several carriers of one unit name the unit once; several units are named together', async () => {
  const one = await task({ versions: raised(PLUGIN, SKILL) })
  assert.equal(one.ledger.fail_detail, REFUSAL)
  const two = await task({ versions: raised(PLUGIN, ORCA) })
  assert.equal(two.ledger.fail_detail,
    'Restore the version of the web app and the extension as origin/main has it; units are raised only at the release step.')
  const three = await task({ versions: raised(CLI, PLUGIN, ORCA) })
  assert.equal(three.ledger.fail_detail,
    'Restore the version of the cli, the web app and the extension as origin/main has it; units are raised only at the release step.')
})

test('task: the base the helper compared with is the base the action names', async () => {
  const { ledger } = await task({ versions: { ...raised(ORCA), base: 'aaa0' } })
  assert.equal(ledger.fail_detail, 'Restore the version of the extension as aaa0 has it; units are raised only at the release step.')
})

test('task: a check that does not answer refuses too — never a silent pass', async () => {
  const { ledger, calls } = await task({ versions: null, 'versions-r2': { error: 'wf-helper not found' } })
  assert.deepEqual(labels(calls).filter(l => l.startsWith('versions')), ['versions', 'versions-r2'])
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'VERSIONS_UNCHECKED')
  assert.equal(ledger.fail_detail, UNCHECKED)
  assert.ok(!labels(calls).some(l => l.startsWith('merge')), 'nothing is merged')
  assert.ok(ledger.notes.includes('versions-r2 error:"wf-helper not found"'), 'the notes say why')
})

test('task: an answer that says not equal but lists nothing is not a pass', async () => {
  const { ledger } = await task({ versions: raised() })
  assert.equal(ledger.fail_reason, 'VERSIONS_UNCHECKED')
})

test('task: a carrier neither side can read is unchecked, never a pass', async () => {
  const { ledger, calls } = await task({ versions: { ...EQUAL, equal: false, unreadable: ['ui/src/cli.ts'] } })
  assert.equal(ledger.fail_reason, 'VERSIONS_UNCHECKED')
  assert.equal(ledger.versions.cause, 'unchecked')
  assert.ok(!labels(calls).some(l => l.startsWith('merge')), 'nothing is merged')
})

// The release step raises the versions on the default branch and pushes them; until the
// push the default branch differs from the published one at the start of every run. The
// action there is the push, never a restore that would undo the release.
const unpushed = (...differs) => ({ ...raised(...differs), start_differs: differs })
const PUSH_FIRST = 'Push the release step first, then run again: the default branch already raises the version of the web app over origin/main.'

test('task: the default branch already ahead of the published one with a raised version -> push first, not restore', async () => {
  const { ledger, calls } = await task({ versions: unpushed(PLUGIN) })
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'RELEASE_NOT_PUSHED')
  assert.equal(ledger.fail_detail, PUSH_FIRST)
  assert.equal(ledger.versions.cause, 'unpushed_release')
  assert.ok(!labels(calls).some(l => l.startsWith('merge')), 'nothing is merged')
})

// A default branch behind the published one (a release pushed from another checkout and
// fetched) or diverged from it has nothing to push: a push would be refused as not a
// fast-forward. The action there is to update the branch, never to push or restore.
const BEHIND = 'Update the default branch from origin/main first, then run again.'
const behind = (...differs) => ({ ...raised(...differs), start_differs: [], start_behind: true })

test('task: the default branch behind the published one -> update it first, neither push nor restore', async () => {
  const { ledger, calls } = await task({ versions: behind(PLUGIN) })
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'BRANCH_BEHIND_ORIGIN')
  assert.equal(ledger.fail_detail, BEHIND)
  assert.equal(ledger.versions.cause, 'branch_behind')
  assert.ok(!labels(calls).some(l => l.startsWith('merge')), 'nothing is merged')
})

test('task: the default branch behind the published one with equal versions passes', async () => {
  const { ledger } = await task({ versions: { ...EQUAL, start_behind: true } })
  assert.equal(ledger.outcome, 'MERGED')
})

test('task: the default branch ahead of the published one is the push, not the update', async () => {
  const { ledger } = await task({ versions: { ...unpushed(PLUGIN), start_behind: false } })
  assert.equal(ledger.fail_reason, 'RELEASE_NOT_PUSHED')
})

test('task: a start equal to the published branch with a raised head is still a restore', async () => {
  const { ledger } = await task({ versions: { ...raised(PLUGIN), start_differs: [] } })
  assert.equal(ledger.fail_reason, 'VERSION_RAISED')
  assert.equal(ledger.fail_detail, REFUSAL)
})

// A conflict is resolved by a rebase, and the rebased head is what merges: it is checked again.
const conflictRun = over => task({
  merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['web/package.json'] }] },
  rebase: { status: 'DONE', head_sha: 'ddd3' },
  'rev-rb': { verdict: 'APPROVED', findings: [] },
  'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'eee4' }] },
  ...over,
})

test('task: the head after a rebase is checked again before the second merge — equal merges', async () => {
  const { ledger, calls, prompt } = await conflictRun({ 'versions-rb': EQUAL })
  assert.equal(ledger.outcome, 'MERGED')
  const order = labels(calls)
  assert.ok(order.indexOf('versions-rb') > order.indexOf('rev-rb') && order.indexOf('versions-rb') < order.indexOf('merge-rb'))
  assert.match(prompt('versions-rb'), /versions --branch 'main' --start 'aaa0' --head 'ddd3'/)
})

test('task: the head after a rebase with a raised version is not merged', async () => {
  const { ledger, calls } = await conflictRun({ 'versions-rb': raised(PLUGIN) })
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'VERSION_RAISED')
  assert.equal(ledger.fail_detail, REFUSAL)
  assert.ok(!labels(calls).includes('merge-rb'), 'the rebased head is not merged')
})

// Which units a project has is its own manifest. Without one there is nothing to
// compare: the run passes and says so in one note; a manifest that cannot be read is
// unchecked, with the action that fixes it.
const NO_MANIFEST = { ...EQUAL, units: 'none' }
const NO_MANIFEST_NOTE = 'versions: the repository has no unit manifest .conport/units.json — unit versions were not compared'
const INVALID = { ...EQUAL, equal: false, units: 'invalid', manifest_error: '.conport/units.json: units must be a non-empty list' }
const FIX_MANIFEST = 'Fix .conport/units.json, then run again: .conport/units.json: units must be a non-empty list'

test('task: no unit manifest -> the task merges, and one note says the versions were not compared', async () => {
  const { ledger } = await task({ versions: NO_MANIFEST })
  assert.equal(ledger.outcome, 'MERGED')
  assert.equal(ledger.versions.cause, 'no_manifest')
  assert.equal(ledger.versions.action, null)
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('versions:')), [NO_MANIFEST_NOTE])
})

test('task: no unit manifest on both checks of a rebased task -> still one note', async () => {
  const { ledger } = await task({
    versions: NO_MANIFEST, 'versions-rb': NO_MANIFEST,
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['web/package.json'] }] },
    rebase: { status: 'DONE', head_sha: 'ddd3' }, 'rev-rb': { verdict: 'APPROVED', findings: [] },
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'eee4' }] },
  })
  assert.equal(ledger.outcome, 'MERGED')
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('versions:')), [NO_MANIFEST_NOTE])
})

test('task: a unit manifest that cannot be read -> unchecked, with the action that fixes the manifest', async () => {
  const { ledger, calls } = await task({ versions: INVALID })
  assert.equal(ledger.outcome, 'FAILED')
  assert.equal(ledger.fail_reason, 'VERSIONS_UNCHECKED')
  assert.equal(ledger.fail_detail, FIX_MANIFEST)
  assert.ok(!labels(calls).some(l => l.startsWith('merge')), 'nothing is merged')
})

test('task: a manifest present says nothing in the notes', async () => {
  const { ledger } = await task({ versions: { ...EQUAL, units: 'manifest' } })
  assert.equal(ledger.outcome, 'MERGED')
  assert.equal(ledger.versions.cause, 'equal')
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('versions:')), [])
})

// ------------------------------------------------------------------ /conport:epic

test('epic: no unit manifest -> READY stands, and one note says the versions were not compared', async () => {
  const { ledger, prompt } = await epic({ versions: NO_MANIFEST })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'READY')
  assert.equal(table.may_close, true)
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('versions:')), [NO_MANIFEST_NOTE])
  assert.ok(table.close_resolution.includes('; acceptance READY; ' + NO_MANIFEST_NOTE),
    'the resolution ConPort keeps says the versions were not compared: ' + table.close_resolution)
})

test('epic: with a manifest the close resolution says nothing of it', async () => {
  const { prompt } = await epic({ versions: { ...EQUAL, units: 'manifest' } })
  assert.ok(!accountTable(prompt('account')).close_resolution.includes('versions:'))
})

test('epic: a unit manifest that cannot be read refuses READY as a question, filing no child', async () => {
  const { ledger, prompt } = await epic({ versions: INVALID })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'NOT_READY')
  assert.ok(!table.minors.some(m => m.title.includes('units.json')), 'no child')
  assert.ok(ledger.questions.some(q => q.title === 'Acceptance could not observe: ' + FIX_MANIFEST))
})

test('epic: equal versions pass — the check runs after the last merge, and the epic may close', async () => {
  const { ledger, calls, prompt } = await epic({ versions: EQUAL })
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  const order = labels(calls)
  assert.ok(order.indexOf('versions') > order.indexOf('merge-w0'), 'after the merges')
  assert.ok(order.indexOf('versions') < order.indexOf('account'), 'before the accounting')
  assert.match(prompt('versions'), /versions --branch 'main' --start 'aaa0' --head 'HEAD'/)
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'READY')
  assert.equal(table.may_close, true)
  assert.deepEqual(ledger.versions, { base: 'origin/main', differs: [], cause: 'equal', action: null })
})

test('epic: a raised version refuses READY — the action is an unmet criterion filed as a child of the epic', async () => {
  const { ledger, prompt } = await epic({ versions: raised(PLUGIN) })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'NOT_READY')
  assert.equal(table.may_close, false)
  assert.deepEqual(table.minors.filter(m => m.title.includes('Restore the version')),
    [{ kind: 'bug', title: 'Acceptance unmet: ' + REFUSAL, priority: 2, parent: 500,
      description: 'The acceptance of epic task-500 observed this criterion of its goal unmet: ' + REFUSAL }])
  assert.equal(ledger.goal.verdict, 'NOT_READY')
  assert.deepEqual(ledger.versions, { base: 'origin/main', differs: [PLUGIN], cause: 'raised', action: REFUSAL })
})

test('epic: the acceptor\'s own unmet criteria stay beside the refusal', async () => {
  const { prompt } = await epic({ versions: raised(ORCA), goal: { verdict: 'NOT_READY', checks: [], unmet: ['the page opens'] } })
  const titles = accountTable(prompt('account')).minors.map(m => m.title)
  assert.ok(titles.includes('Acceptance unmet: the page opens'))
  assert.ok(titles.includes('Acceptance unmet: Restore the version of the extension as origin/main has it; units are raised only at the release step.'))
})

test('epic: every unit raised over a commit base still fits the title of the child the accounting files', async () => {
  const AGENT = { unit: 'the agent', path: 'agent-kit/SKILL.md', base: '16.7.0', head: '16.8.0' }
  const { prompt } = await epic({ versions: { ...raised(PLUGIN, AGENT, CLI, ORCA), base: 'abc1234' } })
  const action = 'Restore the version of the web app, the agent, the cli and the extension as abc1234 has it; units are raised only at the release step.'
  const child = accountTable(prompt('account')).minors.find(m => m.title.includes('Restore the version'))
  assert.equal(child.title, 'Acceptance unmet: ' + action)
  assert.ok(child.title.length <= 200, 'the accounting cuts a title at 200 characters: ' + child.title.length)
})

test('epic: a release step not pushed yet refuses READY as a question to the person, filing no child', async () => {
  const { ledger, prompt } = await epic({ versions: unpushed(PLUGIN) })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'NOT_READY')
  assert.equal(table.may_close, false)
  assert.ok(!table.minors.some(m => /Push the release|Restore the version/.test(m.title)), 'no child that undoes or pushes a release')
  assert.ok(ledger.questions.some(q => q.title === 'Acceptance could not observe: ' + PUSH_FIRST))
  assert.equal(ledger.versions.cause, 'unpushed_release')
})

test('epic: a default branch behind the published one refuses READY as a question, filing no child', async () => {
  const { ledger, prompt } = await epic({ versions: behind(PLUGIN) })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'NOT_READY')
  assert.ok(!table.minors.some(m => /Update the default|Restore the version/.test(m.title)), 'no child')
  assert.ok(ledger.questions.some(q => q.title === 'Acceptance could not observe: ' + BEHIND))
  assert.equal(ledger.versions.cause, 'branch_behind')
})

test('epic: a check that does not answer refuses READY and asks the person, filing no child', async () => {
  const { ledger, prompt } = await epic({ versions: null, 'versions-r2': null })
  const table = accountTable(prompt('account'))
  assert.equal(table.verdict, 'NOT_READY')
  assert.equal(table.may_close, false)
  assert.ok(!table.minors.some(m => m.title.includes('unit versions')), 'no child for an unanswered check')
  assert.ok(ledger.questions.some(q => q.title === 'Acceptance could not observe: ' + UNCHECKED))
})
