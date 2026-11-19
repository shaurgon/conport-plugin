// The texts that teach the onboarding of an existing project: the procedure
// file `references/project-onboarding.md` the conport skill links from its
// part *After init*, the first fill `references/bootstrap.md` it hands a
// repository without history to, the install page of Cursor and the changelog.
// The lines of `init` are the server's own text, word for word.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionWith } from './support/changelog.mjs'

const PLUGIN_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SKILL_DIR = join(PLUGIN_DIR, 'skills', 'conport')
const read = (path) => readFileSync(join(SKILL_DIR, path), 'utf8')
const oneLine = (text) => text.replace(/\s+/g, ' ')

/** The text from a heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

const procedure = () => read('references/project-onboarding.md')
const part = (heading) => oneLine(section(procedure(), heading))
const afterInit = () => {
  const skill = read('SKILL.md')
  return oneLine(skill.slice(skill.indexOf('### After init'), skill.indexOf('### Questions from init')))
}

/** The three lines `init` gives a session with a person, as the server words them. */
const INIT_LINES = [
  "Project onboarding: this project is empty — if the repository has history, offer the user to connect it by the onboarding procedure of the conport skill; if they decline, call project_onboarding(project, state='declined').",
  "Project onboarding in progress — resume it by the onboarding procedure of the conport skill from the step its draft names; if the user no longer wants it, call project_onboarding(project, state='declined') — what is written stays.",
  "Project onboarding in progress, led by another member of this team — do not start another; take it over only on the user's word.",
]

test('the skill links the onboarding procedure from After init', () => {
  const after = afterInit()
  assert.match(after, /`references\/project-onboarding\.md`/)
  assert.ok(procedure().length > 0)
  // The key of init, the lead told only as the caller or not, never by a name.
  assert.match(after, /`onboarding` \(`state`, `offer`, `lead_is_caller`\)/)
  // The local references of the skill name the procedure too.
  assert.match(oneLine(section(read('SKILL.md'), '## Live docs')), /`references\/project-onboarding\.md`/)
})

