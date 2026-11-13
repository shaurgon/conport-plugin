// The texts that teach search through the project model and the entities of a
// decision: the section PROJECT MODEL of the conport skill tells how `search`
// reaches records through the model and how a decision about the structure
// names its entities, and the tool reference shipped with the skill shows the
// view `graph` of `arch_get`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'skills', 'conport')
const read = (path) => readFileSync(join(SKILL_DIR, path), 'utf8')
const DOCS_PAGE = join(SKILL_DIR, '..', '..', '..', '..', 'landing', 'docs-src', 'projects', 'context-recipes.md')

/** The text from a heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

/** A text with its line breaks and runs of spaces folded into one space. */
const flat = (text) => text.replace(/\s+/g, ' ')

const model = () => section(read('SKILL.md'), '## PROJECT MODEL')
const searchPart = () => flat(section(model(), '### Search through the model'))
const decisionPart = () => flat(section(model(), '### A decision names its entities'))

/** The rows `| trigger | tool |` of a table of the skill's section WORKFLOW. */
function workflowRows(heading) {
  return section(section(read('SKILL.md'), '## WORKFLOW — When to call which tool'), heading)
    .split('\n')
    .filter((line) => /^\| /.test(line) && !/^\|[-| ]+\|$/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
}

test('the conport skill names include_removed, via_arch_entity and via_arch_scenario', () => {
  const part = searchPart()
  // A hit says which part of the model it came through.
  assert.match(part, /`via_arch_entity` \(`id`, `name`, `stage`\)/)
  assert.match(part, /`via_arch_scenario` \(`id`, `name`, `kind`\)/)
  // Removed and replaced parts are found only on request.
  assert.match(part, /removed or replaced/)
  assert.match(part, /`search` with `include_removed=true`/)
  // The table Search sends a question about what replaced a thing to the same parameter.
  const replaced = workflowRows('### Search').find((cells) => /replaced/.test(cells[0]))
  assert.ok(replaced, 'the table Search has no row for a removed or replaced part')
  assert.match(replaced.at(-1), /`search` with `include_removed=true`/)
})

test('the conport skill tells a design decision to name its entities', () => {
  const part = decisionPart()
  assert.match(part, /about the structure of the system/)
  assert.match(part, /`sync_decision` with `entities`/)
  assert.match(part, /`arch_names`/)
  assert.match(part, /`linked_entities`/)
  // An older decision gets its entities by an update that only adds links.
  assert.match(part, /`update_decision` with `entities` adds links and removes none/)
  // The table Sync sends a decision about the structure to the same parameter.
  const structure = workflowRows('### Sync').find((cells) => /structure/.test(cells[0]))
  assert.ok(structure, 'the table Sync has no row for a decision about the structure')
  assert.match(structure.at(-1), /`sync_decision` with `entities`/)
  // The refusal over the limit and the failed linking each have their action.
  assert.match(part, /`too_many_entities`[^.]*more than 50 names/)
  assert.match(part, /`entities_error`[^.]*the decision is written/)
  // A decision deleted before its linking is recorded again, not updated.
  assert.match(part, /`decision_not_found`: the decision was deleted before it was linked, and nothing is linked — record it again with `sync_decision`/)
  assert.match(part, /Any other code: call `update_decision` with the same `entities`/)
})

test('the conport skill says what to do with unknown_entities', () => {
  const part = decisionPart()
  const at = part.indexOf('`unknown_entities`')
  assert.ok(at >= 0, 'the part names no unknown_entities')
  const answer = part.slice(at)
  // Nothing was refused, the names are checked against the model, never invented.
  assert.match(answer, /refuses nothing/)
  assert.match(answer, /`arch_names`/)
  assert.match(answer, /`arch_lookup`/)
  assert.match(answer, /`update_decision` with the right names/)
  assert.match(answer, /`arch_submit`/)
  assert.match(answer, /never invent/i)
})

test('the command list shows the graph view of arch_get', () => {
  const get = flat(section(read('references/command_list.md'), '### arch_get'))
  assert.match(get, /one of five views/)
  assert.doesNotMatch(get, /four views/)
  assert.match(get, /composition \\\| neighbourhood \\\| contribution \\\| data \\\| graph/)
  assert.match(get, /`graph` takes no other parameter/)
  assert.match(get, /past 500 nodes/)
  // The answer of the view graph: decisions as nodes and the flag of the cut.
  assert.match(get, /`decisions` \(`id`, `summary`, `entity_ids`\)/)
  assert.match(get, /`truncated`/)
  assert.match(get, /`hint`/)
  // The section PROJECT MODEL of the skill names the view in a row of `arch_get`.
  const row = model().split('\n').find((line) => line.includes("view='graph'"))
  assert.ok(row, 'the skill names no view graph')
  assert.match(row, /`arch_get` with `view='graph'`/)
})

/** What both texts say about the model entities of `task_briefing`. */
function assertModelEntities(text) {
  // The entities of every document linked to the epic by `clarifies`, taken together.
  assert.match(text, /documents linked to (?:that|the) epic by `clarifies`/)
  assert.match(text, /the entities their portions claim, taken together/)
  // The order and the limit.
  assert.match(text, /the active ones first, then by name, at most 50/)
  // The total only when the list is cut.
  assert.match(text, /`model_entities_total` gives how many there are in all, only when the list is cut/)
  // Without an epic above the task, or without such a document, no key at all.
  assert.match(text, /without such a document, gets neither key/)
}

test('the command list names the model entities of task_briefing', () => {
  const assemble = flat(section(read('references/command_list.md'), '### assemble_context'))
  assert.match(assemble, /`task_briefing`[^.]*`model_entities`/)
  // Each entity carries the fields the recipe gives.
  assert.match(assemble, /`model_entities` \(`id`, `name`, `type`, `stage`, `state`, `anchors`\)/)
  assertModelEntities(assemble)
})

test('the docs page of context recipes names the model entities of task_briefing', () => {
  const page = flat(section(readFileSync(DOCS_PAGE, 'utf8'), '### task_briefing'))
  assert.match(page, /`model_entities` lists the entities/)
  assert.match(page, /`id`, `name`, `type`, `stage`, `state` and `anchors`/)
  assertModelEntities(page)
})
