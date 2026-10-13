import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The one reader of marker-fenced regions for every test in this directory. The
// workflow scripts are evaluated with no imports, so shared code and shared prose
// are duplicated by hand and fenced by `<NAME>_BEGIN` / `<NAME>_END` markers that
// live inside comments; the tests read the region between a pair and compare or
// evaluate it.
export const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))

export const source = file => readFileSync(join(WORKFLOWS, file), 'utf8')

// The lines strictly between the two marker lines of `src`. `file` only names the
// source in the failure message. Each marker must occur exactly once: with a
// second one the first pair would win silently, and the comparison would run on
// lines that are not the region the markers were put around.
// A marker is matched as a whole name, never as a part of a longer one: PIPE_BEGIN
// is not found inside ACCOUNT_PIPE_BEGIN, which would otherwise be either a false
// "more than once" or, with the short pair absent, a reading of the other region.
const occurrences = (src, marker) =>
  [...src.matchAll(new RegExp(`(?<![A-Za-z0-9_])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g'))]
    .map(m => m.index)

export const fencedRegion = (src, begin, end, file) => {
  const [from = -1, ...moreBegins] = occurrences(src, begin)
  const [to = -1, ...moreEnds] = occurrences(src, end)
  assert.ok(from >= 0, `marker ${begin} missing from ${file}`)
  assert.ok(to > from, `marker ${end} missing from ${file} or out of order`)
  assert.ok(moreBegins.length === 0, `marker ${begin} occurs more than once in ${file}`)
  assert.ok(moreEnds.length === 0, `marker ${end} occurs more than once in ${file}`)
  // whole lines only: the markers themselves live inside comments
  return src.slice(src.indexOf('\n', from) + 1, src.lastIndexOf('\n', to) + 1)
}

// A copy of `src` that carries `marker` a second time, on a line of its own.
export const withSecond = (src, marker) => `${src}\n// ${marker}\n`

// What a reading of a source that carries `marker` twice fails with.
export const secondMarker = (marker, file) => ({
  name: 'AssertionError',
  message: `marker ${marker} occurs more than once in ${file}`,
})
