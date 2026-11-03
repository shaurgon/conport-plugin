import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractGate } from '../wf-helper.mjs'

const HELPER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'wf-helper.mjs')
const KEY = 'test_key_never_printed'
const PROJECT = 'sample-project'
const HANDLE = 'prk7m2qx9d'                       // a neutral handle: no real project is implied

// ------------------------------------------------------------------ REST mock

// A local stand-in for the routes the scout reads: project resolution by handle
// or name, one task by id, the links of an item and one document by id. The
// production API is never touched by these tests.
const startMock = async (opts = {}) => {
  const state = { tasks: new Map(), requests: [] }
  for (const t of opts.tasks ?? [])
    state.tasks.set(t.id, { description: '', kind: 'task', parent_task_id: null, ...t })
  // Links as [source, link_type, target], each end ['doc' | 'task', id]; documents as {id: doc_type}.
  const links = (opts.links ?? []).map(([source, linkType, target], i) => ({
    id: i + 1, source_type: source[0], source_id: source[1],
    target_type: target[0], target_id: target[1], link_type: linkType, description: null,
  }))
  const docs = opts.docs ?? {}

  const fail = opts.fail ?? (() => null)
  const send = (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      const rec = {
        method: req.method, path: url.pathname, key: req.headers['x-api-key'],
        team: req.headers['x-conport-team-id'],
      }
      state.requests.push(rec)

      const injected = fail(rec)
      if (injected) return send(res, injected.status, injected.body)

      const task = url.pathname.match(new RegExp(`^/api/v1/projects/${HANDLE}/tasks/(\\d+)$`))
      if (task) {
        const found = state.tasks.get(Number(task[1]))
        return found ? send(res, 200, found) : send(res, 404, { detail: 'Task not found' })
      }
      if (url.pathname === `/api/v1/projects/${HANDLE}/links`) {
        const type = url.searchParams.get('item_type')
        const id = Number(url.searchParams.get('item_id'))
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? 100)
        const all = links.filter(l => (l.source_type === type && l.source_id === id) || (l.target_type === type && l.target_id === id))
        return send(res, 200, { links: all.slice(offset, offset + Math.min(limit, opts.linkPage ?? 500)), total: all.length })
      }
      const doc = url.pathname.match(new RegExp(`^/api/v1/projects/${HANDLE}/documents/(\\d+)$`))
      if (doc) {
        const type = docs[Number(doc[1])]
        return type ? send(res, 200, { id: Number(doc[1]), doc_type: type, content: '' }) : send(res, 404, { detail: 'Document not found' })
      }
      const project = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/)
      if (project) {
        const name = decodeURIComponent(project[1])
        if (name !== PROJECT && name !== HANDLE) return send(res, 404, { detail: 'Project not found' })
        return send(res, 200, opts.project ?? { handle: HANDLE, name: PROJECT, canonical_name: 'pers/' + PROJECT })
      }
      return send(res, 404, { detail: 'no route ' + url.pathname })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${server.address().port}/api/v1`
  state.close = () => new Promise(resolve => server.close(resolve))
  return state
}

// ------------------------------------------------------------------ fixtures

// A repository root carrying docs/superpowers/plans/<name>: what the scout globs.
// Every root is recorded and removed at the end of the file — a test run must not
// leave fixture trees behind in the temporary directory.
const roots = []
const repoWithPlan = (name, body) => {
  const root = mkdtempSync(join(tmpdir(), 'wfs-'))
  roots.push(root)
  const dir = join(root, 'docs', 'superpowers', 'plans')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
  return root
}

after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

// A repository root with no plan file: the scout must not find one in the real checkout.
const emptyRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'wfs-'))
  roots.push(root)
  return root
}

const GC = `## Global Constraints

- Shipped text is English; the plan itself is internal.
- Commits carry no AI mentions; git add takes explicit paths only.
- Gate object: \`{dir: "backend", commands: ["uv run pytest -q", "uv run ruff check"]}\`.

`

