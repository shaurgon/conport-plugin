// The Superpowers overlay switch and the SessionStart injection of its rules.
// overlayEnabled() reads `.superpowers/config.json` in the current worktree
// root, then in the main worktree root, and outside git in the directory
// itself; the SessionStart hook prints the rules file as additionalContext
// when the overlay is on, whether or not a ConPort project is configured.
// Every git repository is built under the OS temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES = join(SCRIPTS, '..', 'skills', 'conport', 'references', 'superpowers-overlay.md')
const require = createRequire(import.meta.url)
const { overlayEnabled, worktreeRoot, mainWorktreeRoot } = require(join(SCRIPTS, '_common.js'))

const ON = { conport: { superpowers: true } }

// An environment free of git variables a calling hook may have exported, so
// every git command and child script reads the repository it is pointed at.
function cleanEnv(extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('CONPORT_') && k !== 'CLAUDE_PLUGIN_OPTION_API_KEY') env[k] = v
  }
  return { ...env, ...extra }
}

function git(dir, ...args) {
  const hooks = mkdtempSync(join(tmpdir(), 'conport-nohooks-'))
  try {
    return execFileSync('git', ['-C', dir, '-c', `core.hooksPath=${hooks}`, ...args], {
      env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } finally {
    rmSync(hooks, { recursive: true, force: true })
  }
}

function writeConfig(root, value) {
  mkdirSync(join(root, '.superpowers'), { recursive: true })
  writeFileSync(join(root, '.superpowers', 'config.json'),
    typeof value === 'string' ? value : JSON.stringify(value))
}

// A temp directory holding a repository with one commit at `<tmp>/main`.
function withRepo(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'conport-overlay-'))
  const main = join(tmp, 'main')
  mkdirSync(main)
  git(main, 'init', '-q')
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'init')
  return Promise.resolve()
    .then(() => fn({ tmp, main }))
    .finally(() => rmSync(tmp, { recursive: true, force: true }))
}

function addWorktree(main, tmp) {
  const wt = join(tmp, 'linked')
  git(main, 'worktree', 'add', '-q', '-b', 'linked', wt)
  return wt
}

// --- overlayEnabled / worktreeRoot -----------------------------------------

test('worktreeRoot names the top level of the worktree, from a subdirectory too', () => withRepo(({ main }) => {
  mkdirSync(join(main, 'sub', 'deep'), { recursive: true })
  assert.equal(worktreeRoot(main), realpathSync(main))
  assert.equal(worktreeRoot(join(main, 'sub', 'deep')), realpathSync(main))
}))

test('worktreeRoot is null outside git and for a missing directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'conport-nogit-'))
  try {
    assert.equal(worktreeRoot(tmp), null)
    assert.equal(worktreeRoot(join(tmp, 'absent')), null)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the overlay is on when the worktree root holds the switch, also seen from a subdirectory', () => withRepo(({ main }) => {
  assert.equal(overlayEnabled(main), false)
  writeConfig(main, ON)
  mkdirSync(join(main, 'backend'))
  assert.equal(overlayEnabled(main), true)
  assert.equal(overlayEnabled(join(main, 'backend')), true)
}))

test('a linked worktree without its own switch reads the one in the main worktree', () => withRepo(({ tmp, main }) => {
  const wt = addWorktree(main, tmp)
  assert.equal(overlayEnabled(wt), false)
  writeConfig(main, ON)
  assert.equal(overlayEnabled(wt), true)
}))

test('a switch in the linked worktree itself is read first, before the main one', () => withRepo(({ tmp, main }) => {
  const wt = addWorktree(main, tmp)
  writeConfig(main, ON)
  writeConfig(wt, { conport: { superpowers: false } })
  assert.equal(overlayEnabled(wt), false)
  writeConfig(main, { conport: { superpowers: false } })
  writeConfig(wt, ON)
  assert.equal(overlayEnabled(wt), true)
}))

test('an unreadable switch in the linked worktree keeps the overlay off even with the main one on', () => withRepo(({ tmp, main }) => {
  const wt = addWorktree(main, tmp)
  writeConfig(main, ON)
  writeConfig(wt, '{"conport": {"superpowers": true')
  assert.equal(overlayEnabled(wt), false)
}))

test('a config path in the linked worktree that cannot be read as a file keeps the overlay off', () => withRepo(({ tmp, main }) => {
  const wt = addWorktree(main, tmp)
  writeConfig(main, ON)
  mkdirSync(join(wt, '.superpowers', 'config.json'), { recursive: true })
  assert.equal(overlayEnabled(wt), false)
}))

