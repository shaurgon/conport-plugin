// The session-epic tails loop: PostToolUse records the epics a session
// changed, Stop holds the turn while their children are open, and
// UserPromptSubmit prints the [TAILS] block only when its composition changed.
// Every hook runs as the real script in a child process against a local
// stand-in for the ConPort REST API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOL_ADD = 'mcp__plugin_conport_conport__add_task'
const TOOL_UPDATE = 'mcp__plugin_conport_conport__update_task'

// Fake API: `children` is the task table (parent_task_id per row), `tails`
// the body of GET /epic-tails. Every request is recorded.
async function startApi() {
  const api = { children: [], tails: [], milestones: null, requests: [] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    api.requests.push(url)
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/v1/projects/11/tasks') {
      const parents = (url.searchParams.get('parent_task_ids') || '').split(',').map(Number)
      const rows = api.children.filter((c) => parents.includes(c.parent_task_id))
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 50)
      res.end(JSON.stringify({ tasks: rows.slice(offset, offset + limit), total: rows.length }))
    } else if (url.pathname === '/api/v1/projects/11/milestones' && api.milestones) {
      res.end(JSON.stringify(api.milestones))
    } else if (url.pathname === '/api/v1/projects/11/epic-tails') {
      res.end(JSON.stringify({ tails: api.tails }))
    } else {
      res.statusCode = 404
      res.end('{}')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  api.url = `http://127.0.0.1:${server.address().port}`
  api.close = () => new Promise((resolve) => server.close(resolve))
  return api
}

function runHook(script, payload, { api, dataDir }) {
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_OPTION_API_KEY
  Object.assign(env, {
    CLAUDE_PLUGIN_DATA: dataDir,
    CONPORT_URL: api.url,
    CONPORT_API_KEY: 'cport_test_key',
    CONPORT_PROJECT_ID: '11',
  })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], { env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(JSON.stringify(payload))
  })
}

// An MCP tool result as the harness hands it over: content blocks of JSON text.
const mcpResult = (obj) => [{ type: 'text', text: JSON.stringify(obj) }]

const child = (id, parent, status, extra = {}) => ({
  id, parent_task_id: parent, status, title: `child ${id}`,
  created_at: '2026-09-01T10:00:00Z', started_at: null, ...extra,
})

async function withEnv(fn) {
  const api = await startApi()
  const dataDir = mkdtempSync(join(tmpdir(), 'conport-hooks-'))
  try {
    await fn({ api, dataDir })
  } finally {
    await api.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

const addUnderEpic = (ctx, session, epicId, taskId, title = `Epic ${epicId}`) =>
  runHook('track-session-epics.js', {
    session_id: session,
    tool_name: TOOL_ADD,
    tool_input: { project_id: 11, title: `child ${taskId}`, parent_task_id: epicId },
    tool_response: mcpResult({
      id: taskId, summary: 'created',
      epic_progress: { epic_id: epicId, epic_title: title, open_children: 1, total_children: 1 },
    }),
  }, ctx)

const stop = (ctx, session, extra = {}) =>
  runHook('stop-epic-tails.js', { session_id: session, stop_hook_active: false, ...extra }, ctx)

test('a session that grew its epic past three open children gets the whole list at Stop', () => withEnv(async (ctx) => {
  for (const id of [51, 52, 53, 54, 55]) await addUnderEpic(ctx, 's1', 50, id, 'Review follow-ups')
  ctx.api.children = [51, 52, 53, 54, 55].map((id) => child(id, 50, 'TODO'))
    .concat([child(56, 50, 'DONE')])

  const { code, out } = await stop(ctx, 's1')
  assert.equal(code, 0)
  const verdict = JSON.parse(out)
  assert.equal(verdict.decision, 'block')
  assert.match(verdict.reason, /task-50 Review follow-ups — 5 open/)
  for (const id of [51, 52, 53, 54, 55]) assert.match(verdict.reason, new RegExp(`task-${id} \\[TODO\\]`))
  assert.doesNotMatch(verdict.reason, /task-56/)
}))

test('the Stop reason is conditional on a readiness claim, not an order to do the work', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  const [first, ...rest] = JSON.parse((await stop(ctx, 's1')).out).reason.split('\n')
  assert.match(first, /^\[TAILS\] If this turn reports the work as done, it is not/)
  assert.match(first, /name them to the user\. Otherwise end the turn as planned\.$/)
  for (const line of rest) assert.doesNotMatch(line, /Finish|then close/)
}))

