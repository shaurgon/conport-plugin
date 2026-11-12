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
  // Fourteen codes of the entities, eight of the scenarios and four of the reviewer's report.
  assert.equal(codes.length, 26, `the reference lists ${codes.length} codes: ${codes}`)
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
  // The portion is reviewed before it is submitted, by the order the skill gives.
  const flat = submit.replace(/\s+/g, ' ')
  const submitted = flat.indexOf('arch_submit(')
  for (const step of ['*The review of a document portion*', 'npx -y conport@^0.9.0 arch review-input doc-N']) {
    const at = flat.indexOf(step)
    assert.ok(at >= 0, `the step has no ${step}`)
    assert.ok(at < submitted, `${step} comes after arch_submit(`)
  }
  assert.match(submit, /npx -y conport@\^0\.9\.0 arch submit /)
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

test('the skill dismisses a whole-scenario finding for a missing kind in the review', () => {
  const part = scenariosPart()
  const record = jsonBlocks(part).flatMap((block) => block.review?.findings ?? []).find((f) => f.where === 'whole_scenario')
  assert.ok(record, 'no finding with where: "whole_scenario" in `review.findings`')
  assert.equal(record.subject, 'scenario')
  assert.equal(record.kind, 'missing')
  assert.equal(record.resolution, 'dismissed')
  assert.ok(record.evidence, 'the finding carries no evidence')
  assert.match(record.reason, /no scenario kind fits/i)
  // `dismissed` of a portion is for the debt of a step only.
  assert.deepEqual(jsonBlocks(part).flatMap((block) => block.dismissed ?? []).map((d) => d.kind)
    .filter((kind) => kind !== 'step_without_relation'), [])
})

test('the skill runs the reviewer before a document portion is submitted', () => {
  const model = section(read('SKILL.md'), '## PROJECT MODEL').replace(/\s+/g, ' ')
  // The input directory, then the reviewer: a subagent, or a separate process by a ready command.
  assert.match(model, /npx -y conport@\^0\.9\.0 arch review-input doc-N --portion <draft> -o <dir>/)
  assert.match(model, /`conport:model-reviewer`/)
  assert.match(model, /npx -y conport@\^0\.9\.0 agent model-reviewer/)
  for (const command of ['claude -p', 'codex exec --sandbox read-only --output-last-message', 'cursor-agent -p']) {
    assert.ok(model.includes(command), `no ready command ${command}`)
  }
  // One recheck when something was fixed, then the portion goes with `review`.
  assert.match(model, /--findings <file>/)
  assert.match(model, /`recheck`/)
  // A run that fails is repeated once; then the portion goes without a review and the user is told.
  assert.match(model, /repeat the run once/i)
  assert.match(model, /never invent a report/i)
  assert.match(model, /tell the user/i)
  // A report belongs to one submission.
  assert.match(model, /read with `arch_source` and submitted back unchanged/)
  // The report read back, sent again, is refused by layer 1 with its own action, never "fix it by the schema".
  assert.match(model, /a portion sent back with it is\s+refused as `review_reused` — run the reviewer again, or submit the portion\s+without `review`/)
  assert.doesNotMatch(model, /sent back with it is\s+`portion_invalid`/)
  // The file of `arch source -o` holds no `review`: sent back unreviewed, the portion owes the debt.
  assert.match(model, /`npx -y conport@\^0\.9\.0 arch source <source>` prints `review` the same way, but with `-o <file>` it writes the portion without `review`: that file submitted back without a new review is accepted, and the portion owes `unchecked_portion`/)
  // A dismissal holds while its evidence stands, so the evidence is carried over as the reviewer gave it.
  assert.match(model, /`evidence` exactly as the reviewer gave it/)
  // A ULID stands as the `ulid` of a block or of an item of a list block: reviewers cite item ULIDs too.
  assert.match(model, /while its evidence stands: the quote word for word in `document\.md`, or its ULID in `blocks\.json` as the `ulid` of a block or of an item of a block \(`attrs\.items\[\]\.ulid`\)/)
  assert.doesNotMatch(model, /the ULID of its block in `blocks\.json`/)
  assert.match(model, /comes back, the text of the document changed in that place: resolve it again/)
  assert.doesNotMatch(model, /the class the finding belongs to/)
  // The example dismisses a finding the model rightly leaves out, not a true one.
  const example = jsonBlocks(section(section(read('SKILL.md'), '## PROJECT MODEL'), '### The review of a document portion'))
    .flatMap((block) => block.review?.findings ?? []).find((f) => f.resolution === 'dismissed')
  assert.ok(example, 'the review part shows no dismissed finding')
  assert.match(example.reason, /smaller than the model/)
  // The fields of `review` and the debt of a portion without one.
  for (const field of ['reviewer', 'model', 'findings', 'recheck', 'subject', 'kind', 'name', 'where', 'evidence', 'resolution', 'reason']) {
    assert.match(model, new RegExp('`' + field + '`'), field)
  }
  // Only the required fields are `review_malformed` when left out; the others take their defaults.
  assert.match(model, /so is a required field left out: `reviewer` and `model` of the report, `kind`, `name`, `evidence` and `resolution` of a finding\. Any other field left out takes its default: `findings` empty, `recheck` `false`, `subject` `entity`, `where` and `reason` empty/)
  assert.doesNotMatch(model, /A rule broken or a field left out is/)
  assert.match(model, /`unchecked_portion`/)
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
