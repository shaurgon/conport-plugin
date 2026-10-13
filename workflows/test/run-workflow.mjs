import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A stand-in for the workflow runner: task.js and epic.js are scripts evaluated
// with injected globals (args, agent, phase, parallel) and end in a top-level
// return of the run ledger. Here the shipped source is evaluated as the body of
// an async function with those globals supplied by the test, so a test drives the
// real control flow end to end and reads the ledger the run returns — the agents
// are the only thing replaced.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const AsyncFunction = (async () => {}).constructor

export const source = file => readFileSync(join(WORKFLOWS, file), 'utf8')

// answers: label -> value | (prompt, opts) => value. A label with no answer is a
// dead agent (null), exactly what the runner hands back for one — and so is an
// answer missing a key its schema requires: the runner validates before it returns,
// so a shape the schema does not admit never reaches the script.
export const runWorkflow = async (file, args, answers) => {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = opts.label
    calls.push({ label, prompt, opts })
    const a = answers[label]
    const out = (typeof a === 'function' ? a(prompt, opts) : a) ?? null
    const required = (opts.schema && opts.schema.required) || []
    return out !== null && required.some(k => out[k] === undefined) ? null : out
  }
  const parallel = thunks => Promise.all(thunks.map(f => f()))
  const body = source(file).replace(/^export const meta/m, 'const meta')
  const ledger = await new AsyncFunction('args', 'agent', 'phase', 'parallel', body)(args, agent, () => {}, parallel)
  return { ledger, calls, prompt: label => (calls.find(c => c.label === label) ?? {}).prompt }
}

// ------------------------------------------------------------- a green run

const PROJECT_ID = 42                              // a neutral id: no real project is implied
export const GATE = { dir: '.', commands: ['true'] }
const PRE = { clean: true, branch: 'main', current_branch: 'main', main_sha: 'aaa0', helper_version: '0.0.0' }
const IMPL = { status: 'DONE', branch: 'task/t7', head_sha: 'bbb1', worktree_path: '/tmp/wt-7' }

// One task, implemented, reviewed clean, merged, accounted, cleaned up.
export const taskRun = (over = {}) => ({
  args: { task: 7 },
  answers: {
    preflight: PRE,
    scout: {
      project_id: PROJECT_ID, via: 'wf-helper',
      task: { id: 7, kind: 'task', status: 'TODO', title: 'the thing', parent_epic_id: null },
      brief: { source: 'conport', plan_path: null, lines: null, files: null,
        description: 'describe', acceptance: 'accept', spec_digest: 'digest', global_constraints: 'constrain' },
      gate: GATE,
    },
    baseline: { gate: 'GREEN' },
    impl: IMPL,
    rev: { verdict: 'APPROVED', findings: [] },
    merge: { results: [{ id: 7, status: 'MERGED', merge_sha: 'ccc2' }] },
    account: { via: 'wf-helper', actions: [], task_closed: true },
    janitor: { deleted: ['task/t7'], kept: [], worktrees_removed: ['/tmp/wt-7'], errors: [] },
    ...over,
  },
})

// One epic of a single planned task, the same road end to end.
export const epicRun = (over = {}) => ({
  args: { epic: 500 },
  answers: {
    preflight: PRE,
    scout: {
      project_id: PROJECT_ID, plan_path: 'docs/plan.md', plan_format: 'A', via: 'wf-helper',
      epic: { id: 500, kind: 'epic', title: 'the epic', goal: 'the goal', status: 'TODO' },
      spec: { doc_id: 1, path: 'docs/spec.md', digest: 'digest' }, global_constraints: 'constrain', gate: GATE,
      tasks: [{ conport_id: 501, plan_index: 1, kind: 'work', title: 'the thing', lines: { from: 1, to: 2 },
        files: { modify: ['a.js'], test: [] }, consumes: [], produces: [], deps: [],
        acceptance: 'accept', spec_card: 'card', coverage: 'both' }],
    },
    baseline: { gate: 'GREEN' },
    'impl-501': { ...IMPL, branch: 'epic500/t501' },
    'rev-501': { verdict: 'APPROVED', findings: [] },
    'merge-w0': { results: [{ id: 501, status: 'MERGED', merge_sha: 'ccc2' }] },
    hunt: { gaps: [] },
    goal: { verdict: 'READY', checks: [] },
    account: { via: 'wf-helper', actions: [], epic_closed: true },
    janitor: { deleted: ['epic500/t501'], kept: [], worktrees_removed: ['/tmp/wt-7'], errors: [] },
    ...over,
  },
})

export const RUNS = [
  { file: 'task.js', run: taskRun, green: 'MERGED', mergeLabel: 'merge' },
  { file: 'epic.js', run: epicRun, green: 'EPIC_CLOSED', mergeLabel: 'merge-w0' },
]
