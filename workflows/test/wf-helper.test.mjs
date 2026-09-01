import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStatusPaths, timeoutMs } from '../wf-helper.mjs'

const HELPER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'wf-helper.mjs')

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
const gitTry = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })

// A throwaway repository: main with one commit, deterministic identity, no remote.
const mkRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfh-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'wf@example.test')
  git(dir, 'config', 'user.name', 'wf')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  git(dir, 'add', 'base.txt')
  git(dir, 'commit', '-m', 'init')
  return dir
}

// A branch off main that writes `content` into `file`; returns its head sha.
const mkBranch = (dir, branch, file, content) => {
  git(dir, 'checkout', '-q', '-b', branch)
  writeFileSync(join(dir, file), content)
  git(dir, 'add', file)
  git(dir, 'commit', '-m', 'work on ' + branch)
  const sha = git(dir, 'rev-parse', 'HEAD').trim()
  git(dir, 'checkout', '-q', 'main')
  return sha
}

const runEnv = (cwd, env, ...argv) => {
  const r = spawnSync(process.execPath, [HELPER, ...argv], { cwd, env, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
const run = (cwd, ...argv) => runEnv(cwd, process.env, ...argv)
const runJson = (cwd, ...argv) => {
  const r = run(cwd, ...argv)
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  return JSON.parse(r.stdout)
}

// ------------------------------------------------------------------ preflight

test('preflight: clean tree reports clean, both branch names and the head sha', () => {
  const dir = mkRepo()
  const out = runJson(dir, 'preflight')
  assert.equal(out.clean, true)
  assert.deepEqual(out.dirty_paths, [])
  assert.equal(out.branch, 'main')
  assert.equal(out.current_branch, 'main')
  assert.equal(out.main_sha, git(dir, 'rev-parse', 'HEAD').trim())
})

test('preflight: dirty tree reports the dirty paths', () => {
  const dir = mkRepo()
  writeFileSync(join(dir, 'base.txt'), 'changed\n')
  writeFileSync(join(dir, 'new.txt'), 'new\n')
  const out = runJson(dir, 'preflight')
  assert.equal(out.clean, false)
  assert.deepEqual(out.dirty_paths.sort(), ['base.txt', 'new.txt'])
})

test('preflight: aborts the MERGE_HEAD debris of an interrupted run', () => {
  const dir = mkRepo()
  mkBranch(dir, 'other', 'base.txt', 'theirs\n')
  writeFileSync(join(dir, 'base.txt'), 'ours\n')
  git(dir, 'commit', '-am', 'ours')
  const conflicted = gitTry(dir, 'merge', '--no-ff', 'other')
  assert.notEqual(conflicted.status, 0, 'the fixture must leave a real conflicted merge')
  assert.ok(existsSync(join(dir, '.git', 'MERGE_HEAD')))

  const out = runJson(dir, 'preflight')
  assert.equal(existsSync(join(dir, '.git', 'MERGE_HEAD')), false, 'MERGE_HEAD must be gone')
  assert.equal(out.clean, true)
  assert.equal(out.current_branch, 'main')
})

test('preflight: the default branch is read from origin/HEAD, not from the checkout', () => {
  const origin = mkRepo()
  git(origin, 'branch', '-m', 'main', 'trunk')
  const dir = mkdtempSync(join(tmpdir(), 'wfh-clone-'))
  git(dirname(dir), 'clone', '-q', origin, dir)
  git(dir, 'config', 'user.email', 'wf@example.test')
  git(dir, 'config', 'user.name', 'wf')
  git(dir, 'checkout', '-q', '-b', 'side')
  const out = runJson(dir, 'preflight')
  assert.equal(out.branch, 'trunk')
  assert.equal(out.current_branch, 'side')
})

// ------------------------------------------------- stderr must not be data

test('parseStatusPaths: only porcelain stdout may reach it', () => {
  assert.deepEqual(parseStatusPaths(' M base.txt\n?? new.txt\n'), ['base.txt', 'new.txt'])
  assert.deepEqual(parseStatusPaths(''), [])
  // What folding stderr into stdout would do: a warning parses as a bogus path.
  assert.deepEqual(
    parseStatusPaths("warning: could not open directory 'x': Permission denied\n"),
    ['ning: could not open directory \'x\': Permission denied'])
})

// A git wrapper first on PATH that warns on stderr and still exits 0.
const noisyGitEnv = () => {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  const bin = mkdtempSync(join(tmpdir(), 'wfh-bin-'))
  writeFileSync(join(bin, 'git'),
    `#!/bin/sh\necho "warning: could not open directory 'nope': Permission denied" >&2\nexec ${real} "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  return { ...process.env, PATH: bin + ':' + process.env.PATH }
}

test('preflight: git warnings on stderr are not read as data', () => {
  const dir = mkRepo()
  const env = noisyGitEnv()
  const noisy = spawnSync('git', ['status', '--porcelain'], { cwd: dir, env, encoding: 'utf8' })
  assert.equal(noisy.status, 0)
  assert.match(noisy.stderr, /warning: could not open directory/, 'the fixture must warn on stderr')

  const r = runEnv(dir, env, 'preflight')
  assert.equal(r.code, 0, 'stderr: ' + r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.clean, true, 'dirty_paths: ' + JSON.stringify(out.dirty_paths))
  assert.deepEqual(out.dirty_paths, [])
  assert.equal(out.branch, 'main')
  assert.equal(out.current_branch, 'main')
  assert.equal(out.main_sha, git(dir, 'rev-parse', 'HEAD').trim())
})

// ---------------------------------------------------------------------- gate

test('gate: all commands succeed -> GREEN', () => {
  const dir = mkRepo()
  const out = runJson(dir, 'gate', '--dir', dir, '--commands', JSON.stringify(['true', 'echo ok']))
  assert.equal(out.gate, 'GREEN')
})

test('gate: the first failing command turns the gate RED with the last 30 lines', () => {
  const dir = mkRepo()
  const cmds = ['true', 'for i in $(seq 1 50); do echo line$i; done; exit 1', 'echo unreached']
  const out = runJson(dir, 'gate', '--dir', dir, '--commands', JSON.stringify(cmds))
  assert.equal(out.gate, 'RED')
  const lines = out.red_summary.split('\n')
  assert.equal(lines.length, 30)
  assert.equal(lines[29], 'line50')
  assert.equal(lines[0], 'line21')
  assert.ok(!out.red_summary.includes('unreached'), 'commands after the first failure must not run')
})

test('gate: secret values are masked in red_summary', () => {
  const dir = mkRepo()
  const cmds = ['echo "MY_SECRET=hunter2"; echo "API_TOKEN=abc123"; echo "PLAIN=visible"; exit 1']
  const out = runJson(dir, 'gate', '--dir', dir, '--commands', JSON.stringify(cmds))
  assert.equal(out.gate, 'RED')
  assert.ok(!out.red_summary.includes('hunter2'), 'secret value leaked: ' + out.red_summary)
  assert.ok(!out.red_summary.includes('abc123'), 'token value leaked: ' + out.red_summary)
  assert.ok(out.red_summary.includes('MY_SECRET=***'))
  assert.ok(out.red_summary.includes('API_TOKEN=***'))
  assert.ok(out.red_summary.includes('PLAIN=visible'), 'non-secret output must survive')
})

test('gate: a masked value never bleeds past its own line or its quotes', () => {
  const dir = mkRepo()
  const cmds = ['echo "API_TOKEN="; echo keepme; echo \'MY_SECRET="hunter two"\'; exit 1']
  const out = runJson(dir, 'gate', '--dir', dir, '--commands', JSON.stringify(cmds))
  assert.equal(out.gate, 'RED')
  assert.ok(out.red_summary.includes('keepme'), 'the next line must survive: ' + out.red_summary)
  assert.ok(out.red_summary.includes('MY_SECRET=***'), 'quoted secret: ' + out.red_summary)
  assert.ok(!out.red_summary.includes('hunter'), 'quoted secret leaked: ' + out.red_summary)
  assert.ok(!out.red_summary.includes('two'), 'the tail of a quoted secret leaked: ' + out.red_summary)
})

// A JSON list in a file outside the repository; the --*-file flag form.
const listFile = entries => {
  const p = join(mkdtempSync(join(tmpdir(), 'wfh-l-')), 'list.json')
  writeFileSync(p, JSON.stringify(entries))
  return p
}

test('gate: --commands-file is accepted, a missing file exits 2', () => {
  const dir = mkRepo()
  const out = runJson(dir, 'gate', '--dir', dir, '--commands-file', listFile(['true', 'echo ok']))
  assert.equal(out.gate, 'GREEN')
  assert.equal(run(dir, 'gate', '--dir', dir, '--commands-file', join(dir, 'no-such.json')).code, 2)
})

test('gate: the commands run in --dir', () => {
  const dir = mkRepo()
  const sub = join(dir, 'sub')
  mkdirSync(sub)
  const out = runJson(dir, 'gate', '--dir', sub, '--commands', JSON.stringify(['test "$(basename "$PWD")" = sub']))
  assert.equal(out.gate, 'GREEN')
})

// --------------------------------------------------------------------- merge

// The queue lives outside the repository — an untracked file inside it would be dirt.
const queueFile = entries => {
  const p = join(mkdtempSync(join(tmpdir(), 'wfh-q-')), 'queue.json')
  writeFileSync(p, JSON.stringify(entries))
  return p
}
const mergeRun = (dir, queue, commands, ...extra) =>
  runJson(dir, 'merge', '--queue', queueFile(queue), '--gate-dir', dir,
    '--gate-commands', JSON.stringify(commands), ...extra)

test('merge: a green branch is merged with the prescribed commit message', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['MERGED'])
  assert.equal(out.results[0].merge_sha, git(dir, 'rev-parse', 'HEAD').trim())
  assert.match(git(dir, 'log', '-1', '--pretty=%s').trim(), /^merge task-1: first$/)
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('merge: an already merged branch is not re-merged and reports ALREADY_MERGED', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  git(dir, 'merge', '--no-ff', '-m', 'pre-merged', 'task/t1')
  const before = git(dir, 'rev-parse', 'HEAD').trim()
  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['ALREADY_MERGED'])
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), before, 'nothing may be committed')
})

test('merge: a conflicting branch is aborted and reported with its conflicted files', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'base.txt', 'theirs\n')
  writeFileSync(join(dir, 'base.txt'), 'ours\n')
  git(dir, 'commit', '-am', 'ours')
  const before = git(dir, 'rev-parse', 'HEAD').trim()
  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['CONFLICT'])
  assert.deepEqual(out.results[0].conflict_files, ['base.txt'])
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), before)
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the merge must be aborted')
})

test('merge: a red gate aborts the merge, reports GATE_RED and continues with the next branch', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const sha2 = mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  // red only while a.txt is in the tree -> the first branch fails the gate, the second passes
  const out = mergeRun(dir, [
    { id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' },
    { id: 2, branch: 'task/t2', head_sha: sha2, title: 'second' },
  ], ['! test -f a.txt'])
  assert.deepEqual(out.results.map(r => r.status), ['GATE_RED', 'MERGED'])
  assert.equal(git(dir, 'log', '--pretty=%s', '-1').trim(), 'merge task-2: second')
  assert.equal(existsSync(join(dir, 'a.txt')), false, 'the red merge must be rolled back')
})

test('merge: GATE_RED carries the last 30 masked red lines', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }],
    ['for i in $(seq 1 50); do echo line$i; done; echo "DB_PASSWORD=swordfish"; exit 1'])
  assert.equal(out.results[0].status, 'GATE_RED')
  const lines = out.results[0].gate_tail.split('\n')
  assert.equal(lines.length, 30)
  assert.equal(lines[28], 'line50')
  assert.equal(lines[29], 'DB_PASSWORD=***')
  assert.ok(!out.results[0].gate_tail.includes('swordfish'))
})

test('merge: a red gate on an already merged branch stops the batch with RED_BASELINE', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const sha2 = mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  git(dir, 'merge', '--no-ff', '-m', 'pre-merged', 'task/t1')
  const before = git(dir, 'rev-parse', 'HEAD').trim()
  const out = mergeRun(dir, [
    { id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' },
    { id: 2, branch: 'task/t2', head_sha: sha2, title: 'second' },
  ], ['echo broken >&2; exit 1'])
  assert.deepEqual(out.results.map(r => r.status), ['RED_BASELINE', 'NOT_MERGED'])
  assert.ok(out.results[0].gate_tail.includes('broken'))
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), before, 'no branch may be merged after a red baseline')
})

test('merge: a dirty tree stops the batch with DIRTY_ABORTED and fills the rest with NOT_MERGED', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const sha2 = mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  writeFileSync(join(dir, 'base.txt'), 'uncommitted\n')
  const out = mergeRun(dir, [
    { id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' },
    { id: 2, branch: 'task/t2', head_sha: sha2, title: 'second' },
  ], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['DIRTY_ABORTED', 'NOT_MERGED'])
  assert.ok(out.results[0].gate_tail.includes('base.txt'))
})

test('merge: MERGE_HEAD debris left by an interrupted run is aborted and the batch proceeds', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  mkBranch(dir, 'debris', 'base.txt', 'theirs\n')
  writeFileSync(join(dir, 'base.txt'), 'ours\n')
  git(dir, 'commit', '-am', 'ours')
  assert.notEqual(gitTry(dir, 'merge', '--no-ff', 'debris').status, 0)
  assert.ok(existsSync(join(dir, '.git', 'MERGE_HEAD')))

  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' }], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['MERGED'])
})

test('merge --state-only: reads the state without merging anything', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const sha2 = mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  git(dir, 'merge', '--no-ff', '-m', 'pre-merged', 'task/t1')
  const before = git(dir, 'rev-parse', 'HEAD').trim()
  const out = mergeRun(dir, [
    { id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' },
    { id: 2, branch: 'task/t2', head_sha: sha2, title: 'second' },
  ], ['true'], '--state-only')
  assert.deepEqual(out.results.map(r => r.status), ['ALREADY_MERGED', 'NOT_MERGED'])
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), before, 'state-only must not merge')
})

test('merge --state-only: a red gate marks the first NOT_MERGED entry RED_BASELINE', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const sha2 = mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  const sha3 = mkBranch(dir, 'task/t3', 'c.txt', 'c\n')
  git(dir, 'merge', '--no-ff', '-m', 'pre-merged', 'task/t1')
  const out = mergeRun(dir, [
    { id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' },
    { id: 2, branch: 'task/t2', head_sha: sha2, title: 'second' },
    { id: 3, branch: 'task/t3', head_sha: sha3, title: 'third' },
  ], ['echo baseline broken; exit 1'], '--state-only')
  assert.deepEqual(out.results.map(r => r.status), ['ALREADY_MERGED', 'RED_BASELINE', 'NOT_MERGED'])
  assert.ok(out.results[1].gate_tail.includes('baseline broken'))
  assert.equal(out.results[2].gate_tail, '')
})

test('merge --state-only: MERGE_HEAD debris is the only mutation it performs', () => {
  const dir = mkRepo()
  const sha1 = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  mkBranch(dir, 'debris', 'base.txt', 'theirs\n')
  writeFileSync(join(dir, 'base.txt'), 'ours\n')
  git(dir, 'commit', '-am', 'ours')
  assert.notEqual(gitTry(dir, 'merge', '--no-ff', 'debris').status, 0)
  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha1, title: 'first' }], ['true'], '--state-only')
  assert.equal(existsSync(join(dir, '.git', 'MERGE_HEAD')), false)
  assert.deepEqual(out.results.map(r => r.status), ['NOT_MERGED'])
})

test('merge: --gate-commands-file is accepted, a missing file exits 2', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const queue = queueFile([{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }])
  const out = runJson(dir, 'merge', '--queue', queue, '--gate-dir', dir,
    '--gate-commands-file', listFile(['true']))
  assert.deepEqual(out.results.map(r => r.status), ['MERGED'])
  assert.equal(run(dir, 'merge', '--queue', queue, '--gate-dir', dir,
    '--gate-commands-file', join(dir, 'no-such.json')).code, 2)
})

test('merge: a refused commit is red and says so in gate_tail', () => {
  const dir = mkRepo()
  const sha = mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  // Outside the working tree: an untracked hooks directory would read as dirt.
  const hooks = mkdtempSync(join(tmpdir(), 'wfh-hooks-'))
  git(dir, 'config', 'core.hooksPath', hooks)      // a global hooksPath would win otherwise
  // commit-msg, not pre-commit: git skips pre-commit for a merge commit.
  writeFileSync(join(hooks, 'commit-msg'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n')
  chmodSync(join(hooks, 'commit-msg'), 0o755)
  const before = git(dir, 'rev-parse', 'HEAD').trim()

  const out = mergeRun(dir, [{ id: 1, branch: 'task/t1', head_sha: sha, title: 'first' }], ['true'])
  assert.deepEqual(out.results.map(r => r.status), ['GATE_RED'])
  assert.ok(out.results[0].gate_tail.startsWith('commit refused: '),
    'gate_tail: ' + out.results[0].gate_tail)
  assert.ok(out.results[0].gate_tail.includes('hook says no'))
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), before, 'nothing may be committed')
})

// ------------------------------------------------------------------- cleanup

test('cleanup: deletes the merged branches and keeps every other one', () => {
  const dir = mkRepo()
  mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  mkBranch(dir, 'task/t2', 'b.txt', 'b\n')
  git(dir, 'merge', '--no-ff', '-m', 'm1', 'task/t1')
  const out = runJson(dir, 'cleanup', '--merged', JSON.stringify(['task/t1']), '--worktrees', '[]')
  assert.deepEqual(out.deleted, ['task/t1'])
  assert.deepEqual(out.errors, [])
  const branches = git(dir, 'branch', '--format=%(refname:short)').trim().split('\n')
  assert.deepEqual(branches.sort(), ['main', 'task/t2'])
})

test('cleanup: removes an existing worktree and prunes', () => {
  const dir = mkRepo()
  mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  const wt = join(dir, 'wt-child')
  git(dir, 'worktree', 'add', wt, 'task/t1')
  assert.ok(existsSync(wt))
  const out = runJson(dir, 'cleanup', '--merged', '[]', '--worktrees', JSON.stringify([wt]))
  assert.deepEqual(out.worktrees_removed, [wt])
  assert.equal(existsSync(wt), false)
  assert.deepEqual(out.errors, [])
  assert.ok(!git(dir, 'worktree', 'list').includes('wt-child'))
})

test('cleanup: a failing item lands in errors without stopping the rest', () => {
  const dir = mkRepo()
  mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  git(dir, 'merge', '--no-ff', '-m', 'm1', 'task/t1')
  const out = runJson(dir, 'cleanup',
    '--merged', JSON.stringify(['task/nope', 'task/t1']),
    '--worktrees', JSON.stringify([join(dir, 'no-such-worktree')]))
  assert.deepEqual(out.deleted, ['task/t1'], 'the healthy branch is still deleted')
  assert.equal(out.errors.length, 1)
  assert.ok(out.errors[0].includes('task/nope'), 'errors: ' + JSON.stringify(out.errors))
  assert.deepEqual(out.worktrees_removed, [], 'a missing worktree path is skipped, not an error')
  assert.deepEqual(out.kept, [])
})

// The janitor step of a run hands over exactly the branches and the worktrees of
// that run, so a merged branch is normally still checked out in a worktree of the
// same call. Deleting the branch first refuses with "used by worktree at ..." and
// the whole batch lands in errors; the worktrees have to go first.
test('cleanup: deletes a branch whose worktree is removed in the same call', () => {
  const dir = mkRepo()
  mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  git(dir, 'merge', '--no-ff', '-m', 'm1', 'task/t1')
  const wt = join(dir, 'wt-child')
  git(dir, 'worktree', 'add', wt, 'task/t1')
  const mergedFile = join(dir, 'merged.json')
  const worktreesFile = join(dir, 'worktrees.json')
  writeFileSync(mergedFile, JSON.stringify(['task/t1']))
  writeFileSync(worktreesFile, JSON.stringify([wt]))

  const out = runJson(dir, 'cleanup', '--merged-file', mergedFile, '--worktrees-file', worktreesFile)
  assert.deepEqual(out.errors, [])
  assert.deepEqual(out.deleted, ['task/t1'])
  assert.deepEqual(out.worktrees_removed, [wt])
  assert.equal(existsSync(wt), false)
  const branches = git(dir, 'branch', '--format=%(refname:short)').trim().split('\n')
  assert.deepEqual(branches.sort(), ['main'])
})

// The other door to the same production symptom: a worktree directory removed by
// hand or by a crashed run is skipped by the existsSync guard, so nothing calls
// `git worktree remove` for it and its administrative entry still holds the
// branch. Only the `git worktree prune` between the two loops drops that stale
// entry; without it `git branch -D` refuses with "used by worktree at ...".
test('cleanup: deletes a branch whose worktree directory vanished before the call', () => {
  const dir = mkRepo()
  mkBranch(dir, 'task/t1', 'a.txt', 'a\n')
  git(dir, 'merge', '--no-ff', '-m', 'm1', 'task/t1')
  const wt = join(dir, 'wt-child')
  git(dir, 'worktree', 'add', wt, 'task/t1')
  rmSync(wt, { recursive: true, force: true })     // crashed run: directory gone, entry stale
  assert.equal(existsSync(wt), false)
  const mergedFile = join(dir, 'merged.json')
  const worktreesFile = join(dir, 'worktrees.json')
  writeFileSync(mergedFile, JSON.stringify(['task/t1']))
  writeFileSync(worktreesFile, JSON.stringify([wt]))

  const out = runJson(dir, 'cleanup', '--merged-file', mergedFile, '--worktrees-file', worktreesFile)
  assert.deepEqual(out.errors, [])
  assert.deepEqual(out.deleted, ['task/t1'])
  assert.deepEqual(out.worktrees_removed, [], 'the path is gone: nothing to remove')
  const branches = git(dir, 'branch', '--format=%(refname:short)').trim().split('\n')
  assert.deepEqual(branches.sort(), ['main'])
})

// ------------------------------------------------------------------ dispatch

test('invoked through a symlink it still dispatches and prints JSON', () => {
  const dir = mkRepo()
  const link = join(mkdtempSync(join(tmpdir(), 'wfh-link-')), 'link.mjs')
  symlinkSync(HELPER, link)
  const r = spawnSync(process.execPath, [link, 'preflight'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, 'exit 0 expected, stderr: ' + r.stderr)
  assert.ok(r.stdout.trim().length > 0, 'stdout must not be empty when run via a symlink')
  const out = JSON.parse(r.stdout)
  assert.equal(out.clean, true)
})

// --------------------------------------------------------------------- usage

test('usage errors exit 2', () => {
  const dir = mkRepo()
  assert.equal(run(dir).code, 2)
  assert.equal(run(dir, 'nonsense').code, 2)
  assert.equal(run(dir, 'gate', '--dir', dir, '--commands', 'not json').code, 2)
  assert.equal(run(dir, 'gate', '--dir', dir).code, 2)
})

// ------------------------------------------------------------------- timeout

// CONPORT_TIMEOUT_MS is an operator knob, so it will be set to nonsense sooner or
// later. Every unusable value must degrade to the 10000 default: falling back to
// 0 — or to no deadline at all — turns a silent server into a workflow that hangs
// instead of one that falls back on an error object.
test('an unusable CONPORT_TIMEOUT_MS degrades to the default, never to no deadline', () => {
  const DEFAULT = 10000
  const withEnv = value => {
    const had = 'CONPORT_TIMEOUT_MS' in process.env
    const before = process.env.CONPORT_TIMEOUT_MS
    if (value === undefined) delete process.env.CONPORT_TIMEOUT_MS
    else process.env.CONPORT_TIMEOUT_MS = value
    try { return timeoutMs() } finally {
      if (had) process.env.CONPORT_TIMEOUT_MS = before
      else delete process.env.CONPORT_TIMEOUT_MS
    }
  }

  for (const bad of [undefined, '', '   ', '0', '-5', 'abc', 'NaN', 'Infinity'])
    assert.equal(withEnv(bad), DEFAULT, `${JSON.stringify(bad)} must fall back to ${DEFAULT}`)

  assert.equal(withEnv('1500'), 1500, 'a usable override is honoured')
  assert.equal(withEnv('0.5'), 0.5, 'a small positive value is still a deadline')
})
