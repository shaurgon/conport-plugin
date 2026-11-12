// The commit guard of the PreToolUse(Bash) hook: with the Superpowers overlay
// on, a git commit that adds a new file under docs/superpowers/specs or
// docs/superpowers/plans is refused with the command that moves it to ConPort.
// Every repository is built under the OS temp dir, and the hook runs with a
// logging `git` first on PATH, so a test sees which git calls a command led to.
import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, existsSync, rmSync, writeFileSync, unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const ON = { conport: { superpowers: true } }
const SPECS = 'docs/superpowers/specs'
const PLANS = 'docs/superpowers/plans'

// Built once per run and shared: an empty global git config, a logging
// stand-in for git (a fresh executable per test would be scanned by the OS on
// its first run) and a repository with a first commit that every test copies.
const SHARED = realpathSync(mkdtempSync(join(tmpdir(), 'conport-guard-shared-')))
after(() => rmSync(SHARED, { recursive: true, force: true }))
writeFileSync(join(SHARED, 'gitconfig'), '')
mkdirSync(join(SHARED, 'bin'))
writeFileSync(join(SHARED, 'bin', 'git'),
  `#!/bin/sh\necho "$*" >> "$GUARD_TEST_GIT_LOG"\nexec '${REAL_GIT}' "$@"\n`)
chmodSync(join(SHARED, 'bin', 'git'), 0o755)
// A PATH with no git on it, and a git whose `status` fails while every other
// call goes through.
mkdirSync(join(SHARED, 'nogit'))
mkdirSync(join(SHARED, 'failstatus'))
writeFileSync(join(SHARED, 'failstatus', 'git'),
  `#!/bin/sh\nfor a in "$@"; do [ "$a" = status ] && exit 128; done\nexec '${REAL_GIT}' "$@"\n`)
chmodSync(join(SHARED, 'failstatus', 'git'), 0o755)

// An environment free of git and ConPort variables a calling shell may have
// exported, with no global or system git config, so every git command reads
// only the repository it is pointed at.
function cleanEnv(tmp, extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('CONPORT_') && k !== 'CLAUDE_PLUGIN_OPTION_API_KEY') env[k] = v
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(SHARED, 'gitconfig'),
    CLAUDE_PLUGIN_DATA: join(tmp, 'data'),
    ...extra,
  }
}

function git(tmp, dir, ...args) {
  return execFileSync(REAL_GIT, ['-C', dir, ...args], {
    env: cleanEnv(tmp), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function put(root, rel, text = 'x\n') {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

function commitAll(tmp, repo, message = 'c') {
  git(tmp, repo, 'add', '-A')
  git(tmp, repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', message)
}

const TEMPLATE = join(SHARED, 'repo')
mkdirSync(TEMPLATE)
git(SHARED, TEMPLATE, 'init', '-q')
put(TEMPLATE, 'README.md')
put(TEMPLATE, 'backend/notes.txt')
commitAll(SHARED, TEMPLATE, 'init')

const initRepo = (dir) => {
  cpSync(TEMPLATE, dir, { recursive: true })
  return dir
}

function overlayOn(root) {
  put(root, '.superpowers/config.json', JSON.stringify(ON))
}

// A temp directory with a repository at `<tmp>/repo`; the git calls the hook
// makes are logged to `<tmp>/git-calls`.
function withRepo(fn) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'conport-guard-')))
  const repo = initRepo(join(tmp, 'repo'))
  return Promise.resolve()
    .then(() => fn({ tmp, repo, log: join(tmp, 'git-calls') }))
    .finally(() => rmSync(tmp, { recursive: true, force: true }))
}

// The hook fed `{tool_input: {command}, cwd}` on stdin; `stdin` overrides the
// payload whole. The process itself runs in `procCwd` (default: tmp).
function runHook(tmp, { command, cwd, stdin, procCwd, env = {} }) {
  const payload = stdin !== undefined ? stdin : JSON.stringify({ tool_input: { command }, cwd })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, 'check-command.js')], {
      cwd: procCwd || tmp,
      env: cleanEnv(tmp, {
        PATH: `${join(SHARED, 'bin')}:${process.env.PATH}`, GUARD_TEST_GIT_LOG: join(tmp, 'git-calls'), ...env,
      }),
    })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, err }))
    child.stdin.end(payload)
  })
}

const gitCalls = (log) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
const statusCalls = (log) => gitCalls(log)
  .filter((l) => /^--no-optional-locks -C .+ status --porcelain -z --untracked-files=all -- /.test(l))

