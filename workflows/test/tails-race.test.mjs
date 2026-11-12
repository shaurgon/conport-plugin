import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, taskRun, epicRun } from './run-workflow.mjs'

// The tails epic of the release is looked up before one is created, so two runs of one
// milestone can both miss it and both create one. Every text an agent follows without
// the helper closes the race the way the helper does: the branch B accountant of both
// workflows, and the session answering the tails question. A lookup takes the oldest;
// right after its add_task a run re-reads the open epics of that title in that
// milestone, keeps the oldest, moves the children of its own epic there and cancels
// its own as the duplicate.

const MINOR = { severity: 'MINOR', file: 'a.js', line: 9, what: 'a nit' }
const LOOKUP = 'found -> use it (several open -> the oldest, lowest id)'
const RULE = [
  LOOKUP,
  'Right after that add_task, re-read the open epics with that exact title in the milestone it was created in (kind=epic, open, to the end)',
  'more than one -> keep the oldest (lowest id)',
  'when the oldest is not the epic this run created, another run made it at the same time',
  'move every child of the epic this run created to the oldest — list_tasks(parent_task_id=<its own>, status="ALL", include_snoozed=true, to the end), then update_task(parent_task_id=<the oldest>) for each',
  'cancel its own with update_task(status="CANCELLED", resolution="duplicate of task-<the oldest>") and use the oldest',
  'never cancel an epic this run did not create',
]
const CREATE = 'add_task(kind="epic", priority=1,'
const flat = text => text.replace(/\s+/g, ' ')

// The rule stands in `text` after the add_task that creates the tails epic.
const holdsRule = (where, text) => {
  assert.ok(text, where + ': the text is produced')
  const t = flat(text)
  for (const part of RULE) assert.ok(t.includes(part), where + ': ' + part)
  assert.ok(t.indexOf(RULE[1]) > t.indexOf(CREATE), where + ': the re-read follows the create')
}

// No tails epic filed: the session is asked where the tails go, and so answers it.
const WAITING = { tails_epic_id: null, tails_epic_needs_milestone: true, tails_waiting_progress_id: 701 }

test('task.js: the accountant and the answer to the tails question drop their own duplicate tails epic', async () => {
  const run = taskRun({ rev: { verdict: 'APPROVED', findings: [MINOR] }, fix: null, 'fix-r2': null,
    account: { via: 'wf-helper', actions: [], task_closed: true, ...WAITING } })
  run.answers.scout = { ...run.answers.scout, task: { ...run.answers.scout.task, parent_epic_id: 40 } }
  const { prompt, ledger } = await runWorkflow('task.js', run.args, run.answers)
  holdsRule('task.js accountant', prompt('account'))
  holdsRule('task.js answer to the tails question', ledger.questions_action)
})

test('epic.js: the accountant, the tails epic of a Note answer and the answer to the tails question drop their own duplicate', async () => {
  const run = epicRun({ account: { via: 'wf-helper', actions: [], epic_closed: false, ...WAITING } })
  const { prompt, ledger } = await runWorkflow('epic.js', run.args, run.answers)
  holdsRule('epic.js accountant', prompt('account'))
  const action = flat(ledger.questions_action)
  const answer = action.slice(action.indexOf("The question 'The tails of the release have no milestone to go to'"))
  const noteWork = action.slice(action.indexOf('the tails epic of the release is found or made'))
  assert.ok(answer.length < action.length && noteWork.length < action.length, action)
  holdsRule('epic.js answer to the tails question', answer.slice(0, answer.indexOf('Under that epic file')))
  holdsRule('epic.js tails epic of a Note answer', noteWork)
  assert.ok(!action.includes('found -> use it;'), 'no lookup takes the first epic it sees')
})
