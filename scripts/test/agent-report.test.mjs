// An agent reports a defect of the service, a missing capability or a refusal
// that says nothing it can act on as a public GitHub issue of the plugin's
// repository, through the issue form `agent-report.yml`. These tests read the
// form and the conport skill as they ship and hold them to that channel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const FORM = join(PLUGIN, '.github', 'ISSUE_TEMPLATE', 'agent-report.yml')
const SKILL = join(PLUGIN, 'skills', 'conport', 'SKILL.md')
const PAGE = join(PLUGIN, 'docs', 'use-cases', 'agent-issues.md')
const ROUTINE = join(PLUGIN, 'skills', 'conport-routine', 'SKILL.md')
// The live docs page of the project model; it lives beside the plugin in the
// repository it is developed in, not in the plugin's own repository.
const MODEL_PAGE = join(PLUGIN, '..', '..', 'landing', 'docs-src', 'projects', 'architecture-model.md')
const REPO = 'shaurgon/conport-plugin'
// Labels set through the API are dropped for an author without triage access,
// so the title prefix — not a label — is what marks an agent report and what
// the search before filing finds.
const PREFIX = '[agent-report] '
const NEW_ISSUE = `https://github.com/${REPO}/issues/new?`
// The open issues whose title holds the prefix, as a person opens them without gh.
const SEARCH = `https://github.com/${REPO}/issues?q=is%3Aissue+is%3Aopen+in%3Atitle+%22%5Bagent-report%5D%22+`

/** The form's fields: `{type, id, required, description, options}` per item of `body`. */
function formFields(yaml) {
  const body = yaml.split(/^body:\s*$/m)[1]
  assert.ok(body !== undefined, 'the form has no body')
  return body.split(/^ {2}- type: /m).slice(1).map((item) => ({
    type: item.split('\n')[0].trim(),
    id: (/^ {4}id: (\S+)/m.exec(item) || [])[1],
    required: /^ {6}required: true\s*$/m.test(item),
    description: (/^ {6}description: (.*)$/m.exec(item) || [])[1] || '',
    options: [...item.matchAll(/^ {8}- (\S+)\s*$/gm)].map((m) => m[1]),
  }))
}

// GitHub fills a field of an issue form from a parameter of the address only
// when the field is an input or a textarea; a dropdown stays unselected.
const FILLED_BY_LINK = ['input', 'textarea']
const KINDS = ['defect', 'missing', 'unclear-refusal']

