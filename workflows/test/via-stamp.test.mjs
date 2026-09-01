import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The scout and the accountant each run through one of two branches — A, the
// wf-helper, or B, the MCP fallback — and without a stamp the two are
// indistinguishable in a run report: the owner could pay an LLM for the
// hard-coded path indefinitely and never learn. The helper stamps its scout and
// account output with via:"wf-helper"; the workflow prompts stamp branch B with
// via:"mcp"; the ledger carries the stamp — the scout's in L.notes, the
// accountant's inside L.accounting, where the report lands whole.
const WORKFLOWS = dirname(dirname(fileURLToPath(import.meta.url)))
const HELPER = join(WORKFLOWS, 'wf-helper.mjs')
const KEY = 'test_key_never_printed'
const PROJECT = 'sample-project'
const PROJECT_ID = 42                              // a neutral id: no real project is implied

// ------------------------------------------------------------------ REST mock

// The minimum of the surface these stamps travel over: project resolution and
// one task (the scout), the progress journal (the epic account's run summary).
// The production API is never touched by these tests.
const startMock = async () => {
  const state = { progress: [], requests: [] }
  const send = (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      state.requests.push({ method: req.method, path: url.pathname })

      if (url.pathname === `/api/v1/projects/${PROJECT_ID}/progress`) {
        if (req.method === 'GET') return send(res, 200, { entries: state.progress, total: state.progress.length })
        const entry = { id: 700 + state.progress.length, title: null, description: '' }
        state.progress.push(entry)
        return send(res, 201, entry)
      }
      if (url.pathname === `/api/v1/projects/${PROJECT_ID}/tasks/901`)
        return send(res, 200, { id: 901, title: 'first thing', status: 'TODO', kind: 'task', parent_task_id: null, description: 'do it' })
      const project = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/)
      if (project) return send(res, 200, { id: PROJECT_ID, name: PROJECT })
      return send(res, 404, { detail: 'no route ' + url.pathname })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${server.address().port}/api/v1`
  state.close = () => new Promise(resolve => server.close(resolve))
  return state
}

const withMock = body => async () => {
  const mock = await startMock()
  try { await body(mock) } finally { await mock.close() }
}

// ------------------------------------------------------------------ invocation

const roots = []
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'wfv-')); roots.push(d); return d }

// The mock serves from this very process, so the helper must be spawned
// asynchronously: a synchronous spawn would block the event loop the server
// answers on, and the two would wait for each other forever.
const runHelper = (mock, ...argv) => new Promise((resolve, reject) => {
  const env = { ...process.env, CONPORT_API_URL: mock.url, CONPORT_API_KEY: KEY }
  const p = spawn(process.execPath, [HELPER, ...argv], { env })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', c => { stdout += c })
  p.stderr.on('data', c => { stderr += c })
  p.on('error', reject)
  p.on('close', code => resolve({ code, stdout, stderr }))
})

const runStamped = async (mock, ...argv) => {
  const r = await runHelper(mock, ...argv)
  assert.equal(r.code, 0, 'exit 0 expected, stderr: ' + r.stderr)
  const out = JSON.parse(r.stdout)
  // The literal stamp, not just a parsed field: the ledger note and any grep of
  // a raw run transcript rely on this exact byte sequence.
  assert.ok(r.stdout.includes('"via":"wf-helper"'), 'the stamp travels literally in stdout: ' + r.stdout)
  assert.equal(out.via, 'wf-helper')
  return out
}

const tableFile = table => {
  const path = join(scratch(), 'table.json')
  writeFileSync(path, JSON.stringify(table))
  return path
}

// ------------------------------------------------------- the helper's stamp

test('scout output is stamped via:"wf-helper"', withMock(async mock => {
  const out = await runStamped(mock, 'scout', '--task', '901', '--project', PROJECT, '--repo-root', scratch())
  assert.equal(out.task.id, 901, 'the stamp rides a real scout answer, not an error object')
}))

test('account output of a task table is stamped via:"wf-helper"', withMock(async mock => {
  const out = await runStamped(mock, 'account', '--table',
    tableFile({ project_id: PROJECT_ID, close: null, block: null, minors_umbrella: null }))
  assert.equal(out.task_closed, false, 'the stamp rides the S_ACC report shape')
}))

test('account output of an epic table is stamped via:"wf-helper"', withMock(async mock => {
  const out = await runStamped(mock, 'account', '--table', tableFile({
    project_id: PROJECT_ID, epic: 100, done: [], failed: [], skipped: [],
    parity_failed: [], minors: [], verdict: 'READY', may_close: false, close_resolution: 'r',
  }))
  assert.equal(out.epic_closed, false, 'the stamp rides the epic report shape')
}))

// ------------------------------------------------------- the ledger's stamp

// The workflow runner evaluates task.js and epic.js with injected globals, so the
// carrying of the stamp into the ledger is asserted on the shipped source — the
// same way the scout-step2 parity test pins its instruction. Removing any of
// these mechanisms turns the assertion red.
const source = file => readFileSync(join(WORKFLOWS, file), 'utf8')

// The exact line both control flows run right after a scout survives: the branch
// stamp becomes a ledger note, L.notes carrying scout via:"wf-helper" (A) or
// via:"mcp" (B).
const SCOUT_NOTE = `L.notes.push('scout via:"' + (sc.via ?? 'unknown') + '"')`

// Its accountant twin: written right after L.accounting = acc, so a branch-B
// accountant that ignored the stamp instruction still leaves a visible
// account via:"unknown" note instead of a silently unstamped ledger.
const ACCOUNT_NOTE = `L.notes.push('account via:"' + (acc.via ?? 'unknown') + '"')`

for (const file of ['task.js', 'epic.js']) {
  test(`${file}: the scout stamp reaches L.notes`, () => {
    const src = source(file)
    assert.ok(src.includes(SCOUT_NOTE), `the scout via note is missing from ${file}`)
    assert.ok(src.indexOf(SCOUT_NOTE) > src.indexOf('ABORTED_NO_SCOUT'),
      'the note is written once a scout answer exists')
  })

  test(`${file}: the account report lands in L.accounting whole, stamp included`, () => {
    const src = source(file)
    assert.ok(src.includes('L.accounting = acc'), `the report must land in the ledger verbatim in ${file}`)
    assert.ok(src.includes(ACCOUNT_NOTE), `the account via note is missing from ${file}`)
    assert.ok(src.indexOf(ACCOUNT_NOTE) > src.indexOf('L.accounting = acc'),
      'the note is written once the report has landed in the ledger')
    assert.ok((src.match(/via: \{ type: 'string' \}/g) ?? []).length >= 2,
      `S_SCOUT and S_ACC must both accept the via stamp in ${file}, or validation may drop it`)
  })

  test(`${file}: branch B stamps via:"mcp" in the scout and the accountant`, () => {
    const src = source(file)
    assert.ok(src.includes('set via="mcp"'), `the scout's branch B is unstamped in ${file}`)
    assert.ok(src.includes('Stamp the report with via:"mcp"'), `the accountant's branch B is unstamped in ${file}`)
    assert.ok(src.includes('spec_doc_id / via'), `the scout base does not name via as a carried key in ${file}`)
  })
}
