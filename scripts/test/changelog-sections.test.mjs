// The changelog helper of the plugin's tests reads a changelog the same way
// before the release step (the open section on top) and after it (the version
// number on top), and no other test file names a heading as the place of an entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headingLiterals, sectionWith, sections, topSection } from './support/changelog.mjs'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const HELPER = join(TEST_DIR, 'support', 'changelog.mjs')
// A heading, built so this file holds no literal of one.
const heading = (name) => ['##', name].join(' ')
const OPEN = heading('Unreleased')

const changelog = (top) =>
  `# conport changelog\n\n${top}\n\nThe newest entry,\nwrapped over lines.\n\n${heading('2.0.0')}\n\nThe shipped entry.\n\n### A part\n\nStill 2.0.0.\n`

for (const top of [OPEN, heading('3.0.0')]) {
  test(`the top section is the first one under ${top}`, () => {
    assert.equal(topSection(changelog(top)).trim(), 'The newest entry,\nwrapped over lines.')
  })

  test(`an entry is found by its words under ${top}`, () => {
    assert.equal(sectionWith(changelog(top), 'The newest entry, wrapped over lines.'), topSection(changelog(top)))
    assert.match(sectionWith(changelog(top), 'The shipped entry.'), /### A part\n\nStill 2\.0\.0\./)
  })
}

test('the newest section that holds the words is the one found', () => {
  const text = `${heading('2.0.0')}\n\nSaid again.\n\n${heading('1.0.0')}\n\nSaid again.\n`
  assert.equal(sectionWith(text, 'Said again.'), sections(text)[0])
})

test('words no section holds are refused with the words', () => {
  assert.throws(() => sectionWith(changelog(heading('3.0.0')), 'Never said.'), /no section of the changelog holds: Never said\./)
  assert.throws(() => topSection('# title only\n'), /no '## ' section/)
})

test('a literal of a heading is caught in each of its spellings, a heading in prose is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-guard-'))
  try {
    const version = heading('20.6.0')
    const lines = [
      `const a = '${OPEN}'`,
      `const b = "${OPEN}"`,
      `const c = '\\n${OPEN}\\n'`,
      `const d = section(read('CHANGELOG.md'), '${version}')`,
      `const e = log.slice(log.indexOf("${version}"), log.indexOf('\\n${heading('20.5.0')}'))`,
      `// the epic writes under the open section`,
      `const f = 'the heading ${OPEN} is renamed'`,
      `const g = 'writes its changes under \`${OPEN}\`;'`,
      `const h = 'the entry of \`${version}\`'`,
    ]
    const file = join(dir, 'sample.test.mjs')
    writeFileSync(file, lines.join('\n'))
    assert.deepEqual(headingLiterals([file]), [1, 2, 3, 4, 5].map((n) => `sample.test.mjs:${n}`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no test file but the helper names a heading of the changelog as a literal', () => {
  const files = readdirSync(TEST_DIR, { recursive: true })
    .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
    .map((name) => join(TEST_DIR, name))
    .filter((path) => path !== HELPER)
  assert.ok(files.length > 10, 'the guard reads the test files')
  const found = headingLiterals(files)
  assert.deepEqual(
    found,
    [],
    `read the changelog through support/changelog.mjs (topSection, sectionWith), not by a heading: ${found}`,
  )
})
