// The session start insists on the tools a ConPort project works with: while
// `plugins.superpowers` or `plugins.codegraph` is not set, or is `true` with
// its tool missing or turned off, it says one line per tool with one action
// (install it, turn it on, build the index, set the key); a key set to `false`
// is the user's refusal and silences it. Every hook runs as the real script in
// a child process, in a temporary repository outside this one, with Claude
// Code's settings folder and the PATH set up by the test — never the machine's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isolatedDir, isolatedEnv } from './support/isolated.mjs'
import { overlayNotice } from './support/overlay-notice.mjs'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const {
  TOOL_LINE_HEADS, toolLines, installedSuperpowers, enabledPlugins, superpowersState, onPath, codegraphIndexed,
} = require('../tool-setup.js')

const PROJECT_LINE = 'ConPort project: prk7m2qx9d (from .conport.json)'
const OFFICIAL = 'superpowers@claude-plugins-official'

// The lines word for word, as the user and the agent read them.
const declined = (key) => `; if the user declines, set \`plugins.${key}\` to \`false\` — ` +
  'in .conport.local.json for themselves, in .conport.json for the team'
const INSTALL_SP = '`/plugin install superpowers@claude-plugins-official`'
const SP_INSTALL = `Superpowers is not installed: install it — ${INSTALL_SP}${declined('superpowers')}`
const SP_INSTALL_ON = `Superpowers is not installed, while \`plugins.superpowers\` is \`true\`: install it — ${INSTALL_SP}`
const SP_INSTALL_OLD = 'Superpowers is not installed, while `conport.superpowers` is `true` in .superpowers/config.json: ' +
  `install it — ${INSTALL_SP}`
// Turned on at the scope of the settings that turned it off: the command writes
// that settings file, so the `false` that wins is the one it replaces. The
// project's settings are the team's, so that scope says so and offers `local`.
const PROJECT_NOTE = ', which changes the shared .claude/settings.json of the project — tell the user so, ' +
  'and offer `--scope local` to turn it on for them alone'
const enableAction = (id, scope) =>
  `turn it on — \`claude plugin enable ${id} --scope ${scope}\`${scope === 'project' ? PROJECT_NOTE : ''}`
const SP_ENABLE = (id, scope) => `Superpowers is turned off in Claude Code: ${enableAction(id, scope)}${declined('superpowers')}`
const SP_ENABLE_ON = (id, scope) => 'Superpowers is turned off in Claude Code, while `plugins.superpowers` is `true`: ' +
  enableAction(id, scope)
const SP_SET = '`plugins.superpowers` is not set while Superpowers is installed: turn the ConPort overlay on as the ' +
  `conport skill says (Superpowers overlay)${declined('superpowers')}`
const INSTALL_CG = '`npm install -g @colbymchenry/codegraph`'
const CG_INSTALL = `codegraph is not installed: install it — ${INSTALL_CG}${declined('codegraph')}`
const CG_INSTALL_ON = `codegraph is not installed, while \`plugins.codegraph\` is \`true\`: install it — ${INSTALL_CG}`
const CG_INDEX = `No codegraph index in this working tree: build it — \`codegraph init\` at its root${declined('codegraph')}`
const CG_INDEX_ON = 'No codegraph index in this working tree, while `plugins.codegraph` is `true`: build it — ' +
  '`codegraph init` at its root'
const CG_SET = '`plugins.codegraph` is not set while the codegraph index is built: set it to `true` in .conport.json' +
  declined('codegraph')

// --- the machine ------------------------------------------------------------

// Claude Code's settings folder; with `superpowers` its registry lists the
// plugin under `id`, and `enabled` is the `enabledPlugins` of its settings.json.
function claudeConfig({ superpowers = false, id = OFFICIAL, entry = { scope: 'user', installPath: '/x', version: '5.0.0' }, enabled } = {}) {
  const dir = isolatedDir()
  mkdirSync(join(dir, 'plugins'))
  const plugins = { 'conport@conport-plugin': [{ scope: 'user', installPath: '/y', version: '1.0.0' }] }
  if (superpowers) plugins[id] = [entry]
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }))
  if (enabled) writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: enabled }))
  return dir
}

// The path of the real git, found once.
const GIT = process.platform === 'win32' ? null
  : execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// A PATH holding git and, with `codegraph`, a stand-in of the codegraph command