/** The text from a heading to the next heading of the same or a higher level, as one line. */
function section(text, heading) {
  const from = text.indexOf(`\n${heading}\n`)
  assert.ok(from >= 0, `the skill has no heading ${heading}`)
  const level = heading.match(/^#+/)[0].length
  const rest = text.slice(from + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return (next < 0 ? rest : rest.slice(0, next)).replace(/\s+/g, ' ')
}

test('the issue form carries the label agent-report', () => {
  assert.ok(existsSync(FORM), 'no .github/ISSUE_TEMPLATE/agent-report.yml')
  const yaml = readFileSync(FORM, 'utf8')
  assert.match(yaml, /^name: \S/m, 'the form has no name')
  assert.match(yaml, /^description: .*public/m, 'the description does not say the issue is public')
  assert.match(yaml, /^labels: \[agent-report\]\s*$/m, 'the form does not set the label agent-report')
  assert.ok(yaml.includes(`\ntitle: "${PREFIX}"\n`), `the form does not open the title with ${PREFIX}`)
})

test('the issue form asks the kind, the call, the expectation and the answer, and offers the rest', () => {
  const fields = formFields(readFileSync(FORM, 'utf8'))
  const byId = new Map(fields.filter((field) => field.id).map((field) => [field.id, field]))
  const kind = byId.get('kind')
  assert.ok(kind, 'the form has no field kind')
  assert.equal(kind.type, 'input', 'the field kind is not an input: the link cannot fill it')
  for (const value of KINDS) {
    assert.ok(kind.description.includes(`${value} —`), `the field kind does not name the value ${value}`)
  }
  for (const id of ['kind', 'called', 'expected', 'returned']) {
    assert.ok(byId.has(id), `the form has no field ${id}`)
    assert.ok(byId.get(id).required, `the field ${id} is not required`)
  }
  for (const id of ['refusal_code', 'client']) {
    assert.ok(byId.has(id), `the form has no field ${id}`)
    assert.ok(!byId.get(id).required, `the field ${id} is required`)
  }
})

test('the skill tells the agent when and how to file a report', () => {
  const text = section(readFileSync(SKILL, 'utf8'), '## REPORTING TO THE SERVICE DEVELOPERS')
  const needles = [
    // where it goes, and who reads it
    REPO,
    'public',
    'service developers',
    // what never goes in
    'project content',
    'secrets',
    // when to file
    'No scenario kind fits',
    'does not exist',
    'does not say what to do',
    'differently from its description',
    'after the one retry',
    // search before filing by the title prefix; a match gets a comment
    `gh issue list -R ${REPO} --state open --search "${PREFIX}`,
    'gh issue comment',
    // filing with gh, and without it
    `gh issue create -R ${REPO} --title "${PREFIX}`,
    `${NEW_ISSUE}template=agent-report.yml&title=`,
    'never claim',
    // what the user is told on each path
    'with its URL',
    'not sent until',
    // consent before posting; a run with no person never posts
    'only after the user agrees',
    'no person at the run',
    "run's summary",
    // a failing gh is not retried and falls back to the path without it
    'not logged in',
    '403',
    'rate limit',
    'do not retry',
    // a match found without gh goes to the person as a URL and a text
    'its URL and the body',
    'never claim the comment was posted',
  ]
  // Case ignored: a rule may open a sentence or sit inside one.
  const lower = text.toLowerCase()
  for (const needle of needles) {
    assert.ok(lower.includes(needle.toLowerCase()), `the section does not say: ${needle}`)
  }
})

/** The section of the skill, flattened to one line. */
const reporting = () => section(readFileSync(SKILL, 'utf8'), '## REPORTING TO THE SERVICE DEVELOPERS')

test('a call that fails again on a database or server error after the one retry is a defect', () => {
  const rows = readFileSync(SKILL, 'utf8').split('\n').filter((line) => line.includes('after the one retry'))
  assert.equal(rows.length, 1, 'the table of when to file has no row for a call that fails again after the one retry')
  assert.match(rows[0], /database or server error/, 'the row does not name a database or server error')
  assert.match(rows[0], /\| `defect` \|\s*$/, 'the row is not of the kind defect')
})

test('a session with a person takes a report found in a summary through the steps', () => {
  const text = reporting()
  const from = text.toLowerCase().indexOf('no person at the run')
  const step = text.slice(from, text.indexOf('3. **Ask.**'))
  for (const needle of ["a subagent's or a run's summary", 'steps 3–5']) {
    assert.ok(step.includes(needle), `step 2 does not say: ${needle}`)
  }
})

test('the routine puts a report for the service developers into its summary in full', () => {
  const routine = readFileSync(ROUTINE, 'utf8')
  const digest = paragraphFrom(routine, '### Phase 5: Digest')
  for (const needle of ['REPORTING TO THE SERVICE DEVELOPERS', '`summary` in full']) {
    assert.ok(digest.includes(needle), `phase 5 of the routine does not say: ${needle}`)
  }
})

test('the live docs page of the model points the closed type sets at the report', { skip: !existsSync(MODEL_PAGE) && 'the live docs are not in this repository' }, () => {
  const rule = readFileSync(MODEL_PAGE, 'utf8').split('\n').find((line) => line.startsWith('1. The sets of types are closed'))
  assert.ok(rule, 'the page has no rule of the closed type sets')
  assert.ok(rule.includes('REPORTING TO THE SERVICE DEVELOPERS'), 'the rule of the closed type sets does not point at the report')
})

test('the user agrees before anything is posted', () => {
  const text = reporting()
  const consent = text.indexOf('only after the user agrees')
  assert.ok(consent >= 0, 'the section asks for no consent')
  for (const command of ['gh issue create', 'gh issue comment']) {
    assert.ok(text.indexOf(command) > consent, `${command} comes before the consent`)
  }
})

test('a run with no person never posts and keeps the report in its summary', () => {
  const text = reporting()
  const rule = text.slice(text.toLowerCase().indexOf('no person at the run'))
  const sentence = rule.slice(0, rule.indexOf('. ') + 1)
  for (const needle of ['never file', 'never comment', "run's summary"]) {
    assert.ok(sentence.includes(needle), `the rule of a run with no person does not say: ${needle}`)
  }
})

test('a failing gh sends the agent down the path without gh', () => {
  const text = reporting()
  const from = text.indexOf('`gh` refuses')
  assert.ok(from >= 0, 'the section names no refusal of gh')
  const rule = text.slice(from, text.indexOf('. ', text.indexOf('do not retry', from)) + 1)
  for (const needle of ['not logged in', 'no network', 'sandbox', '403', 'rate limit', 'do not retry', 'without `gh`']) {
    assert.ok(rule.includes(needle), `the rule of a failing gh does not say: ${needle}`)
  }
})

test('without gh the search link of open agent reports comes before the form link', () => {
  const texts = { 'the skill': reporting(), 'the docs page': readFileSync(PAGE, 'utf8') }
  for (const [where, text] of Object.entries(texts)) {
    const search = text.indexOf(SEARCH)
    assert.ok(search >= 0, `${where}: no search link of the open agent reports`)
    assert.ok(search < text.indexOf(NEW_ISSUE), `${where}: the search link does not come before the form link`)
  }
})

/** A text from `from` up to the next heading, flattened to one line. */
function paragraphFrom(text, from) {
  const start = text.indexOf(from)
  assert.ok(start >= 0, `no text starting ${from}`)
  const rest = text.slice(start)
  const end = rest.search(/\n#{1,6} /)
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, ' ')
}

// An edit keeps the earlier text in the edit history, visible to every reader:
// a comment is deleted, an issue loses its earlier revision or is deleted.
// Only the person can do either, on the web page: `gh` deletes no revision,
// and an issue filed through the link was submitted by the person.
const ROLLBACK = [
  'revoke and rotate',
  'delete the comment',
  'earlier revision',
  'edit history',
  'web page',
  'for its deletion',
  'for its removal',
  'someone else',
  'never repeating the content',
  // the request is a comment the agent posts like a report: consent, then gh or the person
  'gh issue comment <issue URL> --body',
  "the issue's URL and the text",
  // a refusing gh and the claim of a posted comment, as on the paths of a report
  'when `gh` refuses',
]
// Who acts, said to the agent in the skill and to the person on the docs page.
const ROLLBACK_SKILL = [
  'tell the user to revoke and rotate it at once, then to take it out',
  'tell the user to delete the comment',
  'tell the user to edit it out',
  'they cannot',
  'write a comment',
  'only after they agree',
  'never claim it was posted',
]
const ROLLBACK_PAGE = [
  'tells you to revoke and rotate it at once, then to take it out',
  'tells you to delete the comment',
  'tells you to edit it out',
  'you cannot',
  'writes a comment',
  'only after you agree',
  'never claims it was posted',
]

test('the skill tells what to do when a secret or project content got into a post', () => {
  const text = reporting()
  const start = text.indexOf('**A slip.**')
  assert.ok(start >= 0, 'the section has no paragraph **A slip.**')
  const slip = text.slice(start)
  for (const needle of [...ROLLBACK, ...ROLLBACK_SKILL]) {
    assert.ok(slip.includes(needle), `the slip rule does not say: ${needle}`)
  }
  assert.ok(!slip.includes('delete or edit'), 'the slip rule lets an edit stand for a deletion')
  assert.ok(!slip.includes('steps 3–5'), 'the slip rule sends a request for deletion through the search and a new issue')
})

test('the docs page names every case of the table of when to file', () => {
  const table = paragraphFrom(readFileSync(SKILL, 'utf8'), '**When to file:**')
  const cases = [...table.matchAll(/\| ([A-Z][^|]*?) (?:— [^|]*)?\| `[a-z-]+` \|/g)].map((m) => m[1].trim())
  assert.ok(cases.length >= 5, `the table lists ${cases.length} cases`)
  const page = paragraphFrom(readFileSync(PAGE, 'utf8'), '## When it happens').toLowerCase()
  for (const kase of cases) {
    const said = kase[0].toLowerCase() + kase.slice(1)
    assert.ok(page.includes(said), `the docs page does not name the case: ${said}`)
  }
  // And no case the table lacks: the page lists exactly as many.
  const raw = readFileSync(PAGE, 'utf8')
  const from = raw.indexOf('## When it happens\n')
  const rest = raw.slice(from + 1)
  const items = rest.slice(0, rest.indexOf('\n## ')).split('\n').filter((line) => line.startsWith('- '))
  assert.equal(items.length, cases.length, `the docs page lists ${items.length} cases, the table ${cases.length}`)
})

test('the docs page states the same rules as the skill', () => {
  const page = readFileSync(PAGE, 'utf8')
  const flatPage = page.replace(/\s+/g, ' ')
  const rules = {
    'the channel': ['with `gh`, or through the issue form *Agent report* when you submit it'],
    consent: ['posts nothing until you agree'],
    'a run with no person': ['no person at it', 'never posts', "run's summary"],
    'a failing gh': ['not logged in', 'no network', 'sandbox', '403', 'rate limit', 'does not retry', 'path without `gh`'],
    'a match found without gh': ['its URL and the body', 'never claims the comment was posted'],
  }
  for (const [rule, needles] of Object.entries(rules)) {
    for (const needle of needles) {
      assert.ok(flatPage.includes(needle), `the docs page, ${rule}, does not say: ${needle}`)
    }
  }
  const slip = paragraphFrom(page, '## If something private got in')
  for (const needle of [...ROLLBACK, ...ROLLBACK_PAGE]) {
    assert.ok(slip.includes(needle), `the docs page's slip rule does not say: ${needle}`)
  }
  assert.ok(!slip.includes('delete or edit'), "the docs page's slip rule lets an edit stand for a deletion")
})

test('the skill neither filters the search by a label nor depends on one when filing', () => {
  const text = section(readFileSync(SKILL, 'utf8'), '## REPORTING TO THE SERVICE DEVELOPERS')
  for (const command of text.match(/gh issue (?:list|create)[^`]*/g) || []) {
    assert.ok(!command.includes('--label'), `the command depends on a label: ${command}`)
  }
})

/** The query parameters of every link to a new issue in a text. */
function linkParameters(text) {
  const links = [...text.matchAll(/https:\/\/github\.com\/shaurgon\/conport-plugin\/issues\/new\?([^\s`)]+)/g)]
  assert.ok(links.length > 0, 'no link to a new issue')
  return links.map((link) => link[1].split('&').map((pair) => pair.split('=')[0]))
}

test('the link without gh fills every field of the form by its id', () => {
  const fields = formFields(readFileSync(FORM, 'utf8')).filter((field) => field.id)
  for (const field of fields) {
    assert.ok(FILLED_BY_LINK.includes(field.type), `the field ${field.id} is a ${field.type}: GitHub does not fill it from the link`)
  }
  const ids = fields.map((field) => field.id)
  const expected = ['template', 'title', ...ids]
  const texts = {
    'the skill': section(readFileSync(SKILL, 'utf8'), '## REPORTING TO THE SERVICE DEVELOPERS'),
    'the docs page': readFileSync(PAGE, 'utf8'),
  }
  for (const [where, text] of Object.entries(texts)) {
    for (const parameters of linkParameters(text)) {
      assert.deepEqual(parameters, expected, `${where}: the link does not fill the form's fields`)
    }
  }
})

test('the skill points the closed type sets and refusals at the report', () => {
  const skill = readFileSync(SKILL, 'utf8')
  for (const heading of ['### What goes into the model', '## MCP ERROR HANDLING']) {
    assert.ok(section(skill, heading).includes('REPORTING TO THE SERVICE DEVELOPERS'), `${heading} does not point at the report`)
  }
})
