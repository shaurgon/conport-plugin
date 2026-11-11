import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'

// The plugin ships five typed agents under agents/. The workflows dispatch
// their implementer, reviewer, fixer and gap hunter by those types; the final
// reviewer is started by the session that leads an epic. Claude Code
// names a plugin agent <plugin name>:<agent name>, so the type a workflow passes
// must be the manifest's name and the name of a shipped definition — a type that
// names nothing makes agent() throw and the run dies at its first dispatch.

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const AGENTS = join(PLUGIN, 'agents')
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))

const ROLES = ['sdd-implementer', 'sdd-task-reviewer', 'sdd-fixer', 'sdd-gap-hunter', 'sdd-final-reviewer']
const READ_ONLY = ['sdd-task-reviewer', 'sdd-gap-hunter', 'sdd-final-reviewer']
const typeOf = role => `${MANIFEST.name}:${role}`

// The frontmatter of an agent file: the "key: value" lines between the two --- lines.
const frontmatter = file => {
  const text = readFileSync(join(AGENTS, file), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  assert.ok(m, `${file}: no frontmatter`)
  const fields = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2]
  }
  return { fields, body: m[2] }
}
const list = v => (v ?? '').split(',').map(s => s.trim()).filter(Boolean)

// ------------------------------------------------------------- the definitions

test('agents/ ships exactly the five SDD agents, each named as its file', () => {
  const files = readdirSync(AGENTS).filter(f => f.endsWith('.md')).sort()
  assert.deepEqual(files, ROLES.map(r => r + '.md').sort())
  for (const role of ROLES) {
    const { fields, body } = frontmatter(role + '.md')
    assert.equal(fields.name, role, `${role}: the name is the file name`)
    assert.ok(fields.description && fields.description.length > 40, `${role}: a description says when to dispatch it`)
    assert.ok(body.trim().length > 500, `${role}: the standing procedure is the body`)
  }
})

test('no agent pins a model: each takes the model of the user\'s session', () => {
  for (const role of ROLES)
    assert.equal(frontmatter(role + '.md').fields.model, undefined, role)
})

test('no agent can start subagents of its own: Agent is denied in every definition', () => {
  for (const role of ROLES)
    assert.ok(list(frontmatter(role + '.md').fields.disallowedTools).includes('Agent'), role)
})

test('the reviewers and the gap hunter cannot edit files; the implementer and the fixer can', () => {
  for (const role of READ_ONLY)
    for (const tool of ['Edit', 'Write', 'NotebookEdit'])
      assert.ok(list(frontmatter(role + '.md').fields.disallowedTools).includes(tool), `${role}: ${tool}`)
  for (const role of ['sdd-implementer', 'sdd-fixer'])
    for (const tool of ['Edit', 'Write'])
      assert.ok(!list(frontmatter(role + '.md').fields.disallowedTools).includes(tool), `${role}: ${tool}`)
})

// A tools allowlist would cut the agent off the ConPort MCP tools and ToolSearch,
// and a workflow agent reads its brief from the task journal through exactly those.
test('no agent narrows its tools to an allowlist: the ConPort MCP tools stay reachable', () => {
  for (const role of ROLES)
    assert.equal(frontmatter(role + '.md').fields.tools, undefined, role)
})

// ------------------------------------------------------------- without a workflow

// A session that leads an epic starts an agent of any kind in a role and reads
// what it did from the task journal, a block or its answer — so each role names
// the shell command that does it, for an agent without the ConPort MCP tools,
// and every command carries -p <handle>.
const body = role => frontmatter(role + '.md').body

test('the implementer, the reviewer and the fixer write the journal through MCP or `conport journal add -p <handle>`', () => {
  for (const role of ['sdd-implementer', 'sdd-task-reviewer', 'sdd-fixer']) {
    const text = body(role)
    assert.match(text, /add_task_journal_entry/, `${role}: the MCP tool`)
    assert.match(text, /conport journal add --task <N> --kind \w+[^`]* -p <handle>/, `${role}: the CLI command with -p <handle>`)
    assert.match(text, /conport journal get --task <N>[^`]* -p <handle>/, `${role}: reading the journal from the shell`)
  }
})

