import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// STEP 2 of the hybrid scout carries the helper's values over unchanged. When the
// helper found no plan file, those values are empty — and the agent is told, in
// that same step, to locate the plan itself first (the base carries no plan_path
// to point at exactly when the reading is needed). Carrying the empty constraints and the null
// gate forward then ships an implementer without the project's prohibitions and
// without a gate, from a plan file that is right there. The instruction that
// forbids it is worded identically in both workflows, and drifts silently unless
// it is compared: this test reads the shipped source of both files.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const source = file => readFileSync(join(WORKFLOWS, file), 'utf8')

const PLAN_FALLBACK = `base.plan_path is null -> locate the plan yourself before filling those values:
grep the anchor '<!-- conport-task: <id> -->' of the id above (an epic id: its
'<!-- conport-epic: <id> -->' anchor) across docs/superpowers/plans/*.md, else a
plan reference in the task description;
nothing found -> leave the values empty (do NOT invent a plan).
Plan file known here — base.plan_path, or one you located in this step — while the
base carried none of its values (base.global_constraints empty, base.gate null) ->
read the Global Constraints verbatim and the gate object out of THAT file; never
carry the base's empty values forward.`

for (const file of ['task.js', 'epic.js'])
  test(`${file}: STEP 2 reads the constraints and the gate out of a plan file the base did not cover`, () => {
    const src = source(file)
    assert.ok(src.includes(PLAN_FALLBACK), `the plan-file fallback instruction is missing from ${file}`)
    assert.ok(src.indexOf(PLAN_FALLBACK) > src.indexOf('=== STEP 2'),
      'the instruction belongs to STEP 2, not to branch B')
    assert.ok(src.indexOf(PLAN_FALLBACK) < src.indexOf('=== BRANCH B'),
      'the instruction belongs to STEP 2, not to branch B')
  })

// A prompt edit the other file does not get is a workflow that behaves differently
// for tasks and for epics; the version number is what tells a running workflow that
// the skeleton it was written against has changed.
test('SKELETON_VERSION is bumped and identical in both workflows', () => {
  const version = file => {
    const m = /const SKELETON_VERSION = (\d+)/.exec(source(file))
    assert.ok(m, `SKELETON_VERSION missing from ${file}`)
    return Number(m[1])
  }
  // Equality is the invariant; the floor only proves the number moved past the
  // skeleton these tests were written against. Pinning the exact value instead
  // turns every later skeleton edit into a failing test that says nothing.
  const task = version('task.js')
  assert.equal(task, version('epic.js'), 'the two workflows carry different skeleton versions')
  assert.ok(task > 7, `SKELETON_VERSION must be past 7, got ${task}`)
})