test('an epic with a single open child is listed too — no near-closing threshold for session epics', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 40, 41)
  ctx.api.children = [child(41, 40, 'IN_PROGRESS')]
  const verdict = JSON.parse((await stop(ctx, 's1')).out)
  assert.match(verdict.reason, /task-41 \[IN_PROGRESS\]/)
}))

test('a session that changed no epic gets nothing at Stop and spends no request', () => withEnv(async (ctx) => {
  // A write on a root task: the server echoes no epic_progress.
  await runHook('track-session-epics.js', {
    session_id: 's1', tool_name: TOOL_UPDATE,
    tool_input: { project_id: 11, task_id: 7, status: 'DONE' },
    tool_response: mcpResult({ id: 7, status: 'DONE', summary: 'closed' }),
  }, ctx)
  ctx.api.children = [child(51, 50, 'TODO')]
  const { code, out } = await stop(ctx, 's1')
  assert.equal(code, 0)
  assert.equal(out, '')
  assert.equal(ctx.api.requests.length, 0)
}))

test("another session's epics are not this session's tails", () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 'other', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal((await stop(ctx, 's1')).out, '')
}))

test('Stop stays silent once every child of the session epics is closed', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'DONE'), child(52, 50, 'CANCELLED')]
  assert.equal((await stop(ctx, 's1')).out, '')
}))

test('Stop holds a turn only once per stop cycle', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal((await stop(ctx, 's1', { stop_hook_active: true })).out, '')
}))

const held = async (ctx, session) => {
  const { code, out } = await stop(ctx, session)
  assert.equal(code, 0)
  return out ? JSON.parse(out).decision === 'block' : false
}

test('Stop does not hold a later turn on the same composition of tails', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO'), child(52, 50, 'IN_PROGRESS')]
  assert.equal(await held(ctx, 's1'), true)
  assert.equal((await stop(ctx, 's1')).out, '')                   // next turn, same tails
  ctx.api.children = [child(51, 50, 'TODO', { title: 'renamed' }), child(52, 50, 'IN_PROGRESS')]
  assert.equal(await held(ctx, 's1'), false)                      // a title is not composition
  assert.equal(await held(ctx, 's2'), false)                      // s2 changed no epic
  await addUnderEpic(ctx, 's2', 50, 51)
  assert.equal(await held(ctx, 's2'), true)                       // per-session memory
}))

test('Stop holds again once the composition of tails changes', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO'), child(52, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), true)

  ctx.api.children = [child(51, 50, 'IN_PROGRESS'), child(52, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), false)                      // a status move is not a new tail

  ctx.api.children = [child(51, 50, 'IN_PROGRESS'), child(52, 50, 'DONE')]
  assert.equal(await held(ctx, 's1'), true)                       // a child closed
  assert.equal(await held(ctx, 's1'), false)

  ctx.api.children.push(child(53, 50, 'TODO'))
  assert.equal(await held(ctx, 's1'), true)                       // a new child appeared
  assert.equal(await held(ctx, 's1'), false)

  await addUnderEpic(ctx, 's1', 60, 61)
  ctx.api.children.push(child(61, 60, 'TODO'))
  const reason = JSON.parse((await stop(ctx, 's1')).out).reason   // a new epic joined
  assert.match(reason, /task-50 Epic 50 — 2 open/)
  assert.match(reason, /task-60 Epic 60 — 1 open/)
  assert.equal(await held(ctx, 's1'), false)
}))

const milestone = (sequence, epicIds, isRelease = false) => ({
  sequence, is_release: isRelease, status: 'OPEN',
  epics: epicIds.map((id) => ({ task_id: id })),
})
const NO_RELEASE = /has no release milestone/

test('Stop lists only the epics the nearest release waits for', () => withEnv(async (ctx) => {
  for (const [epic, task] of [[50, 51], [60, 61], [70, 71], [80, 81]]) await addUnderEpic(ctx, 's1', epic, task)
  ctx.api.children = [child(51, 50, 'TODO'), child(61, 60, 'TODO'), child(71, 70, 'TODO'), child(81, 80, 'TODO')]
  // 50 before the release, 60 on the release point, 70 after it, 80 on no milestone
  ctx.api.milestones = [milestone(3, [70]), milestone(1, [50]), milestone(2, [60], true)]
  const reason = JSON.parse((await stop(ctx, 's1')).out).reason
  assert.match(reason, /task-50 /)
  assert.match(reason, /task-60 /)
  assert.doesNotMatch(reason, /task-70 /)
  assert.doesNotMatch(reason, /task-80 /)
  assert.doesNotMatch(reason, NO_RELEASE)
}))

