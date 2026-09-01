export const meta = {
  name: 'task',
  description: 'Deterministic execution of one ConPort task: implement in a worktree, review, fix, merge behind the full gate, close',
  phases: [
    { title: 'Preflight' }, { title: 'Scout' }, { title: 'Baseline' },
    { title: 'Execute' }, { title: 'Merge' }, { title: 'Accounting' }, { title: 'Cleanup' },
  ],
}
// Mirror rule: the mechanical skeletons live in wf-helper.mjs and in the pipe
// prompts of this file — edit them together. task.js and epic.js carry the pipe
// skeletons and SKELETON_VERSION byte for byte alike; the judgement prompts remain
// duplicated in both files as well.

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (A.task === undefined || A.task === null) throw new Error('conport task workflow requires args: {task: <id>}')
const TASK = A.task
const PROJECT = A.project ?? null
const SERIAL = !!A.serialChecks
const FILE_MINORS = !!A.fileMinors // default: minors live in the ledger only — they never become tasks
const SKELETON_VERSION = 10       // prompt skeleton version; bump on every skeleton edit (mirror it)
const retry = async (lbl, mk) => (await mk(lbl)) ?? (await mk(lbl + '-r2'))

const L = {
  task: TASK, skeleton_version: SKELETON_VERSION,
  outcome: null, abort_reason: null, abort_detail: null,
  fail_reason: null, fail_detail: null, branch: null, head_sha: null,
  merge_sha: null, review: null, rereview: null, minors: [],
  accounting: null, pending_table: null, notes: [],
}
const abort = (reason, detail) => {
  L.outcome = 'ABORTED'; L.abort_reason = reason
  if (detail !== undefined) L.abort_detail = detail
  return L
}
const fail = (reason, detail) => {
  L.outcome = 'FAILED'; L.fail_reason = reason
  if (detail !== undefined) L.fail_detail = detail
}
const hard = rev => rev.findings.some(f => f.severity === 'CRITICAL' || f.severity === 'IMPORTANT')
const collectMinors = rev => {
  for (const f of rev.findings)
    if (f.severity === 'MINOR' && !L.minors.some(m => m.file === f.file && m.what === f.what))
      L.minors.push(f)
}

// ---------------------------------------------------------------- schemas

const S_PRE = { type: 'object', required: ['clean', 'branch', 'current_branch', 'main_sha'], properties: {
  clean: { type: 'boolean' }, dirty_paths: { type: 'array', items: { type: 'string' } },
  branch: { type: 'string' }, current_branch: { type: 'string' }, main_sha: { type: 'string' },
  helper_version: { type: ['string', 'null'] } } }

const S_BASE = { type: 'object', required: ['gate'], properties: {
  gate: { type: 'string', enum: ['GREEN', 'RED'] }, red_summary: { type: 'string' } } }

const S_SCOUT = { type: 'object', required: ['project_id', 'task', 'brief'], properties: {
  project_id: { type: 'integer' },
  task: { type: 'object', required: ['id', 'kind', 'status', 'title'], properties: {
    id: { type: 'integer' }, kind: { type: 'string' }, status: { type: 'string' },
    title: { type: 'string' }, parent_epic_id: { type: ['integer', 'null'] } } },
  brief: { type: 'object', required: ['source', 'acceptance', 'description', 'spec_digest'], properties: {
    source: { type: 'string', enum: ['plan', 'conport'] },
    plan_path: { type: ['string', 'null'] },
    lines: { type: ['object', 'null'], properties: { from: { type: 'integer' }, to: { type: 'integer' } } },
    description: { type: 'string' }, acceptance: { type: 'string' }, spec_digest: { type: 'string' },
    files: { type: ['object', 'null'], properties: {
      modify: { type: 'array', items: { type: 'string' } },
      test: { type: 'array', items: { type: 'string' } } } },
    global_constraints: { type: 'string' } } },
  gate: { type: ['object', 'null'], properties: {
    dir: { type: 'string' }, commands: { type: 'array', items: { type: 'string' } } } },
  via: { type: 'string' },
  notes: { type: 'array', items: { type: 'string' } } } }

const S_IMPL = { type: 'object', required: ['status', 'branch', 'head_sha', 'worktree_path'], properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
  branch: { type: 'string' }, head_sha: { type: 'string' }, worktree_path: { type: 'string' },
  files_changed: { type: 'array', items: { type: 'string' } }, checks_summary: { type: 'string' },
  concerns: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } } }

