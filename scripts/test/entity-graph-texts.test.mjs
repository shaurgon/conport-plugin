// The texts of the service without the entity graph: the skills, their
// references, the live docs, the manifests and the landing describe search
// through the project model, vector and full text, and promise no entity
// extraction, no semantic pass and no tool that is gone. The changelog names
// what went and what replaces each tool.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionWith } from './support/changelog.mjs'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const REPO = join(PLUGIN, '..', '..')
const plugin = (path) => readFileSync(join(PLUGIN, path), 'utf8')
const repo = (path) => readFileSync(join(REPO, path), 'utf8')
const flat = (text) => text.replace(/\s+/g, ' ')
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text from a heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

const changelog = () => plugin('skills/conport/CHANGELOG.md')

// Every text that tells how `search` reaches records through the model.
const SEARCH_TEXTS = {
  'the skill section': () => flat(section(plugin('skills/conport/SKILL.md'), '### Search through the model')),
  'the command list': () => flat(section(plugin('skills/conport/references/command_list.md'), '### search')),
  'the tool reference row': () =>
    repo('landing/docs-src/projects/tool-reference.md')
      .split('\n')
      .find((line) => line.startsWith('| `search` |')) ?? '',
  'the architecture-model page': () =>
    flat(section(repo('landing/docs-src/projects/architecture-model.md'), '## Search through the model')),
}

test('the routine skill has no graph cleanup step', () => {
  const routine = plugin('skills/conport-routine/SKILL.md')
  assert.doesNotMatch(routine, /graph cleanup/i)
  assert.doesNotMatch(routine, /semantic[- ]pass/i)
})

test('the conport skill says a project without a model searches by vector and full text', () => {
  const part = SEARCH_TEXTS['the skill section']()
  assert.match(part, /A project without a model is searched by vector and full text alone/)
  assert.match(part, /`projects_without_model`/)
})

for (const [where, read] of Object.entries(SEARCH_TEXTS)) {
  test(`${where} runs the model branch in any project whose model is not empty`, () => {
    const text = read()
    assert.ok(text.length > 0, `${where} is missing`)
    assert.match(text, /any project whose model is not empty/)
    // Not only a project whose backfill is completed.
    assert.doesNotMatch(text, /model is filled|backfill\.filled/)
    assert.doesNotMatch(text, /GraphRAG|via_entity|via_community/)
  })
}

test('no manifest carries the graphrag keyword', () => {
  for (const path of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.cursor-plugin/plugin.json']) {
    assert.doesNotMatch(plugin(path).toLowerCase(), /graphrag/, path)
  }
})

// The retired tools, read from the entries that removed them, so that no
// shipped text but the changelog spells a tool the server does not have: the
// nine of the entity graph and the semantic pass, and the recipe tool the
// entry of the former tool groups removes.
function retiredTools() {
  const log = changelog()
  const nine = flat(sectionWith(log, 'the nine tools of the entity graph and the semantic pass are retired'))
  const list = nine.slice(nine.indexOf('are retired — '), nine.indexOf('. A call answers'))
  const graphAndPass = [...list.matchAll(/`(\w+)`/g)].map((m) => m[1])
  assert.equal(graphAndPass.length, 9, `the entry of the nine tools names ${graphAndPass}`)
  const groups = flat(sectionWith(log, 'A tool profile that names `diagrams`, `graphrag` or `semantic` is no longer accepted'))
  const recipe = groups.match(/The tool `(\w+)` and the REST route/)
  assert.ok(recipe, 'the entry of the former tool groups names no removed tool')
  return {
    graph: graphAndPass.filter((name) => !name.startsWith('semantic')),
    pass: graphAndPass.filter((name) => name.startsWith('semantic')),
    recipe: recipe[1],
  }
}

/** The entry that retires the entity graph, found by its words under whatever
 * heading it has: the paragraph from its bold title to the next one. */
function graphEntry() {
  const title = '**Breaking: the entity graph is gone, and the data of the entity graph is deleted.**'
  const text = flat(sectionWith(changelog(), title))
  const from = text.indexOf(title)
  const next = text.indexOf(' **', from + title.length)
  return next < 0 ? text.slice(from) : text.slice(from, next)
}