test('the procedure names its steps in order', () => {
  const headings = [...procedure().matchAll(/^## (.+)$/gm)].map((m) => m[1])
  assert.deepEqual(headings, [
    'The frame',
    'Step 0. Entry',
    'Step 1. Interview 1',
    'Step 1a. Earlier records',
    'Step 2. Documents',
    'Step 3. Skeleton',
    'Step 4. History',
    'Step 5. Interview 2',
    'Step 6. Approval',
    'Step 7. Writing',
    'Step 8. Model from the documents',
    'Step 9. Summary',
    'Draft and resume',
    'Decline, stop and rollback',
    'Cost',
    'Without a person',
    'Several repositories',
    'Refusals',
  ])
  // The frame has a row for every step and says what ends it.
  const frame = part('## The frame')
  for (const n of ['0', '1', '1a', '2', '3', '4', '5', '6', '7', '8', '9']) {
    assert.match(frame, new RegExp(`\\| ${n}\\. `), `the frame has no row of step ${n}`)
  }
  assert.match(frame, /Done when/)
})

test('the procedure quotes the three init lines of the server', () => {
  const text = oneLine(procedure())
  for (const line of INIT_LINES) assert.ok(text.includes(`\`${line}\``), `the procedure does not quote: ${line}`)
})

test('the entry checks the repository, the CLI and the project before the state is written', () => {
  const entry = part('## Step 0. Entry')
  // The repository: not shallow, at least 20 first-parent commits, the first older than 30 days.
  assert.match(entry, /`git fetch --unshallow`/)
  assert.match(entry, /at least 20 commits/)
  assert.match(entry, /older than 30 days/)
  assert.match(entry, /`references\/bootstrap\.md` without its own condition/)
  // The CLI reads the state of the onboarding; without Node.js or a key, one action.
  assert.match(entry, /`npx -y conport@\^0\.15\.0 api arch onboarding --project <project>`/)
  assert.match(entry, /`GET \/api\/v1\/projects\/\{project\}\/onboarding`/)
  assert.match(entry, /put CONPORT_API_KEY in the environment or in ~\/\.config\/conport\/\.env/)
  // Advice that blocks nothing, one action each.
  assert.match(entry, /`plugins\.superpowers`/)
  assert.match(entry, /`codegraph` index/)
  assert.match(entry, /blocks nothing/)
  // A project to create: on the user's word, and the limit of the plan.
  assert.match(entry, /`create_project\(name, description\?\)`/)
  assert.match(entry, /`project_limit_reached`[^.]*change the plan or free a project/)
  // The state and the draft.
  assert.match(entry, /`project_onboarding\(project, state='in_progress'\)`/)
  assert.match(entry, /`\.conport\/onboarding\/draft\.md`/)
})

test('the skeleton and the history run the commands of the CLI', () => {
  const skeleton = part('## Step 3. Skeleton')
  assert.match(skeleton, /`npx -y conport@\^0\.15\.0 arch suggest --json`/)
  assert.match(skeleton, /`npx -y conport@\^0\.15\.0 arch check`/)
  assert.match(skeleton, /`references\/model-backfill\.md`/)
  const history = part('## Step 4. History')
  assert.match(history, /`npx -y conport@\^0\.15\.0 history --to <tip of the main branch> --json`/)
  assert.match(history, /`git symbolic-ref refs\/remotes\/origin\/HEAD`/)
  assert.match(history, /`npx -y conport@\^0\.15\.0 history --stage N --to <to> --json`/)
  assert.match(history, /`project_onboarding\(project, state='in_progress', history=\{to, since, ignore\}\)`/)
  // The same arguments on every call, so new commits do not move the stages.
  assert.match(history, /the same `--to`, `--since` and `--ignore`/)
  // The server keeps the arguments the table was read with, never empty ones copied from an example.
  assert.match(history, /"since": <since>, "ignore": <ignore>/)
  assert.doesNotMatch(history, /"since": null, "ignore": \[\]/)
  // The warning comes between the table of contents and the first stage.
  const warning = history.indexOf('the model of your agent reads the commit messages')
  assert.ok(warning > history.indexOf('history --to <tip of the main branch>'), 'no warning after the table of contents')
  assert.ok(warning < history.indexOf('**Each stage.**'), 'the warning comes after the first stage')
})

test('the procedure keeps raw commit messages and authors out of ConPort', () => {
  const history = part('## Step 4. History')
  assert.match(history, /Only your retelling goes into ConPort/)
  assert.match(history, /raw commit messages, the names and the e-mails of their authors are never written/)
  assert.match(history, /no names of people/)
  assert.match(history, /nothing that looks like a secret/)
  // The user is warned before the messages are read.
  assert.match(part('## Cost'), /the model of your agent reads the commit messages; they never reach ConPort/)
  assert.match(part('## Cost'), /Before step 4/)
  // No author ever stands among what is written.
  assert.doesNotMatch(oneLine(procedure()), /author name|commits per author|by author/i)
})

/** The calls of every writing step: the MCP tool and the form of `conport api`. */
const WRITING_PAIRS = [
  ['## Step 0. Entry', 'create_project(name, description?)', 'npx -y conport@^0.15.0 api projects create --name <name>'],
  ['## Step 0. Entry', "project_onboarding(project, state='in_progress')", 'npx -y conport@^0.15.0 api arch onboarding-put'],
  ['## Step 1a. Earlier records', 'deprecate_decision(', 'npx -y conport@^0.15.0 api decisions deprecate'],
  ['## Step 1a. Earlier records', "update_document(project, document_id, status='archived')", 'npx -y conport@^0.15.0 api documents replace --project <project> --document_id <N> --status archived'],
  ['## Step 2. Documents', 'update_document(project, document_id, content=', 'npx -y conport@^0.15.0 api documents replace --project <project> --document_id <N> --content'],
  ['## Step 4. History', 'project_onboarding(project, state=', 'npx -y conport@^0.15.0 api arch onboarding-put'],
  ['## Step 7. Writing', 'log_progress(', 'npx -y conport@^0.15.0 api batch progress'],
  ['## Step 7. Writing', 'sync_decision(', 'npx -y conport@^0.15.0 api batch decisions'],
  ['## Step 7. Writing', 'deprecate_decision(', 'npx -y conport@^0.15.0 api decisions deprecate'],
  ['## Step 7. Writing', "relationship='mentions'", 'npx -y conport@^0.15.0 api links create --project <project> --source_type progress --source_id <N> --target_type entity --target_id <entity> --link_type mentions'],
  ['## Step 7. Writing', "relationship='supersedes'", 'npx -y conport@^0.15.0 api links create --project <project> --source_type decision --source_id <new> --target_type decision --target_id <old> --link_type supersedes'],
  ['## Step 7. Writing', "relationship='references'", 'npx -y conport@^0.15.0 api links create --project <project> --source_type doc --source_id <overview> --target_type doc --target_id <N> --link_type references'],
  ['## Step 7. Writing', 'update_product_context(', 'npx -y conport@^0.15.0 api context update --project <project> --context_type product'],
  ['## Step 7. Writing', "update_active_context(project, field='current_focus'", 'npx -y conport@^0.15.0 api context update --project <project> --context_type active'],
  ['## Step 7. Writing', 'add_document(', 'npx -y conport@^0.15.0 documents upload'],
  ['## Step 9. Summary', "project_onboarding(project, state='completed')", 'npx -y conport@^0.15.0 api arch onboarding-put'],
  ['## Step 9. Summary', 'update_product_context(', 'npx -y conport@^0.15.0 api context update --project <project> --context_type product'],
]

test('every writing step names the MCP call and its conport api form', () => {
  for (const [heading, mcp, cli] of WRITING_PAIRS) {
    const body = part(heading)
    assert.ok(body.includes(mcp), `${heading} does not name ${mcp}`)
    assert.ok(body.includes(cli), `${heading} does not name ${cli}`)
  }
  // Each link of the procedure is a pair: every relationship of link_items has its --link_type form.
  const text = oneLine(procedure())
  const relationships = [...text.matchAll(/link_items\([^`]*relationship='([a-z_]+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(relationships)].sort(), ['mentions', 'references', 'supersedes'])
  for (const relationship of relationships) {
    assert.ok(text.includes(`api links create --project <project>`) && text.includes(`--link_type ${relationship}`), relationship)
  }
  // The batches carry the past dates; the context goes by one PATCH.
  const writing = part('## Step 7. Writing')
  assert.match(writing, /`PATCH \/api\/v1\/projects\/\{project\}\/context\/product`/)
  assert.match(writing, /`POST \/api\/v1\/projects\/\{project\}\/batch\/progress`/)
  assert.match(writing, /`POST \/api\/v1\/projects\/\{project\}\/batch\/decisions`/)
  assert.match(writing, /up to 100/)
})

test('every command runs npx -y conport@^0.15.0', () => {
  const text = procedure()
  const ranges = [...text.matchAll(/conport@[^\s`]+/g)].map((m) => m[0])
  assert.ok(ranges.length > 0)
  assert.deepEqual([...new Set(ranges)], ['conport@^0.15.0'])
  assert.doesNotMatch(text, /npx conport/)
  // No command of the CLI is told bare: whatever `conport` is installed may lack it.
  assert.doesNotMatch(text, /`conport (?:history|api|arch|documents)\b/)
})

test('the chronicle, the overview and the context are written as the spec says', () => {
  const writing = part('## Step 7. Writing')
  assert.match(writing, /`Stage N: <gist>, <month> – <month> <year>`/)
  assert.match(writing, /in the user's language/)
  assert.match(writing, /`created_at` is the date of the last commit of the stage/)
  assert.match(writing, /`first\.\.last`/)
  assert.match(writing, /relationship='mentions'/)
  assert.match(writing, /type `architecture`/)
  assert.match(writing, /`Project overview <name>`/)
  assert.match(writing, /`\[\[progress-N\]\]`/)
  for (const n of [1, 2, 3, 4, 5]) assert.match(writing, new RegExp(` ${n}\\. \\*\\*`), `the overview has no section ${n}`)
  assert.match(writing, /`references`/)
  // What the code, the README and the interviews did not tell is not written.
  assert.match(writing, /A field nothing told is not written/)
  assert.match(part('## Step 9. Summary'), /`onboarded_at`/)
})

test('the documents step dates, titles and uploads each file', () => {
  const documents = part('## Step 2. Documents')
  assert.match(documents, /`git log --diff-filter=A --follow --format=%cI -- <file>`/)
  assert.match(documents, /the oldest/)
  assert.match(documents, /`<path>: <H1 or file name>`/)
  assert.match(documents, /`\.mdx`, `\.rst`, `\.adoc`/)
  assert.match(documents, /"not uploaded: format"/)
  assert.match(documents, /`npx -y conport@\^0\.15\.0 documents upload <file> --doc-type <type> --title <title> --created-at <date>`/)
  assert.match(documents, /approves the inventory/)
  assert.match(documents, /No `\.md` file in the repository and none handed over: the step is empty/)
  assert.doesNotMatch(documents, /Without a repository/)
})

test('a changed file renews its document in place, never by a second upload', () => {
  const documents = part('## Step 2. Documents')
  // The CLI refuses another body under a taken title: a second upload would only end in a duplicate.
  assert.doesNotMatch(oneLine(procedure()), /renewed by uploading it again/)
  assert.match(documents, /is not uploaded again/)
  assert.match(documents, /`update_document\(project, document_id, content=<the file's body>\)`/)
  assert.match(documents, /`npx -y conport@\^0\.15\.0 api documents replace --project <project> --document_id <N> --content "\$\(cat '<file>'\)"`/)
  // A spec only as an amendment with its reason: the server refuses `amend` without one.
  assert.match(documents, /`--change_kind amend --reason '<why>'`/)
  assert.match(documents, /`change_kind='amend'` and\s+`reason` to `update_document`/)
  // A body over one argument of the command line goes through MCP.
  assert.match(documents, /larger than about 128 KiB[^.]*: renew it through MCP `update_document`/)
  // The refusal of the CLI is in the table, with the renewal first.
  const refusals = part('## Refusals')
  assert.match(refusals, /`doc-<N> already has the title "<title>" with another body: …`[^|]*\|[^|]*\| The same file changed since its upload: renew doc-N in place, as step 2 says\. Another file: give it a title of its own/)
})

test('the procedure names the labels of the decisions', () => {
  const writing = part('## Step 7. Writing')
  assert.match(writing, /`project-onboarding`/)
  assert.match(writing, /`restored-from-git`/)
  assert.match(writing, /`from-owner`/)
  assert.match(writing, /`search`[^.]*before/)
  assert.match(writing, /`supersedes`/)
  assert.match(writing, /`update_decision\(project, decision_id, entities=/)
})

test('the draft lives outside git and is found from another worktree', () => {
  const draft = part('## Draft and resume')
  assert.match(draft, /`\.conport\/onboarding\/draft\.md`/)
  assert.match(draft, /`\.gitignore` holding the line `\*`/)
  assert.match(draft, /`git rev-parse --git-common-dir`/)
  // Without the draft the written records are matched before anything is written again.
  assert.match(draft, /by `created_at` and the range `first\.\.last`/)
  assert.match(draft, /by the label `project-onboarding`/)
  assert.match(draft, /by its title/)
  assert.match(draft, /`GET \/api\/v1\/projects\/\{project\}\/onboarding`/)
})

test("the procedure declines, stops and rolls back only on the user's word and before completed", () => {
  const text = procedure()
  const decline = part('## Decline, stop and rollback')
  assert.match(decline, /`project_onboarding\(project, state='declined'\)`/)
  assert.match(decline, /what is written stays/)
  assert.match(decline, /only on the user's word/)
  assert.match(decline, /never as a step of your own/)
  assert.match(decline, /before `completed`/)
  assert.match(decline, /`npx -y conport@\^0\.15\.0 arch withdraw --all --apply`/)
  // No other part of the procedure names the command.
  const outside = text.replace(section(text, '## Decline, stop and rollback'), '')
  assert.doesNotMatch(outside, /withdraw --all/)
  assert.match(part('## Without a person'), /`questions=false`/)
  assert.match(part('## Without a person'), /never starts the procedure/)
})

test('the summary and the several repositories give the actions of the spec', () => {
  const summary = part('## Step 9. Summary')
  for (const what of ['product context', 'overview', 'model', 'chronicle', 'decisions', 'documents']) {
    assert.ok(summary.toLowerCase().includes(what), `the summary does not name ${what}`)
  }
  assert.match(summary, /deletes the draft/)
  const several = part('## Several repositories')
  assert.match(several, /`link_project\(project, target_project, link_type\)`/)
  for (const type of ['`part_of`', '`calls`', '`shares_data`', '`depends_on`']) assert.ok(several.includes(type), type)
  assert.match(several, /connect <repository> the same way and link the projects/)
  assert.match(several, /create a project of its own for the repository <name>, set it in \.conport\.json of that repository, connect it and link the projects/)
  assert.match(several, /`free`/)
})

test('the procedure carries no internal numbers and no project handle', () => {
  const text = procedure()
  assert.doesNotMatch(text, /\b(task|decision|doc)-\d+/)
  assert.doesNotMatch(text, /\bpr[a-hjkmnp-z2-9]{8}\b/)
})

test('bootstrap starts from the onboarding condition and writes the context by PATCH', () => {
  const bootstrap = read('references/bootstrap.md')
  const head = oneLine(bootstrap.slice(0, bootstrap.indexOf('## Interactive flow')))
  assert.match(head, /`references\/project-onboarding\.md`/)
  assert.match(head, /at least 20 commits/)
  // The first fill no longer waits for zero decisions.
  assert.doesNotMatch(head, /decisions_total/)
  assert.match(head, /`onboarding\.offer`/)
  assert.doesNotMatch(bootstrap, /update_product_context\(\{[\s\S]*?content:/)
  assert.match(bootstrap, /`PATCH \/api\/v1\/projects\/\{project\}\/context\/product`/)
  assert.match(bootstrap, /npx -y conport@\^0\.15\.0 api context update --project <project> --context_type product --patch/)
  // A document is created with its type.
  assert.match(oneLine(bootstrap), /`add_document` with its `doc_type`/)
})

test('the skill reads onboarding.offer, not zero counters, for the first fill', () => {
  const after = afterInit()
  assert.match(after, /`onboarding\.offer`/)
  assert.doesNotMatch(after, /no decisions, no patterns/)
  // In a session with an onboarding running, the offer to fill the model does not come.
  const filling = oneLine(section(read('SKILL.md'), '### Filling the model of an existing project'))
  assert.match(filling, /step 8/)
  assert.match(filling, /`in_progress`[^.]*no line offering the backfill/)
})

test('the skill tells an agent without MCP to read GET /onboarding', () => {
  const after = afterInit()
  assert.match(after, /without the MCP server/)
  assert.match(after, /`GET \/api\/v1\/projects\/\{project\}\/onboarding`/)
  assert.match(after, /`npx -y conport@\^0\.15\.0 api arch onboarding --project <project>`/)
})

test('cursor install replaces the whole skills/conport folder with references/', () => {
  const cursor = oneLine(readFileSync(join(PLUGIN_DIR, 'docs', 'install', 'cursor.md'), 'utf8'))
  const updating = cursor.slice(cursor.indexOf('## Updating'))
  assert.match(updating, /the whole `skills\/conport\/` folder/)
  assert.match(updating, /`references\/`/)
  assert.doesNotMatch(updating, /Pull the latest `skills\/conport\/SKILL\.md`/)
})

// The entry is the section that names the document type, under whatever heading the release gave it.
test('the changelog names the breaking changes and the rollback in the release that ships them', () => {
  const entry = oneLine(
    sectionWith(read('CHANGELOG.md'), 'name the document type: spec, architecture, runbook, api_docs, tutorial, meeting_notes, plan or other'),
  )
  for (const needle of [
    '**Breaking',
    '`doc_type`',
    '`POST /api/v1/projects/{project}/documents`',
    '`POST /api/v1/projects/{project}/documents/upload`',
    '`add_document`',
    '`--doc-type`',
    'name the document type: spec, architecture, runbook, api_docs, tutorial, meeting_notes, plan or other',
    '`project_onboarding`',
    '`GET /api/v1/projects/{project}/onboarding`',
    '`PUT /api/v1/projects/{project}/onboarding`',
    '`onboarding_state`',
    '`created_at`',
    '`title`',
    '`--created-at`',
    '`--title`',
    'conport history',
    'npx -y conport@^0.15.0',
    '`references/project-onboarding.md`',
    '`projects/project-onboarding`',
  ]) assert.ok(entry.includes(needle), `the onboarding entry of the changelog does not name ${needle}`)
  // While the server is rolled back, the steps that need the new form are not run.
  assert.match(entry, /steps 2 and 7 of the onboarding are not run/)
  assert.doesNotMatch(entry, /\b(task|decision|doc|progress)-\d+\b/)
})
