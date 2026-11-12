import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_PATH, parseUnitManifest, unitVersionDrift, unreadableCarriers } from '../unit-versions.mjs'

// An epic does not raise a unit version; the release step raises it once. The
// workflows hold that mechanically: before READY they compare every version carrier
// of every unit with the base branch. Which units a project has and where each
// carries its version is the project's own manifest, never the plugin's. These tests
// build a neutral project with its manifest and pin how the manifest is read, how each
// kind of carrier is read, and the helper command that reads both out of git.

const HELPER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'wf-helper.mjs')

// A neutral project: four units, every kind of carrier the manifest offers.
const MANIFEST = {
  units: [
    { unit: 'the web app', carriers: [
      { path: 'web/package.json', read: { json: 'version' } },
      { path: 'web/catalog.json', read: { json: 'plugins[].version' } },
      { dir: 'web/skills', file: 'SKILL.md', read: { skill: 'metadata.version' } },
      { path: 'server/versions.py', read: { regex: '"web"\\s*:\\s*"([^"]+)"' } },
    ] },
    { unit: 'the agent', carriers: [
      { path: 'agent-kit/SKILL.md', read: { skill: 'metadata.version' } },
      { path: 'server/versions.py', read: { regex: '"web-agent"\\s*:\\s*"([^"]+)"' } },
    ] },
    { unit: 'the cli', carriers: [
      { path: 'cli/package.json', read: { json: 'version' } },
      { path: 'ui/src/cli.ts', read: { regex: "^export const CLI_VERSION\\s*=\\s*['\"]([^'\"]+)['\"]" } },
    ] },
    { unit: 'the extension', carriers: [
      { path: 'ext/extension.json', read: { json: 'version' } },
    ] },
  ],
}
const MANIFEST_TEXT = JSON.stringify(MANIFEST, null, 2) + '\n'
const { units: UNITS } = parseUnitManifest(MANIFEST_TEXT)

const skill = (name, v) => `---\nname: ${name}\ndescription: "Use when a version: 9.9.9 appears in prose"\nmetadata:\n  version: ${v}\n---\n\n# ${name}\n\nversion: 9.9.9 in the body is not the version.\n`
const versionsPy = (web, agent) => `"""Latest versions."""\n\nLATEST = {\n    "web-agent": "${agent}",\n    "web": "${web}",\n}\n`

const BASE_VERSION = { 'the web app': '2.6.0', 'the agent': '1.7.0', 'the cli': '0.7.3', 'the extension': '0.4.4' }
// Each carrier file, its unit and its text at a version. server/versions.py carries two
// units, one key each: it is rendered from both.
const CARRIERS = {
  'web/package.json': ['the web app', v => JSON.stringify({ name: 'web', version: v }, null, 2) + '\n'],
  'web/catalog.json': ['the web app', v => JSON.stringify({ name: 'catalog', plugins: [{ name: 'web', version: v }] }, null, 2) + '\n'],
  'web/skills/main/SKILL.md': ['the web app', v => skill('main', v)],
  'web/skills/extra/SKILL.md': ['the web app', v => skill('extra', v)],
  'agent-kit/SKILL.md': ['the agent', v => skill('agent-kit', v)],
  'cli/package.json': ['the cli', v => JSON.stringify({ name: 'cli', version: v, bin: { cli: 'bin.js' } }, null, 2) + '\n'],
  'ui/src/cli.ts': ['the cli', v => `// the CLI\nimport type { X } from './protocol'\n\nexport const CLI_VERSION = '${v}'\n\nexport const RUN = ['npx', '-y', \`cli@\${CLI_VERSION}\`]\n`],
  'ext/extension.json': ['the extension', v => JSON.stringify({ id: 'ext', version: v }, null, 2) + '\n'],
}
const PY = 'server/versions.py'
const filesAt = (raise = {}) => ({
  ...Object.fromEntries(Object.entries(CARRIERS).map(([path, [unit, render]]) => [path, render(raise[path] ?? BASE_VERSION[unit])])),
  [PY]: versionsPy(raise['py:web'] ?? BASE_VERSION['the web app'], raise['py:agent'] ?? BASE_VERSION['the agent']),
})