const S_REV = { type: 'object', required: ['verdict', 'findings'], properties: {
  verdict: { type: 'string', enum: ['APPROVED', 'NEEDS_FIXES'] },
  findings: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'what'], properties: {
    severity: { type: 'string', enum: ['CRITICAL', 'IMPORTANT', 'MINOR'] },
    file: { type: 'string' }, line: { type: 'integer' }, what: { type: 'string' },
    specRef: { type: 'string' }, scenario: { type: 'string' }, fix: { type: 'string' } } } },
  unverifiable: { type: 'array', items: { type: 'string' } } } }

const S_FIX = { type: 'object', required: ['status', 'head_sha'], properties: {
  status: { type: 'string', enum: ['DONE', 'BLOCKED'] },
  per_finding: { type: 'array', items: { type: 'object', required: ['idx', 'action'], properties: {
    idx: { type: 'integer' }, action: { type: 'string', enum: ['FIXED', 'DISPUTED'] }, note: { type: 'string' } } } },
  head_sha: { type: 'string' }, checks_summary: { type: 'string' } } }

const S_REB = { type: 'object', required: ['status', 'head_sha'], properties: {
  status: { type: 'string', enum: ['DONE', 'BLOCKED'] }, head_sha: { type: 'string' },
  semantic_choice: { type: 'boolean' }, conflict_files: { type: 'array', items: { type: 'string' } } } }

const S_MG = { type: 'object', required: ['results'], properties: {
  results: { type: 'array', items: { type: 'object', required: ['id', 'status'], properties: {
    id: { type: 'integer' },
    status: { type: 'string', enum: ['MERGED', 'ALREADY_MERGED', 'CONFLICT', 'GATE_RED', 'RED_BASELINE', 'DIRTY_ABORTED', 'NOT_MERGED'] },
    merge_sha: { type: ['string', 'null'] }, conflict_files: { type: 'array', items: { type: 'string' } },
    gate_tail: { type: 'string' } } } } } }

const S_ACC = { type: 'object', required: ['actions', 'task_closed'], properties: {
  via: { type: 'string' },
  actions: { type: 'array', items: { type: 'object', required: ['step', 'result'], properties: {
    step: { type: 'string' }, target: { type: 'integer' },
    result: { type: 'string', enum: ['done', 'skipped_already', 'failed'] }, detail: { type: 'string' } } } },
  minors_created: { type: 'array', items: { type: 'integer' } }, task_closed: { type: 'boolean' },
  failed_calls: { type: 'array', items: { type: 'object', properties: {
    call: { type: 'string' }, error: { type: 'string' } } } } } }

const S_JAN = { type: 'object', properties: {
  deleted: { type: 'array', items: { type: 'string' } }, kept: { type: 'array', items: { type: 'string' } },
  worktrees_removed: { type: 'array', items: { type: 'string' } }, errors: { type: 'array', items: { type: 'string' } } } }

// ---------------------------------------------------------------- prompts

// PIPE_BASE_BEGIN — pipe/argFiles/gateFile/shq are mirrored in epic.js; the region
// between the markers is compared byte for byte by the mirror parity test.
// The mechanical steps are a single call of the workflow helper: the agent only
// locates it, feeds it the arguments assembled here and pipes its stdout back.
// A missing helper yields a sentinel JSON object: for the four required-bearing
// schemas (preflight, gate, merge, merge state) it fails schema validation on
// purpose and the workflow takes its usual retry / abort path. Cleanup (S_JAN has
// no required keys) instead degrades to a silent no-op — practically unreachable,
// since a helper missing at cleanup was already missing at preflight, which aborts.
const pipe = (command, prep) => `Mechanical step: run the workflow helper and pipe its output back. Decide nothing,
fix nothing, judge nothing.
Locate the helper, in this exact order, and take the first match:
(a) plugins/conport-plugin/workflows/wf-helper.mjs relative to the repository root;
(b) the glob ~/.claude/plugins/cache/*/conport-plugin/*/workflows/wf-helper.mjs —
    on several matches take the highest semantic version.
Neither exists -> return exactly {"error": "wf-helper not found"} and nothing else.
${prep ?? ''}Run exactly ONE helper command: node <helper> ${command}
Return its stdout verbatim as your final answer — no commentary, no reformatting, no
"fixing" of values. The helper's exit code does not matter to you; stdout is the answer.`

