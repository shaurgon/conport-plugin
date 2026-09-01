export const meta = {
  name: 'task',
  description: 'Deterministic execution of one ConPort task: implement in a worktree, review, fix, merge behind the full gate, close',
  phases: [
    { title: 'Preflight' }, { title: 'Scout' }, { title: 'Baseline' },
    { title: 'Execute' }, { title: 'Merge' }, { title: 'Accounting' }, { title: 'Cleanup' },
  ],
}
// Mirror rule: shared prompt skeletons are duplicated in task.js and epic.js — edit both.

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (A.task === undefined || A.task === null) throw new Error('conport task workflow requires args: {task: <id>}')
const TASK = A.task
const PROJECT = A.project ?? null
const SERIAL = !!A.serialChecks
const FILE_MINORS = !!A.fileMinors // default: minors live in the ledger only — they never become tasks
const SKELETON_VERSION = 2        // prompt skeleton version; bump on every skeleton edit (mirror it)
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
  branch: { type: 'string' }, current_branch: { type: 'string' }, main_sha: { type: 'string' } } }

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

const scoutPrompt = (taskId, project, planPath) => `You are the scout for ConPort task-${taskId}. Mutate nothing.
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
  const gc = b.source === 'plan' && b.global_constraints && b.global_constraints.trim()
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

const accountantPrompt = table => {
  const minorsStep = table.minors_umbrella
    ? `3) MINORS (one umbrella, never scattered tasks): ensure the epic titled
   'Workflow run tails' exists — search/list_tasks by that EXACT title
   (kind=epic, open); none -> add_task(kind="epic", priority=4,
   title='Workflow run tails', description='Deferred review minors from
   workflow runs'). Then ONE child: a child with the exact title
   ${JSON.stringify(table.minors_umbrella.title)} exists -> skip; else
   add_task(parent_task_id=<that epic>, title=${JSON.stringify(table.minors_umbrella.title)},
   priority=4, description=<the umbrella body from the table, verbatim>).
   Umbrella body: ${JSON.stringify(table.minors_umbrella.description)}`
    : `3) MINORS: none to file — deferred minors travel in the run ledger and the
   resolution; do NOT create any task for them.`
  return `You are the ConPort accountant (conport MCP tools via ToolSearch, project_id=${table.project_id}).
Execute the table STRICTLY in order, each item behind an idempotency guard.
FORBIDDEN: creating anything beyond the table; rewording resolutions; creating
any ROOT task.
1) CLOSE ${JSON.stringify(table.close)}: if null skip; else get_task(id); already
   DONE -> skip; else update_task(task_id=<id>, status="DONE", resolution=<verbatim
   from the table>) — never replace the description.
2) BLOCK ${JSON.stringify(table.block)}: if null skip; else get_task(id); already
   BLOCKED -> skip; else update_task(task_id=<id>, status="BLOCKED") and APPEND to
   the description a '## Blocked: <reason>' section (keep the original text).
${minorsStep}
Return a report per item: done | skipped_already | failed + details; a failed call
goes into failed_calls while the rest continue.`
}

const janPrompt = (mergedBranches, allWorktrees) => `Mechanical cleanup, decide nothing.
Merged branches to delete: ${JSON.stringify(mergedBranches)} -> git branch -D each.
Every other branch of this run stays (forensics — the commits live in the branches).
Worktrees to remove: ${JSON.stringify(allWorktrees)} -> git worktree remove --force
each path that still exists, then git worktree prune.
Never push. Return JSON per schema.`

// ---------------------------------------------------------------- control flow

phase('Preflight')
const pre = await retry('preflight', l => agent(prePrompt(), { label: l, effort: 'low', schema: S_PRE }))
if (!pre) return abort('ABORTED_PREFLIGHT')
if (!pre.clean) return abort('ABORTED_DIRTY', pre.dirty_paths)
if (pre.current_branch !== pre.branch)
  return abort('ABORTED_NOT_DEFAULT_BRANCH', pre.current_branch)   // mirror this in epic.js
const MAIN = pre.branch

phase('Scout')
const sc = await retry('scout', l => agent(scoutPrompt(TASK, PROJECT, A.plan), { label: l, schema: S_SCOUT }))
if (!sc) return abort('ABORTED_NO_SCOUT')
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
  let mg = await agent(mergePrompt(q, gate, MAIN), { label: 'merge', effort: 'low', schema: S_MG })
  if (!mg) {
    const st = await agent(mergeStatePrompt(q, gate, MAIN), { label: 'mstate', effort: 'low', schema: S_MG })
    const s0 = st && st.results[0]
    if (s0 && s0.status === 'ALREADY_MERGED') mg = st
    else if (s0 && s0.status === 'RED_BASELINE') fail('RED_BASELINE', s0.gate_tail)   // symmetric to epic.js: on a red base the merge is not restarted
    else if (st) mg = await agent(mergePrompt(q, gate, MAIN), { label: 'merge-r2', effort: 'low', schema: S_MG })
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
      const m1 = await agent(mergePrompt([{ ...q[0], head_sha: rb.head_sha }], gate, MAIN),
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
  if (!acc) { L.accounting = 'INCOMPLETE'; L.pending_table = table } else L.accounting = acc
}

phase('Cleanup')
if (L.branch) await agent(
  janPrompt(L.outcome === 'MERGED' ? [L.branch] : [], impl && impl.worktree_path ? [impl.worktree_path] : []),
  { label: 'janitor', effort: 'low', schema: S_JAN })
L.outcome = L.outcome ?? 'UNKNOWN'
return L