// A tree as unitVersionDrift reads it: path -> text, absent -> null.
const tree = files => ({
  read: path => (Object.hasOwn(files, path) ? files[path] : null),
  list: dir => Object.keys(files).filter(p => p.startsWith(dir + '/')),
})
const drift = (base, head) => unitVersionDrift(UNITS, tree(base), tree(head))

// ------------------------------------------------------------- the manifest

test('the manifest lives at .conport/units.json and gives its units in order', () => {
  assert.equal(MANIFEST_PATH, '.conport/units.json')
  assert.deepEqual(UNITS.map(u => u.unit), ['the web app', 'the agent', 'the cli', 'the extension'])
})

const broken = (over, carrierOver) => JSON.stringify({ units: [{ unit: 'u', carriers: [{ path: 'a.json', read: { json: 'version' }, ...carrierOver }], ...over }] })
for (const [what, text, says] of [
  ['not JSON', '{ units: ', /is not JSON/],
  ['no units', JSON.stringify({ units: [] }), /units must be a non-empty list/],
  ['a unit without a name', broken({ unit: '' }), /unit must name the unit/],
  ['a unit without carriers', broken({ carriers: [] }), /carriers must be a non-empty list/],
  ['a carrier with both a path and a dir', broken({}, { dir: 'd', file: 'f' }), /either path, or dir and file/],
  ['a carrier with no read', broken({}, { read: undefined }), /exactly one of json, regex, skill/],
  ['an unknown read', broken({}, { read: { toml: 'version' } }), /unknown read "toml"/],
  ['a regex that does not compile', broken({}, { read: { regex: '(' } }), /does not compile/],
  ['a regex without a group', broken({}, { read: { regex: 'version: \\d+' } }), /capture the version in its first group/],
  ['a skill read of another field', broken({}, { read: { skill: 'version' } }), /must be "metadata.version"/],
]) {
  test(`a manifest with ${what} is refused with the reason`, () => {
    const out = parseUnitManifest(text)
    assert.equal(out.units, undefined)
    assert.match(out.error, says)
  })
}

// ------------------------------------------------------------- the carriers

test('equal versions on both sides: no difference', () => {
  assert.deepEqual(drift(filesAt(), filesAt()), [])
})

for (const path of Object.keys(CARRIERS)) {
  const unit = CARRIERS[path][0]
  test(`a raised version in ${path} is a difference of ${unit}`, () => {
    assert.deepEqual(drift(filesAt(), filesAt({ [path]: '99.0.0' })), [{ unit, path, base: BASE_VERSION[unit], head: '99.0.0' }])
  })
}

test('one file, two units: each reads its own key by the regex of its carrier', () => {
  assert.deepEqual(drift(filesAt(), filesAt({ 'py:agent': '1.8.0' })), [{ unit: 'the agent', path: PY, base: '1.7.0', head: '1.8.0' }])
  assert.deepEqual(drift(filesAt(), filesAt({ 'py:web': '2.7.0' })), [{ unit: 'the web app', path: PY, base: '2.6.0', head: '2.7.0' }])
})

test('a lowered version is a difference too: the base is the only allowed value', () => {
  const path = 'ext/extension.json'
  assert.deepEqual(drift(filesAt(), filesAt({ [path]: '0.4.3' })), [{ unit: 'the extension', path, base: '0.4.4', head: '0.4.3' }])
})

test('a change outside the version field of a carrier is no difference', () => {
  const head = filesAt()
  head['web/package.json'] = JSON.stringify({ name: 'web', description: 'new', version: '2.6.0' })
  head['web/skills/main/SKILL.md'] += '\nmore text, version: 1.2.3\n'
  head['ui/src/cli.ts'] += "\nexport const OTHER_VERSION = '1.0.0'\n"
  assert.deepEqual(drift(filesAt(), head), [])
})

