export const meta = {
  name: 'epic',
  description: 'Deterministic execution of one ConPort epic from its plan: waves of isolated implementers, per-task review, gated sequential merges, a single gap hunt, observed acceptance, ConPort accounting',
  phases: [
    { title: 'Preflight' }, { title: 'Scout' }, { title: 'Baseline' }, { title: 'Parity' },
    { title: 'Waves' }, { title: 'Execute' }, { title: 'Hunt' }, { title: 'Fix criticals' },
    { title: 'Acceptance' }, { title: 'Accounting' }, { title: 'Cleanup' },
  ],
}
// Mirror rule: the mechanical skeletons live in wf-helper.mjs and in the pipe
// prompts of this file — edit them together. task.js and epic.js carry the pipe
// skeletons and SKELETON_VERSION byte for byte alike; the judgement prompts remain
// duplicated in both files as well.

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (A.epic === undefined || A.epic === null) throw new Error('conport epic workflow requires args: {epic: <id>}')
const EPIC = A.epic
const PROJECT = A.project ?? null
const SERIAL = !!A.serialChecks
const FILE_MINORS = !!A.fileMinors // default: leftover minors live in the ledger only — they never become tasks
const CAP_WAVE = 5
const CAP_CRIT = 5
const SKELETON_VERSION = 10       // prompt skeleton version; bump on every skeleton edit (mirror it)
const retry = async (lbl, mk) => (await mk(lbl)) ?? (await mk(lbl + '-r2'))
const hard = rev => rev.findings.some(f => f.severity === 'CRITICAL' || f.severity === 'IMPORTANT')

// ---------------------------------------------------------------- schemas

const S_PRE = { type: 'object', required: ['clean', 'branch', 'current_branch', 'main_sha'], properties: {
  clean: { type: 'boolean' }, dirty_paths: { type: 'array', items: { type: 'string' } },
  branch: { type: 'string' }, current_branch: { type: 'string' }, main_sha: { type: 'string' },
  helper_version: { type: ['string', 'null'] } } }

const S_BASE = { type: 'object', required: ['gate'], properties: {
  gate: { type: 'string', enum: ['GREEN', 'RED'] }, red_summary: { type: 'string' } } }

const S_SCOUT = { type: 'object', required: ['project_id', 'plan_path', 'epic', 'tasks'], properties: {
  project_id: { type: 'integer' }, plan_path: { type: ['string', 'null'] },
  plan_format: { type: ['string', 'null'], enum: ['A', 'B', null] },
  epic: { type: 'object', required: ['id', 'kind', 'title', 'goal', 'status'], properties: {
    id: { type: 'integer' }, kind: { type: 'string' }, title: { type: 'string' },
    goal: { type: 'string' }, status: { type: 'string' } } },
  spec: { type: ['object', 'null'], properties: {
    doc_id: { type: 'integer' }, path: { type: 'string' }, digest: { type: 'string' } } },
  global_constraints: { type: 'string' },
  gate: { type: ['object', 'null'], properties: {
    dir: { type: 'string' }, commands: { type: 'array', items: { type: 'string' } } } },
  tasks: { type: 'array', items: { type: 'object',
    required: ['plan_index', 'kind', 'title', 'coverage'], properties: {
      conport_id: { type: ['integer', 'null'] }, plan_index: { type: 'integer' },
      kind: { type: 'string', enum: ['work', 'controller'] }, title: { type: 'string' },
      lines: { type: ['object', 'null'], properties: { from: { type: 'integer' }, to: { type: 'integer' } } },
      files: { type: ['object', 'null'], properties: {
        modify: { type: 'array', items: { type: 'string' } },
        test: { type: 'array', items: { type: 'string' } } } },
      consumes: { type: 'array', items: { type: 'string' } },
      produces: { type: 'array', items: { type: 'string' } },
      deps: { type: 'array', items: { type: 'integer' } },
      acceptance: { type: 'string' }, spec_card: { type: 'string' },
      conport_status: { type: 'string' },
      coverage: { type: 'string', enum: ['both', 'plan_only', 'conport_only', 'uncovered', 'already_done'] } } } },
  divergences: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string' }, detail: { type: 'string' } } } },
  via: { type: 'string' },
  notes: { type: 'array', items: { type: 'string' } } } }

// Parity has no agent schema any more: the agent only fetches the epic's children,
// the plan-vs-children comparison is code (matchPlanToChildren below).
const S_CHILDREN = { type: 'object', required: ['children'], properties: {
  children: { type: 'array', items: { type: 'object', required: ['id', 'title', 'status'], properties: {
    id: { type: 'integer' }, title: { type: 'string' }, status: { type: 'string' },
    kind: { type: 'string' } } } } } }

// The creation step: one id per plan task that had no child of its own.
const S_CREATED = { type: 'object', required: ['created'], properties: {
  created: { type: 'array', items: { type: 'object', required: ['plan_index', 'conport_id'], properties: {
    plan_index: { type: 'integer' }, conport_id: { type: 'integer' } } } } } }

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

const S_HUNT = { type: 'object', required: ['gaps'], properties: {
  gaps: { type: 'array', items: { type: 'object', required: ['gid', 'claim', 'severity', 'min_action'], properties: {
    gid: { type: 'integer' }, category: { type: 'integer' }, claim: { type: 'string' },
    evidence: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'should_fix', 'note'] },
    umbrella: { type: 'boolean' }, instances: { type: 'array', items: { type: 'string' } },
    min_action: { type: 'object', required: ['title'], properties: {
      title: { type: 'string' }, note: { type: 'string' } } },
    check_hint: { type: 'string' } } } },
  covered: { type: 'array', items: { type: 'object', properties: {
    category: { type: 'integer' }, pointer: { type: 'string' } } } } } }

const S_GV = { type: 'object', required: ['verdicts'], properties: {
  verdicts: { type: 'array', items: { type: 'object', required: ['gid', 'verdict'], properties: {
    gid: { type: 'integer' }, verdict: { type: 'string', enum: ['CONFIRMED', 'REJECTED', 'UNVERIFIABLE'] },
    proof: { type: 'string' }, severity_final: { type: 'string', enum: ['critical', 'minor'] } } } } } }

const S_GOAL = { type: 'object', required: ['verdict', 'checks'], properties: {
  verdict: { type: 'string', enum: ['READY', 'NOT_READY'] },
  checks: { type: 'array', items: { type: 'object', required: ['criterion', 'pass'], properties: {
    criterion: { type: 'string' }, how: { type: 'string' }, observed: { type: 'string' },
    pass: { type: 'boolean' } } } },
  unmet: { type: 'array', items: { type: 'string' } } } }

const S_ACC = { type: 'object', required: ['actions', 'epic_closed'], properties: {
  via: { type: 'string' },
  actions: { type: 'array', items: { type: 'object', required: ['step', 'result'], properties: {
    step: { type: 'string' }, target: { type: 'integer' },
    result: { type: 'string', enum: ['done', 'skipped_already', 'failed'] }, detail: { type: 'string' } } } },
  tails_epic_id: { type: ['integer', 'null'] }, tails_children: { type: 'array', items: { type: 'integer' } },
  epic_progress: { type: ['object', 'null'], properties: { open: { type: 'integer' }, closed: { type: 'integer' } } },
  epic_closed: { type: 'boolean' }, epic_close_error: { type: ['string', 'null'] },
  failed_calls: { type: 'array', items: { type: 'object', properties: {
    call: { type: 'string' }, error: { type: 'string' } } } } } }