const PLAN = `# Sample Plan
<!-- conport-epic: 900 -->

**Spec:** \`docs/superpowers/specs/sample.md\` (ConPort doc-950).

${GC}---

### Task 1: first thing
<!-- conport-task: 901 -->

**Files:**
- Create: \`a/one.mjs\`
- Modify: \`a/two.js\`
- Test: \`a/test/one.test.mjs\`

- [ ] **Step 1** — do it.

### Task 2: second thing
<!-- conport-task: 902 -->

**Files:**
- Modify: \`b/three.js\`

- [ ] **Step 1** — do the other thing.
`

// ------------------------------------------------------------------ invocation

// The mock serves from this very process, so the helper must be spawned
// asynchronously: a synchronous spawn would block the event loop the server
// answers on, and the two would wait for each other forever.
const runHelper = (env, ...argv) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [HELPER, ...argv], { env })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', c => { stdout += c })
  p.stderr.on('data', c => { stderr += c })
  p.on('error', reject)
  p.on('close', code => resolve({ code, stdout, stderr }))
})

const scoutEnv = mock => {
  const env = { ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY }
  delete env.CONPORT_PROJECT_NAME
  return env
}

const runScout = async (mock, argv, env = scoutEnv(mock)) => {
  const r = await runHelper(env, 'scout', ...argv)
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  assert.ok(!r.stdout.includes(KEY), 'the api key must never reach stdout')
  return { out: JSON.parse(r.stdout), stdout: r.stdout }
}

// The server must be closed even when an assertion throws, or the test file
// hangs on an open handle instead of reporting the failure.
const withMock = (opts, body) => async () => {
  const mock = await startMock(opts)
  try { await body(mock) } finally { await mock.close() }
}

const TASKS = [
  { id: 901, title: 'first thing', status: 'TODO', kind: 'task', parent_task_id: 900, description: 'Implement the first thing per doc-950.\n\n## Acceptance\nThe first thing works end to end.\n' },
  { id: 902, title: 'second thing', status: 'TODO', kind: 'task', parent_task_id: 900, description: 'Acceptance: the second thing works.' },
  { id: 903, title: 'planless thing', status: 'TODO', kind: 'task', parent_task_id: null, description: 'No plan slice exists for this one.' },
  { id: 900, title: 'the epic', status: 'IN_PROGRESS', kind: 'epic', parent_task_id: null, description: 'Ship both things.' },
]

// -------------------------------------------------------------- task + plan

test('a task with a plan slice: section lines, files, verbatim constraints, gate', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])

  assert.equal(out.project, HANDLE)
  assert.equal('project_id' in out, false, 'the base names the project by its handle only')
  assert.deepEqual(out.task, {
    id: 901, kind: 'task', status: 'TODO', title: 'first thing',
    description: TASKS[0].description, parent_epic_id: 900,
  })

  const lines = PLAN.split('\n')
  assert.equal(out.plan.path, join(root, 'docs', 'superpowers', 'plans', '2026-09-01-sample.md'))
  assert.equal(lines[out.plan.from - 1], '### Task 1: first thing', 'from is the heading line, 1-based')
  assert.equal(lines[out.plan.to], '### Task 2: second thing', 'to is the line before the next heading')
  assert.deepEqual(out.plan.files, ['a/one.mjs', 'a/two.js', 'a/test/one.test.mjs'])
  assert.equal(out.plan_path, out.plan.path)

  assert.equal(out.global_constraints, GC.split('\n').slice(1).join('\n').trim(),
    'the constraints body travels verbatim, heading excluded')
  assert.equal(out.gc_lines, out.global_constraints.split('\n').length)
  assert.deepEqual(out.gate, { dir: 'backend', commands: ['uv run pytest -q', 'uv run ruff check'] })
  assert.equal(out.acceptance, 'The first thing works end to end.')
  assert.equal(out.spec_doc_id, 950)
}))