// Composite arguments travel through files: create a scratch directory outside the
// working tree so nothing lands in the tree the helper inspects.
const argFiles = files => `Prepare the arguments: create a temporary directory outside the working tree
(mktemp -d) and write these files into it, byte for byte as given here:
${files.map(f => `  ${f.name}: ${f.json}`).join('\n')}
Below, <tmp> is that directory.
`
const gateFile = gate => ({ name: 'gate-commands.json', json: JSON.stringify(gate.commands) })

// Single quotes, not JSON.stringify: double quotes still expand $ and backticks.
const shq = v => `'${String(v).replaceAll("'", `'\\''`)}'`
// PIPE_BASE_END

const prePrompt = () => pipe('preflight')

const basePrompt = gate => pipe(
  `gate --dir ${shq(gate.dir)} --commands-file <tmp>/gate-commands.json`,
  argFiles([gateFile(gate)]))

// The scout is a hybrid: the helper gathers the mechanical part (the task over the
// ConPort REST API, the plan slice, the constraints, the gate, the spec reference)
// and the agent only compresses what is too long and digests the spec. Every path
// out of the helper — no key, no project, an API error, no helper at all — lands in
// branch B, the full scout that predates it. Mirror this skeleton in epic.js —
// the region between the markers is compared byte for byte by the parity test.
// SCOUT_BASE_BEGIN
const scoutBase = args => `Locate the workflow helper, in this exact order, and take the first match:
(a) plugins/conport-plugin/workflows/wf-helper.mjs relative to the repository root;
(b) the glob ~/.claude/plugins/cache/*/conport-plugin/*/workflows/wf-helper.mjs —
    on several matches take the highest semantic version.
Found -> run exactly ONE command: node <helper> scout ${args}
Its stdout is a JSON object with project_id / task / plan / plan_path /
global_constraints / gc_lines / gate / acceptance / spec_doc_id / via -> that
object is your BASE: carry its values over unchanged, never re-deriving or
"fixing" them; then do STEP 2.
Its stdout is an object carrying an "error" key, is not a JSON object at all (empty
output, a crash trace, a bare string, an array), or no helper exists -> that is NOT
a base: discard it and do BRANCH B instead.`
// SCOUT_BASE_END

const scoutPrompt = (taskId, project, planPath) => `You are the scout for ConPort task-${taskId}. Mutate nothing.

=== STEP 1 (mechanical, always first) ===
${scoutBase(`--task ${taskId}${project === null ? '' : ` --project ${shq(project)}`}${planPath ? ` --plan ${shq(planPath)}` : ''}`)}

=== STEP 2 (judgement, only where the base is not already the answer) ===
Fill the schema from the base:
- project_id and task.{id,kind,status,title}: copied; task.parent_epic_id = base
  task.parent_epic_id.
- via = base.via verbatim: the stamp of the branch that ran the scout.
- base.plan is not null -> brief.source="plan", brief.plan_path=base.plan.path,
  brief.lines={from,to} from base.plan, brief.files={modify: base.plan.files, test: []}
  (an empty file list -> files=null). base.plan is null -> brief.source="conport",
  plan_path=null, lines=null, files=null.
- brief.acceptance = base.acceptance verbatim; empty stays empty — do NOT invent one.
- brief.description = base task.description compressed to <=600 chars, keeping every
  requirement, name, format and threshold; already shorter -> verbatim.
- brief.global_constraints = base.global_constraints verbatim; ONLY when base.gc_lines
  is above 60 compress it, preserving every prohibition.
- brief.spec_digest: base.spec_doc_id is null -> empty string; otherwise exactly ONE
  MCP call — get_document(<base.spec_doc_id>) via conport tools (ToolSearch) —
  digested to <=40 lines (goal, invariants, contracts relevant to this task).
- gate = base.gate; it is null -> read the gate (working directory + full check
  commands) out of the constraints prose yourself; the prose names none -> gate=null
  (do NOT invent commands).
