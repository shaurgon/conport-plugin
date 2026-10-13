// The shipped texts describe one model of teams: an API key belongs to its
// user and to no team, a project is addressed as `<team ID>/<project>`, the
// name comes from CONPORT_PROJECT_NAME alone, and a project is created only by
// an explicit `create_project`. These tests read the plugin's files as they
// ship and hold them to that model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const EXAMPLE_HANDLE = 'k7m2qx9d'

function files(dir, extensions) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...files(path, extensions))
    else if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(path)
  }
  return found.sort()
}

function read(extensions, skip = () => false) {
  return new Map(
    files(PLUGIN, extensions)
      .filter((path) => !skip(path))
      .map((path) => [relative(PLUGIN, path), readFileSync(path, 'utf8')]),
  )
}

// The prose that describes the model. A changelog entry describes the release
// it belongs to, so CHANGELOG.md is history and is not held to today's model.
const TEXTS = read(['.md'], (path) => path.endsWith('CHANGELOG.md'))
// Everything that can show a team ID: prose, scripts and their fixtures.
const SOURCES = read(['.md', '.js', '.mjs', '.json'])

function text(name) {
  const body = TEXTS.get(name)
  assert.ok(body !== undefined, `${name} is not among the plugin's Markdown files`)
  return body
}

// Every `file: substring` pair where the substring occurs in the file.
function occurrences(substrings, { ignoreCase = false } = {}) {
  const hits = []
  for (const [name, body] of TEXTS) {
    const haystack = ignoreCase ? body.toLowerCase() : body
    for (const needle of substrings) {
      if (haystack.includes(ignoreCase ? needle.toLowerCase() : needle)) hits.push(`${name}: ${needle}`)
    }
  }
  return hits
}

// The section opened by the first heading matching `heading`, up to the next
// heading of the same or a higher level. Headings inside code fences are text.
function section(name, heading) {
  const lines = text(name).split('\n')
  let fenced = false
  let level = 0
  const kept = []
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const mark = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (level === 0) {
      if (mark && heading.test(mark[2])) {
        level = mark[1].length
        kept.push(line)
      }
      continue
    }
    if (mark && mark[1].length <= level) break
    kept.push(line)
  }
  assert.ok(level > 0, `${name} has no section headed ${heading}`)
  return kept.join('\n')
}

// A section as one line, so a sentence is found however it is wrapped.
function flat(name, heading) {
  return section(name, heading).replace(/\s+/g, ' ')
}

test('no text describes a key bound to a team', () => {
  assert.ok(TEXTS.size > 0, 'no Markdown files were read')
  assert.deepEqual(
    occurrences([
      'key_team_mismatch',
      'key_team_missing',
      'bound to exactly one team',
      'bound to the team',
      'team key',
      'key of that team',
      "connection's team",
      '/mcp/teams/',
      'mcp_path',
    ]),
    [],
  )
})

test('no text derives the project name from the repository', () => {
  assert.deepEqual(
    occurrences(
      ['git remote', 'directory name', 'dir name', 'repository name', 'remote.origin.url', 'basename of', 'repo-derived'],
      { ignoreCase: true },
    ),
    [],
  )
})

test('the skill names the new model', () => {
  const skill = text('skills/conport/SKILL.md')
  for (const needle of [
    'create_project',
    'pers/',
    'candidates',
    'CONPORT_PROJECT_NAME',
    '"env": { "CONPORT_PROJECT_NAME": "<project>" }',
  ]) {
    assert.ok(skill.includes(needle), `skills/conport/SKILL.md does not contain ${needle}`)
  }
})