// — and nothing else, so a codegraph installed on this machine is not seen.
function pathWith({ codegraph }) {
  const bin = isolatedDir()
  symlinkSync(GIT, join(bin, 'git'))
  if (codegraph) {
    writeFileSync(join(bin, 'codegraph'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, 'codegraph'), 0o755)
  }
  return bin
}

// A git repository in a new temporary folder holding `files`.
function repo(files = {}) {
  const dir = isolatedDir(files)
  execFileSync('git', ['-C', dir, 'init', '-q'], { env: isolatedEnv(), stdio: 'ignore' })
  return dir
}

const settings = (plugins) => JSON.stringify({ project_name: 'prk7m2qx9d', ...(plugins ? { plugins } : {}) })

function start(dir, vars) {
  return new Promise((resolve, reject) => {
    const env = isolatedEnv({ CONPORT_URL: 'http://127.0.0.1:9', ...vars })
    delete env.CONPORT_API_KEY
    delete env.CLAUDE_PLUGIN_OPTION_API_KEY
    const child = spawn(process.execPath, [join(SCRIPTS, 'session-start.js')], { env, cwd: dir })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(JSON.stringify({ session_id: 's1', source: 'startup', cwd: dir }))
  })
}

// What the session start told the user and the agent, each as lines.
async function told(dir, vars) {
  const res = await start(dir, vars)
  assert.equal(res.code, 0, res.err)
  const parsed = JSON.parse(res.out)
  return { user: parsed.systemMessage.split('\n'), agent: parsed.hookSpecificOutput.additionalContext }
}

const NO_SYMLINKED_GIT = process.platform === 'win32' && 'the PATH of git alone is built from a symlink, which Windows needs rights for'

// Both tools installed and turned on, codegraph on PATH.
const installed = (enabled) => ({ CLAUDE_CONFIG_DIR: claudeConfig({ superpowers: true, enabled }), PATH: pathWith({ codegraph: true }) })

// --- the three cases of the session start -------------------------------------

test('without plugins.* keys the session start says one line per tool with one action', { skip: NO_SYMLINKED_GIT }, async () => {
  // Nothing installed: install each.
  const bare = repo({ '.conport.json': settings() })
  let said = await told(bare, { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) })
  assert.deepEqual(said.user, [PROJECT_LINE, SP_INSTALL, CG_INSTALL])
  assert.equal(said.agent, said.user.join('\n'))

  // Both installed, no index: turn the overlay on, build the index.
  const vars = installed()
  said = await told(bare, vars)
  assert.deepEqual(said.user, [PROJECT_LINE, SP_SET, CG_INDEX])

  // The index built: set the key.
  mkdirSync(join(bare, '.codegraph'))
  said = await told(bare, vars)
  assert.deepEqual(said.user, [PROJECT_LINE, SP_SET, CG_SET])

  // An empty `plugins` sets no key either.
  const empty = repo({ '.conport.json': settings({}), '.codegraph/index.db': '' })
  said = await told(empty, vars)
  assert.deepEqual(said.user, [PROJECT_LINE, SP_SET, CG_SET])
})

test('with the keys true and the tools there the session start says nothing of them', { skip: NO_SYMLINKED_GIT }, async () => {
  const dir = repo({ '.conport.json': settings({ superpowers: true, codegraph: true }), '.codegraph/index.db': '' })
  const said = await told(dir, installed({ [OFFICIAL]: true }))
  assert.deepEqual(said.user, [PROJECT_LINE])
  assert.equal(said.agent, `${PROJECT_LINE}\n\n${overlayNotice('settings')}`)

  // A key true with its tool missing still names the action, without a way to decline.
  const missing = repo({ '.conport.json': settings({ superpowers: true, codegraph: true }) })
  let lines = (await told(missing, { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) })).user
  assert.deepEqual(lines, [PROJECT_LINE, SP_INSTALL_ON, CG_INSTALL_ON])
  lines = (await told(missing, installed())).user
  assert.deepEqual(lines, [PROJECT_LINE, CG_INDEX_ON])
})

