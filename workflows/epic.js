export const meta = {
  name: 'epic',
  description: 'Deterministic execution of one ConPort epic from its plan: waves of isolated implementers, per-task review, gated sequential merges, a single gap hunt, observed acceptance, ConPort accounting',
  phases: [
    { title: 'Preflight' }, { title: 'Scout' }, { title: 'Baseline' }, { title: 'Parity' },
    { title: 'Waves' }, { title: 'Execute' }, { title: 'Hunt' }, { title: 'Fix criticals' },
    { title: 'Acceptance' }, { title: 'Accounting' }, { title: 'Cleanup' },
  ],
}
// Mirror rule: shared prompt skeletons are duplicated in task.js and epic.js — edit both.

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (A.epic === undefined || A.epic === null) throw new Error('conport epic workflow requires args: {epic: <id>}')
const EPIC = A.epic
const PROJECT = A.project ?? null
const SERIAL = !!A.serialChecks
const FILE_MINORS = !!A.fileMinors // default: leftover minors live in the ledger only — they never become tasks
const CAP_WAVE = 5
const CAP_CRIT = 5
const SKELETON_VERSION = 2        // prompt skeleton version; bump on every skeleton edit (mirror it)
const retry = async (lbl, mk) => (await mk(lbl)) ?? (await mk(lbl + '-r2'))
const hard = rev => rev.findings.some(f => f.severity === 'CRITICAL' || f.severity === 'IMPORTANT')

// ---------------------------------------------------------------- schemas

const S_PRE = { type: 'object', required: ['clean', 'branch', 'current_branch', 'main_sha'], properties: {
  clean: { type: 'boolean' }, dirty_paths: { type: 'array', items: { type: 'string' } },
  branch: { type: 'string' }, current_branch: { type: 'string' }, main_sha: { type: 'string' } } }

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
  notes: { type: 'array', items: { type: 'string' } } } }

const S_PAR = { type: 'object', required: ['created'], properties: {
  created: { type: 'array', items: { type: 'object', required: ['plan_index'], properties: {
    plan_index: { type: 'integer' }, conport_id: { type: 'integer' }, existed: { type: 'boolean' } } } },
  failed: { type: 'array', items: { type: 'object', properties: {
    plan_index: { type: 'integer' }, error: { type: 'string' } } } } } }

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

const prePrompt = () => `Mechanical check, change nothing — with one exception: an existing MERGE_HEAD is
debris of an interrupted previous run — abort it. Return strict JSON per schema.
1) git status --porcelain -> clean/dirty + path list; if MERGE_HEAD exists:
   git merge --abort, then re-check.
2) git rev-parse HEAD; determine the current branch AND the repository's default
   branch (main / master / trunk / whatever this repo uses) — return BOTH names
   (current_branch and branch); the script aborts when they differ.`

const basePrompt = gate => `Mechanical check, change nothing. Run the project gate in ${gate.dir}:
${gate.commands.join('; ')}, one by one. Do not print secret values.
Red = real test failures / lint / type errors. On red return the last 30 lines.
Return strict JSON per schema.`

const mergePrompt = (q, gate, MAIN) => `Mechanics, strictly in list order, decide nothing, fix nothing. Branch list:
${JSON.stringify(q)}. For EACH in turn:
0) git status --porcelain: MERGE_HEAD exists -> git merge --abort (debris of an
   interruption), re-check; tree still dirty -> status=DIRTY_ABORTED for this branch
   (+ the path list in gate_tail) and STOP.
1) git merge-base --is-ancestor <head_sha> ${MAIN} -> already merged: skip the merge
   but still run the full gate (step 3); green -> status=ALREADY_MERGED, red ->
   status=RED_BASELINE and STOP (no further merging).
2) git merge --no-ff --no-commit <branch>. Conflict -> git merge --abort ->
   status=CONFLICT + conflicted file list, move to the next branch.
3) Full gate in ${gate.dir}: ${gate.commands.join('; ')}, one by one. Red -> git merge --abort ->
   status=GATE_RED + last 30 red lines (no secret values), move to the next branch.
4) Green -> git commit -m "merge task-<id>: <title>" -> status=MERGED + merge_sha.
No reset --hard, no fix attempts, NEVER push.
On an early STOP (DIRTY_ABORTED / RED_BASELINE) emit status=NOT_MERGED for every
remaining branch so the results array stays complete.
Return JSON: the result of each branch in order.`

