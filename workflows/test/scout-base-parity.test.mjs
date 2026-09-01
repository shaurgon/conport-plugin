import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The scout skeleton — how the helper is located, what its stdout means, and when
// the run falls back to branch B — is duplicated in task.js and epic.js, because
// the workflow runner evaluates each file on its own with no imports. Duplicated
// prose drifts silently, so the shared region is fenced by markers and compared
// here byte for byte: a change to one file that is not mirrored in the other is a
// red test, not a workflow that behaves differently for tasks and for epics.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const BEGIN = 'SCOUT_BASE_BEGIN'
const END = 'SCOUT_BASE_END'

const scoutBaseRegion = file => {
  const src = readFileSync(join(WORKFLOWS, file), 'utf8')
  const from = src.indexOf(BEGIN)
  const to = src.indexOf(END)
  assert.ok(from >= 0, `marker ${BEGIN} missing from ${file}`)
  assert.ok(to > from, `marker ${END} missing from ${file} or out of order`)
  // whole lines only: the markers themselves live inside comments
  return src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
}

test('the scout base skeleton is byte-identical in task.js and epic.js', () => {
  const fromTask = scoutBaseRegion('task.js')
  assert.ok(fromTask.includes('node <helper> scout'), 'the extracted region is the scout skeleton')
  assert.equal(fromTask, scoutBaseRegion('epic.js'),
    'the mirrored region diverged — edit both files together')
})