test('the second task of the same plan gets its own slice, ending at EOF', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '902', '--project', PROJECT, '--repo-root', root])

  const lines = PLAN.split('\n')
  assert.equal(lines[out.plan.from - 1], '### Task 2: second thing')
  assert.equal(out.plan.to, lines.length - 1, 'the trailing newline is not counted as a line')
  assert.deepEqual(out.plan.files, ['b/three.js'])
  assert.equal(out.acceptance, 'the second thing works.', "the 'Acceptance:' line form is read too")
}))

// The gate line is prose in a plan, so both spellings and both JSON dialects must
// parse: a strict object and a JS-ish one with single quotes and bare keys. A form
// the shape guard must reject carries an expectation of null — the scout never
// hands a half-built gate on, and never invents commands.
const BOTH = { dir: 'backend', commands: ['uv run pytest -q', 'uv run ruff check'] }
const GATE_FORMS = [
  ['a strict JSON object under the English marker',
    'Gate object: `{"dir": "backend", "commands": ["uv run pytest -q", "uv run ruff check"]}`.',
    BOTH],
  ['single quotes and bare keys under the localised marker',
    "Гейт-объект для воркфлоу: {dir: 'backend', commands: ['uv run pytest -q', 'uv run ruff check']}.",
    BOTH],
  // The relaxed rewrite would swallow the apostrophes and tear the string apart, so
  // strict JSON has to be tried — and accepted — before any normalisation runs.
  ['a strict JSON command carrying an apostrophe',
    'Gate object: `{"dir": "backend", "commands": ["uv run pytest -q -k \'not slow\'"]}`.',
    { dir: 'backend', commands: ["uv run pytest -q -k 'not slow'"] }],
  ['no commands key at all', 'Gate object: `{"dir": "backend"}`.', null],
  ['an empty command list', 'Gate object: `{"dir": "backend", "commands": []}`.', null],
  ['a dir that is not a string', 'Gate object: `{"dir": 1, "commands": ["uv run pytest -q"]}`.', null],
  ['a literal neither dialect parses', 'Gate object: `{dir: "backend", commands: ["uv run pytest -q",]}`.', null],
]

// The parser is exercised directly: a rejected form yields null from the same code
// the scout calls, without paying for a process and a REST mock per case.
for (const [what, line, expected] of GATE_FORMS)
  test('gate parser: ' + what, () => assert.deepEqual(extractGate(line), expected))

// End to end, through the plan file and the helper process, for the forms that do
// name a gate: the parsed object has to survive the whole scout, not just the parser.
for (const [what, line, expected] of GATE_FORMS.filter(f => f[2] !== null))
  test('gate: ' + what, withMock({ tasks: TASKS }, async mock => {
    const root = repoWithPlan('2026-09-01-sample.md', PLAN.replace(/- Gate object:.*/, '- ' + line))
    const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])

    assert.deepEqual(out.gate, expected)
  }))

test('gate: constraints naming no gate object yield null, never an invented command', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN.replace(/- Gate object:.*/, '- The gate is the usual full check run.'))
  const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])

  assert.equal(out.gate, null)
  assert.ok(out.global_constraints.includes('the usual full check run'), 'the prose still reaches the caller')
}))

// -------------------------------------------------------------- fenced code

// A plan quotes source in fenced blocks, and that source may itself contain a
// '### Task' line. Treating it as a heading would cut the slice short.
const FENCED = `# Fenced Plan

## Global Constraints

- Nothing to see here.

### Task 1: writes a section heading
<!-- conport-task: 901 -->

**Files:**
- Create: \`a/one.mjs\`

\`\`\`md
### Task 9: quoted, not a boundary
\`\`\`

- [ ] **Step 2** — after the quote.

### Task 2: the real boundary
<!-- conport-task: 902 -->
`