const S_JAN = { type: 'object', properties: {
  deleted: { type: 'array', items: { type: 'string' } }, kept: { type: 'array', items: { type: 'string' } },
  worktrees_removed: { type: 'array', items: { type: 'string' } }, errors: { type: 'array', items: { type: 'string' } } } }

// ---------------------------------------------------------------- shared prompts (mirrored from task.js)

// PIPE_BASE_BEGIN — pipe/argFiles/gateFile/shq are mirrored in task.js; the region
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

const mergeArgs = (q, gate) => argFiles([{ name: 'queue.json', json: JSON.stringify(q) }, gateFile(gate)])
const mergeCommand = gate =>
  `merge --queue <tmp>/queue.json --gate-dir ${shq(gate.dir)} --gate-commands-file <tmp>/gate-commands.json`

const mergePrompt = (q, gate) => pipe(mergeCommand(gate), mergeArgs(q, gate))

const mergeStatePrompt = (q, gate) => pipe(mergeCommand(gate) + ' --state-only', mergeArgs(q, gate))

const janPrompt = (mergedBranches, allWorktrees) => pipe(
  'cleanup --merged-file <tmp>/merged.json --worktrees-file <tmp>/worktrees.json',
  argFiles([
    { name: 'merged.json', json: JSON.stringify(mergedBranches) },
    { name: 'worktrees.json', json: JSON.stringify(allWorktrees) },
  ]))

// ---------------------------------------------------------------- epic prompts

// The scout is a hybrid: the helper gathers the mechanical part (the epic over the
// ConPort REST API, the plan file, the constraints, the gate, the spec reference)
// and the agent only slices the plan into tasks and digests the spec. Every path
// out of the helper — no key, no project, an API error, no helper at all — lands in
// branch B, the full scout that predates it. Mirror this skeleton in task.js —
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