test('Stop stays silent when every open tail is past the nearest release', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 70, 71)
  ctx.api.children = [child(71, 70, 'TODO')]
  ctx.api.milestones = [milestone(1, [], true), milestone(2, [70])]
  assert.equal((await stop(ctx, 's1')).out, '')
}))

test('a roadmap with no release point lists every tail and says to create one', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  await addUnderEpic(ctx, 's1', 80, 81)
  ctx.api.children = [child(51, 50, 'TODO'), child(81, 80, 'TODO')]
  ctx.api.milestones = [milestone(1, [50])]
  const reason = JSON.parse((await stop(ctx, 's1')).out).reason
  assert.match(reason, /task-50 /)
  assert.match(reason, /task-80 /)
  assert.match(reason, NO_RELEASE)
  assert.equal(await held(ctx, 's1'), false)                      // same composition
  ctx.api.milestones = [milestone(1, [50]), milestone(2, [], true)]
  const after = JSON.parse((await stop(ctx, 's1')).out).reason    // release created: new composition
  assert.match(after, /task-50 /)
  assert.doesNotMatch(after, /task-80 /)
  assert.doesNotMatch(after, NO_RELEASE)
}))

test('no release point and nothing open: no hold just to nag', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'DONE')]
  ctx.api.milestones = []
  assert.equal((await stop(ctx, 's1')).out, '')
}))

test('an unreadable roadmap lists every tail without the release reminder', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]                      // milestones route answers 404
  const reason = JSON.parse((await stop(ctx, 's1')).out).reason
  assert.match(reason, /task-50 /)
  assert.doesNotMatch(reason, NO_RELEASE)
}))

test('a child reopened after every tail closed is held again', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), true)
  ctx.api.children = [child(51, 50, 'DONE')]
  assert.equal(await held(ctx, 's1'), false)                      // nothing open
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), true)                       // reopened: a change
  assert.equal(await held(ctx, 's1'), false)
}))

test('a failed Stop fetch neither holds nor resets the held composition', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), true)
  const url = ctx.api.url
  ctx.api.url = 'http://127.0.0.1:1'                             // outage
  assert.equal(await held(ctx, 's1'), false)
  ctx.api.url = url
  assert.equal(await held(ctx, 's1'), false)                      // back, unchanged: still quiet
}))

test('an unwritable Stop memory still holds the turn rather than losing it', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  const state = join(ctx.dataDir, 'hook_state')
  chmodSync(state, 0o500)
  try {
    assert.equal(await held(ctx, 's1'), true)
  } finally {
    chmodSync(state, 0o700)
  }
}))

test('the Stop hold and the UserPromptSubmit [TAILS] block keep separate memories', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  ctx.api.tails = [{ epic_id: 50, title: 'Epic 50', suggested_action: 'Finish task-51, then close epic task-50' }]
  const prompt = async () => {
    const { out } = await runHook('user-prompt-submit.js', { session_id: 's1', prompt: 'hi' }, ctx)
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : ''
  }
  assert.match(await prompt(), /\[TAILS\] task-50/)
  assert.equal(await held(ctx, 's1'), true)                       // the prompt block did not count
  assert.doesNotMatch(await prompt(), /\[TAILS\]/)                // the hold did not reset it
  assert.equal(await held(ctx, 's1'), false)                      // nor the prompt the hold
}))

test('an unreadable Stop memory counts as changed, so the turn is held rather than lost', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 50, 51)
  ctx.api.children = [child(51, 50, 'TODO')]
  assert.equal(await held(ctx, 's1'), true)
  writeFileSync(join(ctx.dataDir, 'hook_state', 'stop_tails_held_s1.json'), 'not json')
  assert.equal(await held(ctx, 's1'), true)
  assert.equal(await held(ctx, 's1'), false)
}))

