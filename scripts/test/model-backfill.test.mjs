// The texts that teach the backfill of the project model: the procedure file
// `references/model-backfill.md` the conport skill links, the part of the
// skill's section PROJECT MODEL that reads the `backfill` key of `init`, and the
// step of the Superpowers overlay that keeps a filled model in step with the
// code. The refusals and their actions are the server's own text, word for word.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionWith } from './support/changelog.mjs'

const SKILL_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'skills', 'conport')
const read = (path) => readFileSync(join(SKILL_DIR, path), 'utf8')
const oneLine = (text) => text.replace(/\s+/g, ' ')
// The changelog entry that shipped the backfill, found by its words under whatever heading it has.
const backfillEntry = () => oneLine(sectionWith(read('CHANGELOG.md'), 'The conport skill ships the procedure `references/model-backfill.md`'))

/** The text from a heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

const procedure = () => read('references/model-backfill.md')
const modelSection = () => section(read('SKILL.md'), '## PROJECT MODEL')

/** The steps of the procedure: `## Step N. <title>` headings with their text. */
function steps() {
  const text = procedure()
  const heads = [...text.matchAll(/^## Step (\d)\. (.+)$/gm)]
  return heads.map((head, i) => ({
    n: Number(head[1]),
    title: head[2],
    body: section(text, head[0]),
  }))
}

const step = (n) => {
  const found = steps().find((s) => s.n === n)
  assert.ok(found, `no step ${n}`)
  return oneLine(found.body)
}

test('the conport skill links the backfill procedure', () => {
  const model = modelSection()
  assert.match(model, /`references\/model-backfill\.md`/)
  assert.ok(procedure().length > 0)
  // A procedure of the skill, not a command of the plugin.
  assert.doesNotMatch(oneLine(model), /\/conport:backfill|\/conport:model-backfill/)
})

test('the procedure names the six steps in their order', () => {
  assert.deepEqual(steps().map((s) => `${s.n}. ${s.title}`), [
    '1. Skeleton',
    '2. Inventory',
    '3. Pass',
    '4. What is gone',
    '5. Decisions',
    '6. Debts',
  ])
  // The frame says what ends each step.
  const frame = oneLine(procedure().slice(0, procedure().indexOf('## Step 1.')))
  for (const n of [1, 2, 3, 4, 5, 6]) assert.match(frame, new RegExp(`\\| ${n}\\. `), `the frame has no row of step ${n}`)
  assert.match(frame, /Done when/)
  // The cost is the user's: the reviewer runs on their model, not on the team's usage.
  assert.match(frame, /up to two reviewer runs per document on the user's model/)
  assert.doesNotMatch(frame, /team's usage/)
})

test('the procedure names the inventory and the result document by their exact titles', () => {
  const inventory = step(2)
  assert.match(inventory, /"Model backfill: inventory", type `other`, role `none`/)
  const result = step(4)
  assert.match(result, /"Model backfill: result", type `other`, role `structure`/)
  assert.match(result, /"Model backfill: result 2"/)
})

test('the procedure lists the seven tables of the result with the six numbers of the trust summary', () => {
  const tables = oneLine(section(procedure(), '## The tables of the result'))
  const names = [...tables.matchAll(/\| \d\. \*\*(.+?)\*\* \|/g)].map((m) => m[1])
  assert.deepEqual(names, [
    'Removed and replaced',
    'Without epic and without code',
    'Contradictions of documents',
    'Did not fit',
    'Unchecked portions',
    'Decisions without an entity',
    'Trust summary',
  ])
  for (const number of [
    'the number of entities',
    'the share of built entities',
    'the number of removed entities',
    'the number of unchecked portions',
    'the number of documents without an epic',
    'the number of decisions without an entity',
  ]) assert.ok(tables.includes(number), `the trust summary lacks ${number}`)
})

test('the procedure names the three roles and what each one means', () => {
  const inventory = step(2)
  assert.match(inventory, /`structure` — describes what exists now/)
  assert.match(inventory, /`history` — describes what has already been replaced/)
  assert.match(inventory, /`none` — ideas, audits, runbooks, notes, plans and text drawn from other records/)
})

test('the procedure gives every document a role and promises no automatic one', () => {
  const inventory = step(2)
  assert.match(inventory, /Every document of the project gets a role; no role is set automatically/)
})

test('the procedure keeps a runbook out of the sources until it is retyped', () => {
  assert.match(step(2), /A `runbook` document gets the role `none`; when it describes how the system is built, give it a new type first, then the role/)
})

test('the procedure starts the backfill with arch_backfill right after the roles are written', () => {
  const inventory = step(2)
  const roles = inventory.indexOf('update_document(project, document_id, model_role=')
  const start = inventory.indexOf("arch_backfill(project, state='in_progress')")
  assert.ok(roles >= 0, 'the step writes no role')
  assert.ok(start > roles, 'the backfill starts before the roles are written')
  assert.match(inventory.slice(roles, start + 60), /right after/)
  assert.match(inventory, /Writing a role does not start the backfill/)
})

test('the procedure leaves approval to the user of the project', () => {
  const text = oneLine(procedure())
  assert.match(text, /the user of the project approves/)
  assert.match(text, /The backfill of a project of another team is approved by a user of that team/)
  assert.match(step(2), /approves the inventory by their word/)
  // The procedure speaks of the user, never of an owner.
  assert.doesNotMatch(text, /\bowner\b/i)
})

test('the procedure tells how to build a code label and when to split it', () => {
  const skeleton = step(1)
  assert.match(skeleton, /`code:<unit-name>`/)
  assert.match(skeleton, /`cli\/conport` → `code:cli-conport`/)
  assert.match(skeleton, /more than 400 entities/)
  assert.match(skeleton, /`code:<unit-name>\.<part>`/)
  assert.match(skeleton, /the portion with the unit itself goes first/)
  assert.match(skeleton, /npx -y conport@\^0\.15\.0 arch check/)
  assert.match(skeleton, /no tool of its own builds the skeleton/i)
})

test('the procedure splits a large unit into code:<unit>.<part> portions that take its unit', () => {
  const skeleton = step(1)
  // Every code portion introduces exactly one unit; the root gets a unit of its own at `.`.
  assert.match(skeleton, /Every `code:` portion but a part portion, `code:root` too, introduces exactly one entity of the type `unit`/)
  assert.match(skeleton, /`code:root` introduces a unit for the repository with the anchor `path` `\.`/)
  // A part portion introduces none and takes the unit of its parent label.
  assert.match(skeleton, /A part portion `code:<unit-name>\.<part>` introduces no unit and takes the unit of `code:<unit-name>`/)
  assert.match(skeleton, /refused `code_portion_unit`/)
  // The server infers the owners of the parts: no relation `contains` is owed for them.
  assert.match(skeleton, /the server infers the entity that holds each part[^.]*`inferred_owners`/)
})

test('the procedure gives no action for orphans: the server folds them', () => {
  const text = oneLine(procedure())
  assert.doesNotMatch(text, /orphan_entity/)
  assert.doesNotMatch(text, /Model backfill: result N/)
  const gone = step(4)
  assert.match(gone, /the server folds it `removed` itself/)
  assert.match(gone, /`no_living_source`/)
  assert.match(gone, /nothing to claim/)
  // A part of a document portion is refused without its owner during the pass.
  assert.match(step(3), /refused `part_without_owner`/)
})

test('the changelog says the server infers the owners of the parts of a code portion', () => {
  const entry = oneLine(sectionWith(read('CHANGELOG.md'), 'The server infers the owners of the parts of a code portion.'))
  assert.match(entry, /`inferred_owners`/)
  assert.match(entry, /`inferred: true`/)
  assert.match(entry, /`by`/)
  assert.match(entry, /`arch_source`/)
})

test('the changelog names every other change of the surface of the model', () => {
  const changelog = read('CHANGELOG.md')
  const part = oneLine(sectionWith(changelog, 'A document portion that introduces a part without an owner is refused.'))
  assert.match(part, /`part_without_owner`/)
  const orphans = oneLine(sectionWith(changelog, 'The debt `orphan_entity` is gone.'))
  assert.match(orphans, /`state_reason: "no_living_source"`/)
  assert.match(orphans, /`no_living_source`/)
  assert.match(orphans, /`\[!supersedes\] \[\[doc-N\]\]`/)
  const stale = oneLine(sectionWith(changelog, 'A document portion goes stale by its blocks.'))
  assert.match(stale, /`model_portion`/)
  for (const tool of ['update_document', 'update_block', 'insert_block', 'delete_block']) assert.match(stale, new RegExp(`\`${tool}\``))
})

test('the overlay keeps the model of a spec and of the code by the rules of the server', () => {
  const flow = oneLine(read('references/superpowers-overlay.md').split('\n## The flow\n')[1].split('\n## ')[0])
  // The portion of the spec gives each part it introduces its owner.
  assert.match(flow, /refused `part_without_owner`/)
  // An edit of the spec answers `model_portion` when the spec has a portion.
  assert.match(flow, /`model_portion`/)
  // The code portions: one unit each, a part portion takes the unit, the server infers the owners.
  assert.match(flow, /Each `code:` portion but a part portion introduces exactly one unit/)
  assert.match(flow, /`code:<unit>\.<part>` introduces none and takes the unit of `code:<unit>`/)
  assert.match(flow, /`inferred_owners`/)
  assert.doesNotMatch(flow, /orphan_entity/)
})

test('the skeleton step runs arch suggest --json and names the version files', () => {
  const skeleton = step(1)
  // The proposal of units, parts and links comes from git history; it submits nothing.
  assert.match(skeleton, /`npx -y conport@\^0\.15\.0 arch suggest --json`/)
  assert.match(skeleton, /submits nothing/)
  // The rule of units is the CLI's own (spec doc-224 §3.4), so the list the agent
  // writes and the one `arch suggest` proposes are the same.
  for (const file of ['pyproject.toml', 'package.json', 'plugin.json', 'orca-plugin.json', 'Cargo.toml', 'go.mod']) {
    assert.ok(skeleton.includes(`\`${file}\``), `the version file ${file} is not named`)
  }
  assert.match(skeleton, /whose name starts with a dot \(`\.claude-plugin\/`, `\.cursor-plugin\/`\) makes its parent directory the unit/)
  assert.match(skeleton, /`workspaces`/)
  assert.match(skeleton, /the root of a workspace, not a unit/)
  assert.match(skeleton, /A version file under a path of the noise does not count/)
  assert.match(skeleton, /A file belongs to the deepest unit/)
  assert.match(skeleton, /the root \(`code:root`\)/)
  // The old rule asked for a release of its own, which no file shows.
  assert.doesNotMatch(skeleton, /and its own release/)
})

test('the procedure carries the limits 150 and 30', () => {
  const pass = step(3)
  assert.match(pass, /more than 150 entities or 30 scenarios/)
  assert.match(pass, /"did not fit"/)
  assert.match(pass, /an empty portion/)
  // No limit of a background check is left: a long document is reviewed like any other.
  assert.doesNotMatch(pass, /`document_too_long`|60 000/)
})

test('the estimate of the pass counts characters and the reviewer runs', () => {
  const pass = step(3)
  // `content_length` counts bytes, so it bounds the length in characters from above.
  assert.match(pass, /their total length in characters/)
  assert.match(pass, /`content_length` of `list_documents` counts bytes/)
  assert.match(pass, /"at most N characters"/)
  assert.match(pass, /up to two reviewer runs per document/)
  assert.doesNotMatch(pass, /their total length \(`content_length`/)
})

test('the pass reviews every document portion before it is submitted', () => {
  const pass = step(3)
  assert.match(pass, /reviewed before it is submitted/)
  assert.match(pass, /\*The review of a document portion\*/)
  assert.match(pass, /npx -y conport@\^0\.15\.0 arch review-input/)
  // A check refused by the team's usage is gone with the check itself.
  assert.doesNotMatch(pass, /not admitted|team's usage/)
})

test('the pass goes by the current dates when no operator of the server can set them', () => {
  const inventory = step(2)
  assert.match(inventory, /the operator of the server sets the dates before the pass/i)
  assert.match(inventory, /no access to the operator of the server, no step waits for it: the pass goes by the current dates of creation/)
  assert.match(inventory, /the result names the documents with disputed dates in one line/)
  // The result is written by step 4 and its tables: they name that line too.
  const tables = oneLine(section(procedure(), '## The tables of the result'))
  assert.match(tables, /When the dates were not set before the pass: one line naming the documents with disputed dates, from the list of the inventory/)
})

test('the procedure grounds a result claim on the block of its table', () => {
  assert.match(step(4), /the ground of each claim is the block of the table of the result that holds its row/)
})

test('the procedure reads unlinked decisions page by page', () => {
  const decisions = step(5)
  assert.match(decisions, /`unlinked_decisions`/)
  assert.match(decisions, /`arch_status\(project, unlinked_after=<next_after>\)`/)
  // The last page carries `next_after: null`, often with `ids` left: reading on would start over.
  assert.match(decisions, /until `next_after` is null — that page is the last/)
  assert.doesNotMatch(decisions, /until `ids` is empty/)
  assert.match(decisions, /`mentioned`/)
})

/** The server's actions of the refusals of the backfill, word for word. */
function refusalActions() {
  return {
    backfill_not_ready: 'Clear each item of `blockers` by its kind, as the backfill procedure says, then repeat the call.',
    backfill_not_started:
      "Start the backfill first: arch_backfill with state 'in_progress', right after the inventory is approved.",
    backfill_required:
      'Filling the model is required and cannot be declined: start the backfill by the backfill procedure of the ' +
      "conport skill, arch_backfill with state 'in_progress' right after the inventory is approved.",
  }
}

test('the procedure names every refusal of the backfill with its action', () => {
  const refusals = section(procedure(), '## Refusals')
  const actions = refusalActions()
  const rows = new Map(refusals.split('\n')
    .filter((line) => /^\| `[a-z_]+` \|/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .map((cells) => [cells[0].replace(/`/g, ''), cells.at(-1)]))
  assert.deepEqual([...rows.keys()].sort(), Object.keys(actions).sort())
  for (const [code, action] of Object.entries(actions)) assert.equal(rows.get(code), action, code)
  const debts = oneLine(step(6))
  assert.match(debts, /`backfill_not_ready` names what blocks the completion/)
  // A portion submitted without a review is a debt like any other: the reviewer and a new submission clear it.
  assert.match(debts, /`unchecked_portion`[^.]*run the reviewer on the portion and submit it again with `review`/i)
  assert.doesNotMatch(debts, /retry_at|answer_truncated|60 000|`state` is `none`/)
})

test('the procedure warns that the none role withdraws the portion of a document', () => {
  const inventory = step(2)
  assert.match(inventory, /The role `none` on a document with a portion withdraws that portion/)
  assert.match(inventory, /The role `history` on a document with a portion keeps the portion and deletes the scenarios of that portion/)
  assert.match(inventory, /never empty it/)
  // A new type would withdraw the portion of a document without a role.
  assert.match(inventory, /a document without a role that already has a portion: write its role first, then change its type/)
})

test("the procedure allows the rollback only on the user's word", () => {
  const text = procedure()
  const rollback = oneLine(section(text, '## Rollback'))
  assert.match(rollback, /only on the user's word/)
  // `withdraw --all` came with the CLI 0.7.3.
  assert.match(rollback, /`npx -y conport@\^0\.15\.0 arch withdraw --all`/)
  assert.match(rollback, /with `--apply` it withdraws every source of the project/i)
  assert.match(rollback, /without `--apply` it removes nothing/)
  // No refusal prescribes the rollback (spec doc-197 §13), and none is tied to it.
  assert.match(rollback, /no refusal prescribes it/)
  assert.doesNotMatch(rollback, /backfill_[a-z_]+/)
  for (const action of Object.values(refusalActions())) assert.doesNotMatch(action, /roll\s*(it\s*)?back|rollback/i)
  // The attachments of decisions leave with the entities; roles, types and links stay.
  assert.match(rollback, /The roles, types and links of the documents stay/)
  assert.match(rollback, /the attachments of decisions to entities are removed with the entities/)
  // No other part of the procedure names the command.
  const outside = text.replace(section(text, '## Rollback'), '')
  assert.doesNotMatch(outside, /withdraw --all/)
  // Nowhere in the skill is the rollback the agent's own step.
  for (const file of ['SKILL.md', 'references/command_list.md', 'references/superpowers-overlay.md']) {
    for (const m of oneLine(read(file)).matchAll(/withdraw --all/g)) {
      const around = oneLine(read(file)).slice(Math.max(0, m.index - 300), m.index + 300)
      assert.match(around, /user's word|only when the user/, `${file}: withdraw --all without the user's word: ${around}`)
    }
  }
})

test('the reference tells a repeated completion keeps its date', () => {
  const reference = oneLine(section(read('references/command_list.md'), '### arch_backfill'))
  assert.doesNotMatch(reference, /from `in_progress` only/)
  assert.match(reference, /again on a completed backfill, which keeps its date of completion/)
})

test('the changelog runs the full withdrawal with the CLI that has it', () => {
  const changelog = backfillEntry()
  assert.match(changelog, /`npx -y conport@\^0\.7\.3 arch withdraw --all`/)
  assert.doesNotMatch(changelog, /conport@\^0\.7 arch withdraw/)
})

test('the skill reads the backfill line of init as a notice and never declines the backfill', () => {
  const model = oneLine(modelSection())
  assert.match(model, /`Backfill: K of M documents submitted`/)
  assert.match(model, /a notice, not a task/)
  assert.match(model, /does not run the backfill/)
  // Filling the model is required: the decline is named only as refused.
  assert.match(model, /Filling the model is required\./)
  assert.match(model, /There is no decline: `arch_backfill\(project, state='declined'\)` is refused with `backfill_required`/)
  assert.doesNotMatch(model, /Show the offer to the user once|only after the user declines it/)
  assert.doesNotMatch(model, /Start, complete or decline the backfill/)
})

test("the skill's no_portion debt names the role rule", () => {
  const debts = section(modelSection(), '### Debts of the model in init')
  const row = debts.split('\n').find((line) => line.startsWith('| `no_portion` |'))
  assert.ok(row, 'no row no_portion')
  assert.match(row, /role `structure` or `history`/)
  assert.match(row, /while the backfill runs or after it is completed/)
})

test('the skill says a history source gets no whole-scenario finding', () => {
  const model = oneLine(modelSection())
  assert.match(model, /A document with the role `history` submits no scenarios, and the reviewer raises no whole-scenario finding for it/)
  assert.match(model, /Submit the portion of a document with the role history again without the field `scenarios`\./)
  // The dismissal of a whole-scenario finding for a missing kind stays as it was.
  assert.match(model, /When no scenario kind fits that behaviour, dismiss the whole-scenario finding for that reason/)
})

test('the overlay resubmits the skeleton only in a project whose model has code sources', () => {
  const flow = read('references/superpowers-overlay.md').split('\n## The flow\n')[1].split('\n## ')[0]
  const finish = oneLine(flow.slice(flow.search(/^\d+\. \*\*Finish\.\*\*/m)))
  const condition = finish.indexOf('In a project whose model has `code` sources')
  const check = finish.indexOf('npx -y conport@^0.15.0 arch check')
  const debt = finish.indexOf('`code_portion_stale`')
  assert.ok(condition >= 0, 'the finish step has no condition on code sources')
  assert.ok(check > condition, 'the anchor check runs without the condition')
  // The git facts come from the main branch, and the portions are resubmitted by the debt they owe.
  assert.match(finish.slice(check), /on the main branch/)
  assert.ok(debt > check, 'the portions are resubmitted before the check that names them')
  assert.match(finish.slice(debt), /submit it again/)
  assert.match(finish, /`arch_sources`/)
  // The branch of the epic lands as a merge commit: a fast-forward dates its changes before the portions.
  assert.match(finish, /`git merge --no-ff`/)
  // The procedure says the same after the backfill.
  const after = oneLine(section(procedure(), '## After the backfill'))
  assert.match(after, /`code_portion_stale`/)
  assert.match(after, /npx -y conport@\^0\.15\.0 arch check/)
  assert.match(after, /`--no-ff`/)
})

// ── the git facts of the anchor check ──────────────────────────────────────

test('the skill teaches the git facts of the anchor check and what leaves the machine', () => {
  const model = oneLine(modelSection())
  const check = oneLine(section(modelSection(), '### The anchor check'))
  // The promise the facts broke is gone; the list of what leaves the machine replaces it.
  assert.doesNotMatch(model, /The code never leaves the machine/)
  for (const what of ['the name of the branch', 'the dates of commits', '`recent_files`', '`changes`',
    '`symbol_files`', 'the paths of the hot directories and of the units', 'the patterns of `arch.ignore`',
    'the numbers of commits and of index nodes']) assert.ok(check.includes(what), `the list lacks ${what}`)
  assert.match(check, /No code, no commit message and no author/)
  // Main or master only; a shallow clone and the opt-out.
  assert.match(check, /`main` or `master`/)
  assert.match(check, /git fetch --unshallow/)
  assert.match(check, /`--no-git`/)
  // The keys of `.conport.json` the pass reads.
  for (const key of ['`plugins.codegraph`', '`arch.ignore`', '`arch.git`']) assert.ok(check.includes(key), key)
  // The debts the facts feed and the state of the pass.
  for (const kind of ['`code_portion_stale`', '`area_uncovered`', '`check_stale`']) assert.ok(check.includes(kind), kind)
  assert.match(check, /older than 7 days/)
  assert.match(check, /`git_pass`/)
  // The table of commands at the head of the section names both new forms of the CLI.
  const table = model.slice(0, model.indexOf('### What goes into the model'))
  assert.match(table,/`npx -y conport@\^0\.15\.0 arch suggest --json`/)
  assert.match(table, /`npx -y conport@\^0\.15\.0 arch check --no-git`/)
})

test('the tool reference describes git_pass of arch_status and activity of the graph and the card', () => {
  const reference = read('references/command_list.md')
  assert.match(oneLine(section(reference, '### arch_status')), /`git_pass` \(`checked_at`, `commit`, `branch`, `head_at`, `history_truncated`, `shallow`, `codegraph`, `disabled`/)
  assert.match(oneLine(section(reference, '### arch_get')), /`activity` \(`last_commit_at`, `commits_90d`, `recent_files`/)
  assert.match(oneLine(section(reference, '### arch_get')), /`activity_as_of`/)
  assert.match(oneLine(section(reference, '### arch_entity')), /`activity`/)
})

// ── the model is required; the line goes only to a session with a person ──

test('the skill says the model is required and only a session with a person gets the line', () => {
  const model = oneLine(modelSection())
  const required = model.slice(model.indexOf('**Filling the model is required.**'), model.indexOf('**A rollback**'))
  assert.ok(required.length > 0, 'no paragraph on the required model')
  assert.match(required, /documents or decisions but no model, search runs without it and `required` is true/)
  assert.match(required, /a decline made before is no exception/)
  assert.match(required, /Only a session with a person — `init` called with `questions=true` — gets the line in `instructions` that says so/)
  assert.match(required, /a routine or a subagent \(`questions=false`\) gets the key `required` alone and leaves it/)
  assert.match(required, /`backfill_required`, whose action is to start the backfill/)
  // One backfill session per project: while it runs, nobody else is told to start one.
  assert.match(required, /While the backfill runs, no session gets the line: one session runs the backfill of a project, and another gets the progress line alone and starts no second one/)
  // The search names the projects it searched without a model.
  const search = oneLine(section(read('SKILL.md'), '### Search through the model'))
  assert.match(search, /`projects_without_model` of the answer names by handle the projects of the search's scope that have documents or decisions but no model/)
})

test("the parameter questions of init says false drops the warning line", () => {
  const row = read('references/command_list.md').split('\n').find((line) => line.startsWith('| questions | boolean |'))
  assert.ok(row, 'no row questions')
  assert.match(row, /`instructions` carries no warning that filling the project model is required \(the key `arch\.backfill\.required` stays\)/)
})

test('the reference says a decline of the backfill is refused and search names the projects without a model', () => {
  const reference = read('references/command_list.md')
  const backfill = oneLine(section(reference, '### arch_backfill'))
  assert.match(backfill, /`declined` is refused in every state with `backfill_required`/)
  assert.doesNotMatch(backfill, /backfill_already_started|only on the user's refusal/)
  assert.match(oneLine(section(reference, '### search')), /`projects_without_model` — the handles of the projects of the search's scope that hold documents or decisions but no model/)
  assert.match(oneLine(procedure()), /\*\*It is required\.\*\* A project with documents or decisions and no model is searched without the model/)
})

test('the changelog says filling the model is required and the backfill can no longer be declined', () => {
  const entry = oneLine(sectionWith(read('CHANGELOG.md'), 'Filling the project model is required; the backfill can no longer be declined.'))
  assert.match(entry, /`arch\.backfill\.required`/)
  assert.match(entry, /`backfill_required`/)
  assert.match(entry, /`projects_without_model`/)
})

test('the backfill entry of the changelog says only a session with a person gets the offer', () => {
  const entry = backfillEntry()
  assert.match(entry, /only a session with a person — `init` called with `questions=true` — gets the line that offers it; a routine or a subagent gets the key `offer` alone/)
})
