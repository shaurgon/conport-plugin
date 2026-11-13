// The rules of the ConPort project settings files: every case of the shared
// fixture (which the other readers run as well), the JSON error position, and
// the loader over real files and a real git repository built in a temporary
// folder outside this repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { delimiter, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isolatedDir, isolatedEnv, REPO_ROOT } from './support/isolated.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const {
  resolveSettings, settingsLocations, jsonErrorPosition, loadSettings, normalizePath, projectLine,
} = require(join(HERE, '..', 'project-config.js'))
const CASES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'project-config-cases.json'), 'utf8'))

function git(dir, env, ...args) {
  return execFileSync('git', [
    '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
}

function repo(env, files = {}) {
  const dir = isolatedDir(files)
  git(dir, env, 'init', '-q', '-b', 'main')
  git(dir, env, 'add', '-A')
  git(dir, env, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'init')
  return dir
}

test('every resolve case of the fixture', () => {
  assert.ok(CASES.resolve.length > 0)
  for (const c of CASES.resolve) {
    assert.deepEqual(resolveSettings(c.input), c.expect, c.name)
  }
})

test('every locations case of the fixture', () => {
  assert.ok(CASES.locations.length > 0)
  for (const c of CASES.locations) {
    assert.deepEqual(settingsLocations(c.cwd, c.git), c.expect, c.name)
  }
})

test('jsonErrorPosition reports the first bad character', () => {
  assert.deepEqual(jsonErrorPosition('{"a":}'), { line: 1, column: 6 })
  assert.deepEqual(jsonErrorPosition('{\n"a": 1,\n}'), { line: 3, column: 1 })
  assert.deepEqual(jsonErrorPosition('{"a": [1, 2'), { line: 1, column: 12 })
  assert.equal(jsonErrorPosition('{"a": [1, 2.5e-3, true, null, "\\u00e9\\n"]}'), null)
  assert.deepEqual(jsonErrorPosition('01'), { line: 1, column: 2 })
  assert.deepEqual(jsonErrorPosition('{"a": tru}'), { line: 1, column: 10 })
  assert.deepEqual(jsonErrorPosition('"\\x"'), { line: 1, column: 3 })
  assert.deepEqual(jsonErrorPosition('{} x'), { line: 1, column: 4 })
  assert.deepEqual(jsonErrorPosition('"a\tb"'), { line: 1, column: 3 })
  // Columns count UTF-16 code units after the last line feed.
  assert.deepEqual(jsonErrorPosition('{\n"\u{1F600}": ,}'), { line: 2, column: 7 })
  // Deep nesting is no stack overflow.
  assert.deepEqual(jsonErrorPosition('['.repeat(200000)), { line: 1, column: 200001 })
})

test('normalizePath folds slashes, drive letters, dots and the trailing slash', () => {
  assert.equal(normalizePath('c:\\repo\\sub\\..\\x\\'), 'C:/repo/x')
  assert.equal(normalizePath('/work/./repo/'), '/work/repo')
  assert.equal(normalizePath('/'), '/')
  assert.equal(normalizePath('C:\\'), 'C:/')
})

test('projectLine names the project and where it came from', () => {
  const line = projectLine({ project: 'p', source: '.conport.json', settings: { plugins: {}, arch: {} }, lines: [] })
  assert.equal(line, 'ConPort project: p (from .conport.json)')
  assert.equal(projectLine({ project: null, source: null, settings: { plugins: {}, arch: {} }, lines: [] }), null)
})

// The roots are normalized (forward slashes, `C:/…` on Windows), so a root is
// compared with the normalized folder.
test('loadSettings reads the local file of the main worktree when the current one has none, on windows paths too', () => {
  const env = isolatedEnv()
  const main = repo(env, { '.gitignore': '.conport.local.json\n', '.conport.json': '{"project_name": "team-project"}' })
  writeFileSync(join(main, '.conport.local.json'), '{"project_name": "mine", "plugins": {"superpowers": true}}')
  const wt = join(isolatedDir(), 'wt')
  git(main, env, 'worktree', 'add', '-q', wt)
  mkdirSync(join(wt, 'sub'))
  const got = loadSettings({ cwd: join(wt, 'sub'), env, home: isolatedDir() })
  assert.equal(got.root, normalizePath(wt))
  assert.equal(got.mainRoot, normalizePath(main))
  assert.equal(got.project, 'mine')
  assert.equal(got.source, '.conport.local.json')
  assert.deepEqual(got.settings.plugins, { superpowers: true })
  assert.deepEqual(got.lines, ['project_name from .conport.local.json (mine) overrides .conport.json (team-project)'])
})

test('loadSettings refuses a root inside CONPORT_SETTINGS_FORBID_ROOT', () => {
  const env = isolatedEnv()
  assert.throws(
    () => loadSettings({ cwd: join(REPO_ROOT, 'plugins'), env, home: isolatedDir() }),
    { message: `settings root ${normalizePath(REPO_ROOT)} is inside CONPORT_SETTINGS_FORBID_ROOT: run the test in a temporary folder` },
  )
  // A root outside the named path is read as usual.
  const dir = isolatedDir({ '.conport.json': '{"project_name": "outside"}' })
  assert.equal(loadSettings({ cwd: dir, env, home: isolatedDir() }).project, 'outside')
})

test('loadSettings refuses a root named through a symlink in CONPORT_SETTINGS_FORBID_ROOT, a junction on windows', () => {
  const link = join(isolatedDir(), 'repo-link')
  // A junction on Windows, where a directory symlink needs a privilege; the
  // type is ignored everywhere else.
  symlinkSync(REPO_ROOT, link, 'junction')
  const env = isolatedEnv({ CONPORT_SETTINGS_FORBID_ROOT: link })
  assert.throws(
    () => loadSettings({ cwd: join(REPO_ROOT, 'plugins'), env, home: isolatedDir() }),
    /is inside CONPORT_SETTINGS_FORBID_ROOT: run the test in a temporary folder$/,
  )
  // Outside git the root is the folder as given; through the link it is still the repository.
  const outside = isolatedEnv({ CONPORT_SETTINGS_FORBID_ROOT: REPO_ROOT })
  const run = () => {
    const err = new Error('Command failed')
    err.stderr = 'fatal: not a git repository (or any of the parent directories): .git\n'
    throw err
  }
  assert.throws(
    () => loadSettings({ cwd: join(link, 'plugins'), env: outside, home: isolatedDir(), run }),
    /is inside CONPORT_SETTINGS_FORBID_ROOT/,
  )
})

test('loadSettings checks ignore only when the local file exists', () => {
  const env = isolatedEnv()
  const dir = repo(env, { '.conport.json': '{"project_name": "p"}' })
  const calls = []
  const run = (args) => {
    calls.push(args.slice(2).join(' '))
    return execFileSync('git', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  const without = loadSettings({ cwd: dir, env, home: isolatedDir(), run })
  assert.deepEqual(calls, ['rev-parse --show-toplevel --git-common-dir'])
  assert.deepEqual(without.lines, [])

  calls.length = 0
  writeFileSync(join(dir, '.conport.local.json'), '{"plugins": {"codegraph": false}}')
  const exposed = loadSettings({ cwd: dir, env, home: isolatedDir(), run })
  assert.deepEqual(calls, [
    'rev-parse --show-toplevel --git-common-dir',
    'ls-files --error-unmatch -- .conport.local.json',
    'check-ignore -q -- .conport.local.json',
  ])
  assert.deepEqual(exposed.lines, ['.conport.local.json is not ignored by git: add it to .gitignore'])

  writeFileSync(join(dir, '.gitignore'), '.conport.local.json\n')
  assert.deepEqual(loadSettings({ cwd: dir, env, home: isolatedDir(), run }).lines, [])
})

test('loadSettings outside git reads the folder itself and the user env file, on windows paths too', () => {
  const env = isolatedEnv()
  const dir = isolatedDir({ '.conport.json': '{"project_name": "loose"}' })
  mkdirSync(join(env.XDG_CONFIG_HOME, 'conport'), { recursive: true })
  writeFileSync(join(env.XDG_CONFIG_HOME, 'conport', '.env'), 'CONPORT_PROJECT_NAME=elsewhere\n')
  const got = loadSettings({ cwd: dir, env, home: isolatedDir() })
  assert.equal(got.root, normalizePath(dir))
  assert.equal(got.mainRoot, null)
  assert.equal(got.project, 'loose')
  assert.deepEqual(got.lines, [
    'CONPORT_PROJECT_NAME in ~/.config/conport/.env is not read: it would apply to every repository — remove it',
  ])
})

test('loadSettings reads the user env file under home without XDG_CONFIG_HOME', () => {
  const env = isolatedEnv()
  delete env.XDG_CONFIG_HOME
  const home = isolatedDir({ '.config/conport/.env': 'CONPORT_PROJECT_NAME=elsewhere\n' })
  const got = loadSettings({ cwd: isolatedDir(), env, home })
  assert.equal(got.lines.length, 1)
})

test('loadSettings says a directory named .conport.json cannot be read', () => {
  const env = isolatedEnv({ CONPORT_PROJECT_NAME: 'from-env' })
  const dir = isolatedDir({ '.conport.json/inner': 'x' })
  const got = loadSettings({ cwd: dir, env, home: isolatedDir() })
  assert.equal(got.project, null)
  assert.deepEqual(got.lines, ['.conport.json cannot be read (EISDIR): fix it'])
})

// A git with translations: it says "not a git repository" in English only when asked in
// English (LC_ALL=C and no LANGUAGE), else in Russian, as git with LANG=ru_RU does.
const TRANSLATING_GIT = [
  '#!/bin/sh',
  'if [ "$LC_ALL" = C ] && [ -z "$LANGUAGE" ]; then',
  "  echo 'fatal: not a git repository (or any of the parent directories): .git' >&2",
  'else',
  "  echo 'fatal: не найден git репозиторий (или один из родительских каталогов): .git' >&2",
  'fi',
  'exit 128',
  '',
].join('\n')

const RUSSIAN = { LANG: 'ru_RU.UTF-8', LC_ALL: 'ru_RU.UTF-8', LANGUAGE: 'ru' }

test(
  'loadSettings asks git in English: a translating git outside a repository is still outside git',
  { skip: process.platform === 'win32' && 'the fake git is a shell script' },
  () => {
    const bin = isolatedDir({ git: TRANSLATING_GIT })
    chmodSync(join(bin, 'git'), 0o755)
    const env = isolatedEnv({ ...RUSSIAN, PATH: `${bin}${delimiter}${process.env.PATH}` })
    const dir = isolatedDir({ '.conport.json': '{"project_name": "loose"}' })
    const got = loadSettings({ cwd: dir, env, home: isolatedDir() })
    assert.deepEqual(got.lines, [])
    assert.equal(got.root, normalizePath(dir))
    assert.equal(got.project, 'loose')
  },
)

// Only that the real git, run with a Russian locale in the caller's environment, still leaves a
// real folder outside any repository read as outside git. It does not prove that git is asked in
// English: a git built without translations passes it without that; the test above proves that.
test('loadSettings with the real git under a Russian locale reads a folder outside git', () => {
  const env = isolatedEnv(RUSSIAN)
  const dir = isolatedDir({ '.conport.json': '{"project_name": "loose"}' })
  const got = loadSettings({ cwd: dir, env, home: isolatedDir() })
  assert.deepEqual(got.lines, [])
  assert.equal(got.root, normalizePath(dir))
  assert.equal(got.project, 'loose')
})

test('loadSettings with a git failure reads no file and takes no variable', () => {
  const env = isolatedEnv({ CONPORT_PROJECT_NAME: 'from-env' })
  const dir = isolatedDir({ '.conport.json': '{"project_name": "p"}' })
  const run = () => {
    const err = new Error('Command failed')
    err.stderr = "fatal: detected dubious ownership in repository at '/x'\nmore\n"
    throw err
  }
  const got = loadSettings({ cwd: dir, env, home: isolatedDir(), run })
  assert.equal(got.project, null)
  assert.equal(got.root, null)
  assert.deepEqual(got.lines, ["git failed (fatal: detected dubious ownership in repository at '/x'): ConPort settings were not read"])
  assert.equal(loadSettings({ cwd: dir, env, home: isolatedDir(), run, explicit: 'flag' }).project, 'flag')
})