test('a fenced ### Task line inside quoted code does not break the section', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-fenced.md', FENCED)
  const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])

  const lines = FENCED.split('\n')
  assert.equal(lines[out.plan.from - 1], '### Task 1: writes a section heading')
  assert.equal(lines[out.plan.to], '### Task 2: the real boundary')
  assert.ok(out.plan.to - out.plan.from > 8, 'the whole section survives the quoted heading')
}))

// ------------------------------------------------------------- no plan slice

test('a task no plan mentions: plan null, no constraints, no invented gate', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '903', '--project', PROJECT, '--repo-root', root])

  assert.equal(out.plan, null)
  assert.equal(out.plan_path, null)
  assert.equal(out.global_constraints, '')
  assert.equal(out.gc_lines, 0)
  assert.equal(out.gate, null)
  assert.equal(out.acceptance, '', 'a description without an acceptance section yields an empty string')
  assert.equal(out.spec_doc_id, null)
  assert.equal(out.task.title, 'planless thing')
}))

// An epic's plan carries no '### Task' section of its own, but it does carry the
// constraints and the gate the epic workflow needs, so the file is still located.
test('an epic id finds its plan by the epic anchor: path and constraints, no slice', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '900', '--project', PROJECT, '--repo-root', root])

  assert.equal(out.task.kind, 'epic')
  assert.equal(out.plan, null, 'there is no task section for an epic id')
  assert.equal(out.plan_path, join(root, 'docs', 'superpowers', 'plans', '2026-09-01-sample.md'))
  assert.ok(out.global_constraints.startsWith('- Shipped text is English'))
  assert.deepEqual(out.gate, { dir: 'backend', commands: ['uv run pytest -q', 'uv run ruff check'] })
  assert.equal(out.spec_doc_id, 950)
}))

test('an explicit --plan overrides the anchor search', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const other = repoWithPlan('2026-08-01-other.md', PLAN.replace('### Task 1: first thing', '### Task 1: relocated'))
  const path = join(other, 'docs', 'superpowers', 'plans', '2026-08-01-other.md')
  const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root, '--plan', path])

  assert.equal(out.plan.path, path)
  assert.deepEqual(out.plan.files, ['a/one.mjs', 'a/two.js', 'a/test/one.test.mjs'])
}))

// --------------------------------------------------------------- spec doc id

// The chain spec -> plan -> task lives in the graph: the plan document clarifies
// the task, the plan is derived_from its spec. The description names neither.
// Documents of other types clarifying the task carry lower ids than the plan, so
// taking the first clarifying document of any type would miss it.
const GRAPH = {
  docs: { 940: 'general', 941: 'general', 945: 'spec', 960: 'plan', 970: 'spec' },
  links: [
    [['doc', 940], 'clarifies', ['task', 904]],     // not a plan: never taken for one
    [['doc', 945], 'clarifies', ['task', 904]],     // a spec clarifying the task: not its plan
    [['doc', 960], 'clarifies', ['task', 904]],
    [['doc', 960], 'clarifies', ['task', 900]],     // the plan of the epic too
    [['doc', 945], 'clarifies', ['task', 900]],
    [['doc', 960], 'derived_from', ['doc', 941]],     // derived from a document that is no spec
    [['doc', 960], 'derived_from', ['doc', 970]],
    [['task', 904], 'clarifies', ['doc', 945]],     // the wrong direction
    [['doc', 960], 'mentions', ['doc', 945]],       // another type
  ],
}

test('spec_doc_id comes from the plan linked to the task and that plan\'s derived_from link, never from the description', withMock({
  tasks: [...TASKS, { id: 904, title: 'linked', status: 'TODO', kind: 'task', parent_task_id: 900, description: 'Follows doc-951 closely.' }],
  ...GRAPH,
}, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const linked = await runScout(mock, ['--task', '904', '--project', PROJECT, '--repo-root', root])
  assert.equal(linked.out.spec_doc_id, 970, 'the spec of the linked plan wins over the description and the plan header')

  const epic = await runScout(mock, ['--task', '900', '--project', PROJECT, '--repo-root', root])
  assert.equal(epic.out.spec_doc_id, 970, 'an epic reaches its spec through its plan the same way')
}))