const mergeStatePrompt = (q, gate, MAIN) => `Read-only recovery after an interrupted merge batch. The only mutation allowed: an
existing MERGE_HEAD is debris — git merge --abort it first.
Branch list: ${JSON.stringify(q)}. For EACH branch in order:
git merge-base --is-ancestor <head_sha> ${MAIN} -> status=ALREADY_MERGED, else
status=NOT_MERGED. Then run the full gate ONCE in ${gate.dir}: ${gate.commands.join('; ')};
red -> replace the status of the FIRST NOT_MERGED entry with RED_BASELINE (+ last
30 red lines in gate_tail). Fix nothing, merge nothing, never push.
Return JSON: the result of each branch in order.`

const janPrompt = (mergedBranches, allWorktrees) => `Mechanical cleanup, decide nothing.
Merged branches to delete: ${JSON.stringify(mergedBranches)} -> git branch -D each.
Every other branch of this run stays (forensics — the commits live in the branches).
Worktrees to remove: ${JSON.stringify(allWorktrees)} -> git worktree remove --force
each path that still exists, then git worktree prune.
Never push. Return JSON per schema.`

// ---------------------------------------------------------------- epic prompts

const scoutPrompt = (epicId, project, planPath) => `You are the scout for epic task-${epicId}. Mutate nothing.
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
   criterion). Children DONE/CANCELLED -> already_done. Return strict JSON per
   schema; minimal texts, pointers instead of copies.`

const parityPrompt = (epicId, pid, list) => `Mechanical bookkeeping via conport MCP tools (ToolSearch), project_id=${pid}. Decide
nothing. For each task in the list ${JSON.stringify(list.map(t => ({ plan_index: t.plan_index, title: t.title, acceptance: t.acceptance, plan_ref: t.lines ? `lines ${t.lines.from}-${t.lines.to}` : 'no line range' })))}:
first list_tasks(parent_task_id=${epicId}, status="ALL") — a child with the same title
already exists -> return its id (skip); else add_task(parent_task_id=${epicId}, title,
description = goal + acceptance + reference 'plan <path>, lines from-to' + the spec
doc reference) — keep the task THIN. Create NOTHING else. Return the
plan_index -> conport_id mapping per schema.`

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
  return `You implement exactly ONE task of epic task-${sc.epic.id} in a dedicated git worktree.
First actions: ${inprog} (2) git checkout -b
${branch} (the branch is mandatory — commits must survive worktree removal).
Task: ${t.title}. Files in scope: ${files}. Acceptance: ${t.acceptance}.
${brief}
Requirements are literal: do not "improve" names, formats, thresholds.
Interfaces from earlier tasks are contracts, do not change them: ${JSON.stringify(t.consumes ?? [])}.
=== GLOBAL CONSTRAINTS (from the plan, verbatim) === ${sc.global_constraints}
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
  return `You fix exactly ONE confirmed critical gap of epic task-${sc.epic.id} in a dedicated git worktree${r2}.
First action: git checkout -b ${branch} (the branch is mandatory — commits must
survive worktree removal). This gap has no ConPort task — skip any status update.
The gap (verified claim): ${g.claim}
Evidence: ${g.evidence ?? ''} ${g.proof ?? ''}
Minimal action to take: ${g.min_action.title}. ${g.min_action.note ?? ''}
Spec digest for context: ${sc.spec ? sc.spec.digest : 'none'}
=== GLOBAL CONSTRAINTS (from the plan, verbatim) === ${sc.global_constraints}
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

