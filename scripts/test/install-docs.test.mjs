// The install pages say what the plugin ships and how Claude.ai is set up
// today: Claude Code's page counts the hooks of hooks.json and names each of
// their scripts, and the Claude.ai page puts the skills under Customize → Skills
// and signs the connector in with OAuth, with no caveat that it cannot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionWith } from './support/changelog.mjs'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (name) => readFileSync(join(PLUGIN, name), 'utf8')
const flat = (text) => text.split(/\s+/).join(' ')

function hookHandlers() {
  const { hooks } = JSON.parse(read('hooks/hooks.json'))
  const handlers = Object.values(hooks).flatMap((groups) => groups.flatMap((group) => group.hooks))
  return { events: Object.keys(hooks).length, handlers }
}

test('the Claude Code page counts the hooks of hooks.json and their events', () => {
  const { events, handlers } = hookHandlers()
  const page = flat(read('docs/install/claude-code.md'))
  assert.ok(page.includes(`${handlers.length} hooks on ${events} events`), `claude-code.md does not say "${handlers.length} hooks on ${events} events"`)
})

test('the Claude Code page names the script of every hook', () => {
  const page = read('docs/install/claude-code.md')
  const missing = hookHandlers()
    .handlers.map((hook) => basename(hook.command.split(' ').at(-1)))
    .filter((script) => !page.includes(`\`${script}\``))
  assert.deepEqual(missing, [])
})

const SKILL_PAGES = ['docs/install/claude-ai.md', '.github/workflows/build-skill-zips.yml']

for (const name of SKILL_PAGES) {
  test(`${name} puts the skills under Customize → Skills`, () => {
    const page = read(name)
    assert.doesNotMatch(page, /Features → Skills/)
    assert.match(page, /Customize → Skills/)
  })
}

test('the Claude.ai page signs the connector in with OAuth and keeps no caveat that it cannot', () => {
  const page = flat(read('docs/install/claude-ai.md'))
  assert.doesNotMatch(page, /Auth caveat|Until we ship OAuth|once OAuth is live|fail at the sign-in step/)
  assert.match(page, /Customize → Connectors/)
  assert.match(page, /signs in with OAuth/)
})

test('the Claude.ai page walks both Continue steps and names the organization policy of code execution', () => {
  const page = flat(read('docs/install/claude-ai.md'))
  assert.equal(page.match(/\*\*Continue\*\*/g)?.length, 2)
  assert.match(page, /Organization settings → Plugins & skills → Policy/)
})

test('the Cursor page finds the server under Customize, not a Settings → MCP panel', () => {
  const page = flat(read('docs/install/cursor.md'))
  assert.doesNotMatch(page, /Settings → MCP|MCP panel/)
  assert.match(page, /Under \*\*Customize\*\* in the sidebar the `conport` server/)
})

test('the changelog tells the install pages were brought up to the product', () => {
  sectionWith(read('skills/conport/CHANGELOG.md'), 'The install pages match the product again.')
})