test('any value other than literal true leaves the overlay off', () => withRepo(({ main }) => {
  for (const value of [
    { conport: { superpowers: 'yes' } },
    { conport: { superpowers: 1 } },
    { conport: { superpowers: false } },
    { conport: true },
    { conport: null },
    { superpowers: true },
    null,
    [],
    'true',
  ]) {
    writeConfig(main, JSON.stringify(value))
    assert.equal(overlayEnabled(main), false, JSON.stringify(value))
  }
}))

test('an unreadable config leaves the overlay off without throwing', () => withRepo(({ main }) => {
  writeConfig(main, '{"conport": {"superpowers": true')
  assert.equal(overlayEnabled(main), false)
  writeConfig(main, '')
  assert.equal(overlayEnabled(main), false)
}))

// A git older than 2.31 does not know `--path-format`: rev-parse echoes the
// unknown flag and prints the rest as it would without it. The stand-in drops
// the flag the same way and passes every other call to the real git.
function withOldGit(fn) {
  const bin = mkdtempSync(join(tmpdir(), 'conport-oldgit-'))
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  writeFileSync(join(bin, 'git'), '#!/bin/sh\n' +
    'for a do\n  shift\n  case "$a" in --path-format=*) printf \'%s\\n\' "$a" ;; *) set -- "$@" "$a" ;; esac\ndone\n' +
    `exec '${realGit}' "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const saved = process.env.PATH
  process.env.PATH = `${bin}:${saved}`
  try {
    return fn()
  } finally {
    process.env.PATH = saved
    rmSync(bin, { recursive: true, force: true })
  }
}

test('the main worktree is found from a relative common dir, without --path-format', () => withRepo(({ tmp, main }) => {
  mkdirSync(join(main, 'sub'))
  const wt = addWorktree(main, tmp)
  writeConfig(main, ON)
  withOldGit(() => {
    // From a subdirectory of the main worktree git names the common dir `../.git`.
    assert.equal(git(join(main, 'sub'), 'rev-parse', '--git-common-dir').trim(), join('..', '.git'))
    assert.equal(realpathSync(mainWorktreeRoot(join(main, 'sub'))), realpathSync(main))
    assert.equal(realpathSync(mainWorktreeRoot(wt)), realpathSync(main))
    assert.equal(overlayEnabled(wt), true)
  })
}))

test('outside git only the directory itself is read', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'conport-nogit-'))
  try {
    const child = join(tmp, 'child')
    mkdirSync(child)
    writeConfig(tmp, ON)
    assert.equal(overlayEnabled(tmp), true)
    assert.equal(overlayEnabled(child), false)
    assert.equal(overlayEnabled(join(tmp, 'absent')), false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// --- SessionStart hook ------------------------------------------------------

// Fake ConPort API answering the conventions fetch; records each request.
async function startApi() {
  const api = { requests: [] }
  const server = createServer((req, res) => {
    api.requests.push(req.url)
    res.setHeader('content-type', 'application/json')
    res.end('{"deny":[]}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  api.close = () => new Promise((resolve) => server.close(resolve))
  return api
}

function runSessionStart({ stdin, cwd, env = {}, scripts = SCRIPTS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scripts, 'session-start.js')], {
      cwd, env: cleanEnv(env),
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(stdin)
  })
}

const rulesText = () => readFileSync(RULES, 'utf8')

function assertInjected(out) {
  const parsed = JSON.parse(out)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(parsed.hookSpecificOutput.additionalContext, rulesText())
}

test('the rules file ships with the visibility line and the versioned CLI', () => {
  const text = rulesText()
  assert.match(text, /\[CONPORT\] Superpowers overlay: on/)
  assert.match(text, /npx -y conport@\^0\.7 plan import/)
  assert.match(text, /<!-- conport-pull-tail -->/)
  assert.doesNotMatch(text, /\b(decision|doc|task)-\d+/)
})

test('the spec is reviewed and gap-hunted as a draft, approved, then uploaded once', () => {
  const flow = rulesText().split('## The flow')[1].split('\n## ')[0]
  const steps = [...flow.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)]
  assert.deepEqual(steps.map((s) => Number(s[1])), steps.map((_, i) => i + 1), 'steps numbered 1..N')
  const texts = steps.map((s, n) => flow.slice(s.index, steps[n + 1]?.index ?? flow.length))
  const uploads = texts.filter((t) => /documents upload/.test(t))
  assert.equal(uploads.length, 1, 'exactly one step uploads the spec')
  for (const t of texts) {
    if (!/spec review|gap hunt/i.test(t)) continue
    assert.doesNotMatch(t, /ConPort document|doc-N|documents get/, `a review or gap hunt on the uploaded spec:\n${t}`)
  }
  const at = (re) => {
    const i = texts.findIndex((t) => re.test(t))
    assert.ok(i >= 0, `no step matches ${re}`)
    return i
  }
  const review = at(/conport:sdd-gap-hunter/)
  const approve = at(/approves the draft/)
  const upload = at(/documents upload <draft> --doc-type spec/)
  const plan = at(/plan import <draft> --spec doc-N/)
  assert.ok(review < approve && approve < upload && upload < plan, `order: ${[review, approve, upload, plan]}`)
  assert.match(texts[review], /\.superpowers\/drafts\/<date>-<topic>-design\.md/)
  assert.match(texts[review], /goal\s+as\s+the\s+user\s+stated\s+it/, 'the gap hunter gets the goal from the user, not from the draft')
})

// The cycle of a piece of work: one task before the design, the epic made with
// the approved spec, the plan and its tasks put into that epic.
test('a task comes before the design, the epic with the uploaded spec, the plan into that epic', () => {
  const oneLine = (text) => text.replace(/\s+/g, ' ')
  const flow = rulesText().split('## The flow')[1].split('\n## ')[0]
  const steps = [...flow.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)]
  const step = (title) => {
    const n = steps.findIndex((s) => s[2].startsWith(title))
    assert.ok(n >= 0, `no step ${title}`)
    return oneLine(flow.slice(steps[n].index, steps[n + 1]?.index ?? flow.length))
  }

  const brainstorming = step('Brainstorming')
  assert.match(brainstorming, /one task \(`kind='task'`\)/)
  assert.match(brainstorming, /no epic yet/)
  assert.match(brainstorming, /the design needs none/)

  const upload = step('Upload the spec')
  assert.match(upload, /add_task\(project=<project>, kind='epic'/)
  assert.match(upload, /goal and the acceptance criterion/)
  assert.match(upload, /roadmap rules/)
  assert.match(upload, /link_items\(project=<project>, source_type='doc', source_id=N, target_type='task', target_id=<id>, relationship='clarifies'\)/)
  assert.match(upload, /exactly one spec per epic/)
  assert.match(upload, /update_task\(project=<project>, task_id=<the task>, status='DONE', resolution=/)
  assert.match(upload, /names `doc-N` and the epic/)
  assert.match(upload, /an epic with no plan and no tasks is a normal state/)
  assert.ok(upload.indexOf('documents upload') < upload.indexOf("kind='epic'"), 'the epic follows the upload')

  const plan = step('Plan')
  assert.match(plan, /npx -y conport@\^0\.7 plan import <draft> --spec doc-N --epic <id>` /)
  assert.match(plan, /the epic is not created again/)
  assert.match(plan, /A plan with no design.*`npx -y conport@\^0\.7 plan import <draft> \[--milestone <id>\]`/)
  assert.doesNotMatch(plan, /\[--epic <id>\]/, 'the epic of a designed plan is not optional')
})