test('with the keys false the session start says nothing of the tools, installed, turned off or not', { skip: NO_SYMLINKED_GIT }, async () => {
  const dir = repo({ '.conport.json': settings({ superpowers: false, codegraph: false }) })
  for (const vars of [
    { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) },
    installed(),
    installed({ [OFFICIAL]: false }),
  ]) {
    assert.deepEqual(await told(dir, vars), { user: [PROJECT_LINE], agent: PROJECT_LINE })
  }

  // The personal file declines for one person over the team's true.
  const mine = repo({
    '.conport.json': settings({ superpowers: true, codegraph: true }),
    '.conport.local.json': '{"plugins": {"superpowers": false, "codegraph": false}}',
    '.gitignore': '.conport.local.json\n',
  })
  const said = await told(mine, { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) })
  assert.deepEqual(said, { user: [PROJECT_LINE], agent: PROJECT_LINE })
})

// --- Superpowers turned off in Claude Code ----------------------------------

test('Superpowers turned off in Claude Code gets a line that turns it on, by the id it is installed under', { skip: NO_SYMLINKED_GIT }, async () => {
  const keyed = repo({ '.conport.json': settings({ superpowers: true, codegraph: false }) })
  const bare = repo({ '.conport.json': settings({ codegraph: false }) })
  // Turned off in the user's settings: turned on there.
  const offInUser = { PATH: pathWith({ codegraph: false }), CLAUDE_CONFIG_DIR: claudeConfig({ superpowers: true, enabled: { [OFFICIAL]: false } }) }
  assert.deepEqual((await told(keyed, offInUser)).user, [PROJECT_LINE, SP_ENABLE_ON(OFFICIAL, 'user')])
  assert.deepEqual((await told(bare, offInUser)).user, [PROJECT_LINE, SP_ENABLE(OFFICIAL, 'user')])

  // Installed from another marketplace: the line names that one.
  const other = 'superpowers@superpowers-marketplace'
  const otherOff = { PATH: pathWith({ codegraph: false }), CLAUDE_CONFIG_DIR: claudeConfig({ superpowers: true, id: other, enabled: { [other]: false } }) }
  assert.deepEqual((await told(keyed, otherOff)).user, [PROJECT_LINE, SP_ENABLE_ON(other, 'user')])

  // Turned off in the project's settings, over the user's on: turned on in the
  // project's settings — the user's scope would leave the project's `false` winning.
  const project = repo({
    '.conport.json': settings({ superpowers: true, codegraph: false }),
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { [OFFICIAL]: false } }),
  })
  const onInUser = { PATH: pathWith({ codegraph: false }), CLAUDE_CONFIG_DIR: claudeConfig({ superpowers: true, enabled: { [OFFICIAL]: true } }) }
  assert.deepEqual((await told(project, onInUser)).user, [PROJECT_LINE, SP_ENABLE_ON(OFFICIAL, 'project')])

  // The personal settings of the project turn it on again: connected, nothing said.
  writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { [OFFICIAL]: true } }))
  assert.deepEqual((await told(project, onInUser)).user, [PROJECT_LINE])

  // Turned off in the personal settings, over the project's and the user's on: turned on there.
  const local = repo({
    '.conport.json': settings({ superpowers: true, codegraph: false }),
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { [OFFICIAL]: true } }),
    '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { [OFFICIAL]: false } }),
  })
  assert.deepEqual((await told(local, onInUser)).user, [PROJECT_LINE, SP_ENABLE_ON(OFFICIAL, 'local')])
})

// The scope comes from the settings alone, not from where the plugin is
// installed: the registry of installs declares nothing. A `false` of the
// user's settings over a plugin installed for the project or for one person is
// turned on in the user's settings, never in the team's shared file.
test('Superpowers installed for the project and turned off by the user is turned on in the user settings', { skip: NO_SYMLINKED_GIT }, async () => {
  for (const scope of ['project', 'local']) {
    const dir = repo({ '.conport.json': settings({ superpowers: true, codegraph: false }) })
    const vars = {
      PATH: pathWith({ codegraph: false }),
      CLAUDE_CONFIG_DIR: claudeConfig({
        superpowers: true, entry: { scope, projectPath: dir, version: '5.0.0' }, enabled: { [OFFICIAL]: false },
      }),
    }
    assert.deepEqual((await told(dir, vars)).user, [PROJECT_LINE, SP_ENABLE_ON(OFFICIAL, 'user')], scope)
  }
})

