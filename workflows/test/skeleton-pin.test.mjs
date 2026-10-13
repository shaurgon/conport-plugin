import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// SKELETON_VERSION is what tells a running workflow that the prompt skeleton it
// was written against has changed, so the rule is "bump it on every skeleton
// edit". A rule nothing checks is a comment: this test pins the content of the
// skeleton regions listed in REGIONS, in both workflows, to the version they
// shipped under. Editing a region without touching the pin is a red test that says what
// to do; the pin below is then updated together with the version.
//
// To re-pin after a skeleton edit: bump SKELETON_VERSION in task.js and epic.js,
// run this file (node --test <this file>) and copy the version and the sha256 it
// prints in the failure message into PIN.
const PIN = {
  version: 11,
  sha256: '4f90b33c567309ee7e29d4474234b03aa32cb0a92ac294d2addf1a151a9b977c',
}

const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const FILES = ['task.js', 'epic.js']
const REGIONS = [
  ['PIPE_BASE_BEGIN', 'PIPE_BASE_END'],
  ['SCOUT_BASE_BEGIN', 'SCOUT_BASE_END'],
  ['ACCOUNT_PIPE_BEGIN', 'ACCOUNT_PIPE_END'],
]

// Line endings are normalised: a checkout that rewrites them is not a skeleton edit.
const source = file => readFileSync(join(WORKFLOWS, file), 'utf8').replaceAll('\r\n', '\n')

// The whole lines strictly between the two marker lines.
const region = (file, begin, end) => {
  const src = source(file)
  const from = src.indexOf(begin)
  const to = src.indexOf(end)
  assert.ok(from >= 0, `marker ${begin} missing from ${file}`)
  assert.ok(to > from, `marker ${end} missing from ${file} or out of order`)
  return src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
}

const skeletonHash = () => {
  const hash = createHash('sha256')
  for (const file of FILES)
    for (const [begin, end] of REGIONS) {
      // the label keeps a line moved from one region to another from hashing alike
      hash.update(`${file}:${begin}\n`)
      hash.update(region(file, begin, end))
    }
  return hash.digest('hex')
}

const version = file => {
  const m = /^const SKELETON_VERSION = (\d+)\b/m.exec(source(file))
  assert.ok(m, `SKELETON_VERSION missing from ${file}`)
  return Number(m[1])
}

test('every pinned region is a non-empty skeleton', () => {
  for (const file of FILES)
    for (const [begin, end] of REGIONS)
      assert.ok(region(file, begin, end).trim().length > 0, `${begin}..${end} is empty in ${file}`)
})

test('the skeleton regions are the ones SKELETON_VERSION was last bumped for', () => {
  const actual = skeletonHash()
  assert.equal(actual, PIN.sha256,
    `a pinned skeleton region (see REGIONS) changed since SKELETON_VERSION ${PIN.version}: ` +
    `bump SKELETON_VERSION in task.js and epic.js to ${PIN.version + 1}, then set PIN to ` +
    `{ version: ${PIN.version + 1}, sha256: '${actual}' }`)
})

test('SKELETON_VERSION is the pinned one in both workflows', () => {
  for (const file of FILES)
    assert.equal(version(file), PIN.version,
      `${file} carries SKELETON_VERSION ${version(file)} while the pin is for ${PIN.version}: ` +
      `set PIN to { version: ${version(file)}, sha256: '${skeletonHash()}' }`)
})
