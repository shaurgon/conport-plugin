import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// task.js and epic.js are evaluated by the workflow runner in isolation, with no
// imports, so their shared mechanics are duplicated by hand under a declared
// mirror rule. The scout skeleton already has a guard (scout-base-parity); this
// test extends the same byte-for-byte comparison to the remaining declared
// mirrored areas — the pipe block (pipe/argFiles/gateFile/shq), the accountant
// branch-A skeleton (accountPipe) and the SKELETON_VERSION declaration. An edit
// to one file that is not mirrored in the other is a red test here, not a
// workflow that behaves differently for tasks and for epics.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))

const region = (file, begin, end) => {
  const src = readFileSync(join(WORKFLOWS, file), 'utf8')
  const from = src.indexOf(begin)
  const to = src.indexOf(end)
  assert.ok(from >= 0, `marker ${begin} missing from ${file}`)
  assert.ok(to > from, `marker ${end} missing from ${file} or out of order`)
  assert.equal(src.indexOf(begin, from + 1), -1, `marker ${begin} occurs more than once in ${file}`)
  assert.equal(src.indexOf(end, to + 1), -1, `marker ${end} occurs more than once in ${file}`)
  // whole lines only: the markers themselves live inside comments
  return src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
}

test('the pipe block (pipe/argFiles/gateFile/shq) is byte-identical in task.js and epic.js', () => {
  const fromTask = region('task.js', 'PIPE_BASE_BEGIN', 'PIPE_BASE_END')
  for (const decl of ['const pipe =', 'const argFiles =', 'const gateFile =', 'const shq ='])
    assert.ok(fromTask.includes(decl), `the extracted region carries ${decl}`)
  assert.equal(fromTask, region('epic.js', 'PIPE_BASE_BEGIN', 'PIPE_BASE_END'),
    'the mirrored region diverged — edit both files together')
})

test('the accountant branch-A skeleton (accountPipe) is byte-identical in task.js and epic.js', () => {
  const fromTask = region('task.js', 'ACCOUNT_PIPE_BEGIN', 'ACCOUNT_PIPE_END')
  assert.ok(fromTask.includes('const accountPipe ='), 'the extracted region carries accountPipe')
  assert.ok(fromTask.includes('node <helper> account'), 'the extracted region is the accountant skeleton')
  assert.equal(fromTask, region('epic.js', 'ACCOUNT_PIPE_BEGIN', 'ACCOUNT_PIPE_END'),
    'the mirrored region diverged — edit both files together')
})

const skeletonVersionLine = file => {
  const src = readFileSync(join(WORKFLOWS, file), 'utf8')
  const matches = src.match(/^const SKELETON_VERSION = .+$/gm)
  assert.ok(matches, `SKELETON_VERSION declaration missing from ${file}`)
  assert.equal(matches.length, 1, `exactly one SKELETON_VERSION declaration in ${file}`)
  return matches[0]
}

test('SKELETON_VERSION is declared identically in task.js and epic.js', () => {
  assert.equal(skeletonVersionLine('task.js'), skeletonVersionLine('epic.js'),
    'SKELETON_VERSION diverged — bump it in both files together')
})
