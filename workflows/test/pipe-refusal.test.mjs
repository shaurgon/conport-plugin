import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, RUNS } from './run-workflow.mjs'

// A mechanical step is one helper command run by an agent. When that step yields
// nothing usable the run records UNKNOWN_MERGE (or aborts) — and it used to do so
// identically whether the helper crashed, printed garbage, or the agent's Bash
// call was refused by the permission system before the helper ever ran. The pipe
// prompt now prescribes an error object for a refusal, in the shape of the
// helper's own sentinels; the script admits that shape through the schema and
// writes it into the ledger notes, then takes the same road a dead answer takes.
const REFUSAL = 'refused: Bash call denied by the permission classifier'
const errorNotes = ledger => ledger.notes.filter(n => n.includes(' error:"'))

// What the run recorded for the one task it carried.
const mergeFate = (file, ledger) => file === 'task.js' ? ledger.fail_reason : ledger.tasks['501'].state

for (const { file, run, green, mergeLabel } of RUNS) {
  const go = async over => {
    const { args, answers } = run(over)
    return runWorkflow(file, args, answers)
  }
  const stateLabel = mergeLabel.replace('merge', 'mstate')

  test(`${file}: a refused merge names the refusal in the ledger notes`, async () => {
    const { ledger } = await go({ [mergeLabel]: { error: REFUSAL }, [stateLabel]: { error: REFUSAL } })
    assert.equal(mergeFate(file, ledger), 'UNKNOWN_MERGE', 'the outcome is the one a dead merge gets')
    assert.deepEqual(errorNotes(ledger),
      [`${mergeLabel} error:"${REFUSAL}"`, `${stateLabel} error:"${REFUSAL}"`])
  })

  test(`${file}: a crashed merge reaches the same outcome with no error note`, async () => {
    const { ledger } = await go({ [mergeLabel]: null, [stateLabel]: null })
    assert.equal(mergeFate(file, ledger), 'UNKNOWN_MERGE')
    assert.deepEqual(errorNotes(ledger), [], 'a crash is not reported as a refusal')
  })

  test(`${file}: a merge answer that is neither a report nor an error is a dead answer`, async () => {
    const { ledger } = await go({ [mergeLabel]: {}, [stateLabel]: { gate_tail: 'noise' } })
    assert.equal(mergeFate(file, ledger), 'UNKNOWN_MERGE', 'the required key is still demanded')
    assert.deepEqual(errorNotes(ledger), [])
  })

  test(`${file}: a refusal followed by a successful retry keeps the note and the green outcome`, async () => {
    const id = file === 'task.js' ? 7 : 501
    const { ledger } = await go({
      [mergeLabel]: { error: REFUSAL },
      [stateLabel]: { results: [{ id, status: 'NOT_MERGED' }] },
      [mergeLabel + '-r2']: { results: [{ id, status: 'MERGED', merge_sha: 'ddd3' }] },
    })
    assert.equal(ledger.outcome, green)
    assert.deepEqual(errorNotes(ledger), [`${mergeLabel} error:"${REFUSAL}"`])
  })

  test(`${file}: the helper's own sentinel is named the same way — a missing helper at preflight`, async () => {
    const { ledger } = await go({ preflight: { error: 'wf-helper not found' }, 'preflight-r2': { error: 'wf-helper not found' } })
    assert.equal(ledger.abort_reason, 'ABORTED_PREFLIGHT')
    assert.deepEqual(errorNotes(ledger),
      ['preflight error:"wf-helper not found"', 'preflight-r2 error:"wf-helper not found"'])
  })

  test(`${file}: a refused gate at the baseline is named and aborts as before`, async () => {
    const { ledger } = await go({ baseline: { error: REFUSAL }, 'baseline-r2': { error: REFUSAL } })
    assert.equal(ledger.abort_reason, 'ABORTED_BASELINE')
    assert.deepEqual(errorNotes(ledger), [`baseline error:"${REFUSAL}"`, `baseline-r2 error:"${REFUSAL}"`])
  })

  test(`${file}: a refused cleanup is named and does not fail the run`, async () => {
    const { ledger } = await go({ janitor: { error: REFUSAL } })
    assert.equal(ledger.outcome, green)
    assert.deepEqual(errorNotes(ledger), [`janitor error:"${REFUSAL}"`])
    // The janitor did answer: "returned no report" would contradict the note above.
    assert.deepEqual(ledger.notes.filter(n => n.startsWith('cleanup')), [])
  })

  test(`${file}: every pipe prompt prescribes the refusal object, and its schema admits it`, async () => {
    const { calls } = await go()
    for (const label of ['preflight', 'baseline', mergeLabel, 'janitor']) {
      const call = calls.find(c => c.label === label)
      assert.ok(call, `${label} ran`)
      assert.ok(call.prompt.includes('{"error": "refused: <'), `${label} prompt does not prescribe the refusal object`)
      assert.deepEqual(call.opts.schema.properties.error, { type: 'string' }, `${label} schema drops the error key`)
      assert.equal(call.opts.schema.required, undefined,
        `${label} schema still requires report keys, so an error object would be discarded before the script sees it`)
    }
    // Judgement agents are not pipes: their schemas stay strict.
    const scout = calls.find(c => c.label === 'scout')
    assert.ok(scout.opts.schema.required.length > 0)
    assert.ok(!scout.prompt.includes('{"error": "refused: <'))
  })
}
