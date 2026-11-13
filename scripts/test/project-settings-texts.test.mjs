// The shipped texts name the project's settings file, `.conport.json` at the
// root of the repository, as the place of the project: no recipe runs with
// `$CONPORT_PROJECT_NAME`, no install page sets the project in
// `.claude/settings.local.json`, a plan's sidecar is never called by the bare
// name of the settings file, and the CLI recipes of the install pages, the
// workflows guide and the plugin's other skills ask npx for the release that
// reads the file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
// A path inside the plugin with `/` between its parts on every platform, as the tests name it.
const pluginPath = (path) => relative(PLUGIN, path).split(sep).join('/')

function files(dir, keep) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...files(path, keep))
    else if (keep(pluginPath(path))) found.push(path)
  }
  return found.sort()
}

function text(name) {
  return readFileSync(join(PLUGIN, name), 'utf8')
}

// Every Markdown file of the plugin and the workflow scripts. A changelog entry
// describes the release it belongs to, so CHANGELOG.md is history, not a recipe.
const SHIPPED = files(
  PLUGIN,
  (name) =>
    (name.endsWith('.md') && !name.endsWith('CHANGELOG.md')) || /^workflows\/[^/]+\.js$/.test(name),
).map((path) => pluginPath(path))

const INSTALL_PAGES = [
  'INSTALL.md',
  'README.md',
  'docs/install/claude-code.md',
  'docs/install/cursor.md',
  'docs/install/other-agents.md',
  'docs/install/claude-ai.md',
]

// The texts this change rewrote: the install pages, the workflows guide, the
// plugin's skills other than `conport` and the Claude.ai advisor page.
const REWRITTEN = [
  ...INSTALL_PAGES,
  'docs/workflows.md',
  'docs/use-cases/claude-ai-advisor-mode.md',
  'skills/conport-routine/SKILL.md',
  'skills/superpowers-conport/SKILL.md',
]

test('no shipped text runs a recipe with $CONPORT_PROJECT_NAME', () => {
  assert.ok(SHIPPED.includes('INSTALL.md') && SHIPPED.includes('workflows/epic.js'), `read: ${SHIPPED}`)
  const hits = []
  for (const name of SHIPPED) {
    for (const found of text(name).matchAll(/\$\{?CONPORT_PROJECT_NAME\b\}?/g)) hits.push(`${name}: ${found[0]}`)
  }
  assert.deepEqual(hits, [])
})

test('the install pages name .conport.json', () => {
  for (const name of INSTALL_PAGES) {
    assert.ok(text(name).includes('`.conport.json`'), `${name} does not name .conport.json`)
  }
  for (const name of ['INSTALL.md', 'docs/install/claude-code.md', 'docs/install/cursor.md', 'docs/install/other-agents.md']) {
    const body = text(name)
    assert.ok(body.includes('"project_name": "<project>"'), `${name} shows no .conport.json with project_name`)
    assert.ok(body.includes('"$schema": "https://conport.app/schema/conport.json"'), `${name} shows no $schema`)
    assert.ok(body.includes('`.conport.local.json`'), `${name} does not name the personal file`)
    assert.ok(
      body.includes('https://conport.app/docs/projects/project-settings.md'),
      `${name} does not send the old places to the move document`,
    )
  }
})

test('no install page sets the project in settings.local.json', () => {
  const hits = []
  for (const name of [...INSTALL_PAGES, 'docs/use-cases/claude-ai-advisor-mode.md']) {
    const body = text(name)
    for (const form of [/"CONPORT_PROJECT_NAME"\s*:/g, /export CONPORT_PROJECT_NAME\b/g, /Set CONPORT_PROJECT_NAME\b/g]) {
      for (const found of body.matchAll(form)) hits.push(`${name}: ${found[0]}`)
    }
  }
  assert.deepEqual(hits, [])
})

// A bare `.conport.json` names the settings file; a sidecar is `<file>.conport.json`.
const BARE = /(^|[^\w>.-])\.conport\.json/
const SETTINGS_WORDS = ['project_name', 'plugins.superpowers', 'units', '.conport.local.json']