test('enabledPlugins is read from the user, the project and the personal settings, the later over the earlier', () => {
  const home = isolatedDir()
  const config = isolatedDir({ 'settings.json': JSON.stringify({ enabledPlugins: { a: false, b: false, c: true, d: false } }) })
  const root = isolatedDir({
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { a: true, b: false, d: false } }),
    '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { b: true, d: false } }),
  })
  // Each value with the scope of the settings it came from.
  assert.deepEqual(enabledPlugins({ env: { CLAUDE_CONFIG_DIR: config }, home, root }), {
    a: { on: true, scope: 'project' },
    b: { on: true, scope: 'local' },
    c: { on: true, scope: 'user' },
    d: { on: false, scope: 'local' },
  })
  // Without CLAUDE_CONFIG_DIR the user settings are ~/.claude/settings.json.
  const userHome = isolatedDir({ '.claude/settings.json': JSON.stringify({ enabledPlugins: { a: false } }) })
  assert.deepEqual(enabledPlugins({ env: {}, home: userHome, root: null }), { a: { on: false, scope: 'user' } })
  // A broken, missing or odd file adds nothing.
  const broken = isolatedDir({ 'settings.json': '{broken', '.claude/settings.json': '{"enabledPlugins": []}' })
  assert.deepEqual(enabledPlugins({ env: { CLAUDE_CONFIG_DIR: broken }, home, root: broken }), {})
})

test('Superpowers is off only when every install of it is turned off', () => {
  const home = isolatedDir()
  const config = (enabled) => isolatedDir({
    'plugins/installed_plugins.json': JSON.stringify({
      plugins: { 'superpowers@a': [{ scope: 'user' }], 'superpowers@b': [{ scope: 'user' }] },
    }),
    'settings.json': JSON.stringify({ enabledPlugins: enabled }),
  })
  const state = (enabled) => superpowersState({ env: { CLAUDE_CONFIG_DIR: config(enabled) }, home, roots: [], root: null })
  assert.deepEqual(state({}), { installed: true, off: null })
  assert.deepEqual(state({ 'superpowers@a': false }), { installed: true, off: null })
  assert.deepEqual(state({ 'superpowers@a': false, 'superpowers@b': false }),
    { installed: true, off: { id: 'superpowers@a', scope: 'user' } })
  assert.deepEqual(superpowersState({ env: { CLAUDE_CONFIG_DIR: isolatedDir() }, home, roots: [], root: null }),
    { installed: false, off: null })
})

// --- the old flag, no project, no git ---------------------------------------

test('the old overlay flag counts as a set key only when conport.superpowers is true or false', { skip: NO_SYMLINKED_GIT }, async () => {
  const cases = [
    // [the old file, the line with Superpowers installed, the line without]
    [{ conport: { superpowers: true } }, null, SP_INSTALL_OLD],
    [{ conport: { superpowers: false } }, null, null],
    [{}, SP_SET, SP_INSTALL],
    [{ conport: { superpowers: 'yes' } }, SP_SET, SP_INSTALL],
    [{ other: 1 }, SP_SET, SP_INSTALL],
  ]
  for (const [flag, withPlugin, withoutPlugin] of cases) {
    const dir = repo({
      '.conport.json': settings({ codegraph: false }),
      '.superpowers/config.json': JSON.stringify(flag),
    })
    const sp = (lines) => lines.find((l) => l.startsWith('Superpowers') || l.startsWith('`plugins.superpowers`')) ?? null
    assert.equal(sp((await told(dir, installed({ [OFFICIAL]: true }))).user), withPlugin, JSON.stringify(flag))
    assert.equal(sp((await told(dir, { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) })).user),
      withoutPlugin, JSON.stringify(flag))
  }
})

test('without a ConPort project the session start says nothing of the tools', { skip: NO_SYMLINKED_GIT }, async () => {
  const dir = repo()
  const res = await start(dir, { CLAUDE_CONFIG_DIR: claudeConfig(), PATH: pathWith({ codegraph: false }) })
  assert.equal(res.code, 0, res.err)
  assert.equal(res.out, '')
})

// Without git there is no root and no project read: the variable does not stand
// in, so nothing is said of the tools — only that git failed.
test('when git does not answer the session start says nothing of the tools', async () => {
  const dir = isolatedDir({ '.conport.json': settings() })
  const said = await told(dir, {
    CLAUDE_CONFIG_DIR: claudeConfig(), PATH: isolatedDir(), CONPORT_PROJECT_NAME: 'prk7m2qx9d',
  })
  assert.equal(said.user.length, 1, said.user.join('\n'))
  assert.match(said.user[0], /^git failed \(.*\): ConPort settings were not read$/)
  assert.equal(said.agent, said.user[0])
})

