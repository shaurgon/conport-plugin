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
// exported, the repository forbidden as a settings root, and the user config
// and plugin data folders in fresh temporary folders. `extra` is laid over the
// result.
const DROPPED = new Set(['CONPORT_PROJECT_NAME', 'CONPORT_PROJECT_ID', 'CLAUDE_PROJECT_DIR'])
export function isolatedEnv(extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (DROPPED.has(k) || k.startsWith('GIT_')) continue
    env[k] = v
  }
  env.CONPORT_SETTINGS_FORBID_ROOT = REPO_ROOT
  env.XDG_CONFIG_HOME = tempDir('conport-xdg-')
  env.CLAUDE_PLUGIN_DATA = tempDir('conport-data-')
  return { ...env, ...extra }
}