test('the implementer and the fixer decide an ambiguity by the spec and block only through `conport task block`', () => {
  for (const role of ['sdd-implementer', 'sdd-fixer']) {
    const text = body(role)
    assert.match(text, /conport task block <N> --reason-file - -p <handle>/, `${role}: the block command`)
    assert.match(text, /irreversible/i, `${role}: case 1 of the stop list`)
    assert.match(text, /conflict[^.]*no (?:safe )?guess/i, `${role}: case 3 of the stop list`)
    assert.match(text, /decide it by the spec/i, `${role}: an ambiguity is decided by the spec`)
  }
  assert.doesNotMatch(body('sdd-implementer'), /Stop and report back with status `NEEDS_CONTEXT`/,
    'the implementer no longer stops on an ambiguity by default')
})

// Nothing runs the roles but a workflow or a session: no text of a role, and no
// description of one, names a run that starts agents and collects from them.
test('no role names the dispatcher run', () => {
  const gone = [/dispatcher/i, /conport epic run/, /epic findings submit/, /conport epic status/,
    /conport epic answer/, /conport epic stop/]
  for (const role of ROLES) {
    const { fields, body: text } = frontmatter(role + '.md')
    for (const pattern of gone) {
      assert.doesNotMatch(text, pattern, `${role}: the body`)
      assert.doesNotMatch(fields.description, pattern, `${role}: the description`)
    }
  }
})

test('the gap hunter and the final reviewer hand their findings back in their answer, in the severities of their role', () => {
  const cases = [
    ['sdd-gap-hunter', ['Blocker', 'Should-fix', 'Note']],
    ['sdd-final-reviewer', ['Critical', 'Important', 'Minor']],
  ]
  for (const [role, severities] of cases) {
    const text = body(role)
    for (const severity of severities)
      assert.match(text, new RegExp(`\\*\\*${severity}\\*\\*`), `${role}: the severity ${severity}`)
    assert.match(text, /the findings go back in your answer/, `${role}: the findings are the answer`)
    assert.match(text, /the full report is your answer/, `${role}: no file is written`)
    assert.doesNotMatch(text, /\bsubmit/i, `${role}: nothing is submitted through a command`)
  }
})

// A task that changes behaviour a spec describes changes the spec in the same
// task: the roles that write edit it by blocks and name the blocks; the roles
// that only read find the miss and never take the edit on.
test('a change to behaviour the spec describes changes the spec in the same task: writers edit it, reviewers find the miss', () => {
  const oneLine = role => body(role).replace(/\s+/g, ' ')
  for (const role of ['sdd-implementer', 'sdd-fixer']) {
    const text = oneLine(role)
    assert.match(text, /behaviour the spec describes, change the spec in the same task with its block tools \(`update_block`, `insert_block`\)/,
      `${role}: edits the spec by blocks in the same task`)
    assert.match(text, /name the blocks you changed in your report/, `${role}: names the changed blocks`)
    // An agent without the ConPort MCP tools edits the spec from the shell, as it writes the journal.
    assert.match(text, /`conport api document-blocks update-blocks --project <handle> --document_id <id> --block_ulid <ulid> --markdown <text>`/,
      `${role}: the shell form of update_block`)
    assert.match(text, /`conport api document-blocks blocks-post --project <handle> --document_id <id> --after <ulid> --markdown <text>`/,
      `${role}: the shell form of insert_block`)
  }
  const reviewer = oneLine('sdd-task-reviewer')
  assert.match(reviewer, /diff changes behaviour the spec describes and the spec is not changed in this same task, that is an Important finding/,
    'the task reviewer: an unchanged spec is Important')
  // A spec edit never enters the git diff: the reviewer reads the blocks the report names itself.
  assert.match(reviewer, /never enters the git diff, so this is a named check outside the diff/,
    'the task reviewer: the spec check is a named check outside the diff')
  assert.match(reviewer, /read each block the report names yourself \(`get_block`, or `conport api document-blocks get-blocks --project <handle> --document_id <id> --block_ulid <ulid>`\)/,
    'the task reviewer: reads the named blocks itself, through MCP or the shell')
  assert.match(reviewer, /the report names no changed block, or a block it names does not describe what the diff builds/,
    'the task reviewer: when the finding is raised')
  const final = oneLine('sdd-final-reviewer')
  assert.match(final, /both ways/, 'the final reviewer checks the branch against the spec both ways')
  assert.match(final, /described and not built/, 'the final reviewer: described and not built')
  assert.match(final, /built otherwise than described/, 'the final reviewer: built otherwise than described')
  assert.match(final, /both are \*\*Important\*\*/, 'the final reviewer: both directions are Important')
  for (const role of READ_ONLY)
    assert.doesNotMatch(oneLine(role), /(?:change|edit|correct|fix) the spec yourself|update_block|insert_block/,
      `${role}: a reviewer only finds the miss, it never edits the spec`)
})