test('the skill and the bridge follow the same cycle', () => {
  const oneLine = (text) => text.replace(/\s+/g, ' ')
  const skill = readFileSync(join(SCRIPTS, '..', 'skills', 'conport', 'SKILL.md'), 'utf8')
  const planning = skill.slice(skill.indexOf('### Planning'), skill.indexOf('### Execution'))
  const row = (re) => {
    const found = planning.split('\n').filter((l) => l.startsWith('|') && re.test(l))
    assert.equal(found.length, 1, `one Planning row matches ${re}, got ${found.length}`)
    return found[0]
  }
  assert.match(row(/^\| Work that needs a design/), /`add_task` \(`kind='task'`\).*no epic/)
  const spec = row(/^\| The spec is approved/)
  assert.match(spec, /`add_task` with `kind='epic'`/)
  assert.match(spec, /`link_items`.*`relationship='clarifies'`/)
  assert.match(spec, /one spec per epic/)
  assert.match(row(/^\| The plan is approved/), /`parent_task_id`.*--epic <id>/)

  // Every `plan import` the bridge prescribes for a plan with a spec names the spec's epic.
  const bridge = readFileSync(join(SCRIPTS, '..', 'skills', 'superpowers-conport', 'SKILL.md'), 'utf8')
  const withSpec = oneLine(bridge).match(/plan import <plan(?:_path)?> --spec doc-N\S*( --epic <id>)?/g) ?? []
  assert.ok(withSpec.length >= 4, `expected the import answer and the finish prescriptions, got ${withSpec.length}`)
  for (const cmd of withSpec) assert.match(cmd, / --epic <id>$/, cmd)
  // With the overlay off the bridge takes the epic the spec already has instead of a second one.
  const epicStep = oneLine(bridge.slice(bridge.indexOf('### 4. Import plan as epic + tasks'), bridge.indexOf('**Tasks:**')))
  assert.match(epicStep, /get_linked\(\{ project, item_type: 'doc', item_id: <doc_id>, relationship: 'clarifies', direction: 'outgoing' \}\)/)
  assert.match(epicStep, /never a second epic/)
  assert.match(epicStep, /title and description stay as they are/)
  // A re-import through the anchor never rewrites the epic the spec made, and still
  // refreshes the epic the bridge made. The sign is the bridge's own `Full plan:` line:
  // the `clarifies` link cannot be it, because step 5 links every epic, the bridge's included.
  const step5 = oneLine(bridge.slice(bridge.indexOf('### 5. Link spec ↔ epic'), bridge.indexOf('### 6.')))
  assert.match(step5, /relationship: 'clarifies'/, 'step 5 links the spec to every epic')
  const anchorFound = epicStep.slice(epicStep.indexOf('- Anchor found'), epicStep.indexOf('- Anchor not found'))
  assert.doesNotMatch(anchorFound, /get_linked/, 'the clarifies link step 5 writes cannot tell the spec epic from the bridge epic')
  assert.match(anchorFound, /get_task\(\{ project, task_id: <epic_id> \}\)/)
  assert.match(anchorFound, /description carries `Full plan: <plan_path>`: the bridge made this epic.*update_task\(\{ project, task_id: <epic_id>, title: <H1>, description: <short summary, ending with `See spec: doc-<doc_id>\. Full plan: <plan_path>\.`, ≤ 2000 chars> \}\)/)
  assert.match(anchorFound, /description carries no `Full plan: <plan_path>`: the epic was created with the spec.*leave its title and description as they are; no `update_task` on the epic/)
  // The bridge's own epic carries the sign from its creation; the spec's epic never gets it.
  const created = epicStep.slice(epicStep.indexOf('- Anchor not found, and the spec has no epic'))
  assert.match(created, /add_task\(\{ project, title: <H1>, description: <short summary, ending with `See spec: doc-<doc_id>\. Full plan: <plan_path>\.`>, kind: 'epic'/)
  const specEpic = epicStep.slice(epicStep.indexOf('- Anchor not found, and the spec already has its epic'), epicStep.indexOf('- Anchor not found, and the spec has no epic'))
  assert.match(specEpic, /title and description stay as they are, and no `Full plan: <plan_path>` is added to them/)
})

test('the rules and the skill name every agent type the plugin ships, the final reviewer for the whole branch', () => {
  const types = readdirSync(join(SCRIPTS, '..', 'agents'))
    .filter((f) => /^sdd-.*\.md$/.test(f))
    .map((f) => `conport:${f.slice(0, -3)}`)
  assert.ok(types.length >= 5, `agent types found: ${types}`)
  const oneLine = (text) => text.replace(/\s+/g, ' ')
  const rules = rulesText()
  const typeRule = oneLine(rules.slice(rules.indexOf('**The agent type.**'), rules.indexOf("**The subagent's answer**")))
  const skill = readFileSync(join(SCRIPTS, '..', 'skills', 'conport', 'SKILL.md'), 'utf8')
  const from = skill.indexOf("**SDD's subagents**")
  const skillRule = oneLine(skill.slice(from, skill.indexOf('\n- **', from)))
  for (const [name, text] of [['the rules', typeRule], ['the skill', skillRule]]) {
    for (const type of types) assert.ok(text.includes(`\`${type}\``), `${name}: no ${type} in: ${text}`)
    assert.match(text, /`conport:sdd-final-reviewer` for the final review of the whole branch/, name)
  }
  // The step that waits for the final review names who does it.
  const flow = rules.split('## The flow')[1].split('\n## ')[0]
  const finish = oneLine(flow.slice(flow.search(/^\d+\. \*\*Finish\.\*\*/m)))
  assert.match(finish, /final whole-branch review \(`conport:sdd-final-reviewer` in Claude Code\)/)
})

test('every journal tool call of the rules names its project', () => {
  const calls = rulesText().match(/\b(?:add_task_journal_entry|get_task_journal_entry|list_task_journal)\([^)]*\)/g) ?? []
  assert.ok(calls.length >= 3, `expected the brief, dispatch and history calls, got ${calls.length}`)
  for (const call of calls) assert.match(call, /\(project=<project>, /, call)
})

test('with the overlay on and no project configured, the hook injects the rules from the stdin cwd', () => withRepo(async ({ tmp, main }) => {
  writeConfig(main, ON)
  const { code, out } = await runSessionStart({ stdin: JSON.stringify({ cwd: main }), cwd: tmp })
  assert.equal(code, 0)
  assertInjected(out)
}))

test('without a cwd in stdin the hook reads the overlay from its working directory', () => withRepo(async ({ main }) => {
  writeConfig(main, ON)
  for (const stdin of ['', 'not json', '{"session_id":"s1"}', 'null']) {
    const { code, out } = await runSessionStart({ stdin, cwd: main })
    assert.equal(code, 0, stdin)
    assertInjected(out)
  }
}))

test('a linked worktree session gets the rules from the main worktree switch', () => withRepo(async ({ tmp, main }) => {
  const wt = addWorktree(main, tmp)
  writeConfig(main, ON)
  const { code, out } = await runSessionStart({ stdin: JSON.stringify({ cwd: wt }), cwd: tmp })
  assert.equal(code, 0)
  assertInjected(out)
}))

test('with the overlay off the hook prints nothing, as before', () => withRepo(async ({ tmp, main }) => {
  for (const config of [undefined, { conport: { superpowers: 'yes' } }, '{broken']) {
    if (config !== undefined) writeConfig(main, config)
    const { code, out } = await runSessionStart({ stdin: JSON.stringify({ cwd: main }), cwd: tmp })
    assert.equal(code, 0)
    assert.equal(out, '')
  }
}))

test('the deny-list fetch runs as before, with the overlay on and off', () => withRepo(async ({ tmp, main }) => {
  const api = await startApi()
  const dataDir = join(tmp, 'data')
  const env = { CONPORT_URL: api.url, CONPORT_PROJECT_NAME: 'prk7m2qx9d', CLAUDE_PLUGIN_DATA: dataDir }
  try {
    let res = await runSessionStart({ stdin: JSON.stringify({ cwd: main }), cwd: tmp, env })
    assert.equal(res.code, 0)
    assert.equal(res.out, '')
    assert.equal(api.requests.length, 1)
    assert.match(api.requests[0], /^\/api\/v1\/hooks\/conventions\?project=prk7m2qx9d$/)
    assert.equal(readFileSync(join(dataDir, 'deny-list_prk7m2qx9d.json'), 'utf8'), '{"deny":[]}')

    rmSync(dataDir, { recursive: true, force: true })
    writeConfig(main, ON)
    res = await runSessionStart({ stdin: JSON.stringify({ cwd: main }), cwd: tmp, env })
    assert.equal(res.code, 0)
    assertInjected(res.out)
    assert.equal(api.requests.length, 2)
    assert.ok(existsSync(join(dataDir, 'deny-list_prk7m2qx9d.json')))
  } finally {
    await api.close()
  }
}))

// One JSON document on stdout: the line about the retired variable is shown to
// the user at the start of a session only, while the overlay rules reach the
// agent on every source — a compacted session needs them again.
test('with the overlay on, the line goes to the user at startup and the rules to the agent', () => withRepo(async ({ tmp, main }) => {
  writeConfig(main, ON)
  const line = 'CONPORT_PROJECT_ID is no longer read — set CONPORT_PROJECT_NAME to the project\'s handle or name'
  const run = source => runSessionStart({
    stdin: JSON.stringify({ cwd: main, source }), cwd: tmp, env: { CONPORT_PROJECT_ID: '42' },
  })
  const started = await run('startup')
  assert.equal(started.code, 0)
  const parsed = JSON.parse(started.out)
  assert.equal(parsed.systemMessage, line)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(parsed.hookSpecificOutput.additionalContext, rulesText())

  for (const source of ['resume', 'clear', 'compact']) {
    const again = await run(source)
    assert.equal(again.code, 0)
    assert.equal('systemMessage' in JSON.parse(again.out), false, source)
    assertInjected(again.out)
  }
}))

test('a missing rules file leaves the hook silent and the session starting', () => withRepo(async ({ tmp, main }) => {
  writeConfig(main, ON)
  // The hook copied without the skill directory next to it.
  const scripts = join(tmp, 'plugin', 'scripts')
  mkdirSync(scripts, { recursive: true })
  for (const f of ['session-start.js', '_common.js']) copyFileSync(join(SCRIPTS, f), join(scripts, f))
  const { code, out } = await runSessionStart({ stdin: JSON.stringify({ cwd: main }), cwd: tmp, scripts })
  assert.equal(code, 0)
  assert.equal(out, '')
}))
