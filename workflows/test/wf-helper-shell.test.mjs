// The shell the gate commands run in. Plans write their check commands in sh
// syntax; on Windows `shell: true` means cmd.exe, so there the helper runs them
// through the bash of Git for Windows and refuses when it finds none.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GIT_BASH_MISSING, gateShell, runGate, shellInvocation } from '../wf-helper.mjs'

const HELPER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'wf-helper.mjs')
const SH_CMD = 'FOO=1 sh -c \'test "$FOO" = 1\' && printf "%s" "$(echo ok)"; test -z "$FOO"'
const GIT_BASH = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
const OWN_BASH = 'D:\\tools\\git\\bin\\bash.exe'
const only = (...files) => p => files.includes(p)

test('shell: on POSIX the command still goes to sh through shell: true, verbatim', () => {
  for (const platform of ['darwin', 'linux']) {
    const shell = gateShell({ platform, env: { PATH: '/usr/bin:/bin' }, isFile: () => true })
    assert.deepEqual(shell, { bash: null })
    assert.deepEqual(shellInvocation(shell, SH_CMD), { file: SH_CMD, args: null, options: { shell: true } })
  }
})

test('shell: on win32 an sh command goes to bash with -c, never through shell: true', () => {
  const shell = gateShell({ platform: 'win32', env: { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\usr\\bin' }, isFile: only(GIT_BASH) })
  assert.deepEqual(shell, { bash: GIT_BASH })
  assert.deepEqual(shellInvocation(shell, SH_CMD), { file: GIT_BASH, args: ['-c', SH_CMD], options: {} })
})

test('shell: on win32 CLAUDE_CODE_GIT_BASH_PATH wins over a bash on PATH', () => {
  const env = { CLAUDE_CODE_GIT_BASH_PATH: OWN_BASH, PATH: 'C:\\Program Files\\Git\\usr\\bin' }
  assert.deepEqual(gateShell({ platform: 'win32', env, isFile: only(GIT_BASH, OWN_BASH) }), { bash: OWN_BASH })
})

test('shell: on win32 a CLAUDE_CODE_GIT_BASH_PATH that names no file falls back to PATH', () => {
  const env = { CLAUDE_CODE_GIT_BASH_PATH: OWN_BASH, PATH: 'C:\\Program Files\\Git\\usr\\bin' }
  assert.deepEqual(gateShell({ platform: 'win32', env, isFile: only(GIT_BASH) }), { bash: GIT_BASH })
})

test('shell: on win32 PATH is read under any letter case, quoted entries included', () => {
  const env = { Path: 'C:\\nothing;;"C:\\Program Files\\Git\\usr\\bin"' }
  assert.deepEqual(gateShell({ platform: 'win32', env, isFile: only(GIT_BASH) }), { bash: GIT_BASH })
})

test('shell: on win32 without bash the gate is refused with one line and one action', () => {
  assert.equal(GIT_BASH_MISSING,
    'Git Bash not found: install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe')
  for (const env of [{}, { PATH: 'C:\\Windows\\System32' }, { CLAUDE_CODE_GIT_BASH_PATH: OWN_BASH, PATH: '' }])
    assert.deepEqual(gateShell({ platform: 'win32', env, isFile: () => false }), { error: GIT_BASH_MISSING })
})

// The production path end to end: the bash the win32 lookup resolves is the one
// the gate spawns, with -c and the command as one argument. A recording stand-in
// for bash.exe hands the command on to the real sh.
const notOnWindows = { skip: process.platform === 'win32' && 'the stand-in for bash.exe is an sh script' }
test('gate: the resolved bash runs the sh command with -c and its exit decides the colour', notOnWindows, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfh-shell-'))
  const log = join(dir, 'argv.log')
  const bash = join(dir, 'bash.exe')
  writeFileSync(bash, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nexec /bin/sh "$@"\n`)
  chmodSync(bash, 0o755)
  const shell = gateShell({ platform: 'win32', env: { CLAUDE_CODE_GIT_BASH_PATH: bash } })
  assert.deepEqual(shell, { bash })

  assert.deepEqual(runGate(dir, [SH_CMD], shell), { green: true, tail: '' })
  assert.equal(readFileSync(log, 'utf8'), '-c\n' + SH_CMD + '\n')

  const red = runGate(dir, ['echo broken; exit 3'], shell)
  assert.equal(red.green, false)
  assert.equal(red.tail, 'broken')
})

// On Windows itself (the windows-latest job) the subcommands take the real road.
const helper = (env, ...argv) => {
  const r = spawnSync(process.execPath, [HELPER, ...argv], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, 'exit 0 expected, stderr: ' + r.stderr)
  return JSON.parse(r.stdout)
}
const onWindows = { skip: process.platform !== 'win32' && 'runs on Windows only' }

test('gate (win32): an sh command runs through Git Bash and is GREEN', onWindows, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfh-shell-'))
  assert.deepEqual(helper(process.env, 'gate', '--dir', dir, '--commands', JSON.stringify([SH_CMD])),
    { gate: 'GREEN', red_summary: '' })
})

test('gate and merge (win32): no Git Bash -> the refusal, never a RED', onWindows, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfh-shell-'))
  const env = { SystemRoot: process.env.SystemRoot, PATH: '' }
  assert.deepEqual(helper(env, 'gate', '--dir', dir, '--commands', JSON.stringify(['true'])), { error: GIT_BASH_MISSING })
  const queue = join(dir, 'queue.json')
  writeFileSync(queue, '[]')
  assert.deepEqual(helper(env, 'merge', '--queue', queue, '--gate-dir', dir, '--gate-commands', '["true"]'),
    { error: GIT_BASH_MISSING })
})
