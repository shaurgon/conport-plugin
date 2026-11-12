import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, RUNS, source } from './run-workflow.mjs'

// An agent of a workflow run that meets a problem of the conport service itself
// has no person to ask, so it files nothing: it answers the report in
// service_reports. The run collects every such report from its agents' answers
// into the ledger, as a list of its own, and tells the session to take each one
// through the steps of the conport skill's reporting section that ask the user and
// file — otherwise the report dies with the agent's answer.
const REPORT = { title: '[agent-report] get_task: refusal names no action', body: '### Kind\nunclear-refusal' }
const OTHER = { title: '[agent-report] arch_submit: missing kind', body: '### Kind\nmissing' }

// The labels of the judgement agents of a green run, and of its mechanical pipes.
const JUDGEMENT = { 'task.js': ['scout', 'impl', 'rev', 'account'],
  'epic.js': ['scout', 'impl-501', 'rev-501', 'hunt', 'anchors', 'goal', 'account'] }
const PIPES = { 'task.js': ['preflight', 'baseline', 'merge', 'janitor', 'j-brief'],
  'epic.js': ['preflight', 'baseline', 'merge-w0', 'janitor', 'j-brief-501'] }

for (const { file, run, green } of RUNS) {
  const go = async (over = {}) => {
    const { args, answers } = run(over)
    return runWorkflow(file, args, answers)
  }
  const implLabel = file === 'task.js' ? 'impl' : 'impl-501'
  const revLabel = file === 'task.js' ? 'rev' : 'rev-501'
  const answerOf = label => run().answers[label]

  test(`${file}: a run whose agents report nothing returns an empty list and no action`, async () => {
    const { ledger } = await go()
    assert.equal(ledger.outcome, green)
    assert.deepEqual(ledger.service_reports, [])
    assert.equal(ledger.service_reports_action, null)
  })

  test(`${file}: a report in an agent's answer is in the run's result, with the action for the session`, async () => {
    const { ledger } = await go({ [implLabel]: { ...answerOf(implLabel), service_reports: [REPORT] } })
    assert.equal(ledger.outcome, green, 'the report changes nothing else of the run')
    assert.deepEqual(ledger.service_reports, [{ ...REPORT, from: implLabel }])
    assert.match(ledger.service_reports_action, /REPORTING TO THE SERVICE DEVELOPERS in the conport skill/)
    assert.match(ledger.service_reports_action, /ask the user[\s\S]*only after the user agrees/)
    assert.match(ledger.service_reports_action, /with gh, or without gh by the links/)
    assert.doesNotMatch(ledger.service_reports_action, /step \d|steps \d/, 'steps are named by what they do, never by number')
  })

  test(`${file}: reports of several agents are collected in order, the same report once`, async () => {
    const { ledger } = await go({
      [implLabel]: { ...answerOf(implLabel), service_reports: [REPORT] },
      [revLabel]: { ...answerOf(revLabel), service_reports: [REPORT, OTHER] },
    })
    assert.deepEqual(ledger.service_reports, [{ ...REPORT, from: implLabel }, { ...OTHER, from: revLabel }])
  })

  test(`${file}: a run that aborts still returns the reports its agents gave before`, async () => {
    // The scout reports, then the run aborts for want of a gate.
    const scout = { ...answerOf('scout'), gate: null, service_reports: [REPORT] }
    const { ledger } = await go({ scout })
    assert.equal(ledger.abort_reason, 'ABORTED_NO_GATE')
    assert.deepEqual(ledger.service_reports, [{ ...REPORT, from: 'scout' }])
    assert.match(ledger.service_reports_action, /REPORTING TO THE SERVICE DEVELOPERS/)
  })

  test(`${file}: a malformed entry is dropped, the well-formed one kept`, async () => {
    const { ledger } = await go({ [implLabel]: { ...answerOf(implLabel),
      service_reports: [{ title: 'no body' }, 'a string', null, REPORT] } })
    assert.deepEqual(ledger.service_reports, [{ ...REPORT, from: implLabel }])
  })

  test(`${file}: every judgement agent is offered service_reports and told to fill it; no pipe is`, async () => {
    const { calls } = await go()
    const of = label => calls.find(c => c.label === label)
    for (const label of JUDGEMENT[file]) {
      const c = of(label)
      assert.ok(c, `${label} was dispatched`)
      const items = c.opts.schema.properties.service_reports && c.opts.schema.properties.service_reports.items
      assert.ok(items, `${label}: the schema admits service_reports`)
      assert.deepEqual(items.required, ['title', 'body'], `${label}: a report is a title and a body`)
      assert.ok(!(c.opts.schema.required || []).includes('service_reports'), `${label}: the field stays optional`)
      assert.match(c.prompt, /file no GitHub issue[\s\S]*service_reports/, `${label}: the prompt prescribes the field`)
    }
    for (const label of PIPES[file]) {
      const c = of(label)
      assert.ok(c, `${label} was dispatched`)
      assert.equal(c.opts.schema.properties.service_reports, undefined, `${label}: a pipe only pipes the helper`)
      assert.doesNotMatch(c.prompt, /service_reports/, `${label}: a pipe prompt stays mechanical`)
    }
  })
}