test('the links of a task are read page by page', withMock({
  tasks: [...TASKS, { id: 904, title: 'linked', status: 'TODO', kind: 'task', parent_task_id: 900, description: '' }],
  ...GRAPH,
  linkPage: 1,
}, async mock => {
  const { out } = await runScout(mock, ['--task', '904', '--project', PROJECT, '--repo-root', emptyRoot()])
  assert.equal(out.spec_doc_id, 970)
}))

test('a description naming a doc is not read for the spec: without a linked plan the plan header names it', withMock({
  tasks: [...TASKS, { id: 904, title: 'own spec', status: 'TODO', kind: 'task', description: 'Follows doc-951 closely.' }],
}, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const plan = join(root, 'docs', 'superpowers', 'plans', '2026-09-01-sample.md')
  const own = await runScout(mock, ['--task', '904', '--project', PROJECT, '--repo-root', root, '--plan', plan])
  assert.equal(own.out.spec_doc_id, 950, 'the description is not a source of the spec')

  const none = await runScout(mock, ['--task', '904', '--project', PROJECT, '--repo-root', emptyRoot()])
  assert.equal(none.out.spec_doc_id, null, 'no link and no plan file: no spec, whatever the description says')
}))

test('a linked plan without a derived_from link falls back to the plan header', withMock({
  tasks: TASKS,
  docs: { 960: 'plan' },
  links: [[['doc', 960], 'clarifies', ['task', 902]]],
}, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '902', '--project', PROJECT, '--repo-root', root])
  assert.equal(out.spec_doc_id, 950)
}))

// -------------------------------------------------------------- environment

test('the project name is taken from the environment when no flag is passed', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const env = { ...scoutEnv(mock), CONPORT_PROJECT_NAME: PROJECT }
  const { out } = await runScout(mock, ['--task', '901', '--repo-root', root], env)

  assert.equal(out.project, HANDLE)
}))

// A `team/project` name does not fit one path segment: the team goes into the
// header of every call, the short name into the path of the first one.
test('scout reads a team/project name with the team header', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '901', '--project', 'k7m2qx9d/' + PROJECT, '--repo-root', root])

  assert.equal(out.project, HANDLE)
  assert.deepEqual(mock.requests.slice(0, 2).map(r => [r.path, r.team]), [
    ['/api/v1/projects/' + PROJECT, 'k7m2qx9d'],
    [`/api/v1/projects/${HANDLE}/tasks/901`, 'k7m2qx9d'],
  ])
  assert.ok(mock.requests.every(r => r.team === 'k7m2qx9d'), 'every call carries the team header')
}))

test('scout takes a team/project name from the environment the same way', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const env = { ...scoutEnv(mock), CONPORT_PROJECT_NAME: 'pers/' + PROJECT }
  await runScout(mock, ['--task', '901', '--repo-root', root], env)

  assert.deepEqual(mock.requests.slice(0, 2).map(r => [r.path, r.team]), [
    ['/api/v1/projects/' + PROJECT, 'pers'],
    [`/api/v1/projects/${HANDLE}/tasks/901`, 'pers'],
  ])
  assert.ok(mock.requests.every(r => r.team === 'pers'), 'every call carries the team header')
}))

// An address is turned into the handle once; every later path carries the handle,
// never the name it was reached by.
test('scout turns the name into the handle and addresses the task by the handle', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])
  const paths = mock.requests.map(r => r.path)
  assert.deepEqual(paths.slice(0, 2), ['/api/v1/projects/' + PROJECT, `/api/v1/projects/${HANDLE}/tasks/901`])
  assert.ok(paths.slice(1).every(p => p.startsWith(`/api/v1/projects/${HANDLE}/`)), 'every later path carries the handle')
}))

