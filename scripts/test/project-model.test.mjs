// The texts that teach the project model: the section PROJECT MODEL of the
// conport skill answers every write-time refusal of a portion with its one
// action, and the Superpowers overlay submits the portion of a spec right after
// the plan is imported. The refusals are the ones the tool reference shipped
// with the skill lists for `arch_submit`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'skills', 'conport')
const read = (path) => readFileSync(join(SKILL_DIR, path), 'utf8')

/** The text from a heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

/** The refusal codes the tool reference lists for `arch_submit`. */
function referenceCodes() {
  const submit = section(read('references/command_list.md'), '### arch_submit')
  const list = submit.slice(submit.indexOf('The codes:'), submit.indexOf('A portion off the schema'))
  return [...list.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
}

/** `{code: action}` of the table of write-time refusals in the skill's section PROJECT MODEL. */
function skillRefusals() {
  const model = section(read('SKILL.md'), '## PROJECT MODEL')
  const refusals = section(model, '### Refusals of a portion')
  // A row is `| `code` | when | action |`: the first cell names the code, the last holds the action.
  const rows = refusals.split('\n')
    .filter((line) => /^\| `[a-z_]+` \|/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
  return new Map(rows.map((cells) => [cells[0].replace(/`/g, ''), cells.at(-1)]))
}

test('the conport skill names every write-time refusal of the model', () => {
  const codes = referenceCodes()
  // Fourteen codes of the entities and eight of the scenarios.
  assert.equal(codes.length, 22, `the reference lists ${codes.length} codes: ${codes}`)
  const refusals = skillRefusals()
  for (const code of codes) {
    assert.ok(refusals.has(code), `the skill has no row for ${code}`)
    assert.notEqual(refusals.get(code), '', `the row of ${code} names no action`)
  }
  assert.deepEqual([...refusals.keys()].filter((code) => !codes.includes(code)), [],
    'the skill answers a refusal the reference does not list')
})

/** The numbered steps of the overlay's flow: number, title and text up to the next step. */
function overlaySteps() {
  const flow = read('references/superpowers-overlay.md').split('\n## The flow\n')[1].split('\n## ')[0]
  const heads = [...flow.matchAll(/^(\d+)\. \*\*(.+?)\.\*\*/gm)]
  return heads.map((head, i) => ({
    n: Number(head[1]),
    title: head[2],
    body: flow.slice(head.index, heads[i + 1]?.index),
  }))
}

test('the overlay submits the portion right after plan import', () => {
  const steps = overlaySteps()
  // The steps keep their numbers and titles: other texts name them.
  assert.deepEqual(steps.map((s) => `${s.n}. ${s.title}`), [
    '1. Brainstorming',
    '2. Spec review and gap hunt on the draft',
    '3. Approval',
    '4. Upload the spec, once',
    '5. Plan',
    '6. Execution',
    '7. Editing the plan during the work',
    '8. Finish',
  ])
  const plan = steps.find((s) => s.title === 'Plan').body
  const imported = plan.indexOf('plan import <draft> --spec doc-N')
  const portion = plan.indexOf('**Submit the portion of the spec.**')
  assert.ok(imported >= 0, 'the step Plan imports the plan')
  assert.ok(portion > imported, 'the portion is submitted after the plan import, in the same step')
  const submit = plan.slice(portion)
  assert.match(submit, /arch_submit\(project=<project>, portion=/)
  assert.match(submit, /npx -y conport@\^0\.8\.0 arch submit /)
  assert.match(submit, /"source": "doc-N"/)
  // Nothing submits a portion before the plan is imported.
  for (const step of steps.slice(0, steps.findIndex((s) => s.title === 'Plan'))) {
    assert.doesNotMatch(step.body, /arch_submit|arch submit/, `step ${step.n} submits a portion`)
  }
  assert.doesNotMatch(plan.slice(0, imported), /arch_submit|arch submit/, 'a portion before the import')
})

/** The part Scenarios of the skill's section PROJECT MODEL. */
const scenariosPart = () => section(section(read('SKILL.md'), '## PROJECT MODEL'), '### Scenarios')

/** Every fenced `json` block of a text, parsed; a block inside a list item is indented. */
function jsonBlocks(text) {
  return [...text.matchAll(/^( *)```json\n([\s\S]*?)^\1```$/gm)].map((m) => JSON.parse(m[2]))
}

/** The `{kind: action}` rows of the skill's table of the model's debts. */
function skillDebts() {
  const debts = section(section(read('SKILL.md'), '## PROJECT MODEL'), '### Debts of the model in init')
  const rows = debts.split('\n')
    .filter((line) => /^\| `[a-z_]+` \|/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
  return new Map(rows.map((cells) => [cells[0].replace(/`/g, ''), cells.at(-1)]))
}

test('the conport skill names both scenario debts and their actions', () => {
  const debts = skillDebts()
  // The actions are the server's own text, word for word.
  assert.equal(debts.get('step_without_relation'), 'Add the missing relation to the portion or correct the step.')
  assert.equal(debts.get('scenario_participant_gone'),
    'Resubmit the scenario: drop the removed entity or name the one that replaced it.')
  // The tool reference lists the same eight kinds for `arch_status`, and the number of the scenario.
  const status = section(read('references/command_list.md'), '### arch_status')
  const kinds = status.slice(status.indexOf('`kind`'), status.indexOf('`subject`')).match(/[a-z]+(?:_[a-z]+)+|mismatch/g)
  assert.deepEqual(kinds, [...debts.keys()])
  assert.match(status, /`scenario_id`/)
  // The part Scenarios dismisses the step debt with a reason, by a record of the scenario.
  const record = jsonBlocks(scenariosPart()).flatMap((block) => block.dismissed ?? [])
    .find((d) => d.kind === 'step_without_relation')
  assert.ok(record, 'no dismissal of step_without_relation in the part Scenarios')
  assert.equal(record.subject, 'scenario')
  assert.ok(record.reason && record.name, 'the dismissal names the scenario and a reason')
})

test('the conport skill shows a portion with a scenario of each kind', () => {
  const portion = jsonBlocks(scenariosPart()).find((block) => Array.isArray(block.scenarios))
  assert.ok(portion, 'the part Scenarios has no portion with scenarios')
  const byKind = Object.fromEntries(portion.scenarios.map((s) => [s.kind, s]))
  assert.deepEqual(Object.keys(byKind).sort(), ['activity', 'sequence', 'states'])
  // A sequence with a request, a refusal and a retry.
  const sequence = byKind.sequence
  assert.ok(sequence.steps.some((s) => s.kind === 'call'), 'the sequence has no request')
  assert.ok(sequence.steps.some((s) => s.kind === 'reply'), 'the sequence has no reply')
  assert.ok(sequence.steps.some((s) => s.branch?.type === 'loop'), 'the sequence does not retry')
  // An outcome machine whose final states are the verdicts.
  const states = byKind.states
  assert.equal(states.states.filter((s) => s.initial).length, 1)
  assert.ok(states.states.filter((s) => s.final).length >= 2, 'the outcome has fewer than two verdicts')
  // An activity with a decision.
  const decision = byKind.activity.nodes.find((n) => n.kind === 'decision')
  assert.ok(decision, 'the activity has no decision')
  assert.ok(byKind.activity.transitions.filter((t) => t.from === decision.key && t.condition).length >= 2)
  // Every entity a scenario names is an entity of the portion.
  const names = new Set(portion.entities.map((e) => e.name))
  const named = [
    ...sequence.participants.map((p) => p.entity),
    ...sequence.steps.flatMap((s) => (s.via ? [s.via] : [])),
    states.subject,
    ...states.transitions.flatMap((t) => (t.performer ? [t.performer] : [])),
    ...byKind.activity.nodes.flatMap((n) => (n.performer ? [n.performer] : [])),
  ]
  assert.deepEqual(named.filter((name) => !names.has(name)), [])
  // The code portion carries a scenario grounded in an anchor, not in a block.
  const code = jsonBlocks(section(section(read('SKILL.md'), '## PROJECT MODEL'), '### A code portion for one unit'))[0]
  const anchored = (code.scenarios ?? []).find((s) => s.anchor)
  assert.ok(anchored, 'the code portion has no scenario with an anchor')
  assert.ok(['path', 'symbol'].includes(anchored.anchor.kind))
  assert.equal(anchored.block, undefined)
})

test('the scenario part points a missing kind to the agent-report section', () => {
  const part = scenariosPart()
  assert.match(part, /no (scenario )?kind fits[\s\S]{0,200}\*REPORTING TO THE SERVICE DEVELOPERS\*/i)
  // It points, it does not repeat the procedure.
  assert.doesNotMatch(part, /\[agent-report\]|gh issue|### Kind/)
  assert.ok(section(read('SKILL.md'), '## REPORTING TO THE SERVICE DEVELOPERS').includes('No scenario kind fits'))
})

test('the skill dismisses a whole-scenario finding for a missing kind', () => {
  const part = scenariosPart()
  const record = jsonBlocks(part).flatMap((block) => block.dismissed ?? []).find((d) => d.where === 'whole_scenario')
  assert.ok(record, 'no dismissal with where: "whole_scenario"')
  assert.equal(record.subject, 'scenario')
  assert.equal(record.kind, 'missing')
  assert.match(record.reason, /no scenario kind fits/i)
})

test('the skill tells to remove a debt dismissal record after it is accepted', () => {
  const part = scenariosPart().replace(/\s+/g, ' ')
  assert.match(part, /once the submission is accepted, remove the record from `dismissed`/i)
  assert.match(part, /only with a new reason/i)
})

test('the overlay keeps scenarios in the portion submitted right after plan import', () => {
  const plan = overlaySteps().find((s) => s.title === 'Plan').body
  const submit = plan.slice(plan.indexOf('**Submit the portion of the spec.**')).replace(/\s+/g, ' ')
  assert.match(submit, /`scenarios`/)
  assert.match(submit, /in the same portion/)
})