test('a json path over a list joins every value; a list entry without the field is unreadable', () => {
  const path = 'web/catalog.json'
  const two = v => JSON.stringify({ plugins: [{ version: '2.6.0' }, { version: v }] })
  assert.deepEqual(drift({ ...filesAt(), [path]: two('2.6.0') }, { ...filesAt(), [path]: two('2.7.0') }),
    [{ unit: 'the web app', path, base: '2.6.0, 2.6.0', head: '2.6.0, 2.7.0' }])
  assert.deepEqual(drift(filesAt(), { ...filesAt(), [path]: JSON.stringify({ plugins: [{ name: 'web' }] }) }),
    [{ unit: 'the web app', path, base: '2.6.0', head: null }])
})

test('a SKILL.md reads metadata.version from its frontmatter only, never from an example in its body', () => {
  const path = 'web/skills/main/SKILL.md'
  const head = { ...filesAt(), [path]: '---\nname: main\n---\n\nAn example:\n\n---\nmetadata:\n  version: 2.6.0\n---\n' }
  assert.deepEqual(drift(filesAt(), head), [{ unit: 'the web app', path, base: '2.6.0', head: null }])
})

test('a carrier present on one side only is no difference: a new skill is not a raise', () => {
  const head = { ...filesAt(), 'web/skills/new/SKILL.md': skill('new', '2.6.0') }
  const base = filesAt()
  delete base['ext/extension.json']
  assert.deepEqual(drift(base, head), [])
})

test('a repository with none of the carriers has no difference', () => {
  assert.deepEqual(drift({}, { 'README.md': 'version: 1' }), [])
})

test('a carrier whose version cannot be read on one side differs from the readable one', () => {
  const path = 'cli/package.json'
  assert.deepEqual(drift(filesAt(), { ...filesAt(), [path]: '{ not json' }), [{ unit: 'the cli', path, base: '0.7.3', head: null }])
})

test('unreadable: a carrier at an exact path whose version neither side can read is unchecked, never equal', () => {
  const path = 'ui/src/cli.ts'
  const odd = v => `export const CLI_VERSION: string = '${v}'\n`
  const base = { ...filesAt(), [path]: odd('0.7.3') }
  const head = { ...filesAt(), [path]: odd('0.7.4') }
  assert.deepEqual(drift(base, head), [])
  assert.deepEqual(unreadableCarriers(UNITS, tree(base), tree(head)), [path])
})

test('unreadable: none when every carrier reads, when a carrier is absent, or when one side alone is unreadable', () => {
  assert.deepEqual(unreadableCarriers(UNITS, tree(filesAt()), tree(filesAt())), [])
  assert.deepEqual(unreadableCarriers(UNITS, tree({}), tree({})), [])
  // one side readable: that is a difference (see above), not an unreadable carrier
  assert.deepEqual(unreadableCarriers(UNITS, tree(filesAt()), tree({ ...filesAt(), 'cli/package.json': '{ not json' })), [])
})

test('unreadable: a file of a directory carrier without a version is not unchecked — only exact paths are', () => {
  const bare = { ...filesAt(), 'web/skills/main/SKILL.md': '---\nname: main\n---\n' }
  assert.deepEqual(unreadableCarriers(UNITS, tree(bare), tree(bare)), [])
})

// ------------------------------------------------------------- the helper

const roots = []
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })

const commitAll = (dir, files, msg) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', msg)
  return git(dir, 'rev-parse', 'HEAD').trim()
}
// A throwaway repository on main carrying every carrier at its base version and, unless
// told otherwise, the manifest; no remote.
const mkRepo = (manifest = MANIFEST_TEXT) => {
  const dir = mkdtempSync(join(tmpdir(), 'wfuv-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'wf@example.test')
  git(dir, 'config', 'user.name', 'wf')
  git(dir, 'config', 'commit.gpgsign', 'false')
  const sha = commitAll(dir, { ...filesAt(), ...(manifest === null ? {} : { [MANIFEST_PATH]: manifest }) }, 'init')
  return { dir, sha }
}
const versions = (cwd, ...argv) => {
  const r = spawnSync(process.execPath, [HELPER, 'versions', ...argv], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, 'exit 0 expected, stderr: ' + r.stderr)
  return JSON.parse(r.stdout)
}
const short = (dir, sha) => git(dir, 'rev-parse', '--short', sha).trim()
const render = (path, v) => CARRIERS[path][1](v)

test('helper versions: no manifest -> units none, nothing compared, equal', () => {
  const { dir, sha } = mkRepo(null)
  commitAll(dir, { 'ext/extension.json': render('ext/extension.json', '9.0.0') }, 'a raise nobody declared')
  assert.deepEqual(versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD'),
    { units: 'none', base: short(dir, sha), head: 'HEAD', equal: true, differs: [], unreadable: [], start_differs: [], start_behind: false })
})

test('helper versions: a manifest that cannot be read -> units invalid with the reason, not equal', () => {
  const { dir, sha } = mkRepo('{ "units": [] }\n')
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD')
  assert.equal(out.units, 'invalid')
  assert.match(out.manifest_error, /units must be a non-empty list/)
  assert.equal(out.equal, false)
})

test('helper versions: the manifest is read at the start, so a head that drops a carrier is still checked by it', () => {
  const { dir, sha } = mkRepo()
  const fewer = JSON.stringify({ units: MANIFEST.units.filter(u => u.unit !== 'the extension') })
  commitAll(dir, { 'ext/extension.json': render('ext/extension.json', '0.4.5'), [MANIFEST_PATH]: fewer }, 'raise and hide')
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD')
  assert.deepEqual(out.differs.map(d => [d.unit, d.head]), [['the extension', '0.4.5']])
})

test('helper versions: equal versions -> equal, no difference; a commit base is named by its short sha', () => {
  const { dir, sha } = mkRepo()
  commitAll(dir, { 'docs/notes.md': 'work of the epic\n' }, 'work')
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD')
  assert.deepEqual(out, { units: 'manifest', base: short(dir, sha), head: 'HEAD', equal: true, differs: [], unreadable: [], start_differs: [], start_behind: false })
  assert.ok(out.base.length < 40 && sha.startsWith(out.base), 'the short sha, so a title naming it is not cut')
})

test('helper versions: a raised skill version -> not equal, the carrier named with both values', () => {
  const { dir, sha } = mkRepo()
  const path = 'web/skills/main/SKILL.md'
  commitAll(dir, { [path]: render(path, '2.7.0') }, 'raise')
  assert.deepEqual(versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD'),
    { units: 'manifest', base: short(dir, sha), head: 'HEAD', equal: false, unreadable: [], start_differs: [], start_behind: false,
      differs: [{ unit: 'the web app', path, base: '2.6.0', head: '2.7.0' }] })
})

test('helper versions: the head is any commit, not only the checkout — a task branch before its merge', () => {
  const { dir, sha } = mkRepo()
  git(dir, 'checkout', '-q', '-b', 'task/t7')
  const path = 'cli/package.json'
  const head = commitAll(dir, { [path]: render(path, '0.7.4') }, 'raise the cli')
  git(dir, 'checkout', '-q', 'main')
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', head)
  assert.equal(out.equal, false)
  assert.deepEqual(out.differs.map(d => [d.unit, d.path, d.base, d.head]), [['the cli', path, '0.7.3', '0.7.4']])
})

test('helper versions: the published branch is the base when it exists, not the start of the run', () => {
  const { dir, sha } = mkRepo()
  const path = 'ext/extension.json'
  const raised = commitAll(dir, { [path]: render(path, '0.4.5') }, 'an earlier epic raised the extension')
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha)
  // the run starts after the raise: against its start the versions are equal
  const out = versions(dir, '--branch', 'main', '--start', raised, '--head', 'HEAD')
  assert.equal(out.base, 'origin/main')
  assert.deepEqual(out.differs.map(d => [d.unit, d.base, d.head]), [['the extension', '0.4.4', '0.4.5']])
})

test('helper versions: a start that already differs from the published branch is named — a release step not pushed yet', () => {
  const { dir, sha } = mkRepo()
  const path = 'ext/extension.json'
  const released = commitAll(dir, { [path]: render(path, '0.4.5') }, 'the release step')
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha)
  const out = versions(dir, '--branch', 'main', '--start', released, '--head', 'HEAD')
  assert.deepEqual(out.start_differs, [{ unit: 'the extension', path, base: '0.4.4', head: '0.4.5' }])
  assert.equal(out.start_behind, false, 'the start is ahead of the published branch')
  // pushed: the start equals the published branch again
  git(dir, 'update-ref', 'refs/remotes/origin/main', released)
  const pushed = versions(dir, '--branch', 'main', '--start', released, '--head', 'HEAD')
  assert.deepEqual([pushed.start_differs, pushed.start_behind], [[], false])
})