// --- the parts --------------------------------------------------------------

// The skill tells an agent with hooks what each line means: it quotes every
// line up to its action, in the Claude Code part of step 1.
test('step 1 of the skill quotes every line of the tools', () => {
  const skill = readFileSync(join(SCRIPTS, '..', 'skills', 'conport', 'SKILL.md'), 'utf8')
  const step1 = skill.slice(skill.indexOf('### Step 1: Determine the project name'), skill.indexOf('### Step 2'))
  const withHooks = step1.slice(step1.indexOf('**Claude Code CLI**'), step1.indexOf('**Cursor, Codex')).replace(/\s+/g, ' ')
  assert.ok(withHooks.length > 100, 'step 1 has no part for Claude Code')
  for (const head of TOOL_LINE_HEADS) {
    assert.ok(withHooks.includes(head), `the Claude Code part of step 1 does not quote ${head}`)
  }
  // The command that turns Superpowers on names the scope whose `false` wins.
  assert.ok(withHooks.includes('claude plugin enable <id> --scope <user | project | local>'), withHooks)
  // Before the consent the user hears that `project` changes the team's settings, and gets `local`.
  assert.match(withHooks, /`--scope project` changes the shared `\.claude\/settings\.json` of the project[^.]*tell the user so before asking[^.]*`--scope local`[^.]*for them alone/)
})

const facts = (sp, cgInstalled, cgIndexed, off = null) => ({
  superpowersInstalled: sp, superpowersOff: off, codegraphInstalled: cgInstalled, codegraphIndexed: cgIndexed,
})
const OFF_PROJECT = { id: OFFICIAL, scope: 'project' }
const ABSENT = { key: undefined, from: null }
const ON = { key: true, from: 'settings' }
const OFF = { key: false, from: 'settings' }

test('each tool gives the first step it misses, nothing when connected or declined', () => {
  // Key absent: install, turn on, then the index, then the key.
  assert.deepEqual(toolLines({ superpowers: ABSENT, codegraph: undefined, facts: facts(false, false, true) }), [SP_INSTALL, CG_INSTALL])
  assert.deepEqual(toolLines({ superpowers: ABSENT, codegraph: undefined, facts: facts(true, true, false, OFF_PROJECT) }), [SP_ENABLE(OFFICIAL, 'project'), CG_INDEX])
  assert.deepEqual(toolLines({ superpowers: ABSENT, codegraph: undefined, facts: facts(true, true, false) }), [SP_SET, CG_INDEX])
  assert.deepEqual(toolLines({ superpowers: ABSENT, codegraph: undefined, facts: facts(true, true, true) }), [SP_SET, CG_SET])
  // Key true: the missing step without a way to decline, nothing once connected.
  assert.deepEqual(toolLines({ superpowers: ON, codegraph: true, facts: facts(false, false, false) }), [SP_INSTALL_ON, CG_INSTALL_ON])
  assert.deepEqual(toolLines({ superpowers: ON, codegraph: true, facts: facts(true, true, false, OFF_PROJECT) }), [SP_ENABLE_ON(OFFICIAL, 'project'), CG_INDEX_ON])
  assert.deepEqual(toolLines({ superpowers: ON, codegraph: true, facts: facts(true, true, true) }), [])
  // A true of the old flag is named where it is.
  assert.deepEqual(toolLines({ superpowers: { key: true, from: 'old' }, codegraph: false, facts: facts(false, false, false) }), [SP_INSTALL_OLD])
  assert.deepEqual(toolLines({ superpowers: { key: true, from: 'old' }, codegraph: false, facts: facts(true, false, false) }), [])
  // Key false: nothing, whatever the machine holds.
  for (const f of [facts(false, false, false), facts(true, true, true), facts(true, true, true, OFF_PROJECT)]) {
    assert.deepEqual(toolLines({ superpowers: OFF, codegraph: false, facts: f }), [])
    assert.deepEqual(toolLines({ superpowers: { key: false, from: 'old' }, codegraph: false, facts: f }), [])
  }
  // No switch given at all is an absent key.
  assert.deepEqual(toolLines({ superpowers: null, codegraph: false, facts: facts(false, false, false) }), [SP_INSTALL])
  // An id that is not a plain `name@marketplace` is not printed into a command.
  assert.deepEqual(toolLines({ superpowers: ON, codegraph: false, facts: facts(true, false, false, { id: 'superpowers@x`; rm -rf', scope: 'user' }) }),
    [SP_ENABLE_ON('superpowers', 'user')])
})