test('an epic that grew after work started is listed first', () => withEnv(async (ctx) => {
  await addUnderEpic(ctx, 's1', 60, 61)   // touched first, did not grow
  await addUnderEpic(ctx, 's1', 70, 71)   // grew after its first child started
  ctx.api.children = [
    child(61, 60, 'TODO', { created_at: '2026-09-01T10:00:00Z' }),
    child(62, 60, 'DONE', { created_at: '2026-09-01T10:00:00Z', started_at: '2026-09-02T10:00:00Z' }),
    child(71, 70, 'TODO', { created_at: '2026-09-05T10:00:00Z' }),
    child(72, 70, 'DONE', { created_at: '2026-09-01T10:00:00Z', started_at: '2026-09-02T10:00:00Z' }),
  ]
  const reason = JSON.parse((await stop(ctx, 's1')).out).reason
  const grown = reason.indexOf('[TAILS] task-70')
  const plain = reason.indexOf('[TAILS] task-60')
  assert.ok(grown > -1 && plain > -1, reason)
  assert.ok(grown < plain, reason)
  assert.match(reason, /task-70 Epic 70 \(grew after work started\)/)
  assert.doesNotMatch(reason, /task-60 Epic 60 \(grew/)
}))

test('a child status change recorded from a plain-object result makes its epic a session epic', () => withEnv(async (ctx) => {
  await runHook('track-session-epics.js', {
    session_id: 's1', tool_name: TOOL_UPDATE,
    tool_input: { project_id: 11, task_id: 81, status: 'IN_PROGRESS' },
    tool_response: { id: 81, status: 'IN_PROGRESS', epic_progress: { epic_id: 80, epic_title: 'Epic 80' } },
  }, ctx)
  ctx.api.children = [child(81, 80, 'IN_PROGRESS')]
  assert.match(JSON.parse((await stop(ctx, 's1')).out).reason, /task-80 Epic 80/)
}))

test('an unreadable add_task result still records the epic named in its input', () => withEnv(async (ctx) => {
  // Content blocks as the harness hands them over, carrying non-JSON text.
  await runHook('track-session-epics.js', {
    session_id: 's1', tool_name: TOOL_ADD,
    tool_input: { project_id: 11, title: 'x', parent_task_id: 90 },
    tool_response: [{ type: 'text', text: 'created task-91' }],
  }, ctx)
  ctx.api.children = [child(91, 90, 'TODO')]
  assert.match(JSON.parse((await stop(ctx, 's1')).out).reason, /\[TAILS\] task-90 — 1 open\n {2}· task-91/)
}))

test('a readable add_task payload without the epic echo records nothing, even with a parent in the input', () => withEnv(async (ctx) => {
  await runHook('track-session-epics.js', {
    session_id: 's1', tool_name: TOOL_ADD,
    tool_input: { project_id: 11, title: 'x', parent_task_id: 90 },
    tool_response: mcpResult({ id: 91, summary: 'created' }),
  }, ctx)
  ctx.api.children = [child(91, 90, 'TODO')]
  assert.equal((await stop(ctx, 's1')).out, '')
}))

test('the UserPromptSubmit [TAILS] block is printed only when its composition changes', () => withEnv(async (ctx) => {
  const cache = join(ctx.dataDir, 'hook_state', 'epic_tails_11.json')
  const prompt = async (session) => {
    const { out } = await runHook('user-prompt-submit.js', { session_id: session, prompt: 'hi' }, ctx)
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : ''
  }
  const tail = (id, action) => ({ epic_id: id, title: `Epic ${id}`, suggested_action: action })

  ctx.api.tails = [tail(50, 'Finish task-51, then close epic task-50 with a resolution')]
  assert.match(await prompt('s1'), /\[TAILS\] task-50/)
  assert.doesNotMatch(await prompt('s1'), /\[TAILS\]/)          // cached, unchanged
  rmSync(cache)
  assert.doesNotMatch(await prompt('s1'), /\[TAILS\]/)          // re-fetched, unchanged
  assert.match(await prompt('s2'), /\[TAILS\] task-50/)         // a new session sees it once

  ctx.api.tails = [tail(50, 'Close epic task-50 with a resolution')]
  rmSync(cache)
  const changed = await prompt('s1')
  assert.match(changed, /\[TAILS\] task-50 Epic 50 — Close epic task-50/)
  assert.ok(JSON.parse(readFileSync(cache, 'utf8')).ok)
}))

test('a failed tails fetch neither prints nor resets what the session was shown', () => withEnv(async (ctx) => {
  const cache = join(ctx.dataDir, 'hook_state', 'epic_tails_11.json')
  const prompt = async () => {
    const { out } = await runHook('user-prompt-submit.js', { session_id: 's1', prompt: 'hi' }, ctx)
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : ''
  }
  ctx.api.tails = [{ epic_id: 50, title: 'Epic 50', suggested_action: 'Close epic task-50 with a resolution' }]
  assert.match(await prompt(), /\[TAILS\] task-50/)
  rmSync(cache)
  const url = ctx.api.url
  ctx.api.url = 'http://127.0.0.1:1'                             // outage
  assert.doesNotMatch(await prompt(), /\[TAILS\]/)
  ctx.api.url = url
  rmSync(cache)
  assert.doesNotMatch(await prompt(), /\[TAILS\]/)               // back, unchanged: still quiet
}))