test('helper versions: a start behind the published branch is named behind, never an unpushed release', () => {
  const { dir, sha } = mkRepo()
  const path = 'ext/extension.json'
  // the release was pushed from another checkout and fetched; the local branch did not follow
  const released = commitAll(dir, { [path]: render(path, '0.4.5') }, 'the release step, elsewhere')
  git(dir, 'update-ref', 'refs/remotes/origin/main', released)
  git(dir, 'reset', '-q', '--hard', sha)
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD')
  assert.equal(out.start_behind, true)
  assert.deepEqual(out.start_differs, [], 'nothing to push: the start is behind')
  assert.deepEqual(out.differs.map(d => [d.unit, d.base, d.head]), [['the extension', '0.4.5', '0.4.4']])
})

test('helper versions: a start diverged from the published branch is named behind too', () => {
  const { dir, sha } = mkRepo()
  const path = 'ext/extension.json'
  const released = commitAll(dir, { [path]: render(path, '0.4.5') }, 'the release step, elsewhere')
  git(dir, 'reset', '-q', '--hard', sha)
  const local = commitAll(dir, { 'docs/notes.md': 'local work\n' }, 'local work')
  git(dir, 'update-ref', 'refs/remotes/origin/main', released)
  const out = versions(dir, '--branch', 'main', '--start', local, '--head', 'HEAD')
  assert.deepEqual([out.start_behind, out.start_differs], [true, []])
})

test('helper versions: without a published branch the start is never behind', () => {
  const { dir, sha } = mkRepo()
  assert.equal(versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD').start_behind, false)
})

test('helper versions: a carrier unreadable on both sides is listed as unreadable and is not equal', () => {
  const { dir, sha } = mkRepo()
  const path = 'ui/src/cli.ts'
  const odd = "export const CLI_VERSION: string = '0.7.3'\n"
  git(dir, 'update-ref', 'refs/remotes/origin/main', commitAll(dir, { [path]: odd }, 'a new form of the constant'))
  commitAll(dir, { [path]: odd.replace('0.7.3', '0.7.4') }, 'raise')
  const out = versions(dir, '--branch', 'main', '--start', sha, '--head', 'HEAD')
  assert.deepEqual(out.unreadable, [path])
  assert.deepEqual(out.differs, [])
  assert.equal(out.equal, false)
})

test('helper versions: a base that does not resolve is an error object, never a pass', () => {
  const { dir } = mkRepo()
  const out = versions(dir, '--branch', 'main', '--start', 'deadbeef', '--head', 'HEAD')
  assert.equal(typeof out.error, 'string')
  assert.match(out.error, /deadbeef/)
  assert.equal(out.equal, undefined)
})

test('helper versions: --branch and --start are required', () => {
  const r = spawnSync(process.execPath, [HELPER, 'versions', '--branch', 'main'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /versions requires --branch <name> and --start <sha>/)
})
