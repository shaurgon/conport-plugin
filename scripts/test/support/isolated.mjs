// Folders and environments for tests that read ConPort project settings.
// A test that resolves settings inside this repository would read the
// repository's own .conport.json instead of what the test set up, so every
// such test runs in a temporary folder outside it, and the environment names
// the repository in CONPORT_SETTINGS_FORBID_ROOT: a reader that still finds a
// root inside it refuses instead of answering from the wrong file.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// support → test → scripts → conport-plugin → plugins → the repository.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

const made = []
process.on('exit', () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (_) {
      // A folder still in use is left to the OS temp cleanup.
    }
  }
})

function tempDir(prefix) {
  // The real path: git answers with it, and a temp root behind a symlink
  // (as on macOS) would otherwise not compare equal.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

// A new temporary folder outside the repository holding `files`, a map of
// relative path to text. Removed when the test process exits.
export function isolatedDir(files = {}) {
  const dir = tempDir('conport-settings-')
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return dir
}

// A copy of process.env for a settings reader under test: no project from the
// calling shell (CONPORT_PROJECT_NAME, CONPORT_PROJECT_ID), no session root a
// calling harness set (CLAUDE_PROJECT_DIR) and no git variables a calling hook
// exported, the repository forbidden as a settings root, the user config,
// Claude Code's settings (CLAUDE_CONFIG_DIR, so no plugin the machine has
// installed is seen) and plugin data folders in fresh temporary folders, and
// every time budget of the hooks stretched (HOOK_TIME_SCALE). `extra` is laid
// over the result.
const DROPPED = new Set(['CONPORT_PROJECT_NAME', 'CONPORT_PROJECT_ID', 'CLAUDE_PROJECT_DIR'])
// A hook budget (hook-time.js) is wall-clock time: on a busy machine a pause
// of a few seconds spent a 500 ms or a 6 s budget before a local stand-in
// could answer, and the hook took its outage path. Stretched twentyfold, a
// budget a test does not mean to spend outlasts any such pause; a test of a
// budget sets a scale of its own. The stretch counts because the environment
// also names CONPORT_SETTINGS_FORBID_ROOT, the mark of a test run.
export const HOOK_TIME_SCALE = '20'
export function isolatedEnv(extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (DROPPED.has(k) || k.startsWith('GIT_')) continue
    env[k] = v
  }
  env.CONPORT_SETTINGS_FORBID_ROOT = REPO_ROOT
  env.XDG_CONFIG_HOME = tempDir('conport-xdg-')
  env.CLAUDE_CONFIG_DIR = tempDir('conport-claude-')
  env.CLAUDE_PLUGIN_DATA = tempDir('conport-data-')
  env.CONPORT_HOOK_TIME_SCALE = HOOK_TIME_SCALE
  return { ...env, ...extra }
}
