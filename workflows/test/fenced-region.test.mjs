import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencedRegion, secondMarker, withSecond } from './fenced-region.mjs'

// The reader every parity test in this directory goes through. A region read from
// the wrong place compares, or evaluates, something other than the shipped code
// and stays green, so each way a pair of markers can be wrong is a failure here.
const SRC = ['before', '// X_BEGIN — prose on the marker line', 'one', 'two', '// X_END', 'after', ''].join('\n')
const read = src => fencedRegion(src, 'X_BEGIN', 'X_END', 'fixture')

test('a region is the whole lines strictly between the two marker lines', () => {
  assert.equal(read(SRC), 'one\ntwo\n')
})

test('markers on adjacent lines fence an empty region', () => {
  assert.equal(read('// X_BEGIN\n// X_END\n'), '')
})

test('a missing opening marker fails the reading', () => {
  assert.throws(() => read(SRC.replace('X_BEGIN', 'X_START')),
    { name: 'AssertionError', message: 'marker X_BEGIN missing from fixture' })
})

test('a missing closing marker fails the reading', () => {
  assert.throws(() => read(SRC.replace('X_END', 'X_STOP')),
    { name: 'AssertionError', message: 'marker X_END missing from fixture or out of order' })
})

test('a closing marker ahead of the opening one fails the reading', () => {
  assert.throws(() => read('// X_END\none\n// X_BEGIN\n'),
    { name: 'AssertionError', message: 'marker X_END missing from fixture or out of order' })
})

for (const marker of ['X_BEGIN', 'X_END'])
  test(`a second ${marker} after the region fails the reading`, () => {
    assert.throws(() => read(withSecond(SRC, marker)), secondMarker(marker, 'fixture'))
  })

// A marker is a whole name: PIPE_BEGIN is not found inside ACCOUNT_PIPE_BEGIN.
const NESTED = ['// ACCOUNT_PIPE_BEGIN', 'account', '// ACCOUNT_PIPE_END', '// PIPE_BEGIN', 'pipe', '// PIPE_END', ''].join('\n')

test('a pair whose name ends another pair\'s name is read as its own region', () => {
  assert.equal(fencedRegion(NESTED, 'PIPE_BEGIN', 'PIPE_END', 'fixture'), 'pipe\n')
  assert.equal(fencedRegion(NESTED, 'ACCOUNT_PIPE_BEGIN', 'ACCOUNT_PIPE_END', 'fixture'), 'account\n')
})

test('a longer name carrying the marker is not the marker: the short pair is missing', () => {
  const longOnly = NESTED.split('\n').slice(0, 3).join('\n') + '\n'
  assert.throws(() => fencedRegion(longOnly, 'PIPE_BEGIN', 'PIPE_END', 'fixture'),
    { name: 'AssertionError', message: 'marker PIPE_BEGIN missing from fixture' })
})

test('a name that only starts with the marker is not the marker', () => {
  assert.throws(() => fencedRegion('// X_BEGINNING\none\n// X_END\n', 'X_BEGIN', 'X_END', 'fixture'),
    { name: 'AssertionError', message: 'marker X_BEGIN missing from fixture' })
})

// Without the guard the first pair wins: a pair pasted ahead of the real one
// becomes the region that is read.
test('a second opening marker ahead of the region fails the reading', () => {
  assert.throws(() => read(`// X_BEGIN\nstray\n${SRC}`), secondMarker('X_BEGIN', 'fixture'))
})

// Without the guard the region is cut short at the first closing marker.
test('a second closing marker inside the region fails the reading', () => {
  assert.throws(() => read(SRC.replace('two', '// X_END\ntwo')), secondMarker('X_END', 'fixture'))
})
