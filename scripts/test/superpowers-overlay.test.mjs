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
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
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
  assert.match(text, /npx -y conport@\^0\.6 plan import/)
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