test('every line of the tools opens with a head the skill quotes', () => {
  const all = new Set()
  for (const superpowers of [ABSENT, ON, { key: true, from: 'old' }]) {
    for (const codegraph of [undefined, true]) {
      for (const f of [facts(false, false, false), facts(true, true, false, OFF_PROJECT), facts(true, true, false), facts(true, true, true)]) {
        for (const line of toolLines({ superpowers, codegraph, facts: f })) all.add(line)
      }
    }
  }
  assert.equal(all.size, 12)
  for (const line of all) assert.ok(TOOL_LINE_HEADS.some((head) => line.startsWith(head)), line)
})

test('Superpowers is installed by the registry of Claude Code, for the user or for this project', () => {
  const home = isolatedDir()
  const env = (dir) => ({ CLAUDE_CONFIG_DIR: dir })
  const ids = (dir, roots = []) => installedSuperpowers({ env: env(dir), home, roots })
  assert.deepEqual(ids(claudeConfig({ superpowers: true })), [OFFICIAL])
  assert.deepEqual(ids(claudeConfig()), [])
  // No registry, an unreadable one or one of another shape: not installed.
  assert.deepEqual(ids(isolatedDir()), [])
  for (const text of ['{broken', 'null', '[]', '{"plugins": []}']) {
    assert.deepEqual(ids(isolatedDir({ 'plugins/installed_plugins.json': text })), [], text)
  }
  // A plugin of another name that only starts with it is not Superpowers.
  const other = isolatedDir({
    'plugins/installed_plugins.json': JSON.stringify({ plugins: { 'superpowers-lab@x': [{ scope: 'user' }] } }),
  })
  assert.deepEqual(ids(other), [])
  // The first registry format, one object per plugin, is read too.
  const v1 = isolatedDir({
    'plugins/installed_plugins.json': JSON.stringify({ version: 1, plugins: { 'superpowers@m': { version: '4.0.0' } } }),
  })
  assert.deepEqual(ids(v1), ['superpowers@m'])
  // Installed for a project: only in that project, the main worktree of a linked one included.
  const project = isolatedDir()
  const scoped = claudeConfig({ superpowers: true, entry: { scope: 'project', projectPath: project } })
  assert.deepEqual(ids(scoped, [project]), [OFFICIAL])
  assert.deepEqual(ids(scoped, [isolatedDir(), project]), [OFFICIAL])
  assert.deepEqual(ids(scoped, [isolatedDir(), null]), [])
  // Without CLAUDE_CONFIG_DIR the registry is in ~/.claude.
  const userHome = isolatedDir({
    '.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'superpowers@m': [{ scope: 'user' }] } }),
  })
  assert.deepEqual(installedSuperpowers({ env: {}, home: userHome, roots: [] }), ['superpowers@m'])
})

test('codegraph is installed when its command is on PATH and indexed with .codegraph/ at the root', () => {
  const bin = isolatedDir()
  assert.equal(onPath('codegraph', { PATH: bin }, 'linux'), false)
  writeFileSync(join(bin, 'codegraph'), '')
  // A file that cannot run is no command.
  assert.equal(onPath('codegraph', { PATH: bin }, 'linux'), false)
  chmodSync(join(bin, 'codegraph'), 0o755)
  assert.equal(onPath('codegraph', { PATH: `${isolatedDir()}${delimiter}${bin}` }, 'linux'), true)
  assert.equal(onPath('codegraph', {}, 'linux'), false)
  // On Windows the command is found by its PATHEXT ending.
  const win = isolatedDir({ 'codegraph.cmd': '' })
  assert.equal(onPath('codegraph', { PATH: win, PATHEXT: '.EXE;.CMD' }, 'win32'), true)
  assert.equal(onPath('codegraph', { PATH: win, PATHEXT: '.EXE' }, 'win32'), false)

  const root = isolatedDir()
  assert.equal(codegraphIndexed(root), false)
  writeFileSync(join(root, '.codegraph'), '')
  assert.equal(codegraphIndexed(root), false, 'a file named .codegraph is no index')
  assert.equal(codegraphIndexed(isolatedDir({ '.codegraph/index.db': '' })), true)
  assert.equal(codegraphIndexed(null), false)
})
