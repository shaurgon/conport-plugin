import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The version handshake: a helper served from a stale plugin cache is
// indistinguishable from a broken one by behavior alone, so the helper reports
// the plugin version it shipped with — `--version` prints it by hand, and every
// preflight report carries it as helper_version, which both workflows record in
// the run ledger's notes. These tests pin the whole chain: the stamp against
// the real manifest, its degradation to null, and the ledger lines in the
// shipped task.js and epic.js source.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const HELPER = join(WORKFLOWS, 'wf-helper.mjs')

// The version the handshake must report: the manifest next to the workflows
// directory — the same layout in the repository and in the installed cache.
const MANIFEST_VERSION =
  JSON.parse(readFileSync(join(dirname(WORKFLOWS), '.claude-plugin', 'plugin.json'), 'utf8')).version

const roots = []
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'wfver-')); roots.push(d); return d }

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })

// A throwaway repository: main with one commit, deterministic identity, no remote.
const mkRepo = () => {
  const dir = scratch()
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'wf@example.test')
  git(dir, 'config', 'user.name', 'wf')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  git(dir, 'add', 'base.txt')
  git(dir, 'commit', '-m', 'init')
  return dir
}

const runJson = (helper, cwd, ...argv) => {
  const r = spawnSync(process.execPath, [helper, ...argv], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, 'exit 0 expected, stderr: ' + r.stderr)
  return JSON.parse(r.stdout)
}

// A copy of the helper with no plugin manifest anywhere near it: the layout of
// a broken or torn cache entry. The handshake must degrade to null, not crash.
const orphanHelper = () => {
  const root = scratch()
  mkdirSync(join(root, 'workflows'))
  const path = join(root, 'workflows', 'wf-helper.mjs')
  writeFileSync(path, readFileSync(HELPER))
  return path
}

// ------------------------------------------------------------- the handshake

test('--version reports the version of the manifest the helper ships with', () => {
  assert.equal(typeof MANIFEST_VERSION, 'string', 'the plugin manifest carries a version')
  const out = runJson(HELPER, scratch(), '--version')
  assert.deepEqual(out, { version: MANIFEST_VERSION })
})

test('preflight stamps helper_version, so the run report carries the handshake', () => {
  const out = runJson(HELPER, mkRepo(), 'preflight')
  assert.equal(out.helper_version, MANIFEST_VERSION)
  assert.equal(out.clean, true, 'the stamp rides a real preflight answer')
})

test('no manifest next to the helper -> version null, never a crash', () => {
  const helper = orphanHelper()
  assert.deepEqual(runJson(helper, scratch(), '--version'), { version: null })
  assert.equal(runJson(helper, mkRepo(), 'preflight').helper_version, null)
})

// ------------------------------------------------------- the ledger's stamp

// The workflow runner evaluates task.js and epic.js with injected globals, so
// the carrying of the stamp into the ledger is asserted on the shipped source,
// the same way the via-stamp test pins its notes.
const source = file => readFileSync(join(WORKFLOWS, file), 'utf8')

// The exact line both control flows run right after a preflight answer exists —
// before any abort check, so even an aborted run's report names its helper.
const NOTE = `L.notes.push('helper_version:"' + (pre.helper_version ?? 'unknown') + '"')`

for (const file of ['task.js', 'epic.js']) {
  test(`${file}: the handshake reaches L.notes before the abort checks`, () => {
    const src = source(file)
    assert.ok(src.includes(NOTE), `the helper_version note is missing from ${file}`)
    assert.ok(src.indexOf(NOTE) > src.indexOf('ABORTED_PREFLIGHT'),
      'the note is written once a preflight answer exists')
    assert.ok(src.indexOf(NOTE) < src.indexOf('ABORTED_DIRTY'),
      'the note must precede the abort checks, or an aborted run loses the handshake')
  })

  test(`${file}: S_PRE accepts the helper_version stamp`, () => {
    assert.ok(source(file).includes(`helper_version: { type: ['string', 'null'] }`),
      `S_PRE must accept helper_version in ${file}, or validation may drop it`)
  })
}
