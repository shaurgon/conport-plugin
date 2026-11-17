// The time budgets of the hooks and the one variable that scales them
// (hook-time.js): a positive number multiplies every budget, anything else
// leaves it as the hook has it, and a stretch counts only in a hook test run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { HOOK_TIME_SCALE, isolatedEnv } from './support/isolated.mjs'

const { SCALE_VAR, TEST_MARK_VAR, budgetMs } = createRequire(import.meta.url)('../hook-time.js')
// A hook test run: the mark isolatedEnv sets.
const TEST = { [TEST_MARK_VAR]: '/repo' }

test('the scale variable is CONPORT_HOOK_TIME_SCALE, and a test run is marked by CONPORT_SETTINGS_FORBID_ROOT', () => {
  assert.equal(SCALE_VAR, 'CONPORT_HOOK_TIME_SCALE')
  assert.equal(TEST_MARK_VAR, 'CONPORT_SETTINGS_FORBID_ROOT')
})

test('without a scale a budget is the one the hook has', () => {
  assert.equal(budgetMs(500, {}), 500)
  assert.equal(budgetMs(3000, { OTHER: '20' }), 3000)
})

test('in a test run a positive scale multiplies the budget, rounded to whole milliseconds', () => {
  assert.equal(budgetMs(500, { ...TEST, [SCALE_VAR]: '20' }), 10000)
  assert.equal(budgetMs(3000, { ...TEST, [SCALE_VAR]: '0.1' }), 300)
  assert.equal(budgetMs(250, { ...TEST, [SCALE_VAR]: '0.01' }), 3)   // 2.5 rounds up
  assert.equal(budgetMs(3000, { ...TEST, [SCALE_VAR]: '1' }), 3000)
  assert.equal(budgetMs(5000, { ...TEST, [SCALE_VAR]: ' 2 ' }), 10000)
})

// A user's value never makes a hook outlast the timeout Claude Code gives it:
// outside a test run the factor is cut to 1, on the boundary and above it.
test('outside a test run a scale above 1 is cut to 1, and a scale up to 1 still shrinks', () => {
  for (const value of ['20', '1.34', '1.0001']) {
    assert.equal(budgetMs(3000, { [SCALE_VAR]: value }), 3000, value)
    assert.equal(budgetMs(3000, { [SCALE_VAR]: value, [TEST_MARK_VAR]: '' }), 3000, `${value} with an empty mark`)
  }
  assert.equal(budgetMs(3000, { [SCALE_VAR]: '1' }), 3000)
  assert.equal(budgetMs(3000, { [SCALE_VAR]: '0.5' }), 1500)
  assert.equal(budgetMs(3000, { [SCALE_VAR]: '0.1' }), 300)
})

test('a budget never shrinks below one millisecond', () => {
  assert.equal(budgetMs(500, { [SCALE_VAR]: '0.0001' }), 1)       // the smallest positive scale still counts
})

test('a scale that is not a positive number leaves the budget as it is', () => {
  for (const value of ['0', '-2', '', ' ', 'abc', 'Infinity', 'NaN', '1e400']) {
    assert.equal(budgetMs(3000, { ...TEST, [SCALE_VAR]: value }), 3000, JSON.stringify(value))
  }
})

test('the hook tests stretch every budget', () => {
  const env = isolatedEnv()
  assert.equal(env[SCALE_VAR], HOOK_TIME_SCALE)
  assert.equal(budgetMs(500, env), 500 * Number(HOOK_TIME_SCALE))
  // A test of a budget sets its own scale over the stretched one.
  assert.equal(budgetMs(3000, isolatedEnv({ [SCALE_VAR]: '0.1' })), 300)
})
