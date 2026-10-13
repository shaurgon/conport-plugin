import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencedRegion, secondMarker, source, withSecond } from './fenced-region.mjs'

// The scout skeleton — how the helper is located, what its stdout means, and when
// the run falls back to branch B — is duplicated in task.js and epic.js, because
// the workflow runner evaluates each file on its own with no imports. Duplicated
// prose drifts silently, so the shared region is fenced by markers and compared
// here byte for byte: a change to one file that is not mirrored in the other is a
// red test, not a workflow that behaves differently for tasks and for epics.
const BEGIN = 'SCOUT_BASE_BEGIN'
const END = 'SCOUT_BASE_END'

const scoutBaseRegion = (file, src = source(file)) => fencedRegion(src, BEGIN, END, file)

test('the scout base skeleton is byte-identical in task.js and epic.js', () => {
  const fromTask = scoutBaseRegion('task.js')
  assert.ok(fromTask.includes('node <helper> scout'), 'the extracted region is the scout skeleton')
  assert.equal(fromTask, scoutBaseRegion('epic.js'),
    'the mirrored region diverged — edit both files together')
})

for (const file of ['task.js', 'epic.js'])
  for (const marker of [BEGIN, END])
    test(`${file}: a second ${marker} fails the reading instead of moving the comparison`, () => {
      assert.throws(() => scoutBaseRegion(file, withSecond(source(file), marker)), secondMarker(marker, file))
    })
