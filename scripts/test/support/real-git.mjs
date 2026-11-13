// The full path of the real git, for tests that put a logging stand-in for
// git first on PATH and have it run the real one. Found on PATH without a
// shell: `command -v` needs /bin/sh, which Windows has not, and the lookup runs
// when a test file loads.
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export function realGit() {
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const file = join(dir, name)
    try {
      if (!statSync(file).isFile()) continue
      accessSync(file, constants.X_OK)
      return file
    } catch (_) {
      // not here
    }
  }
  throw new Error('git is not on PATH: install git to run these tests')
}