// ------------------------------------------------------------- the dispatch

// Every agent() call of a run, with the type it was dispatched as.
const typesOf = calls => calls.map(c => [c.label, c.opts.agentType])

const IMPORTANT = { severity: 'IMPORTANT', file: 'a.js', line: 3, what: 'drops the guard', fix: 'restore it' }
const CLEAN = { verdict: 'APPROVED', findings: [] }
const FIXED = { status: 'DONE', head_sha: 'eee4', per_finding: [{ idx: 0, action: 'FIXED' }] }
const ASKS = { status: 'NEEDS_CONTEXT', branch: 'x', head_sha: 'x', worktree_path: '/tmp/x', questions: ['which?'] }

// Which type each label of a run is dispatched as; any other label — the scout,
// the pipes, the rebaser, the verifier, the acceptor, the accountant — takes none.
const expected = label => {
  if (/^(impl|gapimpl)(-|$)/.test(label)) return typeOf('sdd-implementer')
  if (/^(rev|rev2|gaprev)(-|$)/.test(label)) return typeOf('sdd-task-reviewer')
  if (/^fix(-|$)/.test(label)) return typeOf('sdd-fixer')
  if (/^hunt(-|$)/.test(label)) return typeOf('sdd-gap-hunter')
  return undefined
}

const assertTyped = (calls, mustSee) => {
  for (const [label, type] of typesOf(calls))
    assert.equal(type, expected(label), `${label} is dispatched as ${expected(label) ?? 'an untyped agent'}`)
  const seen = calls.map(c => c.label)
  for (const label of mustSee) assert.ok(seen.includes(label), `the run reached ${label}`)
  for (const t of new Set(calls.map(c => c.opts.agentType).filter(Boolean)))
    assert.ok(ROLES.some(r => typeOf(r) === t), `${t} names a shipped agent`)
}