test('every example handle is the made-up one', () => {
  // A string of the team ID format (with a digit, so plain words do not count)
  // in each place a team ID is written: before the `/` of a project name,
  // after `--team-id`, and as the value of `team`.
  const id = '(?=[a-z2-9]*[2-9])[a-hjkmnp-z][a-hjkmnp-z2-9]{7}'
  const forms = [
    new RegExp(`\\b(${id})/`, 'g'),
    new RegExp(`--team-id[ =]["']?(${id})\\b`, 'g'),
    new RegExp(`\\bteam["']?\\s*[:=]\\s*["'\`](${id})\\b`, 'g'),
  ]
  const seen = []
  for (const [name, body] of SOURCES) {
    for (const form of forms) {
      for (const match of body.matchAll(form)) seen.push(`${name}: ${match[1]}`)
    }
  }
  for (const form of ['k7m2qx9d/', '--team-id k7m2qx9d']) {
    assert.ok(text('INSTALL.md').includes(form), `INSTALL.md does not show ${form}`)
  }
  assert.deepEqual(
    seen.filter((entry) => !entry.endsWith(`: ${EXAMPLE_HANDLE}`)),
    [],
  )
})

const NAME_SECTION = /Project name \(required\)/
const REWRITTEN = [
  ['skills/conport/SKILL.md', /^Step 1: Determine the project name$/],
  // The team section holds the refusals, the action table and the transfer.
  ['skills/conport/SKILL.md', /^TEAMS\b/],
  ['skills/conport-routine/SKILL.md', /^TEAM CONTEXT$/],
  ['skills/superpowers-conport/SKILL.md', /^1\. Resolve ConPort project$/],
  ['INSTALL.md', NAME_SECTION],
  ['docs/install/claude-code.md', NAME_SECTION],
  ['docs/install/cursor.md', NAME_SECTION],
  ['docs/install/other-agents.md', NAME_SECTION],
  ['docs/install/claude-ai.md', NAME_SECTION],
  ['docs/install/claude-ai.md', /^Verify$/],
]

test('no internal identifier leaks into the rewritten sections', () => {
  const leaks = []
  for (const [name, heading] of REWRITTEN) {
    for (const match of section(name, heading).match(/\b(doc|decision|task|progress)-\d+\b/g) || []) {
      leaks.push(`${name} (${heading}): ${match}`)
    }
  }
  assert.deepEqual(leaks, [])
})

const PROJECT_NAME_RULE =
  "Set CONPORT_PROJECT_NAME. Personal repository: <project>. Team repository: k7m2qx9d/<project> — the team ID is on the team's settings page. A bare name in a team repository sends every member to their own Private Team."

test('every install guide carries the project name rule word for word', () => {
  for (const name of ['INSTALL.md', 'docs/install/claude-code.md', 'docs/install/cursor.md', 'docs/install/other-agents.md']) {
    assert.ok(flat(name, NAME_SECTION).includes(PROJECT_NAME_RULE), `${name}: the section does not carry the rule verbatim`)
  }
})

test('the Claude.ai guide has the user name the project and create it explicitly', () => {
  const name = section('docs/install/claude-ai.md', NAME_SECTION)
  assert.ok(name.includes('k7m2qx9d/<project>'), 'the section does not show a team project name')
  const verify = section('docs/install/claude-ai.md', /^Verify$/)
  for (const needle of ['project_not_found', 'create_project']) {
    assert.ok(verify.includes(needle), `the first run does not name ${needle}`)
  }
})

test('the superpowers bridge takes the project from the variable and creates nothing on its own', () => {
  const resolve = section('skills/superpowers-conport/SKILL.md', /^1\. Resolve ConPort project$/)
  for (const needle of ['CONPORT_PROJECT_NAME', 'project_not_found', 'create_project', 'candidates']) {
    assert.ok(resolve.includes(needle), `the section does not contain ${needle}`)
  }
})

test('the CLI guides name the one command that creates a project', () => {
  const command = 'npx -y conport api projects create --name <project>'
  for (const [name, heading] of [
    ['INSTALL.md', /^Step 4\b/],
    ['docs/install/other-agents.md', NAME_SECTION],
  ]) {
    const body = flat(name, heading)
    assert.ok(body.includes(command), `${name}: no ${command}`)
    assert.ok(body.includes('--team-id k7m2qx9d'), `${name}: the team's project is not shown`)
  }
})