// A green run dispatches only some of the judgement agents (no rebase, no gap
// verification, no findings round), so the dispatches above cannot hold every call
// site. The source can: a bare agent() call is allowed only inside ask(), which
// offers the field, and inside piped(), the mechanical pipes. Any other call site
// bypasses ask() and its agent silently loses service_reports.
const ALLOWED = ['ask', 'piped']
// A bare call is a call in code: `agent(` inside a string, a template literal's text,
// a regular expression or a comment is prose, never a call. codeOnly blanks all of
// them out — a character state machine whose state runs across lines, the text of a
// template's ${...} kept as code — and keeps every newline, so a line of its result
// is the same line of the source.
const codeOnly = src => {
  let out = ''
  const stack = [{ kind: 'code', depth: 0 }]   // a template's ${ pushes code, its } pops back
  let i = 0
  let prev = ''                                 // the last significant code character
  const blank = c => (c === '\n' ? '\n' : ' ')
  while (i < src.length) {
    const c = src[i], n = src[i + 1], top = stack[stack.length - 1]
    if (top.kind === 'template') {
      if (c === '\\') { out += blank(c) + blank(n ?? ''); i += 2; continue }
      if (c === '`') { stack.pop(); out += c; prev = c; i++; continue }
      if (c === '$' && n === '{') { stack.push({ kind: 'code', depth: 0 }); out += '${'; prev = '{'; i += 2; continue }
      out += blank(c); i++; continue
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++ } continue }
    if (c === '/' && n === '*') {
      out += '  '; i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++ }
      out += '  '; i += 2; continue
    }
    if (c === '"' || c === "'") {
      out += c; i++
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { out += ' '; i++ }
        out += blank(src[i] ?? ''); i++
      }
      out += src[i] ?? ''; prev = c; i++; continue
    }
    if (c === '`') { stack.push({ kind: 'template' }); out += c; i++; continue }
    // a slash that cannot divide opens a regular expression
    if (c === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
      out += c; i++
      let cls = false
      while (i < src.length && src[i] !== '\n' && (cls || src[i] !== '/')) {
        if (src[i] === '\\') { out += ' '; i++ } else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false
        out += blank(src[i] ?? ''); i++
      }
      out += src[i] ?? ''; prev = '/'; i++; continue
    }
    if (c === '{') top.depth++
    if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); out += c; i++; continue }   // the end of a ${...}
      top.depth--
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}
// The calls of a source, each named by the top-level `const` it sits in.
const bareCalls = src => {
  const calls = []
  let owner = null
  const lines = src.split('\n')
  codeOnly(src).split('\n').forEach((line, k) => {
    const decl = /^const (\w+) =/.exec(line)
    if (decl) owner = decl[1]
    for (const _ of line.matchAll(/(?<![\w.$])agent\(/g)) calls.push({ owner, line: lines[k].trim() })
  })
  return calls
}

test('the check counts a bare agent( call in code, never one in a string, a template, a regex or a comment', () => {
  const src = [
    "const ask = async (p, o) => agent(p, o)",
    "const piped = async (p, o) => { const r = await agent(p, o); return r }",
    "const prompt = () => `Never call agent( yourself; ${fenced('x', 'agent(')} the",
    "  agent(prompt) of a run is the run's — ${'agent('.length} agent( stays prose`",
    "const said = 'an agent(x) in a string' + \"and agent(y)\" // and agent(z) here",
    "const re = /agent\\(/g",
    "/* a block comment",
    " * agent(x) on its second line */",
    "const fine = 1",
  ].join('\n')
  assert.deepEqual(bareCalls(src).map(c => c.owner), ALLOWED, 'prose is not a call')
  const bypass = src + "\nconst rebase = async () => {\n  return agent(rebasePrompt(), { label: 'rebase' })\n}"
  assert.deepEqual(bareCalls(bypass).map(c => c.owner), [...ALLOWED, 'rebase'], 'a call in another function is counted')
  const inTemplate = src + "\nconst t = `text ${await agent(p, o)} text`"
  assert.deepEqual(bareCalls(inTemplate).map(c => c.owner), [...ALLOWED, 't'], 'a call inside ${...} is code')
})

for (const file of ['task.js', 'epic.js'])
  test(`${file}: every agent call goes through ask() except the pipes`, () => {
    const calls = bareCalls(source(file))
    assert.deepEqual(calls.map(c => c.owner), ALLOWED,
      'a bare agent( call outside ask/piped bypasses service_reports: ' + JSON.stringify(calls.filter(c => !ALLOWED.includes(c.owner))))
  })