const accountantPrompt = table => `You are the ConPort accountant (conport MCP tools via ToolSearch, project_id=${table.project_id}).
Execute the table STRICTLY in order, each item behind an idempotency guard.
FORBIDDEN: add_task with parent_task_id=${table.epic}; creating anything beyond the table;
rewording resolutions.
1) DONE_LIST ${JSON.stringify(table.done)}: for each {id, resolution}: get_task(id); already
   DONE -> skip; else update_task(status="DONE", resolution=<verbatim>) — never
   replace the description.
2) FAILED_LIST ${JSON.stringify(table.failed)}: for each {id, reason}: get_task; already
   BLOCKED -> skip; else update_task(status="BLOCKED") and APPEND the reason to the
   description as a '## Blocked: <reason>' section (keep the original text).
3) SKIPPED_LIST ${JSON.stringify(table.skipped)}: for each {id, dep}: get_task; description
   already contains a '## Skipped' section -> skip; else APPEND a
   '## Skipped: dependency task-<dep> failed' section (status stays TODO — the task
   waits for the next run).
4) PARITY_FAILED_LIST ${JSON.stringify(table.parity_failed)}: dedup guard — search for the
   exact string '[epic-run:${table.epic}]' via conport search (fallback: list_progress
   paginated to the very end); if no entry with this prefix and this title ->
   log_progress '[epic-run:${table.epic}] plan task without a child: <title> — <outcome>'.
5) TAILS_LIST ${JSON.stringify(table.minors)}: when non-empty -> search/list_tasks for
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
7) Closing: only if ${JSON.stringify(table.may_close)} is true. list_tasks(
   parent_task_id=${table.epic}, status="ALL", include_snoozed=true) -> 0 open ->
   update_task(${table.epic}, status="DONE", resolution=${JSON.stringify(table.close_resolution)}).
   An epic_not_ready error -> do NOT work around it: return the open children list
   as is.
Return a report per item: done | skipped_already | failed + details; a failed call
goes into failed_calls while the rest continue.`

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
const planOnly = tasks => tasks.filter(t => t.coverage === 'plan_only')
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
  return { project_id: sc.project_id, epic: sc.epic.id, done: doneList, failed: failedList,
    skipped: skippedList, parity_failed: L.parity_failed, minors, verdict: goal ? goal.verdict : 'UNKNOWN',
    may_close: mayClose,
    close_resolution: 'plan tasks ' + doneList.length + '/' + planRowsTotal +
      ' merged; criticals fixed ' + (L.criticals.length - L.unresolved_criticals.length) + ' of ' +
      L.criticals.length + '; tails filed ' + minors.length + '; minors deferred in ledger ' + deferred.length +
      '; gate green; acceptance ' + (goal ? goal.verdict : 'UNKNOWN') }
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
if (!pre.clean) return abort(L, 'ABORTED_DIRTY', pre.dirty_paths)
if (pre.current_branch !== pre.branch)
  return abort(L, 'ABORTED_NOT_DEFAULT_BRANCH', pre.current_branch)   // mirrored from task.js
const MAIN = pre.branch

phase('Scout')
const sc = await retry('scout', l => agent(scoutPrompt(EPIC, PROJECT, A.plan), { label: l, schema: S_SCOUT }))
if (!sc) return abort(L, 'ABORTED_NO_SCOUT')
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
  const par = await retry('parity', l => agent(parityPrompt(EPIC, sc.project_id, planOnly(tasks)), { label: l, effort: 'low', schema: S_PAR }))
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
    let mg = await agent(mergePrompt(rows, gate, MAIN), { label: `merge-w${w}`, effort: 'low', schema: S_MG })
    if (!mg) {                                               // not a blind retry
      const st = await agent(mergeStatePrompt(rows, gate, MAIN), { label: `mstate-w${w}`, effort: 'low', schema: S_MG })
      if (!st) { L.markUnknownMerge(q) }
      else {
        applyMerge(L, q, st)
        const rest = q.filter(t => L.pendingMerge(t))
        if (rest.length) {
          mg = await agent(mergePrompt(rest.map(t => mergeRow(t, L)), gate, MAIN), { label: `merge-w${w}-r2`, effort: 'low', schema: S_MG })
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
      const m1 = await agent(mergePrompt([mergeRow(t, L, rb.head_sha)], gate, MAIN),
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
    const m = await agent(mergePrompt([{ id: gt.id, branch: gt.branch, head_sha: gt.head_sha, title: gt.title }], gate, MAIN),
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
else L.accounting = acc

phase('Cleanup')
await agent(janPrompt(L.mergedBranches(), L.allWorktrees()), { label: 'janitor', effort: 'low', schema: S_JAN })
// merged branches are deleted; FAILED branches stay (forensics lives in branches); all worktrees are removed

L.outcome = L.outcome ?? (L.unresolved_criticals.length || L.escalations.length
  ? 'DONE_WITH_UNRESOLVED_CRITICALS'
  : (acc && acc.epic_closed) ? 'EPIC_CLOSED' : 'DONE_EPIC_OPEN')
return finishLedger(L, goal, acc)