test('a plan sidecar is named <file>.conport.json', () => {
  // Anything glued to `.conport.json` is a placeholder of the plan's path; a
  // lone `<` opens a list of sources (`<.conport.json | … >`), not a path.
  const glued = []
  for (const name of SHIPPED) {
    for (const found of text(name).matchAll(/([^\s`'"(*]+)\.conport\.json/g)) {
      if (found[1] !== '<' && !/^<[a-z_]+>$/.test(found[1])) glued.push(`${name}: ${found[0]}`)
    }
  }
  assert.deepEqual(glued, [])
  // Where a text speaks of a sidecar, a bare `.conport.json` in the same
  // paragraph is the settings file, said so by one of its keys.
  const unclear = []
  for (const name of ['README.md', 'docs/workflows.md', 'skills/superpowers-conport/SKILL.md']) {
    for (const paragraph of text(name).split(/\n\s*\n/)) {
      if (BARE.test(paragraph) && !SETTINGS_WORDS.some((word) => paragraph.includes(word))) {
        unclear.push(`${name}: ${paragraph.trim().slice(0, 120)}`)
      }
    }
  }
  assert.deepEqual(unclear, [])
  assert.ok(
    text('README.md').includes('audits a pulled plan through its `<file>.conport.json`'),
    'the README calls the sidecar by the name of the settings file',
  )
})

test('finish compares the sidecar with the project of the settings, not with the variable', () => {
  const bridge = text('skills/superpowers-conport/SKILL.md')
  const finish = bridge.slice(bridge.indexOf('\n## Mode: finish\n'), bridge.indexOf('\n### Output — no sidecar\n'))
  assert.ok(finish.length > 0, 'the finish section was not found')
  assert.match(finish, /проект в <plan_path>\.conport\.json: <sidecar project>; проект настроек: <name> \(<source>\)/)
  assert.match(finish, /Сделай сейчас: укажи <sidecar project> в project_name файла <settings file>, затем повтори finish\./)
  assert.doesNotMatch(finish, /CONPORT_PROJECT_NAME: <name>/)
  assert.doesNotMatch(finish, /в CONPORT_PROJECT_NAME/)
  const resolve = bridge.slice(bridge.indexOf('### 1. Resolve ConPort project'), bridge.indexOf('### 2. Import spec doc'))
  assert.match(resolve, /`project_name` of `\.conport\.json`/)
  assert.match(resolve, /`\.conport\.local\.json` over it/)
  assert.match(resolve, /`ConPort project:/)
})

test('every npx conport recipe names ^0.11.0', () => {
  const wrong = []
  let seen = 0
  for (const name of REWRITTEN) {
    for (const found of text(name).matchAll(/npx(?: -y)? conport(?![\w-])(?:@[^\s`'"]+)?/g)) {
      seen += 1
      if (found[0] !== 'npx -y conport@^0.11.0') wrong.push(`${name}: ${found[0]}`)
    }
  }
  assert.ok(seen > 0, 'no npx conport recipe was read')
  assert.deepEqual(wrong, [])
  const recipe = 'npx -y conport@^0.11.0 api tasks list --project <project_name from .conport.json>'
  for (const name of ['INSTALL.md', 'docs/install/other-agents.md']) {
    assert.ok(text(name).includes(recipe), `${name} does not show ${recipe}`)
  }
})

// The run refuses when the settings name no project — a broken settings file or a
// failing git — and the guide says so beside the other refusals at the start of a
// run: what causes ABORTED_NO_PROJECT and the one thing to do. The reason is the
// one both workflows issue.
test('the workflows guide names the refusal for settings that name no project', () => {
  for (const name of ['workflows/task.js', 'workflows/epic.js']) {
    assert.ok(text(name).includes("'ABORTED_NO_PROJECT'"), `${name} no longer issues ABORTED_NO_PROJECT: drop this test`)
  }
  const guide = text('docs/workflows.md')
  const requirements = guide.slice(guide.indexOf('\n### Requirements\n'), guide.indexOf('\n### Arguments\n'))
  assert.ok(requirements.length > 0, 'the Requirements section was not found')
  const item = requirements.split('\n- ').find((entry) => entry.includes('`ABORTED_NO_PROJECT`'))
  assert.ok(item, 'the Requirements do not name ABORTED_NO_PROJECT')
  const flat = item.replace(/\s+/g, ' ')
  // what causes it
  assert.match(flat, /cannot be read, is not valid JSON, holds no JSON object or carries a wrong `project_name`/)
  assert.match(flat, /a git that fails \(other than "not a git repository"\)/)
  assert.match(flat, /`CONPORT_PROJECT_NAME` does not stand in/)
  // the one action: fix what the lines name, then run again
  assert.match(flat, /fix what those lines name and run again/)
  assert.ok(flat.includes('`no ConPort project: set project_name in .conport.json`'), 'the refusal with no project at all is not quoted')
  // the helper's answer with the lines is no plain fallback
  const handBack = guide.slice(guide.indexOf('\n### When the helper hands the work back\n'))
  assert.match(handBack.replace(/\s+/g, ' '), /`\{"error": "no project", "lines": \[\.\.\.\]\}`[^.]*`ABORTED_NO_PROJECT`/)
})

test('the workflows guide quotes the anchor check as the epic run issues it, with its project', () => {
  // The run names the project it runs in (`workflows/epic.js`); the guide
  // shows the same command, so a copy of it runs in that project too.
  assert.ok(
    text('workflows/epic.js').includes('`npx -y conport@^0.11.0 arch check -p ${project}`'),
    'epic.js no longer issues the anchor check with -p',
  )
  const guide = text('docs/workflows.md').replace(/\s+/g, ' ')
  assert.ok(guide.includes('`npx -y conport@^0.11.0 arch check -p <project>`'), 'the guide does not quote the check with -p')
  assert.doesNotMatch(guide, /`npx -y conport@\^0\.11\.0 arch check`/)
})
