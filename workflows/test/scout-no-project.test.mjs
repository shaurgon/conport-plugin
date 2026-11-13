import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencedRegion, secondMarker, source, withSecond } from './fenced-region.mjs'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'

// Step 0 of branch B resolves the project when the helper gave no base. A broken
// settings file or a failing git names no project, and nothing stands in for it:
// neither the other file nor CONPORT_PROJECT_NAME. The step is duplicated in
// task.js and epic.js (each file is evaluated on its own), so it is fenced and
// compared byte for byte, and its rules are held here for both.
const BEGIN = 'SCOUT_PROJECT_BEGIN'
const END = 'SCOUT_PROJECT_END'
const FILES = ['task.js', 'epic.js']

const region = (file, src = source(file)) => fencedRegion(src, BEGIN, END, file)

test('the project step of branch B is byte-identical in task.js and epic.js', () => {
  assert.equal(region('task.js'), region('epic.js'), 'the mirrored region diverged — edit both files together')
})

for (const file of FILES) {
  for (const marker of [BEGIN, END])
    test(`${file}: a second ${marker} fails the reading instead of moving the comparison`, () => {
      assert.throws(() => region(file, withSecond(source(file), marker)), secondMarker(marker, file))
    })

  test(`${file}: branch B resolves the project through the fenced step`, () => {
    const src = source(file)
    const branchB = src.slice(src.indexOf('=== BRANCH B'))
    assert.match(branchB, /^\$\{projectStep\(project\)\}$/m, 'branch B starts from the project step')
    assert.doesNotMatch(src, /else env\n\s*CONPORT_PROJECT_NAME/, 'no second wording of the step outside the region')
  })

  test(`${file}: the project step refuses a broken file and lets the variable in only when no file sets project_name`, () => {
    const text = region(file)
    // the lines the helper answered are returned verbatim, never resolved around
    assert.match(text, /"error": "no project" and a non-empty "lines"/)
    assert.match(text, /return exactly \{"no_project": <those lines, verbatim>\} and stop/)
    // git asked in English; a failure other than "not a git repository" reads nothing
    assert.match(text, /LC_ALL=C git rev-parse --show-toplevel/)
    assert.match(text, /git failed \(<first line of the error>\): ConPort settings were not read/)
    // a broken file names no project, and nothing stands in for it
    for (const broken of ['cannot be read', 'is not valid JSON', 'is not a JSON object', 'not a non-empty string', 'holds an API key'])
      assert.match(text, new RegExp(broken.split(' ').join('\\s+')), `a file that ${broken} names no project`)
    assert.match(text, /neither\s+the other file nor CONPORT_PROJECT_NAME stands in for it/)
    // the variable only when no file sets project_name
    assert.match(text, /only when neither file\s+sets project_name, env CONPORT_PROJECT_NAME/)
    assert.match(text, /\{"no_project": \["no ConPort project: set project_name in \.conport\.json"\]\}/)
  })
}

// The scout's answer {no_project: [...]} stops the run with those lines: the
// schema admits it, and the run refuses before anything else is read from it.
const LINES = ['.conport.json is not valid JSON (line 1, column 19): fix it']
for (const [file, run] of [['task.js', taskRun], ['epic.js', epicRun]]) {
  test(`${file}: a scout answering no_project aborts the run with its lines`, async () => {
    const { args, answers } = run({ scout: { no_project: LINES } })
    const { ledger, calls } = await runWorkflow(file, args, answers)

    assert.equal(ledger.abort_reason, 'ABORTED_NO_PROJECT')
    assert.equal(ledger.abort_detail, LINES[0])
    const scout = calls.find(c => c.label === 'scout')
    assert.deepEqual(scout.opts.schema.properties.no_project, { type: 'array', items: { type: 'string' } })
    assert.ok(!calls.some(c => c.label === 'baseline' || c.label === 'impl'), 'nothing runs after the refusal')
  })

  test(`${file}: an empty no_project list aborts with the one action`, async () => {
    const { args, answers } = run({ scout: { no_project: [] } })
    const { ledger } = await runWorkflow(file, args, answers)

    assert.equal(ledger.abort_reason, 'ABORTED_NO_PROJECT')
    assert.equal(ledger.abort_detail, 'no ConPort project: set project_name in .conport.json')
  })

  // A model filling the schema may set an empty list beside a whole base: that is
  // a base, and the run goes on past the scout.
  test(`${file}: a whole base with an empty no_project list goes on past the scout`, async () => {
    const { args, answers } = run()
    const { ledger, calls } = await runWorkflow(file, args, { ...answers, scout: { ...answers.scout, no_project: [] } })

    assert.notEqual(ledger.abort_reason, 'ABORTED_NO_PROJECT')
    assert.notEqual(ledger.abort_reason, 'ABORTED_NO_SCOUT')
    assert.ok(calls.some(c => c.label === 'baseline'), 'the run reaches the baseline gate')
  })

  // Lines are a refusal even beside a base: the settings named no project.
  test(`${file}: a base with lines in no_project still aborts with them`, async () => {
    const { args, answers } = run()
    const { ledger } = await runWorkflow(file, args, { ...answers, scout: { ...answers.scout, no_project: LINES } })

    assert.equal(ledger.abort_reason, 'ABORTED_NO_PROJECT')
    assert.equal(ledger.abort_detail, LINES[0])
  })

  test(`${file}: a scout answer that is neither a base nor no_project is no scout`, async () => {
    const { args, answers } = run({ scout: { via: 'mcp' } })
    const { ledger } = await runWorkflow(file, args, answers)

    assert.equal(ledger.abort_reason, 'ABORTED_NO_SCOUT')
  })

  // The schema handed to the agent no longer requires the base keys, so the run
  // holds them: a base without its project is no scout.
  test(`${file}: a base without its project is no scout`, async () => {
    const { project, ...noProject } = run().answers.scout
    assert.ok(project)
    const { args, answers } = run({ scout: noProject })
    const { ledger } = await runWorkflow(file, args, answers)

    assert.equal(ledger.abort_reason, 'ABORTED_NO_SCOUT')
  })
}