base.plan_path is null -> locate the plan yourself before filling those values:
grep the anchor '<!-- conport-task: <id> -->' of the id above (an epic id: its
'<!-- conport-epic: <id> -->' anchor) across docs/superpowers/plans/*.md, else a
plan reference in the task description;
nothing found -> leave the values empty (do NOT invent a plan).
Plan file known here — base.plan_path, or one you located in this step — while the
base carried none of its values (base.global_constraints empty, base.gate null) ->
read the Global Constraints verbatim and the gate object out of THAT file; never
carry the base's empty values forward.
Return strict JSON per schema; minimal texts, pointers instead of copies.

=== BRANCH B (fallback: there is no base to build on) ===
0) Resolve the ConPort project: name = ${project === null ? 'null' : JSON.stringify(project)}; if null, derive it
   yourself: env CONPORT_PROJECT_NAME -> repository name from git remote -> working
   directory name. Load conport MCP tools via ToolSearch and resolve project_id by
   that name (list_projects). Use this project_id for every call.
1) get_task(${taskId}): return id, kind, status, title, parent epic id if any, the
   description compressed to <=600 chars, and the acceptance criterion if the
   description carries one (an '## Acceptance' / 'Acceptance:' section or an explicit
   testable criterion; do NOT invent one — absent means an empty string).
2) Brief source. ${planPath ? `Use the plan file ${planPath}.` : `Grep '<!-- conport-task: ${taskId} -->' across docs/superpowers/plans/*.md.`}
   Found -> source="plan": return plan_path and the LINE NUMBERS (from,to) of this
   task's section — NOT the body — plus files from its Files: section if present,
   and the plan's Global Constraints verbatim (compress above ~60 lines, preserving
   every prohibition). Not found -> source="conport": the brief is the task
   description plus the spec digest below; plan fields null.
3) Spec digest: if the task description references a ConPort doc (doc-N) or the
   found plan's header names one, get_document and digest it to <=40 lines (goal,
   invariants, contracts relevant to this task). None -> empty string.
4) Gate: if the found plan's Global Constraints name the project gate (working
   directory + full check commands), return {dir, commands}; otherwise gate=null
   (do NOT invent commands).
5) via: set via="mcp" — this branch is the MCP fallback; the ledger records which
   branch ran the scout.
Return strict JSON per schema; minimal texts, pointers instead of copies.`

const implPrompt = (sc, gate, serial, branch, extra) => {
  const b = sc.brief
  const files = b.files ? [...(b.files.modify ?? []), ...(b.files.test ?? [])].join(', ') : 'not listed — derive them from the brief'
  const slice = b.lines ? `, lines ${b.lines.from}-${b.lines.to}` : ''
  const brief = b.source === 'plan'
    ? `Details and ready-made code — read ${b.plan_path}${slice} (ONLY
those; the path inside the worktree is the same).`
    : `There is no plan file. The task brief is its ConPort description plus the spec
digest — nothing else is authoritative: ${b.description} ${b.spec_digest}`
  // Not gated on source: an epic's plan carries the constraints even when it holds
  // no slice of this task, and dropping them would ship the implementer without them.
  const gc = b.global_constraints && b.global_constraints.trim()
    ? `\n=== GLOBAL CONSTRAINTS (from the plan, verbatim) === ${b.global_constraints}`
    : ''
  const ser = serial
    ? `\nDo NOT run any tests at all — static checks only; tests run at the sequential
merge gate.`
    : ''
  const ctx = extra && extra.questions && extra.questions.length
    ? `\nAdditional context for your earlier questions: ${sc.brief.spec_digest}
Your earlier questions: ${JSON.stringify(extra.questions)}`
    : ''
  return `You implement exactly ONE ConPort task task-${sc.task.id} in a dedicated git worktree.
First actions: (1) via conport MCP tools (ToolSearch), project_id=${sc.project_id}:
update_task(task_id=${sc.task.id}, status="IN_PROGRESS") — if already IN_PROGRESS/DONE, leave
it; this task has no ConPort id -> skip step (1) entirely; (2) git checkout -b
${branch} (the branch is mandatory — commits must survive worktree removal).
Task: ${sc.task.title}. Files in scope: ${files}. Acceptance: ${b.acceptance}.
${brief}
Requirements are literal: do not "improve" names, formats, thresholds.${gc}
Additionally: git stash is forbidden; git add only with explicit paths; never push;
no AI mentions in commits; atomic commits, message of 1-2 sentences. Touch only the
task's files plus what is strictly necessary.
Unclear requirement — do not guess: return NEEDS_CONTEXT with concrete questions.
Dead end / architectural fork — BLOCKED. Bad work is worse than no work.
A test must prove the mechanism: remove exactly the protected mechanism — the test
fails (verify by observation, then restore the code); production path, not a fixture
shortcut; a new threshold -> cases on both sides of the boundary.
Before finishing: run FOCUSED checks for your task only — lint and type checks from
the project gate scoped to your area, and tests only for your task's test files.${ser}
Never run the full test suite — project resources may be shared; the orchestrator
runs the full gate after merge. Fix red in your own area now. Commit everything;
return JSON per schema.${ctx}`
}

const revPrompt = (sc, impl, MAIN, extra) => {
  const b = sc.brief
  const spec = b.spec_digest && b.spec_digest.trim()
    ? b.spec_digest
    : `${b.acceptance} (there is no spec document — the acceptance criterion is the spec layer here)`
  const slice = b.lines ? `, lines ${b.lines.from}-${b.lines.to}` : ''
  const planLayer = b.source === 'plan'
    ? `2. PLAN — acceptance ${b.acceptance}; on any dispute with the diff read the details
   yourself: ${b.plan_path}${slice}.`
    : `2. PLAN — this layer is absent — verify against the task's ConPort description and
   the spec digest instead: ${b.description} ${b.spec_digest}`
  const dropped = b.source === 'plan'
    ? `3. DIFF. A spec_card requirement closed neither by the diff nor by an explicit
'done by task N' note in the plan is an IMPORTANT finding 'dropped from the plan'.`
    : '3. DIFF.'
  const re = extra && extra.rereview
    ? `\nPrevious findings and fixer actions: ${JSON.stringify(extra.rereview.findings)} / ${JSON.stringify(extra.fixed.per_finding ?? [])}.
Check ONLY their closure; arbitrate a DISPUTED finding yourself: withdrawn — say so,
confirmed — into the verdict.`
    : ''
  const rb = extra && extra.postRebase
    ? `\nThe diff changed by rebase — check the conflicted hunks: ${JSON.stringify(extra.files ?? [])}.`
    : ''
  return `You are the single reviewer of one task. Mutate NOTHING — no files, no git, no
ConPort; run no tests (judge test mechanics by reading the code).
Fetch the diff yourself: git diff ${MAIN}...${impl.branch}. Do not trust the implementer's
claims (${impl.checks_summary ?? ''}, ${JSON.stringify(impl.concerns ?? [])}) — verify against the diff; their justifications
do not lower finding severity.
Your view has three layers, checked IN THIS ORDER (the plan itself may have dropped
a spec requirement, so verification goes FROM THE SPEC DOWN):
1. SPEC — the card: ${spec}.
${planLayer}
${dropped}
Part 1 — compliance: missing / extra / built the wrong thing. Part 2 — quality:
would the test fail without exactly the protected mechanism; is it the production
path; threshold boundaries; swallowed errors. Outside the diff — only a targeted
grep for a concrete NAMED risk (contract or shared-state change -> call sites); do
not widen the search; unverifiable -> into unverifiable, do not guess.
Calibration is strict, inflation is forbidden. CRITICAL requires all three at once:
(a) the exact spec/acceptance line violated; (b) a concrete failure scenario
'input -> wrong outcome'; (c) the defect ships to ${MAIN} with this merge. Any missing
-> downgrade. IMPORTANT = the task cannot be trusted until fixed. MINOR = polish;
MINOR does not block the merge and is GUARANTEED to land in the tails epic — do not
inflate 'so it will not get lost': the ledger never loses a minor. Something absent
from both spec and acceptance is not a finding.
Each finding: file:line + specRef + scenario + minimal fix (<=3 lines).${re}${rb}`
}

const fixPrompt = (sc, rev, impl, serial) => {
  const list = rev.findings
    .map((f, i) => ({ idx: i, severity: f.severity, at: f.file + (f.line ? ':' + f.line : ''), what: f.what, specRef: f.specRef, fix: f.fix }))
  const ser = serial ? '; skip tests entirely — static checks only' : ''
  return `You fix one implemented task per the review findings list. Work in worktree
${impl.worktree_path} (branch ${impl.branch}). Worktree missing -> restore it:
git worktree prune && git worktree add <a sibling directory outside the primary working tree> ${impl.branch}.
Apply EVERY finding and NOTHING else: no adjacent refactoring, do not leave the
task's files.
Findings (ALL severities — minors are fixed on the spot too): ${JSON.stringify(list)}.
A finding unclear or, in your view, wrong — do not invent a fix and do not skip it
silently: return action=DISPUTED for it with reasoning, apply the rest.
A changed test inherits the rules: fails without the protected mechanism, threshold
boundaries.
After the edits: focused checks only (lint/types scoped to your area; tests only for
the task's test files${ser}).
Never the full suite. git stash is forbidden. Commit atomically. Return JSON per
schema.`
}

const mergeArgs = (q, gate) => argFiles([{ name: 'queue.json', json: JSON.stringify(q) }, gateFile(gate)])
const mergeCommand = gate =>
  `merge --queue <tmp>/queue.json --gate-dir ${shq(gate.dir)} --gate-commands-file <tmp>/gate-commands.json`

const mergePrompt = (q, gate) => pipe(mergeCommand(gate), mergeArgs(q, gate))

const mergeStatePrompt = (q, gate) => pipe(mergeCommand(gate) + ' --state-only', mergeArgs(q, gate))

const rebasePrompt = (sc, impl, serial, MAIN) => {
  const slice = sc.brief.lines ? `:${sc.brief.lines.from}-${sc.brief.lines.to}` : ''
  const guide = sc.brief.source === 'plan'
    ? `the plan slice ${sc.brief.plan_path}${slice}`
    : `the task brief: ${sc.brief.acceptance}`
  const ser = serial ? '; skip tests' : ''
  return `Rebase branch ${impl.branch} onto fresh ${MAIN}. Work in ${impl.worktree_path}; missing ->
git worktree prune && git worktree add <a sibling directory> ${impl.branch}.
Resolve conflicts minimally, guided by ${guide}; a
semantic choice during resolution -> set semantic_choice=true and name the files.
git stash is forbidden. Then: focused checks only (lint/types; tests only for the
task's test files${ser}). Never the full suite. Return JSON.`
}

// Branch A of the accountant: the helper executes the table over the ConPort
// REST API and its stdout is the report. Its two sentinels — no key, or a table
// whose steps it does not implement — hand the work back to branch B, which does
// the same table through MCP tools. Mirror this skeleton in epic.js — the region
// between the markers is compared byte for byte by the mirror parity test.
// ACCOUNT_PIPE_BEGIN
const accountPipe = table => `Accounting of an already computed table. Decide nothing, judge nothing, add
nothing to the table.
TABLE: ${JSON.stringify(table)}

=== BRANCH A (mechanical, try this first) ===
Locate the workflow helper, in this exact order, and take the first match:
(a) plugins/conport-plugin/workflows/wf-helper.mjs relative to the repository root;
(b) the glob ~/.claude/plugins/cache/*/conport-plugin/*/workflows/wf-helper.mjs —
    on several matches take the highest semantic version.
Found -> create a temporary directory outside the working tree (mktemp -d), write the
TABLE above into <tmp>/table.json byte for byte, and run exactly ONE command:
node <helper> account --table <tmp>/table.json
Its stdout is an accounting report -> return that stdout verbatim as your final
answer: no commentary, no reformatting, no "fixing" of values. The exit code does
not matter to you; stdout is the answer.
Its stdout is exactly {"error": "no api key"} or exactly {"error": "unsupported table"},
or no helper exists -> that output is NOT an answer: discard it and do BRANCH B.
Its stdout is not a JSON object — empty output included, a crash trace, a bare
string or an array -> that is NOT an answer either: discard it and do BRANCH B.

=== BRANCH B (fallback: execute the same TABLE yourself) ===`
// ACCOUNT_PIPE_END

const accountantPrompt = table => {
  const minorsStep = table.minors_umbrella
    ? `3) MINORS (one umbrella, never scattered tasks): ensure the epic titled
   'Workflow run tails' exists — search/list_tasks by that EXACT title
   (kind=epic, open); none -> add_task(kind="epic", priority=4,
   title='Workflow run tails', description='Deferred review minors from
   workflow runs'). Then ONE child: a child with the exact title from
   minors_umbrella.title exists -> skip; else add_task(parent_task_id=<that
   epic>, title=<minors_umbrella.title>, priority=4,
   description=<minors_umbrella.description, verbatim>).`
    : `3) MINORS: none to file — deferred minors travel in the run ledger and the
   resolution; do NOT create any task for them.`
  return `${accountPipe(table)}
You are the ConPort accountant (conport MCP tools via ToolSearch, project_id=${table.project_id}).
Execute the table STRICTLY in order, each item behind an idempotency guard.
FORBIDDEN: creating anything beyond the table; rewording resolutions; creating
any ROOT task.
1) CLOSE — the table's close: if null skip; else get_task(id); already
   DONE -> skip; else update_task(task_id=<id>, status="DONE", resolution=<verbatim
   from the table>) — never replace the description.
2) BLOCK — the table's block: if null skip; else get_task(id); already
   BLOCKED -> skip; else update_task(task_id=<id>, status="BLOCKED") and APPEND to
   the description a '## Blocked: <reason>' section (keep the original text).
${minorsStep}
Return a report per item: done | skipped_already | failed + details; a failed call
goes into failed_calls while the rest continue. Stamp the report with via:"mcp" —
branch B is the MCP path.`
}

const janPrompt = (mergedBranches, allWorktrees) => pipe(
  'cleanup --merged-file <tmp>/merged.json --worktrees-file <tmp>/worktrees.json',
  argFiles([
    { name: 'merged.json', json: JSON.stringify(mergedBranches) },
    { name: 'worktrees.json', json: JSON.stringify(allWorktrees) },
  ]))

// ---------------------------------------------------------------- control flow

phase('Preflight')
const pre = await retry('preflight', l => agent(prePrompt(), { label: l, effort: 'low', schema: S_PRE }))
if (!pre) return abort('ABORTED_PREFLIGHT')
// The version handshake, before any abort check: "unknown" means a stale helper
// in the plugin cache (it predates the stamp) — update the plugin first.
L.notes.push('helper_version:"' + (pre.helper_version ?? 'unknown') + '"')
if (!pre.clean) return abort('ABORTED_DIRTY', pre.dirty_paths)
if (pre.current_branch !== pre.branch)
  return abort('ABORTED_NOT_DEFAULT_BRANCH', pre.current_branch)   // mirror this in epic.js
const MAIN = pre.branch

phase('Scout')
const sc = await retry('scout', l => agent(scoutPrompt(TASK, PROJECT, A.plan), { label: l, schema: S_SCOUT }))
if (!sc) return abort('ABORTED_NO_SCOUT')
L.notes.push('scout via:"' + (sc.via ?? 'unknown') + '"')  // the branch that ran the scout: wf-helper (A) or mcp (B)
if (sc.task.kind === 'epic') return abort('ABORTED_IS_EPIC', 'this id is an epic — use /conport:epic')
if (sc.task.status === 'DONE' || sc.task.status === 'CANCELLED') return abort('ABORTED_ALREADY_DONE', sc.task.status)
if (sc.brief.source === 'conport' && !sc.brief.acceptance.trim())
  return abort('ABORTED_NO_ACCEPTANCE', 'no acceptance criterion and no plan slice — add an acceptance criterion first')
const gate = A.gate ?? sc.gate
if (!gate || !gate.commands || !gate.commands.length)
  return abort('ABORTED_NO_GATE', 'no gate resolved — pass args.gate or add a gate section to the plan Global Constraints')
const BRANCH = 'task/t' + sc.task.id

phase('Baseline')
const base = await retry('baseline', l => agent(basePrompt(gate), { label: l, effort: 'low', schema: S_BASE }))
if (!base) return abort('ABORTED_BASELINE')
if (base.gate !== 'GREEN') return abort('ABORTED_RED_BASELINE', base.red_summary)

phase('Execute')
let impl = await agent(implPrompt(sc, gate, SERIAL, BRANCH), { label: 'impl', isolation: 'worktree', schema: S_IMPL })
if (impl === null)
  impl = await agent(implPrompt(sc, gate, SERIAL, BRANCH + '-r2'), { label: 'impl-r2', isolation: 'worktree', schema: S_IMPL })
if (impl && impl.status === 'NEEDS_CONTEXT')
  impl = await agent(implPrompt(sc, gate, SERIAL, BRANCH + '-ctx', { questions: impl.questions }),
                     { label: 'impl-ctx', isolation: 'worktree', schema: S_IMPL })
if (!impl) fail('IMPL_DEAD')
else if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') fail(impl.status, impl.questions ?? impl.concerns)
else { L.branch = impl.branch; L.head_sha = impl.head_sha }

if (!L.outcome) {
  const rev = await retry('rev', l => agent(revPrompt(sc, impl, MAIN), { label: l, schema: S_REV }))
  if (!rev) fail('REVIEW_DEAD')
  else {
    L.review = rev
    if (rev.findings.length) {                       // minors are fixed on the spot too
      const fx = await retry('fix', l => agent(fixPrompt(sc, rev, impl, SERIAL), { label: l, schema: S_FIX }))
      if (!fx || fx.status !== 'DONE') {
        if (hard(rev)) fail('FIX_FAILED')
        else collectMinors(rev)                      // minors alone never block the merge — leftovers go to the ledger
      } else {
        const r2 = await agent(revPrompt(sc, impl, MAIN, { rereview: rev, fixed: fx }), { label: 'rev2', schema: S_REV })
        if (!r2 || hard(r2)) fail('RED_AFTER_FIX')
        else { L.rereview = r2; collectMinors(r2); L.head_sha = fx.head_sha }
      }
    }
  }
}

phase('Merge')
if (!L.outcome) {
  const q = [{ id: sc.task.id, branch: L.branch, head_sha: L.head_sha, title: sc.task.title }]
  let mg = await agent(mergePrompt(q, gate), { label: 'merge', effort: 'low', schema: S_MG })
  if (!mg) {
    const st = await agent(mergeStatePrompt(q, gate), { label: 'mstate', effort: 'low', schema: S_MG })
    const s0 = st && st.results[0]
    if (s0 && s0.status === 'ALREADY_MERGED') mg = st
    else if (s0 && s0.status === 'RED_BASELINE') fail('RED_BASELINE', s0.gate_tail)   // symmetric to epic.js: on a red base the merge is not restarted
    else if (st) mg = await agent(mergePrompt(q, gate), { label: 'merge-r2', effort: 'low', schema: S_MG })
  }
  let res = mg && mg.results[0]
  if (res && res.status === 'CONFLICT') {
    const rb = await agent(rebasePrompt(sc, impl, SERIAL, MAIN), { label: 'rebase', schema: S_REB })
    const rr = (rb && rb.status === 'DONE')
      ? await agent(revPrompt(sc, impl, MAIN, { postRebase: true, files: rb.conflict_files }), { label: 'rev-rb', schema: S_REV })
      : null
    if (!rb || !rr || hard(rr)) { fail('MERGE_CONFLICT'); res = null }
    else {
      L.head_sha = rb.head_sha
      const m1 = await agent(mergePrompt([{ ...q[0], head_sha: rb.head_sha }], gate),
                             { label: 'merge-rb', effort: 'low', schema: S_MG })
      res = m1 && m1.results[0]
      if (res && res.status === 'CONFLICT') { fail('MERGE_CONFLICT'); res = null }
    }
  }
  if (!L.outcome) {
    if (!res) fail('UNKNOWN_MERGE')
    else if (res.status === 'MERGED' || res.status === 'ALREADY_MERGED') { L.merge_sha = res.merge_sha; L.outcome = 'MERGED' }
    else if (res.status === 'GATE_RED') fail('GATE_RED', res.gate_tail)
    else if (res.status === 'RED_BASELINE') fail('RED_BASELINE', res.gate_tail)
    else if (res.status === 'DIRTY_ABORTED') { L.outcome = 'ABORTED'; L.abort_reason = 'ABORTED_DIRTY_MERGE' }
  }
}

phase('Accounting')                       // always, once the implementer has started
if (L.branch || L.outcome === 'FAILED') {
  const minorsNote = L.minors.length
    ? '; ' + L.minors.length + ' review minor(s) deferred in the run ledger' + (FILE_MINORS ? ' and filed as one umbrella task' : '')
    : ''
  const table = {
    project_id: sc.project_id,
    close: L.outcome === 'MERGED'
      ? { id: sc.task.id, resolution: 'merged as ' + L.merge_sha + '; review ' +
          (L.rereview ? 'clean after one fix round' : 'clean') + '; full gate green' + minorsNote }
      : null,
    block: L.outcome === 'FAILED'
      ? { id: sc.task.id, reason: L.fail_reason + (L.fail_detail ? ': ' + JSON.stringify(L.fail_detail) : '') }
      : null,
    minors_umbrella: (FILE_MINORS && L.minors.length)
      ? { title: 'Review minors: task-' + sc.task.id + ' run',
          description: ('Deferred review minors from the /conport:task run of task-' + sc.task.id + ':\n' +
            L.minors.map(f => '- ' + f.file + (f.line ? ':' + f.line : '') + ' — ' + f.what + (f.fix ? ' (fix: ' + f.fix + ')' : '')).join('\n')).slice(0, 1900) }
      : null,
  }
  const acc = await retry('account', l => agent(accountantPrompt(table), { label: l, effort: 'low', schema: S_ACC }))
  if (!acc) { L.accounting = 'INCOMPLETE'; L.pending_table = table }
  else {
    L.accounting = acc
    L.notes.push('account via:"' + (acc.via ?? 'unknown') + '"')  // the branch that ran the account: wf-helper (A) or mcp (B)
  }
}

phase('Cleanup')
if (L.branch) await agent(
  janPrompt(L.outcome === 'MERGED' ? [L.branch] : [], impl && impl.worktree_path ? [impl.worktree_path] : []),
  { label: 'janitor', effort: 'low', schema: S_JAN })
L.outcome = L.outcome ?? 'UNKNOWN'
return L