function assertRefusedSpec(res, file) {
  assert.equal(res.code, 2, res.err)
  assert.equal(res.err.trimEnd().split('\n').length, 1, 'the reason is one line')
  assert.ok(res.err.includes(`npx -y conport@^0.8.0 documents upload ${file} --doc-type spec`), res.err)
  assert.match(res.err, /remove the file/)
}

// The refusal names the spec and its epic, so the import neither leaves the
// plan without a spec nor starts a second epic; `doc-N` and `<id>` are left
// for the agent to fill.
function assertRefusedPlan(res, file) {
  assert.equal(res.code, 2, res.err)
  assert.equal(res.err, `BLOCKED: ${file} is a new Superpowers plan, and with the ConPort overlay on ` +
    `plans live in ConPort: run \`npx -y conport@^0.8.0 plan import ${file} --spec doc-N --epic <id>\` ` +
    "with doc-N the plan's spec and <id> the spec's epic, then remove the file.\n")
}

function assertAllowed(res) {
  assert.equal(res.code, 0, res.err)
  assert.equal(res.err, '')
}

// Every test builds its own temp directory, so they run side by side.
describe('commit guard', { concurrency: true }, () => {
  test('a staged new spec is refused with the upload command', () => withRepo(async ({ tmp, repo, log }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new-design.md`)
    git(tmp, repo, 'add', `${SPECS}/new-design.md`)
    const res = await runHook(tmp, { command: 'git commit -m "add spec"', cwd: repo })
    assertRefusedSpec(res, join(repo, SPECS, 'new-design.md'))
    assert.equal(statusCalls(log).length, 1)
  }))

  test('a staged new plan is refused with the plan import command', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${PLANS}/new-plan.md`)
    git(tmp, repo, 'add', `${PLANS}/new-plan.md`)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo })
    assertRefusedPlan(res, join(repo, PLANS, 'new-plan.md'))
  }))

  test('an untracked spec is refused when the command also runs git add', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/draft.md`)
    const res = await runHook(tmp, { command: 'git add . && git commit -m x', cwd: repo })
    assertRefusedSpec(res, join(repo, SPECS, 'draft.md'))
  }))

  test('an untracked spec passes a commit that runs no git add', () => withRepo(async ({ tmp, repo, log }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/draft.md`)
    const res = await runHook(tmp, { command: 'git commit -am x', cwd: repo })
    assertAllowed(res)
    assert.equal(statusCalls(log).length, 1, 'the commit was checked')
  }))

  test('cd into a subdirectory sees the paths from the worktree root', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/draft.md`)
    const res = await runHook(tmp, { command: 'cd backend && git add -A && git commit -m x', cwd: repo })
    assertRefusedSpec(res, join(repo, SPECS, 'draft.md'))
  }))

  test('git global options before commit are skipped and the commit is checked', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const command of [
      'git -c core.x=y commit -m x',
      `git --git-dir=${join(repo, '.git')} --work-tree=${repo} commit -m x`,
      'git --no-pager -c user.name=t commit -m x',
      'GIT_AUTHOR_NAME=t git commit -m x',
      'echo start; git commit -m x | cat',
    ]) {
      assertRefusedSpec(await runHook(tmp, { command, cwd: repo }), join(repo, SPECS, 'new.md'))
    }
  }))

  test('git -C <tree> commit is checked in that tree', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    const outside = join(tmp, 'outside')
    mkdirSync(outside)
    const abs = await runHook(tmp, { command: `git -C ${repo} commit -m x`, cwd: outside })
    assertRefusedSpec(abs, join(repo, SPECS, 'new.md'))
    const rel = await runHook(tmp, { command: 'git -C repo/backend commit -m x', cwd: tmp })
    assertRefusedSpec(rel, join(repo, SPECS, 'new.md'))
  }))

  test('cd <tree> && git commit is checked in that tree', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    // The session runs in another repository that has no overlay of its own.
    const other = initRepo(join(tmp, 'other'))
    assertAllowed(await runHook(tmp, { command: 'git commit -m x', cwd: other }))
    const res = await runHook(tmp, { command: `cd ${repo} && git commit -m x`, cwd: other })
    assertRefusedSpec(res, join(repo, SPECS, 'new.md'))
  }))

  test('a file renamed into the plans directory is refused', () => withRepo(async ({ tmp, repo }) => {
    put(repo, `${SPECS}/old.md`)
    commitAll(tmp, repo)
    overlayOn(repo)
    mkdirSync(join(repo, PLANS), { recursive: true })
    git(tmp, repo, 'mv', `${SPECS}/old.md`, `${PLANS}/moved.md`)
    assert.match(git(tmp, repo, 'status', '--porcelain', '--', SPECS, PLANS), /^R {2}/m)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo })
    assertRefusedPlan(res, join(repo, PLANS, 'moved.md'))
  }))

  test('a rename inside one guarded directory passes', () => withRepo(async ({ tmp, repo }) => {
    put(repo, `${PLANS}/old.md`)
    put(repo, `${SPECS}/old-design.md`)
    commitAll(tmp, repo)
    overlayOn(repo)
    git(tmp, repo, 'mv', `${PLANS}/old.md`, `${PLANS}/2026-old.md`)
    mkdirSync(join(repo, SPECS, 'archive'))
    git(tmp, repo, 'mv', `${SPECS}/old-design.md`, `${SPECS}/archive/old-design.md`)
    const status = git(tmp, repo, 'status', '--porcelain', '--', SPECS, PLANS)
    assert.equal(status.match(/^R {2}/gm).length, 2, status)
    assertAllowed(await runHook(tmp, { command: 'git commit -m archive', cwd: repo }))
  }))

  test('a file renamed into a guarded directory from outside is refused', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    mkdirSync(join(repo, PLANS), { recursive: true })
    git(tmp, repo, 'mv', 'backend/notes.txt', `${PLANS}/notes.md`)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo })
    assertRefusedPlan(res, join(repo, PLANS, 'notes.md'))
  }))

  test('a merge in progress commits the plan it brought in; without the merge the plan is refused', () => withRepo(async ({ tmp, repo }) => {
    git(tmp, repo, 'switch', '-q', '-c', 'side')
    put(repo, `${PLANS}/open-epic.md`)
    commitAll(tmp, repo, 'plan on side')
    git(tmp, repo, 'switch', '-q', '-')
    put(repo, 'README.md', 'main side\n')
    commitAll(tmp, repo, 'main moves')
    overlayOn(repo)
    git(tmp, repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', '--no-commit', 'side')
    assert.ok(existsSync(join(repo, '.git', 'MERGE_HEAD')))
    assert.match(git(tmp, repo, 'status', '--porcelain', '--', PLANS), /^A {2}/m)
    assertAllowed(await runHook(tmp, { command: 'git commit --no-edit', cwd: repo }))

    git(tmp, repo, 'merge', '--abort')
    git(tmp, repo, 'checkout', 'side', '--', `${PLANS}/open-epic.md`)
    assert.match(git(tmp, repo, 'status', '--porcelain', '--', PLANS), /^A {2}/m)
    assertRefusedPlan(await runHook(tmp, { command: 'git commit --no-edit', cwd: repo }),
      join(repo, PLANS, 'open-epic.md'))
  }))

  test('a merge in progress is found from a subdirectory the command moved into', () => withRepo(async ({ tmp, repo }) => {
    git(tmp, repo, 'switch', '-q', '-c', 'side')
    put(repo, `${PLANS}/open-epic.md`)
    commitAll(tmp, repo, 'plan on side')
    git(tmp, repo, 'switch', '-q', '-')
    put(repo, 'README.md', 'main side\n')
    commitAll(tmp, repo, 'main moves')
    overlayOn(repo)
    git(tmp, repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', '--no-commit', 'side')
    // From backend/ git names the head `../.git/MERGE_HEAD`: it is found only
    // when resolved against the directory the commit runs in.
    assert.equal(git(tmp, join(repo, 'backend'), 'rev-parse', '--git-path', 'MERGE_HEAD').trim(),
      join('..', '.git', 'MERGE_HEAD'))
    assertAllowed(await runHook(tmp, { command: 'cd backend && git commit --no-edit', cwd: repo }))
  }))

  test('a cherry-pick or revert in progress is seen in the git dir of its own worktree',() => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    const wt = join(tmp, 'linked')
    git(tmp, repo, 'worktree', 'add', '-q', '-b', 'linked', wt)
    put(wt, `${PLANS}/picked.md`)
    git(tmp, wt, 'add', `${PLANS}/picked.md`)
    const file = join(wt, PLANS, 'picked.md')
    const head = git(tmp, wt, 'rev-parse', 'HEAD')
    // A merge in progress in the main worktree is not the linked worktree's.
    writeFileSync(join(repo, '.git', 'MERGE_HEAD'), head)
    assertRefusedPlan(await runHook(tmp, { command: 'git commit -m x', cwd: wt }), file)
    for (const name of ['CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      const at = resolve(wt, git(tmp, wt, 'rev-parse', '--git-path', name).trim())
      writeFileSync(at, head)
      assertAllowed(await runHook(tmp, { command: 'git commit -m x', cwd: wt }))
      unlinkSync(at)
      assertRefusedPlan(await runHook(tmp, { command: 'git commit -m x', cwd: wt }), file)
    }
  }))

  test('an archive file renamed out of the directories passes', () => withRepo(async ({ tmp, repo }) => {
    put(repo, `${SPECS}/old.md`)
    commitAll(tmp, repo)
    overlayOn(repo)
    git(tmp, repo, 'mv', `${SPECS}/old.md`, 'archive-old.md')
    assertAllowed(await runHook(tmp, { command: 'git commit -m x', cwd: repo }))
  }))

  test('a linked worktree without its own switch is checked by the main worktree switch', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    const wt = join(tmp, 'linked')
    git(tmp, repo, 'worktree', 'add', '-q', '-b', 'linked', wt)
    put(wt, `${SPECS}/new.md`)
    git(tmp, wt, 'add', `${SPECS}/new.md`)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: wt })
    assertRefusedSpec(res, join(wt, SPECS, 'new.md'))
  }))

  test('modified and deleted archive files pass', () => withRepo(async ({ tmp, repo, log }) => {
    put(repo, `${SPECS}/kept.md`)
    put(repo, `${PLANS}/gone.md`)
    commitAll(tmp, repo)
    overlayOn(repo)
    put(repo, `${SPECS}/kept.md`, 'changed\n')
    git(tmp, repo, 'add', `${SPECS}/kept.md`)
    git(tmp, repo, 'rm', '-q', `${PLANS}/gone.md`)
    const res = await runHook(tmp, { command: 'git add -A && git commit -m archive', cwd: repo })
    assertAllowed(res)
    assert.equal(statusCalls(log).length, 1, 'the commit was checked')
  }))

  test('with the overlay off a new spec passes and git status is never asked', () => withRepo(async ({ tmp, repo, log }) => {
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const config of [undefined, { conport: { superpowers: false } }, '{broken']) {
      if (config !== undefined) put(repo, '.superpowers/config.json', typeof config === 'string' ? config : JSON.stringify(config))
      assertAllowed(await runHook(tmp, { command: 'git add . && git commit -m x', cwd: repo }))
    }
    assert.deepEqual(statusCalls(log), [])
  }))

  test('the guard runs with an empty deny-list and with no project configured', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    const file = join(repo, SPECS, 'new.md')
    assertRefusedSpec(await runHook(tmp, { command: 'git commit -m x', cwd: repo }), file)

    mkdirSync(join(tmp, 'data'), { recursive: true })
    writeFileSync(join(tmp, 'data', 'deny-list_my-proj.json'), JSON.stringify({ conventions: [] }))
    const env = { CONPORT_PROJECT_NAME: 'my-proj' }
    assertRefusedSpec(await runHook(tmp, { command: 'git commit -m x', cwd: repo, env }), file)

    // The guard comes before the deny-list: a matching convention does not speak first.
    writeFileSync(join(tmp, 'data', 'deny-list_my-proj.json'),
      JSON.stringify({ conventions: [{ pattern: 'git commit', reason: 'deny-list reason' }] }))
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo, env })
    assertRefusedSpec(res, file)
    assert.doesNotMatch(res.err, /deny-list reason/)

    // The deny-list still applies once the guard lets the command through.
    unlinkSync(file)
    git(tmp, repo, 'add', '-A')
    const denied = await runHook(tmp, { command: 'git commit -m x', cwd: repo, env })
    assert.equal(denied.code, 2)
    assert.match(denied.err, /^BLOCKED: deny-list reason/)
  }))

  test('a command with no git commit runs no git at all', () => withRepo(async ({ tmp, repo, log }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const command of [
      'git status',
      'git log --oneline -n 3',
      'git -C . add -A',
      'echo "git commit -m x"',
      'git show HEAD:commit',
      'npm run commit',
    ]) {
      assertAllowed(await runHook(tmp, { command, cwd: repo }))
    }
    assert.deepEqual(gitCalls(log), [])
  }))

  test('bad input never crashes the hook', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const stdin of ['', 'not json', 'null', '[]', '{"tool_input":null}', '{"tool_input":{"command":42}}',
      JSON.stringify({ tool_input: { command: 'git commit -m "unterminated' }, cwd: 7 }),
      JSON.stringify({ tool_input: { command: 'git commit -m x' }, cwd: join(tmp, 'absent') }),
      JSON.stringify({ tool_input: { command: 'cd && git -C commit' }, cwd: repo }),
    ]) {
      const res = await runHook(tmp, { stdin })
      assert.ok(res.code === 0 || res.code === 2, `${stdin}: exit ${res.code}`)
      assert.doesNotMatch(res.err, /Error|at .*\.js:\d+/, stdin)
    }
    // Without a cwd in the input the hook's own working directory is used.
    const res = await runHook(tmp, { stdin: JSON.stringify({ tool_input: { command: 'git commit -m x' } }), procCwd: repo })
    assertRefusedSpec(res, join(repo, SPECS, 'new.md'))
  }))

  test('a non-ASCII file name is named as it is, a name with a space is quoted', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/дизайн-стража.md`)
    git(tmp, repo, 'add', '-A', SPECS)
    assertRefusedSpec(await runHook(tmp, { command: 'git commit -m x', cwd: repo }),
      join(repo, SPECS, 'дизайн-стража.md'))

    git(tmp, repo, 'rm', '-q', '--cached', `${SPECS}/дизайн-стража.md`)
    rmSync(join(repo, SPECS, 'дизайн-стража.md'))
    put(repo, `${PLANS}/my plan.md`)
    git(tmp, repo, 'add', '-A', PLANS)
    assertRefusedPlan(await runHook(tmp, { command: 'git commit -m x', cwd: repo }),
      `'${join(repo, PLANS, 'my plan.md')}'`)
  }))

  test('a file name with a newline keeps the refusal on one line', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/a\nb's.md`)
    git(tmp, repo, 'add', '-A', SPECS)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo })
    assertRefusedSpec(res, `$'${join(repo, SPECS)}/a\\nb\\'s.md'`)
  }))

  test('a file copied into the plans directory is refused', () => withRepo(async ({ tmp, repo }) => {
    put(repo, `${SPECS}/old.md`, 'line1\nline2\nline3\nline4\nline5\n')
    commitAll(tmp, repo)
    overlayOn(repo)
    git(tmp, repo, 'config', 'status.renames', 'copies')
    put(repo, `${PLANS}/copied.md`, 'line1\nline2\nline3\nline4\nline5\n')
    put(repo, `${SPECS}/old.md`, 'line1\nline2\nline3\nline4\nline5\nline6\n')
    git(tmp, repo, 'add', '-A')
    assert.match(git(tmp, repo, 'status', '--porcelain', '--', SPECS, PLANS), /^C {2}/m)
    const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo })
    assertRefusedPlan(res, join(repo, PLANS, 'copied.md'))
  }))

  test('a here-document body is text, not a command', () => withRepo(async ({ tmp, repo, log }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const command of [
      'cat <<X\ngit commit -m x\nX',
      "cat <<'EOF' > notes.txt\ngit commit -m x\nEOF\necho done",
      'cat <<-"END"\n\tgit commit -m x\n\tEND',
      'cat <<A <<B\ngit commit\nA\ngit commit\nB',
      'cat <<<"git commit -m x"',
    ]) {
      assertAllowed(await runHook(tmp, { command, cwd: repo }))
    }
    assert.deepEqual(gitCalls(log), [])
    // A commit after the body is still seen.
    assertRefusedSpec(await runHook(tmp, { command: 'cat <<X\ntext\nX\ngit commit -m x', cwd: repo }),
      join(repo, SPECS, 'new.md'))
  }))

  test('a commit inside a group, a branch or after a prefix is checked',() => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/draft.md`)
    const file = join(repo, SPECS, 'draft.md')
    // The `git add` inside the group counts, so the untracked file is refused.
    assertRefusedSpec(await runHook(tmp, { command: '{ git add . && git commit -m x; }', cwd: repo }), file)
    git(tmp, repo, 'add', `${SPECS}/draft.md`)
    for (const command of [
      'if true; then git commit -m x; fi',
      '! command git commit -m x',
      'time exec git commit -m x',
    ]) {
      assertRefusedSpec(await runHook(tmp, { command, cwd: repo }), file)
    }
  }))

  test('a cd or -C target built by an expansion keeps the current directory', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    const file = join(repo, SPECS, 'new.md')
    for (const command of [
      'cd "$(git rev-parse --show-toplevel)" && git commit -m x',
      'cd `pwd` && git commit -m x',
      'git -C "$PWD" commit -m x',
    ]) {
      assertRefusedSpec(await runHook(tmp, { command, cwd: repo }), file)
    }
  }))

  test('without git, or when git status fails, there is no check', () => withRepo(async ({ tmp, repo }) => {
    overlayOn(repo)
    put(repo, `${SPECS}/new.md`)
    git(tmp, repo, 'add', `${SPECS}/new.md`)
    for (const bin of ['nogit', 'failstatus']) {
      const res = await runHook(tmp, { command: 'git commit -m x', cwd: repo, env: { PATH: join(SHARED, bin) } })
      assertAllowed(res)
    }
  }))
})