test('the changelog names a replacement for every retired tool', () => {
  const { graph, pass, recipe } = retiredTools()
  // Six tools of the entity graph and three of the semantic pass.
  assert.deepEqual([graph.length, pass.length], [6, 3], `graph ${graph}, pass ${pass}`)
  const entry = graphEntry()
  assert.match(entry, /What replaced each tool/)
  const named = (names) => names.map((name) => `\`${name}\``).join(', ').replace(/, (?=[^,]*$)/, ' and ')
  assert.match(entry, new RegExp(`${escape(named(graph))} — \`arch_names\`, \`arch_entity\`, \`arch_lookup\``))
  assert.match(entry, new RegExp(`${escape(named(pass))} — nothing to call, the checks of the model keep it clean`))
  assert.match(entry, new RegExp(`\`${recipe}\` — \`arch_get\``))
})

test('the changelog names the removed REST field and routes', () => {
  const entry = graphEntry()
  assert.match(entry, /`extraction_status`/)
  assert.match(entry, /`schema_version` 6/)
  assert.match(entry, /`\/api\/v1\/admin\/retry-\*-extractions`/)
  assert.match(entry, /searched by vector and full text/)
  // The recipe route goes with its tool, in the entry of the former tool groups.
  const groups = flat(sectionWith(changelog(), 'A tool profile that names `diagrams`, `graphrag` or `semantic` is no longer accepted'))
  assert.match(groups, /`POST \/api\/v1\/projects\/\{project\}\/recipes\/current-architecture` are removed/)
})

test('the docs pages name no tool and no page that is gone', () => {
  assert.equal(existsSync(join(REPO, 'landing/docs-src/projects/semantic-pass.md')), false)
  const { recipe } = retiredTools()
  const pages = [
    'landing/docs-src/core/graph-model.md',
    'landing/docs-src/projects/context-recipes.md',
    'landing/docs-src/projects/spec-append-only.md',
    'landing/docs-src/projects/tool-reference.md',
  ]
  for (const path of pages) {
    const text = repo(path)
    assert.doesNotMatch(text, /recipe runner|GraphRAG|extracted entities/, path)
    assert.ok(!text.includes(recipe), `${path} names ${recipe}`)
    assert.doesNotMatch(text, /semantic proposals|semantic-pass proposals/, path)
  }
  assert.doesNotMatch(repo('landing/public/llms.txt'), /semantic-pass/)
})

test('the graph-model page describes the graph as the project model', () => {
  const page = repo('landing/docs-src/core/graph-model.md')
  assert.match(page, /^## The project model$/m)
  assert.match(flat(page), /A project without a model is searched by vector and full text alone/)
})

test('the data handling page promises no entity extraction', () => {
  const page = repo('landing/src/content/data-handling.md')
  assert.doesNotMatch(page, /GraphRAG|entity extraction|extract the entities|semantic cleanup|community summaries/i)
  assert.doesNotMatch(repo('landing/src/pages/Home.tsx'), /Semantic cleanup|duplicate entities/)
  assert.doesNotMatch(plugin('README.md'), /GraphRAG/)
})

test('the repository README does not describe the entity graph', () => {
  const text = repo('README.md')
  assert.doesNotMatch(text, /GraphRAG|EntityExtractionService|entity extraction|Louvain/i)
  // The table names are spelled with a class: a shipped text names no table.
  assert.doesNotMatch(text, /canonical[_]entities|entity[_]mentions|entity[_]communities/)
  assert.doesNotMatch(text, /HNSW indexes (for|with)|Uses HNSW/)
  assert.doesNotMatch(text, /maintenance routes on the graph/)
})

test('the skills say the server resolves gaps, not semantic-pass proposals', () => {
  for (const path of ['skills/conport/SKILL.md', 'skills/conport/references/command_list.md']) {
    assert.doesNotMatch(plugin(path), /semantic-pass proposals/, path)
  }
  assert.doesNotMatch(plugin('skills/conport/SKILL.md'), /graph_rebuilding|GraphRAG/)
})
