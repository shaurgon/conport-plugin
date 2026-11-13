import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencedRegion, secondMarker, source, withSecond } from './fenced-region.mjs'

// task.js and epic.js are evaluated by the workflow runner in isolation, with no
// imports, so their shared mechanics are duplicated by hand under a declared
// mirror rule. The scout skeleton already has a guard (scout-base-parity); this
// test extends the same byte-for-byte comparison to the remaining declared
// mirrored areas — the pipe block (pipe/argFiles/gateFile/shq), the pipe prompts
// built on it (preflight and baseline gate, merge, cleanup), the accountant
// branch-A skeleton (accountPipe) and the SKELETON_VERSION declaration. An edit
// to one file that is not mirrored in the other is a red test here, not a
// workflow that behaves differently for tasks and for epics.
const region = (file, name, src = source(file)) => fencedRegion(src, `${name}_BEGIN`, `${name}_END`, file)

// Every region this test compares, with the declarations that prove the markers
// fence what the name says.
const MIRRORED = {
  PIPE_BASE: ['const pipe =', 'const piped =', 'const cleanupNote =', 'const cleanup =', 'const argFiles =', 'const gateFile =', 'const shq ='],
  PIPE_CYCLE: ['const S_CYC =', 'const S_BR =', 'const cyclePrompt =', 'const branchPrompt =', 'const journalVerdict =',
    'const REVIEW_NOTES =', 'const cycle =', 'const reviewStep =', 'const noBranchDetail =', 'const adoptWorktree ='],
  PIPE_PRE: ['const prePrompt =', 'const basePrompt ='],
  PIPE_MERGE: ['const mergeArgs =', 'const mergeCommand =', 'const mergePrompt =', 'const mergeStatePrompt ='],
  PIPE_JAN: ['const janPrompt ='],
  PIPE_VERSIONS: ['const S_VER =', 'const versionsPrompt =', 'const VERSIONS_UNCHECKED =', 'const versionsVerdict =', 'const versionsLedger ='],
  ACCOUNT_PIPE: ['const accountPipe =', 'node <helper> account'],
  AGENT_TYPES: ['const AGENT =', "'conport:sdd-implementer'", 'const NO_AGENT_TYPE =', 'const typed ='],
  SPEC_EDIT: ['const specBrief =', 'const specImplRule =', 'const specFixRule =', 'const specReviewRule ='],
  REVIEW_CONCERNS: ['const S_REV =', 'const concernsOf =', 'const concernRuleOf =', 'const revSchemaOf =', 'const ruled ='],
}

for (const [name, carries] of Object.entries(MIRRORED)) {
  test(`the ${name} region (${carries.join(', ')}) is byte-identical in task.js and epic.js`, () => {
    const fromTask = region('task.js', name)
    for (const text of carries)
      assert.ok(fromTask.includes(text), `the extracted region carries ${text}`)
    assert.equal(fromTask, region('epic.js', name),
      'the mirrored region diverged — edit both files together')
  })

  for (const file of ['task.js', 'epic.js'])
    for (const marker of [`${name}_BEGIN`, `${name}_END`])
      test(`${file}: a second ${marker} fails the reading instead of moving the comparison`, () => {
        assert.throws(() => region(file, name, withSecond(source(file), marker)), secondMarker(marker, file))
      })
}

// The mirror rule at the head of each file lists the fenced regions both files
// carry: a region fenced in both and missing from the list is a rule that no
// longer says what the tests hold.
const fencedNames = file => new Set([...source(file).matchAll(/\b([A-Z][A-Z_]*)_BEGIN\b/g)].map(m => m[1]))
const mirrorRule = file => {
  const src = source(file)
  const from = src.indexOf('// Mirror rule:')
  assert.ok(from >= 0, `no mirror rule in ${file}`)
  return src.slice(from, src.indexOf('\n\n', from))
}

for (const file of ['task.js', 'epic.js'])
  test(`${file}: the mirror rule names every region fenced in both files`, () => {
    const other = fencedNames(file === 'task.js' ? 'epic.js' : 'task.js')
    const rule = mirrorRule(file)
    const missing = [...fencedNames(file)].filter(name => other.has(name) && !new RegExp(`\\b${name}\\b`).test(rule))
    assert.deepEqual(missing, [], `the mirror rule of ${file} does not name ${missing.join(', ')}`)
  })

const skeletonVersionLine = file => {
  const matches = source(file).match(/^const SKELETON_VERSION = .+$/gm)
  assert.ok(matches, `SKELETON_VERSION declaration missing from ${file}`)
  assert.equal(matches.length, 1, `exactly one SKELETON_VERSION declaration in ${file}`)
  return matches[0]
}

test('SKELETON_VERSION is declared identically in task.js and epic.js', () => {
  assert.equal(skeletonVersionLine('task.js'), skeletonVersionLine('epic.js'),
    'SKELETON_VERSION diverged — bump it in both files together')
})