test('a handle given as the project is resolved like a name', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const { out } = await runScout(mock, ['--task', '901', '--project', HANDLE, '--repo-root', root])
  assert.equal(out.project, HANDLE)
  assert.deepEqual(mock.requests.slice(0, 2).map(r => [r.path, r.team]), [
    ['/api/v1/projects/' + HANDLE, undefined],
    [`/api/v1/projects/${HANDLE}/tasks/901`, undefined],
  ])
}))

// A server that answers the project without a handle (one of an earlier
// release) gives the scout nothing to address the task by: an error, so the
// workflow takes branch B, and no task is read by a number.
for (const [what, project] of [['a number only', { id: 42, name: PROJECT }], ['an empty handle', { handle: '', name: PROJECT }]]) {
  test(`a project answered with ${what} is an error, not a base`, withMock({ tasks: TASKS, project }, async mock => {
    const r = await runHelper(scoutEnv(mock), 'scout', '--task', '901', '--project', PROJECT)
    assert.equal(r.code, 0)
    const out = JSON.parse(r.stdout)
    assert.match(out.error, /no project handle/)
    assert.deepEqual(mock.requests.map(r => r.path), ['/api/v1/projects/' + PROJECT])
  }))
}

test('scout sends no team header for a bare name', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root])

  assert.ok(mock.requests.length >= 2)
  assert.ok(mock.requests.every(r => r.team === undefined))
}))

for (const name of ['a/b/c', '/' + PROJECT, 'pers/', '/']) {
  test(`scout treats an invalid name as no project: ${name}`, withMock({ tasks: TASKS }, async mock => {
    const r = await runHelper(scoutEnv(mock), 'scout', '--task', '901', '--project', name)

    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), '{"error": "no project"}')
    assert.deepEqual(mock.requests, [])
  }))
}

// An installed plugin never sets CONPORT_API_KEY: the harness exposes the
// configured key as CLAUDE_PLUGIN_OPTION_API_KEY, exactly as scripts/_common.js
// reads it. Accepting only the manual variable left every install keyless.
test('the harness key alone drives the REST path', withMock({ tasks: TASKS }, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)
  const env = { ...scoutEnv(mock), CLAUDE_PLUGIN_OPTION_API_KEY: KEY }
  delete env.CONPORT_API_KEY
  const { out } = await runScout(mock, ['--task', '901', '--project', PROJECT, '--repo-root', root], env)

  assert.equal(out.project, HANDLE)
  assert.equal(out.task.title, 'first thing')
  assert.equal(mock.requests[0].key, KEY, 'the harness key travels in X-API-Key')
}))

test('no api key in either variable: the fallback sentinel is printed and nothing is called', withMock({ tasks: TASKS }, async mock => {
  const env = scoutEnv(mock)
  delete env.CONPORT_API_KEY
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  const r = await runHelper(env, 'scout', '--task', '901', '--project', PROJECT)

  assert.equal(r.code, 0, 'a missing key is a fallback signal, not a CLI failure')
  assert.equal(r.stdout.trim(), '{"error": "no api key"}')
  assert.deepEqual(mock.requests, [])
}))

test('no project to resolve: the fallback sentinel is printed and nothing is called', withMock({ tasks: TASKS }, async mock => {
  const r = await runHelper(scoutEnv(mock), 'scout', '--task', '901')

  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '{"error": "no project"}')
  assert.deepEqual(mock.requests, [])
}))

test('an API failure degrades to an error object, with the key masked out', withMock({
  tasks: TASKS,
  fail: rec => rec.path.endsWith('/tasks/901') ? { status: 401, body: { detail: 'bad key ' + KEY } } : null,
}, async mock => {
  const r = await runHelper(scoutEnv(mock), 'scout', '--task', '901', '--project', PROJECT)

  assert.equal(r.code, 0, 'the caller falls back on the error object, it is not a crash')
  assert.ok(!r.stdout.includes(KEY), 'the key value never leaves the process')
  const out = JSON.parse(r.stdout)
  assert.ok(out.error.includes('401'), 'the status code is reported: ' + out.error)
  assert.ok(out.error.includes('***'), 'the echoed key is masked: ' + out.error)
}))