const scoutPrompt = (epicId, project, planPath) => `You are the scout for epic task-${epicId}. Mutate nothing.

=== STEP 1 (mechanical, always first) ===
${scoutBase(`--task ${epicId}${project === null ? '' : ` --project ${shq(project)}`}${planPath ? ` --plan ${shq(planPath)}` : ''}`)}

=== STEP 2 (judgement, only where the base is not already the answer) ===
Carried over from the base, unchanged: project_id; epic.{id,kind,status,title};
epic.goal = the base task.description verbatim (if kind is not 'epic', the script
aborts the run — return it as it is); plan_path = base.plan_path; gate = base.gate;
via = base.via verbatim (the stamp of the branch that ran the scout);
global_constraints = base.global_constraints verbatim, compressed ONLY when
base.gc_lines is above 60 and then preserving every prohibition. Use the base
project_id for every MCP call below (conport tools via ToolSearch).
1) plan_path is null -> find the plan yourself: ${planPath ? `use the plan file ${planPath}.` : `grep '<!-- conport-epic: ${epicId} -->'
   across docs/superpowers/plans/*.md; else the text 'task-${epicId}' there; else
   a plan reference in the epic's description.`} Multiple candidates -> newest by
   file name, list all in divergences. Still nothing -> plan_path=null (do NOT
   invent a plan).
2) list_tasks(parent_task_id=${epicId}, status="ALL", include_snoozed=true, paginate by
   total to the end).
3) Slice the plan. Format A: '^### Task \\d+:' + '<!-- conport-task: (\\d+) -->' under
   the heading; format B: '^## Task \\d+' + 'ConPort task-(\\d+)' in the heading. For
   each task return LINE NUMBERS (from,to) — NOT the body; files from the Files:
   section (modify+test; format B without Files: infer from text, unreliable ->
   files=null); consumes/produces from Interfaces: (exact names); acceptance
   compressed to <=600 chars; a task with the '<!-- conport-finish -->' anchor or an
   'executed by the orchestrator' note -> kind:"controller".
4) gate is null in the base -> read the gate out of the Global Constraints prose
   yourself: working directory and the full check commands (lint, types, full test
   run) as separate fields; the prose names none -> gate=null (do NOT invent commands).
5) Spec: base.spec_doc_id, or a doc the plan header names when it is null ->
   get_document once. Return: (a) spec.digest <=80 lines — goal, invariants, public
   contracts, definition of done; (b) spec_card <=20 lines PER TASK — only the spec
   claims this task must close, worded verbatim (via references in the task body and
   the plan's Self-Review matrix). No spec -> spec=null, empty cards, note it in notes.
6) Coverage: both | plan_only (plan section without a child) | conport_only (child
   without a section) | uncovered (child with neither section nor acceptance
   criterion). Children DONE/CANCELLED -> already_done.
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
1) Plan: ${planPath ? `use the plan file ${planPath}.` : `grep '<!-- conport-epic: ${epicId} -->'
   across docs/superpowers/plans/*.md; else the text 'task-${epicId}' there; else
   get_task(${epicId}) and a plan reference in its description.`} Multiple candidates ->
   newest by file name, list all in divergences. Not found -> plan_path=null
   (do NOT invent a plan).
2) ConPort: get_task(${epicId}) — the goal verbatim and the task's kind (return it: if
   kind is not 'epic', the script aborts the run); list_tasks(parent_task_id=${epicId},
   status="ALL", include_snoozed=true, paginate by total to the end).
3) Slice the plan. Format A: '^### Task \\d+:' + '<!-- conport-task: (\\d+) -->' under
   the heading; format B: '^## Task \\d+' + 'ConPort task-(\\d+)' in the heading. For
   each task return LINE NUMBERS (from,to) — NOT the body; files from the Files:
   section (modify+test; format B without Files: infer from text, unreliable ->
   files=null); consumes/produces from Interfaces: (exact names); acceptance
   compressed to <=600 chars; a task with the '<!-- conport-finish -->' anchor or an
   'executed by the orchestrator' note -> kind:"controller".
4) Global Constraints — verbatim (longer than ~60 lines -> compress, preserving every
   prohibition). Extract the project gate if the plan names one: working directory and
   the full check commands (lint, types, full test run) as separate fields; if the
   plan names none -> gate=null (do NOT invent commands).
5) Spec from the plan header (**Spec:** / a ConPort doc id): get_document. Return:
   (a) spec.digest <=80 lines — goal, invariants, public contracts, definition of
   done; (b) spec_card <=20 lines PER TASK — only the spec claims this task must
   close, worded verbatim (via references in the task body and the plan's
   Self-Review matrix). No spec -> spec=null, empty cards, note it in notes.
6) Coverage: both | plan_only (plan section without a child) | conport_only (child
   without a section) | uncovered (child with neither section nor acceptance
   criterion). Children DONE/CANCELLED -> already_done.
7) via: set via="mcp" — this branch is the MCP fallback; the ledger records which
   branch ran the scout.
Return strict JSON per schema; minimal texts, pointers instead of copies.`

const childrenPrompt = (epicId, pid) => `Data fetch via conport MCP tools (ToolSearch), project_id=${pid}. Read only: create
nothing, update nothing, compare nothing — the comparison happens outside you.
list_tasks(parent_task_id=${epicId}, status="ALL", include_snoozed=true), paginating by
total to the very end. Return EVERY child as {id, title, status, kind}: titles
verbatim, no rewording, no filtering, no sorting, no invented entries. No children ->
an empty list. Return strict JSON per schema.`

const createChildrenPrompt = (epicId, pid, missing) => `Bookkeeping via conport MCP tools (ToolSearch), project_id=${pid}. Give every plan
task below a child of epic ${epicId} — nothing else: no code, no branches, no status
changes, no dependencies, no other tasks touched.
MISSING ${JSON.stringify(missing)}
For EACH entry, in order:
1) list_tasks(parent_task_id=${epicId}, status="ALL", include_snoozed=true) once, and
   if a child already carries exactly this title, return ITS id — do not create a
   twin (this step must be safe to re-run).
2) Otherwise add_task(project_id=${pid}, parent_task_id=${epicId}, title=<title
   verbatim>, description=<brief, or the title when the brief is empty>, priority=3)
   and return the new id.
Return strict JSON per schema: one {plan_index, conport_id} per entry you settled.
An entry you could not settle is simply absent — never invent an id.`

// The plan's constraints, verbatim, as a block of the prompt — empty when the plan
// carries none, so no agent is ever handed a heading with nothing under it.
const constraintsBlock = sc => sc.global_constraints && sc.global_constraints.trim()
  ? `\n=== GLOBAL CONSTRAINTS (from the plan, verbatim) === ${sc.global_constraints}`
  : ''

const implPrompt = (t, sc, serial, branch, extra) => {
  const noPlan = sc.plan_path === null
  const files = t.files ? [...(t.files.modify ?? []), ...(t.files.test ?? [])].join(', ') : 'not listed — derive them from the brief'
  const slice = t.lines ? `, lines ${t.lines.from}-${t.lines.to}` : ''
  const brief = !noPlan
    ? `Details and ready-made code — read ${sc.plan_path}${slice} (ONLY
those; the path inside the worktree is the same).`
    : `There is no plan file. The task brief is its ConPort description plus the spec
digest — nothing else is authoritative: ${t.acceptance} ${sc.spec ? sc.spec.digest : ''}`
  const inprog = t.conport_id != null
    ? `(1) via conport MCP tools (ToolSearch), project_id=${sc.project_id}:
update_task(task_id=${t.conport_id}, status="IN_PROGRESS") — if already IN_PROGRESS/DONE, leave
it;`
    : `(1) this task has no ConPort id — skip the status update;`
  const ser = serial
    ? `\nDo NOT run any tests at all — static checks only; tests run at the sequential
merge gate.`
    : ''
  const ctx = extra && extra.questions && extra.questions.length
    ? `\nAdditional context for your earlier questions: ${sc.spec ? sc.spec.digest : ''}
Your earlier questions: ${JSON.stringify(extra.questions)}`
    : ''
  // An empty constraints block would ship a bare heading with nothing under it.
  const gc = constraintsBlock(sc)
  return `You implement exactly ONE task of epic task-${sc.epic.id} in a dedicated git worktree.
First actions: ${inprog} (2) git checkout -b
${branch} (the branch is mandatory — commits must survive worktree removal).
Task: ${t.title}. Files in scope: ${files}. Acceptance: ${t.acceptance}.
${brief}
Requirements are literal: do not "improve" names, formats, thresholds.
Interfaces from earlier tasks are contracts, do not change them: ${JSON.stringify(t.consumes ?? [])}.${gc}
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

const revPrompt = (t, sc, impl, MAIN, extra) => {
  const noPlan = sc.plan_path === null
  const spec = t.spec_card && t.spec_card.trim()
    ? t.spec_card
    : `${t.acceptance} (there is no spec card — the acceptance criterion is the spec layer here)`
  const slice = t.lines ? `, lines ${t.lines.from}-${t.lines.to}` : ''
  const planLayer = !noPlan
    ? `2. PLAN — acceptance ${t.acceptance}; on any dispute with the diff read the details
   yourself: ${sc.plan_path}${slice}.`
    : `2. PLAN — this layer is absent — verify against the task's ConPort description and
   the spec digest instead: ${t.acceptance} ${sc.spec ? sc.spec.digest : ''}`
  const dropped = !noPlan
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

const fixPrompt = (t, rev, impl, serial) => {
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

const rebasePrompt = (t, sc, impl, serial, MAIN) => {
  const slice = t.lines ? `:${t.lines.from}-${t.lines.to}` : ''
  const guide = sc.plan_path !== null
    ? `the plan slice ${sc.plan_path}${slice}`
    : `the task brief: ${t.acceptance}`
  const ser = serial ? '; skip tests' : ''
  return `Rebase branch ${impl.branch} onto fresh ${MAIN}. Work in ${impl.worktree_path}; missing ->
git worktree prune && git worktree add <a sibling directory> ${impl.branch}.
Resolve conflicts minimally, guided by ${guide}; a
semantic choice during resolution -> set semantic_choice=true and name the files.
git stash is forbidden. Then: focused checks only (lint/types; tests only for the
task's test files${ser}). Never the full suite. Return JSON.`
}

const huntPrompt = (sc, fates, mainSha, MAIN) => `You are the gap hunter for epic task-${sc.epic.id}. The only question: what is MISSING that
nobody asked about? Do not assess the quality of what exists (spotted a bug — one
line, move on). Edit nothing, run no tests.
The GOAL verbatim: ${sc.epic.goal}. Spec (digest): ${sc.spec ? sc.spec.digest : 'none'}. Tasks and their fate:
${fates}. Change range:
git log --oneline ${mainSha}..${MAIN} and targeted git show — yourself; do not read
the whole repo.
Method: FIRST derive from the goal what a complete solution requires, ONLY THEN
compare with the facts.
Check explicitly: (1) does the sum of tasks reach the goal or a coherent part of it;
(2) the operational tail — env/config in every carrier, migrations, deploy,
backfill, rollback; (3) is each acceptance verified by observation rather than
claimed; (4) seams between tasks; (5) consumers of changed symbols — grep them;
(6) failure/emptiness/slowness; (7) operator visibility; (8) decisions with no trace
in the tracker; (9) a rollback path.
Collapse a class of same-shaped instances into ONE umbrella finding with a list.
Each gap: proof (goal phrase + the place where it is absent) + severity
(blocker|should_fix|note) + minimal action (title + 1-2 sentences) + check_hint
(HOW to verify by observation: grep / command / file). At most 12, ranked.
Unsure about scope — a note with a question for the owner, do not invent.
A covered category = "covered: <pointer>" in one line.`

const gapVerifyPrompt = (gaps, sc, MAIN) => `Adversarial verification of the hunter's findings, one by one, strictly in order.
Your job is to REFUTE each by observation: an exact grep, reading the named spot,
running the check_hint / a targeted test (do NOT run the full gate). Change nothing.
Refuted by fact -> REJECTED + a pointer to the evidence. Neither refuted nor
reproduced by observation -> UNVERIFIABLE ('looks like' = not confirmed; the burden
of proof is on the finding). Confirmed -> CONFIRMED + what exactly you observed.
Final class — for CONFIRMED gaps only: critical = without a fix the epic goal is not
reached OR the defect is in code already merged to ${MAIN} by this run — and in both
cases a failure scenario is named; everything else = minor (improvement / guard /
measurement / class extension). Extending one gap into a class = ALWAYS a one-line
minor umbrella.
An unproven critical is not a critical. List: ${JSON.stringify(gaps)}. Return verdicts per schema.`

const gapImplPrompt = (g, sc, serial, branch, extra) => {
  const ser = serial
    ? `\nDo NOT run any tests at all — static checks only; tests run at the sequential
merge gate.`
    : ''
  const r2 = extra && extra.attempt === 'r2' ? ' (second attempt — the first agent died; start clean)' : ''
  const gc = constraintsBlock(sc)
  return `You fix exactly ONE confirmed critical gap of epic task-${sc.epic.id} in a dedicated git worktree${r2}.
First action: git checkout -b ${branch} (the branch is mandatory — commits must
survive worktree removal). This gap has no ConPort task — skip any status update.
The gap (verified claim): ${g.claim}
Evidence: ${g.evidence ?? ''} ${g.proof ?? ''}
Minimal action to take: ${g.min_action.title}. ${g.min_action.note ?? ''}
Spec digest for context: ${sc.spec ? sc.spec.digest : 'none'}${gc}
Apply the minimal action and NOTHING else: no adjacent refactoring, no scope growth.
Additionally: git stash is forbidden; git add only with explicit paths; never push;
no AI mentions in commits; atomic commits, message of 1-2 sentences.
A test must prove the mechanism: remove exactly the protected mechanism — the test
fails (verify by observation, then restore the code).
Dead end -> BLOCKED. Before finishing: focused checks only (lint/types scoped to
your area, tests only for your changed test files).${ser}
Never run the full test suite. Commit everything; return JSON per schema.`
}

const gapRevPrompt = (g, sc, impl, MAIN) => `You are the single reviewer of one critical-gap fix. Mutate NOTHING — no files, no
git, no ConPort; run no tests (judge test mechanics by reading the code).
Fetch the diff yourself: git diff ${MAIN}...${impl.branch}. Do not trust the implementer's
claims — verify against the diff.
The verified gap this fix must close: ${g.claim}
Proof it was real: ${g.proof ?? g.evidence ?? ''}
Prescribed minimal action: ${g.min_action.title}. ${g.min_action.note ?? ''}
Spec digest: ${sc.spec ? sc.spec.digest : 'none'}
Part 1 — does the diff actually close the gap (not merely gesture at it)? Part 2 —
quality: would the test fail without exactly the protected mechanism; is it the
production path; no scope growth beyond the minimal action.
Calibration is strict. CRITICAL requires: the gap is NOT closed, with a concrete
scenario. IMPORTANT = the fix cannot be trusted. MINOR = polish, does not block.
Each finding: file:line + scenario + minimal fix (<=3 lines).`

const goalPrompt = (sc, ledgerBrief, gate, MAIN) => `You are the acceptor of epic task-${sc.epic.id}. One question: is the GOAL achieved — not
whether the tasks are closed.
GOAL verbatim: ${sc.epic.goal}
Definition of done (from the spec digest / the plan's finish contract): ${sc.spec ? sc.spec.digest : 'none — judge against the goal and the acceptances'}
LEDGER (task outcomes, FAILED/SKIPPED with reasons, unresolved criticals, escalations):
${ledgerBrief}
Do not trust the ledger — verify each DoD criterion by OBSERVATION: a named command
or reading a concrete file. Gate: if git rev-parse ${MAIN} equals the sha of the last
green merge named in the ledger — the gate is already proven by that merge, do NOT
re-run; otherwise run the full gate once (${gate.dir}: ${gate.commands.join('; ')}). A criterion with no
way to observe it -> into unmet marked 'unverifiable', do not count it. FAILED/
SKIPPED tasks: does their absence break the goal? Breaks -> NOT_READY.
Unresolved criticals or escalations non-empty -> NOT_READY unconditionally.
READY — only when EVERY criterion is observed green. Mutate nothing.`

// Branch A of the accountant: the helper executes the table over the ConPort
// REST API and its stdout is the report. Its two sentinels — no key, or a table
// whose steps it does not implement — hand the work back to branch B, which does
// the same table through MCP tools. Mirror this skeleton in task.js — the region
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

const accountantPrompt = table => `${accountPipe(table)}
You are the ConPort accountant (conport MCP tools via ToolSearch, project_id=${table.project_id}).
Execute the table STRICTLY in order, each item behind an idempotency guard.
FORBIDDEN: add_task with parent_task_id=${table.epic}; creating anything beyond the table;
rewording resolutions.
1) DONE_LIST — the table's done: for each {id, resolution}: get_task(id); already
   DONE -> skip; else update_task(status="DONE", resolution=<verbatim>) — never
   replace the description.
2) FAILED_LIST — the table's failed: for each {id, reason}: get_task; already
   BLOCKED -> skip; else update_task(status="BLOCKED") and APPEND the reason to the
   description as a '## Blocked: <reason>' section (keep the original text).
3) SKIPPED_LIST — the table's skipped: for each {id, dep}: get_task; description
   already contains a '## Skipped' section -> skip; else APPEND a
   '## Skipped: dependency task-<dep> failed' section (status stays TODO — the task
   waits for the next run).
4) PARITY_FAILED_LIST — the table's parity_failed: dedup guard — search for the
   exact string '[epic-run:${table.epic}]' via conport search (fallback: list_progress
   paginated to the very end); if no entry with this prefix and this title ->
   log_progress '[epic-run:${table.epic}] plan task without a child: <title> — <outcome>'.
5) TAILS_LIST — the table's minors: when non-empty -> search/list_tasks for
   the EXACT title 'Tails of epic task-${table.epic}' (kind=epic, open); none ->
   add_task(kind="epic", priority=3, title='Tails of epic task-${table.epic}',
   description='Findings deferred from the epic run'). Then each entry: a child of
   the tails epic with the same title exists -> skip; else add_task(
   parent_task_id=<tails epic>, title, description, priority). Priority-1 entries
   are unresolved criticals and escalations; a priority-4 entry is the single
   minors umbrella. Create NOTHING beyond this list — deferred minors outside it
   live in the run ledger, never as tasks.
6) Run summary: log_progress '[epic-run:${table.epic}] result: ${table.close_resolution}'
   (same dedup guard: search, fallback full pagination) — numbers, not a chronicle.
7) Closing: only if the table's may_close is true. list_tasks(
   parent_task_id=${table.epic}, status="ALL", include_snoozed=true) -> 0 open ->
   update_task(${table.epic}, status="DONE", resolution=${JSON.stringify(table.close_resolution)}).
   An epic_not_ready error -> do NOT work around it: return the open children list
   as is.
Return a report per item: done | skipped_already | failed + details; a failed call
goes into failed_calls while the rest continue. Stamp the report with via:"mcp" —
branch B is the MCP path.`

// ---------------------------------------------------------------- helpers

function mkLedger(epicId) {
  const L = {
    epic: epicId, skeleton_version: SKELETON_VERSION, mode: 'PLAN',
    outcome: null, aborted: false, abort_reason: null, abort_detail: null,
    already_done: [], conport_only: [], uncovered: [], parity_failed: [],
    minors: [], gaps: null, gap_hunt: null, gap_minors: [], criticals: [],
    unresolved_criticals: [], escalations: [], rejected_gaps: [],
    accounting: null, pending_table: null, tasks: {}, notes: [],
    of: t => (L.tasks[t.key] = L.tasks[t.key] || { id: t.conport_id ?? null, title: t.title }),
    fail: (t, reason, detail) => { const r = L.of(t); r.state = 'FAILED'; r.reason = reason; r.detail = detail },
    built: (t, impl) => { const r = L.of(t); r.state = 'BUILT'; r.impl = impl },
    isBuilt: t => L.tasks[t.key] && L.tasks[t.key].state === 'BUILT',
    implOf: t => L.tasks[t.key].impl,
    approve: (t, sha) => { const r = L.tasks[t.key]; r.state = 'APPROVED'; r.head_sha = sha },
    isApproved: t => L.tasks[t.key] && L.tasks[t.key].state === 'APPROVED',
    headOf: t => L.tasks[t.key].head_sha,
    done: (t, sha) => { const r = L.of(t); r.state = 'DONE'; r.merge_sha = sha },
    conflict: (t, files) => {
      const r = L.of(t)
      if (r.conflicted) { r.state = 'FAILED'; r.reason = 'MERGE_CONFLICT' }
      else { r.conflicted = true; r.state = 'CONFLICT'; r.conflict_files = files }
    },
    isConflict: t => L.tasks[t.key] && L.tasks[t.key].state === 'CONFLICT',
    pendingMerge: t => L.tasks[t.key] && L.tasks[t.key].state === 'APPROVED',
    markUnknownMerge: q => q.forEach(t => { const r = L.of(t); r.state = 'UNKNOWN_MERGE' }),
    abortRun: (reason, detail) => { L.aborted = true; L.outcome = 'ABORTED'; L.abort_reason = reason; L.abort_detail = detail },
    collectMinors: (t, rev) => {
      for (const f of rev.findings)
        if (f.severity === 'MINOR' && !L.minors.some(m => m.file === f.file && m.what === f.what))
          L.minors.push({ ...f, from: t.key })
    },
    skippedDep: t => L.tasks[t.key] && L.tasks[t.key].state === 'SKIPPED_DEP',
    propagateSkips: waves => {
      const bad = new Map()                                  // produce -> key of the failed supplier
      for (const w of waves) for (const t of w) {
        const r = L.tasks[t.key]
        if (r && (r.state === 'FAILED' || r.state === 'SKIPPED_DEP' || r.state === 'UNKNOWN_MERGE'))
          (t.produces || []).forEach(p => { if (!bad.has(p)) bad.set(p, t.key) })
      }
      for (const w of waves) for (const t of w)
        if (!L.tasks[t.key] || !L.tasks[t.key].state) {
          const hit = (t.consumes || []).find(c => bad.has(c))
          if (hit !== undefined) { const r = L.of(t); r.state = 'SKIPPED_DEP'; r.dep = bad.get(hit) }
        }
    },
    classifyGaps: (hunt, gv, cap) => {
      L.gaps = hunt.gaps
      if (!gv) {                                             // verifier died: nothing is lost — everything to the tails, marked unverified
        L.gap_hunt = 'VERIFY_FAILED'
        L.gap_minors = hunt.gaps.map(g => ({ ...g, not_verified: true }))
        return
      }
      const verdictOf = g => gv.verdicts.find(v => v.gid === g.gid)
      const confirmed = hunt.gaps.filter(g => { const v = verdictOf(g); return v && v.verdict === 'CONFIRMED' })
      L.rejected_gaps = hunt.gaps.filter(g => { const v = verdictOf(g); return v && v.verdict === 'REJECTED' })
      const crit = confirmed.filter(g => verdictOf(g).severity_final === 'critical').sort((a, b) => a.gid - b.gid)
        .map(g => ({ ...g, proof: verdictOf(g).proof }))
      L.criticals = crit.slice(0, cap)
      L.escalations = crit.slice(cap)
      L.gap_minors = confirmed.filter(g => verdictOf(g).severity_final !== 'critical')   // CONFIRMED without severity_final is not lost
        .concat(hunt.gaps.filter(g => { const v = verdictOf(g); return !v || v.verdict === 'UNVERIFIABLE' }))
    },
    criticalsToFix: () => L.criticals,
    unresolved: (g, stage) => L.unresolved_criticals.push({ gid: g.gid, claim: g.claim, stage }),
    mergedBranches: () => Object.values(L.tasks).filter(r => r.state === 'DONE' && r.impl)
      .map(r => r.impl.branch),
    allWorktrees: () => Object.values(L.tasks).filter(r => r.impl && r.impl.worktree_path)
      .map(r => r.impl.worktree_path),
  }
  return L
}

const matchId = t => t.conport_id ?? t.id ?? (10000 + t.plan_index)
const keyNum = t => t.conport_id != null ? Number(t.conport_id) : 10000 + t.plan_index
const filesOf = t => t.files ? [...(t.files.modify || []), ...(t.files.test || [])] : null
const overlap = (a, b) => a.some(x => b.includes(x))
const conflictsWith = (a, b) => {
  const fa = filesOf(a), fb = filesOf(b)
  if (fa === null || fb === null) return true             // files unknown -> conflicts with everything (solo wave)
  if (overlap(fa, fb)) return true
  if ((a.produces || []).some(p => (b.consumes || []).includes(p))) return true
  if ((b.produces || []).some(p => (a.consumes || []).includes(p))) return true
  if ((b.deps || []).includes(a.conport_id) || (a.deps || []).includes(b.conport_id)) return true
  return false
}
function buildWaves(tasks, cap) {                          // tasks pre-sorted by numeric key
  const waves = []
  for (const t of tasks) {
    let depWave = -1
    waves.forEach((w, i) => {
      if (w.some(x => (t.deps || []).includes(x.conport_id) ||
                      (x.produces || []).some(p => (t.consumes || []).includes(p)))) depWave = i
    })
    let placed = false
    for (let i = depWave + 1; i < waves.length && !placed; i++)
      if (waves[i].length < cap && waves[i].every(x => !conflictsWith(x, t))) { waves[i].push(t); placed = true }
    if (!placed) waves.push([t])                           // a deps cycle degrades into solo waves — safe
  }
  return waves
}

function classifyCoverage(sc, L, noPlan) {
  return sc.tasks.map(t => {
    const key = t.conport_id != null ? String(t.conport_id) : 'p' + t.plan_index
    const done = t.coverage === 'already_done'
    const runnable = !done && t.kind === 'work' && (noPlan
      ? (t.coverage !== 'uncovered' && (t.acceptance || '').trim() !== '')
      : (t.coverage === 'both' || t.coverage === 'plan_only'))
    if (done) L.already_done.push(key)
    if (!noPlan && t.coverage === 'conport_only') L.conport_only.push({ id: t.conport_id, title: t.title })
    if (t.coverage === 'uncovered') L.uncovered.push({ id: t.conport_id, title: t.title })
    return { ...t, key, runnable }
  })
}
// PARITY_BLOCK_BEGIN — the parity core is pure and self-contained between these
// markers; the test file extracts it verbatim. Keep it free of workflow globals.
const planOnly = tasks => tasks.filter(t => t.coverage === 'plan_only')

// Plan vs the epic's children — deterministic, no agent judgement. The result keeps
// the shape applyParity consumes ({created, failed}); unplanned/closed are reported
// into the ledger notes only. A plan task with no child of its own is reported in
// failed: the creation step turns those into real children before applyParity runs,
// and whatever stays in failed travels to parity_failed as before.
const titleKey = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const CLOSED_STATES = ['DONE', 'CANCELLED']
function matchPlanToChildren(tasks, children) {
  const kids = (children ?? []).filter(c => c && c.id != null)
  const byTitle = new Map()
  for (const c of kids) if (!byTitle.has(titleKey(c.title))) byTitle.set(titleKey(c.title), c)
  // children already carried by a both-task are taken: the match may not reuse them
  const consumed = new Set(tasks.filter(t => t.conport_id != null).map(t => t.conport_id))
  const out = { created: [], failed: [], unplanned: [], closed: [] }
  for (const t of planOnly(tasks)) {
    const hit = byTitle.get(titleKey(t.title))
    if (!hit || consumed.has(hit.id)) {
      out.failed.push({ plan_index: t.plan_index, title: t.title, error: 'no free child of the epic carries this title' })
      continue
    }
    consumed.add(hit.id)
    out.created.push({ plan_index: t.plan_index, conport_id: hit.id, existed: true })
    if (CLOSED_STATES.includes(String(hit.status ?? '').toUpperCase()))
      out.closed.push(hit.id + ' ' + hit.title + ' (' + hit.status + ')')
  }
  // unplanned = every child the match did not take, duplicate titles included
  out.unplanned = kids.filter(c => !consumed.has(c.id)).map(c => c.id + ' ' + c.title)
  return out
}
// Ids handed back by the creation agent move from failed to created (existed:false),
// so applyParity sees one list and parity_failed never lists a task that has an id.
function applyCreated(par, created) {
  for (const c of (created ?? [])) {
    if (!c || c.conport_id == null || c.plan_index == null) continue
    const i = par.failed.findIndex(f => f.plan_index === c.plan_index)
    if (i < 0) continue
    // an id already carried by another entry stays failed: idempotency-by-title can
    // hand the same existing child back twice, and two plan tasks may not share a key
    if (par.created.some(x => x.conport_id === c.conport_id)) continue
    par.failed.splice(i, 1)
    par.created.push({ plan_index: c.plan_index, conport_id: c.conport_id, existed: false })
  }
  return par
}
function applyParity(tasks, par, L) {
  if (!par) { L.parity_failed = planOnly(tasks).map(t => ({ plan_index: t.plan_index, title: t.title })); return tasks }
  return tasks.map(t => {
    if (t.coverage !== 'plan_only') return t
    const hit = par.created.find(c => c.plan_index === t.plan_index)
    if (hit && hit.conport_id) return { ...t, conport_id: hit.conport_id, key: String(hit.conport_id) }
    L.parity_failed.push({ plan_index: t.plan_index, title: t.title })
    return t
  })
}
// PARITY_BLOCK_END
function applyMerge(L, q, mg) {
  for (const r of mg.results) {
    const t = q.find(x => matchId(x) === r.id); if (!t) continue
    if (r.status === 'MERGED' || r.status === 'ALREADY_MERGED') L.done(t, r.merge_sha)
    else if (r.status === 'CONFLICT') L.conflict(t, r.conflict_files)
    else if (r.status === 'GATE_RED') L.fail(t, 'GATE_RED', r.gate_tail)
    else if (r.status === 'RED_BASELINE') L.abortRun('RED_BASELINE', r.gate_tail)
    else if (r.status === 'DIRTY_ABORTED') L.abortRun('DIRTY_ABORTED', r.gate_tail)
  }
}
const gapAsTask = (g, r) => ({ id: 100000 + g.gid, conport_id: null, key: 'gap' + g.gid,
  branch: r.branch, head_sha: r.head_sha, title: 'gap fix: ' + g.min_action.title })

// The epic accounting table. Its key set is the contract with branch A of the
// accountant — the helper's `account` command executes exactly this shape over
// the REST API — so a key added here and unknown there makes the helper refuse
// the table whole and the whole run fall back to branch B.
// EPIC_TABLE_KEYS_BEGIN — mirrored by EPIC_TABLE_KEYS in wf-helper.mjs, compared
// key for key by the drift test; the table is emitted through this list, so a key
// added below without being added here never reaches the helper.
const EPIC_TABLE_KEYS = ['project_id', 'epic', 'done', 'failed', 'skipped',
  'parity_failed', 'minors', 'verdict', 'may_close', 'close_resolution']
// EPIC_TABLE_KEYS_END
function buildCallTable(sc, L, goal) {
  const rows = Object.entries(L.tasks)
  const doneList = rows.filter(([, r]) => r.state === 'DONE' && r.id)
    .map(([, r]) => ({ id: r.id, resolution: 'merged as ' + r.merge_sha + '; review clean; full gate green' }))
  const failedList = rows.filter(([, r]) => r.state === 'FAILED' && r.id)
    .map(([, r]) => ({ id: r.id, reason: r.reason + (r.detail ? ': ' + JSON.stringify(r.detail) : '') }))
  const skippedList = rows.filter(([, r]) => r.state === 'SKIPPED_DEP' && r.id)
    .map(([, r]) => ({ id: r.id, dep: r.dep }))               // dep = the failed supplier's key from propagateSkips
  const deferred = L.minors.map(f => '- ' + f.file + (f.line ? ':' + f.line : '') + ' — ' + f.what + (f.fix ? ' (fix: ' + f.fix + ')' : '') + ' [task ' + f.from + ']')
    .concat((L.gap_minors || []).map(g => '- ' + (g.not_verified ? '[NOT VERIFIED] ' : '') + g.min_action.title + ' — ' + g.claim))
  const minors = L.unresolved_criticals.map(u => ({
    title: 'UNRESOLVED CRITICAL: ' + u.claim, priority: 1,
    description: 'Critical gap not fixed in the run (failed at ' + u.stage + ').' }))
    .concat(L.escalations.map(g => ({
      title: 'ESCALATED CRITICAL: ' + g.min_action.title, priority: 1,
      description: 'Confirmed critical beyond the per-run cap: ' + g.claim })))
    .concat((FILE_MINORS && deferred.length) ? [{
      title: 'Review minors of the epic run', priority: 4,
      description: ('Deferred minors and unverified gap findings of the run:\n' + deferred.join('\n')).slice(0, 1900) }] : [])
  // by default deferred minors travel ONLY in the returned ledger — they never become tasks
  const mayClose = !!goal && goal.verdict === 'READY' &&
    !L.unresolved_criticals.length && !L.escalations.length
  const planRowsTotal = rows.filter(([k]) => !k.startsWith('gap')).length   // denominator counts plan tasks only, not gap fixes
  const table = { project_id: sc.project_id, epic: sc.epic.id, done: doneList, failed: failedList,
    skipped: skippedList, parity_failed: L.parity_failed, minors, verdict: goal ? goal.verdict : 'UNKNOWN',
    may_close: mayClose,
    close_resolution: 'plan tasks ' + doneList.length + '/' + planRowsTotal +
      ' merged; criticals fixed ' + (L.criticals.length - L.unresolved_criticals.length) + ' of ' +
      L.criticals.length + '; tails filed ' + minors.length + '; minors deferred in ledger ' + deferred.length +
      '; gate green; acceptance ' + (goal ? goal.verdict : 'UNKNOWN') }
  return Object.fromEntries(EPIC_TABLE_KEYS.map(k => [k, table[k]]))
}
function finishLedger(L, goal, acc) {
  L.goal = goal ?? null
  return L
}
const abort = (L, reason, detail) => { L.abortRun(reason, detail); return finishLedger(L, null, null) }
const mergeRow = (t, L, sha) => ({ id: matchId(t), branch: L.implOf(t).branch, head_sha: sha ?? L.headOf(t), title: t.title })
const fateOf = (L, t) => (L.tasks[t.key] && L.tasks[t.key].state) || (t.runnable ? 'PENDING' : t.coverage)

// ---------------------------------------------------------------- control flow

const L = mkLedger(EPIC)

phase('Preflight')
const pre = await retry('preflight', l => agent(prePrompt(), { label: l, effort: 'low', schema: S_PRE }))
if (!pre) return abort(L, 'ABORTED_PREFLIGHT')
// The version handshake, before any abort check: "unknown" means a stale helper
// in the plugin cache (it predates the stamp) — update the plugin first.
L.notes.push('helper_version:"' + (pre.helper_version ?? 'unknown') + '"')
if (!pre.clean) return abort(L, 'ABORTED_DIRTY', pre.dirty_paths)
if (pre.current_branch !== pre.branch)
  return abort(L, 'ABORTED_NOT_DEFAULT_BRANCH', pre.current_branch)   // mirrored from task.js
const MAIN = pre.branch

phase('Scout')
const sc = await retry('scout', l => agent(scoutPrompt(EPIC, PROJECT, A.plan), { label: l, schema: S_SCOUT }))
if (!sc) return abort(L, 'ABORTED_NO_SCOUT')
L.notes.push('scout via:"' + (sc.via ?? 'unknown') + '"')  // the branch that ran the scout: wf-helper (A) or mcp (B)
if (sc.epic.kind !== 'epic') return abort(L, 'ABORTED_NOT_EPIC', 'this id is not an epic — use /conport:task for a single task')
const noPlan = sc.plan_path === null
if (noPlan && !A.allowNoPlan) return abort(L, 'ABORTED_NO_PLAN', 'no plan file found — a plan is the source of task detail; pass args.allowNoPlan to run from ConPort briefs alone')
if (noPlan) L.mode = 'CONPORT_ONLY_NO_PLAN'

const gate = A.gate ?? sc.gate
if (!gate || !gate.commands || !gate.commands.length)
  return abort(L, 'ABORTED_NO_GATE', 'no gate resolved — pass args.gate or add a gate section to the plan Global Constraints')

phase('Baseline')
const base = await retry('baseline', l => agent(basePrompt(gate), { label: l, effort: 'low', schema: S_BASE }))
if (!base) return abort(L, 'ABORTED_BASELINE')
if (base.gate !== 'GREEN') return abort(L, 'ABORTED_RED_BASELINE', base.red_summary)

phase('Parity')
let tasks = classifyCoverage(sc, L, noPlan)
if (!noPlan && tasks.some(t => t.coverage === 'plan_only')) {
  const kids = await retry('children', l => agent(childrenPrompt(EPIC, sc.project_id), { label: l, effort: 'low', schema: S_CHILDREN }))
  const par = kids ? matchPlanToChildren(tasks, kids.children) : null
  // Missing children are created before applyParity, so an id earned here keeps the
  // task out of parity_failed; a dead agent leaves the task unmatched, as before.
  if (par && par.failed.length) {
    const missing = par.failed.map(f => {
      const t = tasks.find(x => x.plan_index === f.plan_index)
      return { plan_index: f.plan_index, title: f.title, brief: (t && t.acceptance) ? t.acceptance : '' }
    })
    const made = await retry('create-children', l => agent(createChildrenPrompt(EPIC, sc.project_id, missing), { label: l, effort: 'low', schema: S_CREATED }))
    if (made) applyCreated(par, made.created)
  }
  if (par && par.unplanned.length) L.notes.push('epic children outside the plan: ' + par.unplanned.join('; '))
  if (par && par.closed.length) L.notes.push('plan tasks whose child is already closed: ' + par.closed.join('; '))
  tasks = applyParity(tasks, par, L)
}

phase('Waves')                                  // pure JS, zero agents
const exec = tasks.filter(t => t.runnable)
exec.sort((a, b) => keyNum(a) - keyNum(b))      // deterministic order — resume depends on it
const waves = noPlan ? exec.map(t => [t]) : buildWaves(exec, CAP_WAVE)

phase('Execute')
for (let w = 0; w < waves.length; w++) {
  const live = waves[w].filter(t => !L.skippedDep(t))
  // 1) implementers: barrier, exactly one agent() call per thunk
  const impls = await parallel(live.map(t => () =>
    agent(implPrompt(t, sc, SERIAL, `epic${EPIC}/t${t.key}`), { label: `impl-${t.key}`, isolation: 'worktree', schema: S_IMPL })))
  // 2) follow-ups strictly by index (retries and re-dispatches are sequential)
  for (let i = 0; i < live.length; i++) {
    const t = live[i]; let r = impls[i]
    if (r === null)
      r = await agent(implPrompt(t, sc, SERIAL, `epic${EPIC}/t${t.key}-r2`), { label: `impl-${t.key}-r2`, isolation: 'worktree', schema: S_IMPL })
    if (r && r.status === 'NEEDS_CONTEXT')
      r = await agent(implPrompt(t, sc, SERIAL, `epic${EPIC}/t${t.key}-ctx`, { questions: r.questions }),
                      { label: `impl-${t.key}-ctx`, isolation: 'worktree', schema: S_IMPL })
    if (!r) { L.fail(t, 'IMPL_DEAD'); continue }
    if (r.status === 'BLOCKED' || r.status === 'NEEDS_CONTEXT') { L.fail(t, r.status, r.questions ?? r.concerns); continue }
    L.built(t, r)
  }
  const b = live.filter(t => L.isBuilt(t))
  // 3) reviewers: barrier, one call per thunk (read-only — parallel is safe)
  const revs = await parallel(b.map(t => () =>
    agent(revPrompt(t, sc, L.implOf(t), MAIN), { label: `rev-${t.key}`, schema: S_REV })))
  // 4) fixes / re-reviews strictly by index; budget: 1 + 1
  for (let i = 0; i < b.length; i++) {
    const t = b[i]
    let rev = revs[i] ?? await agent(revPrompt(t, sc, L.implOf(t), MAIN), { label: `rev-${t.key}-r2`, schema: S_REV })
    if (!rev) { L.fail(t, 'REVIEW_DEAD'); continue }        // no merge without a review, ever
    if (rev.findings.length) {                              // minors are fixed on the spot too
      const fx = await retry(`fix-${t.key}`, l =>
        agent(fixPrompt(t, rev, L.implOf(t), SERIAL), { label: l, schema: S_FIX }))
      if (!fx || fx.status !== 'DONE') {
        if (hard(rev)) { L.fail(t, 'FIX_FAILED'); continue }
        L.collectMinors(t, rev); L.approve(t, L.implOf(t).head_sha)  // minors alone never block — leftovers to the ledger
      } else {
        const r2 = await agent(revPrompt(t, sc, L.implOf(t), MAIN, { rereview: rev, fixed: fx }),
                               { label: `rev2-${t.key}`, schema: S_REV })
        if (!r2 || hard(r2)) { L.fail(t, 'RED_AFTER_FIX'); continue }
        L.collectMinors(t, r2); L.approve(t, fx.head_sha)
      }
    } else L.approve(t, L.implOf(t).head_sha)
  }
  // 5) wave batch merger: merges are sequential, the full gate runs after each
  const q = b.filter(t => L.isApproved(t))
  if (q.length) {
    const rows = q.map(t => mergeRow(t, L))
    let mg = await agent(mergePrompt(rows, gate), { label: `merge-w${w}`, effort: 'low', schema: S_MG })
    if (!mg) {                                               // not a blind retry
      const st = await agent(mergeStatePrompt(rows, gate), { label: `mstate-w${w}`, effort: 'low', schema: S_MG })
      if (!st) { L.markUnknownMerge(q) }
      else {
        applyMerge(L, q, st)
        const rest = q.filter(t => L.pendingMerge(t))
        if (rest.length) {
          mg = await agent(mergePrompt(rest.map(t => mergeRow(t, L)), gate), { label: `merge-w${w}-r2`, effort: 'low', schema: S_MG })
          mg ? applyMerge(L, rest, mg) : L.markUnknownMerge(rest)
        }
      }
    } else applyMerge(L, q, mg)
    if (L.aborted) return finishLedger(L, null, null)
    // 6) conflict retries: 1 rebase -> re-review of the new diff -> mini-merge
    for (const t of q.filter(t => L.isConflict(t))) {
      const rb = await agent(rebasePrompt(t, sc, L.implOf(t), SERIAL, MAIN), { label: `rebase-${t.key}`, schema: S_REB })
      const rr = (rb && rb.status === 'DONE')
        ? await agent(revPrompt(t, sc, L.implOf(t), MAIN, { postRebase: true, files: rb.conflict_files }),
                      { label: `rev-rb-${t.key}`, schema: S_REV })
        : null
      if (!rb || !rr || hard(rr)) { L.fail(t, 'MERGE_CONFLICT'); continue }
      const m1 = await agent(mergePrompt([mergeRow(t, L, rb.head_sha)], gate),
                             { label: `merge-${t.key}-rb`, effort: 'low', schema: S_MG })
      m1 ? applyMerge(L, [t], m1) : L.markUnknownMerge([t])  // a second conflict fails inside applyMerge
      if (L.aborted) return finishLedger(L, null, null)
    }
  }
  L.propagateSkips(waves)   // consumers of a failed task's produces in later waves -> SKIPPED_DEP, never dispatched
}

phase('Hunt')                                                // exactly one pass — a second hunt does not exist
const fates = exec.map(t => `${t.key} | ${t.title} | ${fateOf(L, t)} | ${t.files ? filesOf(t).join(',') : '-'}`).join('\n')
const hunt = await retry('hunt', l => agent(huntPrompt(sc, fates, pre.main_sha, MAIN), { label: l, schema: S_HUNT }))
if (!hunt) L.gap_hunt = 'SKIPPED_AGENT_FAILED'
else if (hunt.gaps.length) {
  const gv = await retry('gapverify', l => agent(gapVerifyPrompt(hunt.gaps, sc, MAIN), { label: l, schema: S_GV }))
  L.classifyGaps(hunt, gv, CAP_CRIT)
}

phase('Fix criticals')                                       // one round, capped; no second hunt
const crits = L.criticalsToFix()
if (crits.length) {
  const fi = await parallel(crits.map(g => () =>
    agent(gapImplPrompt(g, sc, SERIAL, `epic${EPIC}/gap${g.gid}`), { label: `gapimpl-${g.gid}`, isolation: 'worktree', schema: S_IMPL })))
  for (let i = 0; i < crits.length; i++) {
    const g = crits[i]; let r = fi[i]
    if (!r) r = await agent(gapImplPrompt(g, sc, SERIAL, `epic${EPIC}/gap${g.gid}-r2`, { attempt: 'r2' }),
                            { label: `gapimpl-${g.gid}-r2`, isolation: 'worktree', schema: S_IMPL })
    if (!r || (r.status !== 'DONE' && r.status !== 'DONE_WITH_CONCERNS')) { L.unresolved(g, 'impl'); continue }
    const rv = await retry(`gaprev-${g.gid}`, l => agent(gapRevPrompt(g, sc, r, MAIN), { label: l, schema: S_REV }))
    if (!rv || hard(rv)) { L.unresolved(g, 'review'); continue }
    const gt = gapAsTask(g, r)
    const m = await agent(mergePrompt([{ id: gt.id, branch: gt.branch, head_sha: gt.head_sha, title: gt.title }], gate),
                          { label: `gapmerge-${g.gid}`, effort: 'low', schema: S_MG })
    if (m) {
      applyMerge(L, [gt], m)
      if (L.tasks[gt.key] && L.tasks[gt.key].state !== 'DONE') L.unresolved(g, 'merge')
      if (L.aborted) return finishLedger(L, null, null)
    } else L.unresolved(g, 'merge')
  }
}

phase('Acceptance')
const ledgerBrief = JSON.stringify({
  outcomes: Object.fromEntries(Object.entries(L.tasks).map(([k, r]) => [k, { state: r.state, reason: r.reason ?? null, merge_sha: r.merge_sha ?? null }])),
  conport_only: L.conport_only, uncovered: L.uncovered, parity_failed: L.parity_failed,
  unresolved_criticals: L.unresolved_criticals, escalations: L.escalations, gap_hunt: L.gap_hunt,
})
const goal = await retry('goal', l => agent(goalPrompt(sc, ledgerBrief, gate, MAIN), { label: l, schema: S_GOAL }))
// null -> verdict UNKNOWN -> the epic is not closed (conservative)

phase('Accounting')
const table = buildCallTable(sc, L, goal)
const acc = await retry('account', l => agent(accountantPrompt(table), { label: l, effort: 'low', schema: S_ACC }))
if (!acc) { L.accounting = 'INCOMPLETE'; L.pending_table = table }
else {
  L.accounting = acc
  L.notes.push('account via:"' + (acc.via ?? 'unknown') + '"')  // the branch that ran the account: wf-helper (A) or mcp (B)
}

phase('Cleanup')
await agent(janPrompt(L.mergedBranches(), L.allWorktrees()), { label: 'janitor', effort: 'low', schema: S_JAN })
// merged branches are deleted; FAILED branches stay (forensics lives in branches); all worktrees are removed

L.outcome = L.outcome ?? (L.unresolved_criticals.length || L.escalations.length
  ? 'DONE_WITH_UNRESOLVED_CRITICALS'
  : (acc && acc.epic_closed) ? 'EPIC_CLOSED' : 'DONE_EPIC_OPEN')
return finishLedger(L, goal, acc)