test('task.js: every implementer, reviewer and fixer dispatch is typed; nothing else is', async () => {
  const { args, answers } = taskRun({
    impl: null, 'impl-r2': ASKS,
    'impl-ctx': { status: 'DONE', branch: 'task/t7-ctx', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' },
    rev: { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, fix: FIXED, rev2: CLEAN,
    merge: { results: [{ id: 7, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    rebase: { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb': CLEAN,
    'merge-rb': { results: [{ id: 7, status: 'MERGED', merge_sha: 'iii8' }] },
  })
  const { ledger, calls } = await runWorkflow('task.js', args, answers)
  assert.equal(ledger.outcome, 'MERGED')
  assertTyped(calls, ['impl', 'impl-r2', 'impl-ctx', 'rev', 'fix', 'rev2', 'rebase', 'rev-rb', 'scout', 'account'])
})

test('epic.js: every implementer, reviewer, fixer and gap-hunter dispatch is typed; nothing else is', async () => {
  const gap = { gid: 1, claim: 'a missing piece', evidence: 'ev', severity: 'blocker', min_action: { title: 'close it' } }
  const { args, answers } = epicRun({
    'impl-501': null, 'impl-501-r2': ASKS,
    'impl-501-ctx': { status: 'DONE', branch: 'epic500/t501-ctx', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' },
    'rev-501': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }, 'fix-501': FIXED, 'rev2-501': CLEAN,
    'merge-w0': { results: [{ id: 501, status: 'CONFLICT', conflict_files: ['a.js'] }] },
    'rebase-501': { status: 'DONE', head_sha: 'hhh7', conflict_files: ['a.js'] },
    'rev-rb-501': CLEAN,
    'merge-501-rb': { results: [{ id: 501, status: 'MERGED', merge_sha: 'iii8' }] },
    hunt: { gaps: [gap] },
    gapverify: { verdicts: [{ gid: 1, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen' }] },
    'gapimpl-1': { status: 'DONE', branch: 'epic500/gap1', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': CLEAN,
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  const { ledger, calls } = await runWorkflow('epic.js', args, answers)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assertTyped(calls, ['impl-501', 'impl-501-r2', 'impl-501-ctx', 'rev-501', 'fix-501', 'rev2-501', 'rebase-501',
    'rev-rb-501', 'hunt', 'gapverify', 'gapimpl-1', 'gaprev-1', 'goal', 'scout', 'account'])
})

test('epic.js: the retries of a dead reviewer, fixer and hunter keep their type', async () => {
  const { args, answers } = epicRun({
    'rev-501': null, 'rev-501-r2': { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] },
    'fix-501': null, 'fix-501-r2': FIXED, 'rev2-501': CLEAN,
    hunt: null, 'hunt-r2': { gaps: [] },
  })
  const { ledger, calls } = await runWorkflow('epic.js', args, answers)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assertTyped(calls, ['rev-501', 'rev-501-r2', 'fix-501', 'fix-501-r2', 'hunt', 'hunt-r2'])
})

test('epic.js: the second attempt of a dead gap implementer and gap reviewer keeps its type', async () => {
  const gap = { gid: 1, claim: 'a missing piece', evidence: 'ev', severity: 'blocker', min_action: { title: 'close it' } }
  const { args, answers } = epicRun({
    hunt: { gaps: [gap] },
    gapverify: { verdicts: [{ gid: 1, verdict: 'CONFIRMED', severity_final: 'critical', proof: 'seen' }] },
    'gapimpl-1': null,
    'gapimpl-1-r2': { status: 'DONE', branch: 'epic500/gap1-r2', head_sha: 'fff5', worktree_path: '/tmp/wt-g1' },
    'gaprev-1': null, 'gaprev-1-r2': CLEAN,
    'gapmerge-1': { results: [{ id: 100001, status: 'MERGED', merge_sha: 'ggg6' }] },
  })
  const { ledger, calls } = await runWorkflow('epic.js', args, answers)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  assertTyped(calls, ['gapimpl-1', 'gapimpl-1-r2', 'gaprev-1', 'gaprev-1-r2'])
})

// ------------------------------------------------------------- a type that is not installed

// What the workflow runner throws for a type no installed agent carries.
const notFound = type => new Error(`agent({agentType}): agent type '${type}' not found. Available agents: general-purpose`)
// The answers of a role whose type is not installed: the typed dispatch is refused
// the way the runner refuses it, and the untyped one — under its own label — answers.
const missing = (label, value) => ({
  [label]: (_prompt, opts) => { throw notFound(opts.agentType) },
  [label + '-untyped']: value,
})
const callsOf = (calls, label) => calls.filter(c => c.label === label)
const withoutType = ({ agentType, ...rest }) => rest

// The typed dispatch of a role, then the untyped one: the same prompt and options
// under the label <label>-untyped, so the progress tells the two apart.
const assertFellBack = (calls, label) => {
  const typedCalls = callsOf(calls, label)
  const untypedCalls = callsOf(calls, label + '-untyped')
  assert.equal(typedCalls.length, 1, `${label}: dispatched typed once`)
  assert.equal(typedCalls[0].opts.agentType, expected(label), `${label}: as its type`)
  assert.equal(untypedCalls.length, 1, `${label}: then untyped exactly once`)
  assert.equal(untypedCalls[0].opts.agentType, undefined, `${label}: without a type`)
  assert.equal(untypedCalls[0].prompt, typedCalls[0].prompt, `${label}: with the same prompt`)
  assert.deepEqual(untypedCalls[0].opts, { ...withoutType(typedCalls[0].opts), label: label + '-untyped' },
    `${label}: and the same options under its own label`)
}

test('task.js: a type that is not installed sends the same prompt once to an untyped agent, and the run goes on', async () => {
  const { args, answers } = taskRun({
    ...missing('impl', { status: 'DONE', branch: 'task/t7', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' }),
    ...missing('rev', { verdict: 'NEEDS_FIXES', findings: [IMPORTANT] }),
    ...missing('fix', FIXED),
    'rev2-untyped': CLEAN,
  })
  const { ledger, calls } = await runWorkflow('task.js', args, answers)
  assert.equal(ledger.outcome, 'MERGED')
  for (const label of ['impl', 'rev', 'fix']) assertFellBack(calls, label)
  // the reviewer's type is known to be missing by now: the re-review goes untyped straight away
  assert.deepEqual(callsOf(calls, 'rev2'), [])
  assert.deepEqual(callsOf(calls, 'rev2-untyped').map(c => c.opts.agentType), [undefined])
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('agent type missing')), [
    'agent type missing: conport:sdd-implementer — dispatched untyped',
    'agent type missing: conport:sdd-task-reviewer — dispatched untyped',
    'agent type missing: conport:sdd-fixer — dispatched untyped',
  ])
})

test('epic.js: a type that is not installed sends the same prompt once to an untyped agent, and the run goes on', async () => {
  const { args, answers } = epicRun({
    ...missing('impl-501', { status: 'DONE', branch: 'epic500/t501', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' }),
    ...missing('rev-501', CLEAN),
    ...missing('hunt', { gaps: [] }),
  })
  const { ledger, calls } = await runWorkflow('epic.js', args, answers)
  assert.equal(ledger.outcome, 'EPIC_CLOSED')
  for (const label of ['impl-501', 'rev-501', 'hunt']) assertFellBack(calls, label)
  assert.deepEqual(ledger.notes.filter(n => n.startsWith('agent type missing')), [
    'agent type missing: conport:sdd-implementer — dispatched untyped',
    'agent type missing: conport:sdd-task-reviewer — dispatched untyped',
    'agent type missing: conport:sdd-gap-hunter — dispatched untyped',
  ])
})

test('any other error of a typed dispatch is not caught: a type denied by a rule still stops the run', async () => {
  const denied = () => {
    throw new Error("agent({agentType}): 'conport:sdd-implementer' is denied by permission rule 'Agent(conport:sdd-implementer)' from userSettings.")
  }
  // the untyped dispatch would answer: a catch that swallowed this error would let the run go on
  const impl = { status: 'DONE', branch: 'task/t7', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' }
  for (const [file, run, label] of [['task.js', taskRun, 'impl'], ['epic.js', epicRun, 'impl-501']]) {
    const { args, answers } = run({ [label]: denied, [label + '-untyped']: impl })
    await assert.rejects(runWorkflow(file, args, answers), /is denied by permission rule/, file)
  }
})
