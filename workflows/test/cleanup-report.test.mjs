import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, RUNS } from './run-workflow.mjs'

// Cleanup is best effort: a branch git refuses to delete or a worktree it cannot
// remove must not fail a run whose work is already merged and accounted. But the
// janitor's report used to be dropped on the floor, so the debris it could not
// remove was invisible in the run report. The errors now travel in the ledger's
// notes; these tests run both workflows end to end with a stand-in for the agents
// and read the ledger the run returns.
const cleanupNotes = ledger => ledger.notes.filter(n => n.startsWith('cleanup'))

for (const { file, run, green } of RUNS) {
  const go = async janitor => {
    const { args, answers } = run({ janitor })
    return (await runWorkflow(file, args, answers)).ledger
  }

  test(`${file}: a green run reaches its usual outcome with no cleanup note`, async () => {
    const { args, answers } = run()
    const { ledger, calls } = await runWorkflow(file, args, answers)
    assert.equal(ledger.outcome, green)
    assert.ok(calls.some(c => c.label === 'janitor'), 'the janitor ran')
    assert.deepEqual(cleanupNotes(ledger), [])
  })

  test(`${file}: the janitor's errors land in the ledger notes, the run is not failed`, async () => {
    const ledger = await go({ deleted: [], kept: [], worktrees_removed: [],
      errors: ['branch -D task/t7: not fully merged', 'worktree prune: locked'] })
    assert.deepEqual(cleanupNotes(ledger),
      ['cleanup errors: branch -D task/t7: not fully merged; worktree prune: locked'])
    assert.equal(ledger.outcome, green, 'cleanup is best effort — the outcome stands')
  })

  test(`${file}: a single error is one note`, async () => {
    const ledger = await go({ errors: ['worktree remove /tmp/wt-7: busy'] })
    assert.deepEqual(cleanupNotes(ledger), ['cleanup errors: worktree remove /tmp/wt-7: busy'])
  })

  test(`${file}: a report without errors, or without the key at all, leaves no note`, async () => {
    assert.deepEqual(cleanupNotes(await go({ errors: [] })), [])
    assert.deepEqual(cleanupNotes(await go({})), [])
  })

  // The branches cleanup left on purpose — the run's own unmerged ones — are not
  // errors, but the operator reads the ledger, not the janitor's transcript.
  test(`${file}: the branches cleanup kept are named in one note, the run is not failed`, async () => {
    const ledger = await go({ deleted: ['task/t1'], kept: ['task/t7', 'task/t9'],
      worktrees_removed: [], errors: [] })
    assert.deepEqual(cleanupNotes(ledger), ['cleanup kept: task/t7, task/t9'])
    assert.equal(ledger.outcome, green, 'a kept branch is the policy — the outcome stands')
  })

  test(`${file}: a single kept branch is one note`, async () => {
    assert.deepEqual(cleanupNotes(await go({ kept: ['task/t7'] })), ['cleanup kept: task/t7'])
  })

  test(`${file}: an empty kept, a missing one or one that is not a list leaves no note`, async () => {
    assert.deepEqual(cleanupNotes(await go({ kept: [] })), [])
    assert.deepEqual(cleanupNotes(await go({ deleted: ['task/t1'] })), [])
    assert.deepEqual(cleanupNotes(await go({ kept: 'task/t7' })), [])
  })

  // A name is a non-empty string: anything else in the list is not a branch.
  test(`${file}: a kept list with no branch name in it leaves no note`, async () => {
    assert.deepEqual(cleanupNotes(await go({ kept: [''] })), [])
    assert.deepEqual(cleanupNotes(await go({ kept: [1, null, {}] })), [])
  })

  test(`${file}: only the branch names of a kept list reach the note`, async () => {
    assert.deepEqual(cleanupNotes(await go({ kept: ['', 1, 'task/t7', null, {}] })),
      ['cleanup kept: task/t7'])
  })

  test(`${file}: kept branches and errors are two notes`, async () => {
    const ledger = await go({ kept: ['task/t7'], errors: ['worktree prune: locked'] })
    assert.deepEqual(cleanupNotes(ledger),
      ['cleanup errors: worktree prune: locked', 'cleanup kept: task/t7'])
    assert.equal(ledger.outcome, green)
  })

  test(`${file}: a janitor that returned nothing is named in the notes`, async () => {
    const ledger = await go(null)
    assert.deepEqual(cleanupNotes(ledger), ['cleanup: the janitor returned no report'])
    assert.equal(ledger.outcome, green)
  })
}
