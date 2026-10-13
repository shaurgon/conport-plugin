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

  test(`${file}: a janitor that returned nothing is named in the notes`, async () => {
    const ledger = await go(null)
    assert.deepEqual(cleanupNotes(ledger), ['cleanup: the janitor returned no report'])
    assert.equal(ledger.outcome, green)
  })
}