// ---------------------------------------------------------------- acceptance

// Plans and tasks in this repository are written in Russian, so the acceptance
// criterion is marked «Приёмка» as often as 'Acceptance'. Reading only the English
// marker dropped the criterion and the implementer was dispatched without one.
test('the Russian acceptance marker is read, as a section and as a line', withMock({
  tasks: [...TASKS,
    { id: 905, title: 'ru section', status: 'TODO', kind: 'task', description: 'Делает дело.\n\n## Приёмка\nДело сделано целиком.\n' },
    { id: 906, title: 'ru line', status: 'TODO', kind: 'task', description: 'Делает дело.\nПриёмка: дело сделано строкой.' }],
}, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)

  const section = await runScout(mock, ['--task', '905', '--project', PROJECT, '--repo-root', root])
  assert.equal(section.out.acceptance, 'Дело сделано целиком.')

  const line = await runScout(mock, ['--task', '906', '--project', PROJECT, '--repo-root', root])
  assert.equal(line.out.acceptance, 'дело сделано строкой.')
}))

// The marker is a whole word in both languages. A heading that merely starts with
// its letters — '## Acceptances', '## Приёмкаs' — is a different section, and
// swallowing it would hand the implementer prose invented by a regex as the
// criterion the work is judged by.
test('a heading that only starts with the marker is not an acceptance section', withMock({
  tasks: [...TASKS,
    { id: 907, title: 'en lookalike', status: 'TODO', kind: 'task', description: 'Does a thing.\n\n## Acceptances\nNot a criterion at all.\n' },
    { id: 908, title: 'ru lookalike', status: 'TODO', kind: 'task', description: 'Делает дело.\n\n## Приёмкаs\nВовсе не критерий.\n' },
    { id: 909, title: 'en inline lookalike', status: 'TODO', kind: 'task', description: 'Does a thing.\nAcceptances: not a criterion.' },
    { id: 910, title: 'ru inline lookalike', status: 'TODO', kind: 'task', description: 'Делает дело.\nПриёмкаs: вовсе не критерий.' }],
}, async mock => {
  const root = repoWithPlan('2026-09-01-sample.md', PLAN)

  for (const id of [907, 908, 909, 910]) {
    const { out } = await runScout(mock, ['--task', String(id), '--project', PROJECT, '--repo-root', root])
    assert.equal(out.acceptance, '', `task ${id}: the lookalike marker must not be read as acceptance`)
  }
}))

// ------------------------------------------------------------------- timeout

// A server that accepts the connection and never answers it. Without a deadline
// per call the scout would wait on it forever, and a workflow that hangs cannot
// fall back to branch B.
test('a server that never answers: the call degrades to an error object instead of hanging', { timeout: 20000 }, async () => {
  const server = createServer(() => {})            // the request is received and never answered
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const env = {
    ...process.env,
    CONPORT_API_URL: `http://127.0.0.1:${server.address().port}/api/v1`,
    CONPORT_API_KEY: KEY,
    CONPORT_TIMEOUT_MS: '300',
  }
  delete env.CONPORT_PROJECT_NAME
  try {
    const r = await runHelper(env, 'scout', '--task', '901', '--project', PROJECT)

    assert.equal(r.code, 0, 'a dead server is a fallback signal, not a crash')
    assert.ok(!r.stdout.includes(KEY), 'the key value never leaves the process')
    const out = JSON.parse(r.stdout)
    assert.ok(typeof out.error === 'string' && out.error, 'the timeout is reported as an error object: ' + r.stdout)
    // A bare abort names nothing; the endpoint and the deadline are what tell the
    // caller which call died and why.
    assert.ok(out.error.includes('timeout after 300ms'), 'the deadline is named: ' + out.error)
    assert.ok(/GET \/projects\//.test(out.error), 'the endpoint is named: ' + out.error)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
