#!/usr/bin/env node
// PreToolUse(conport add_task / update_task): hold a new task in an epic that
// has a plan — a started plan or a plan document that clarifies the epic —
// until its description says why it is not a fix round and the person said
// yes. An `update_task` that attaches a task with no epic to an epic counts as
// a new task; moving a task between epics is free. An epic without a plan and
// the tails epic of a release are not held. What the hook cannot find out is
// not let through: an outage, an unreadable answer or a failure of the script
// itself is a refusal (R4) that says to call again, and its cause is one line
// of epic-growth-guard.log in the plugin's data folder. A call with no parent
// passes before anything is read. CONPORT_EPIC_GROWTH_GUARD=off passes every
// call without asking ConPort: that is the person's choice, and no refusal
// names it.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, dataDir, parseProject, projectRoute, authHeader, request, readStdin,
} = require('./_common.js');
const {
  takeConsent, isHandle, withinBudget,
} = require('./epic-growth-consent.js');

const REQUEST_TIMEOUT_MS = 3000;
const PREFIX = 'Why not a fix round:';
const TAILS_TITLE = 'Tails of release ';
const LOG_FILE = 'epic-growth-guard.log';
const LOG_LIMIT = 64 * 1024;

const R1 = (p) => `A new task in epic task-${p} grows an epic that has a plan. A finding is a fix round of ` +
  "the task it came from; a final review's or gap hunt's finding is a fix round of the " +
  "epic's final-review task (or, in an epic without one, of the task whose code it is in); " +
  "a finding outside the epic's goal goes to the tails epic of the release. Only for new " +
  "work the goal needs: start the description with 'Why not a fix round:' and call again.";
const R2 = (p, project) => `A new task in epic task-${p} needs the person's yes. Ask them in a plain ` +
  'message, not with a question tool, in one line why this is not a fix round and to ' +
  `reply: allow epic ${p} in ${project}. Then call again; a refused call needs a new yes. ` +
  'Never write that reply or the consent file yourself.';
const R3 = (p) => `A subagent does not grow epic task-${p}. Put the task you would file, with its ` +
  "'Why not a fix round:' line, into your answer; the session that dispatched you decides.";
const R4 = (p) => `ConPort did not say whether epic task-${p} has a plan; call again in a minute.`;

// Thrown for anything the hook cannot read: the call is refused with R4, and
// the message is the cause the log keeps.
class Unknown extends Error {}

// The cause of a field of an answer that is not what the hook reads.
function fieldCause(object, name) {
  return object[name] === undefined || object[name] === null ? `missing field ${name}` : `bad type ${name}`;
}

// The cause of an argument of the call the hook cannot use.
function argumentCause(toolInput, name) {
  const value = toolInput[name];
  const missing = value === undefined || value === null || (typeof value === 'string' && !value.trim());
  return `${missing ? 'missing field' : 'bad value'} ${name} in the call`;
}

// The cause of an R4 as the log keeps it: the reason an Unknown names, else
// the name of the exception.
function causeOf(err) {
  if (err instanceof Unknown) return err.message;
  return (err && typeof err.name === 'string' && err.name) || 'exception';
}

// One line per R4 in the plugin's data folder: the time, the tool, the epic
// and the cause. Past LOG_LIMIT the log keeps its newer half. Writing it never
// changes the answer and never throws.
function logUnknown(input, epic, err) {
  try {
    const one = (value) => String(value).replace(/[\r\n\t]+/g, ' ').slice(0, 200);
    const tool = input && typeof input.tool_name === 'string' && input.tool_name ? input.tool_name : '?';
    const file = path.join(dataDir(), LOG_FILE);
    fs.appendFileSync(file, `${new Date().toISOString()} ${one(tool)} epic ${epic}: ${one(causeOf(err))}\n`);
    if (fs.statSync(file).size <= LOG_LIMIT) return;
    const kept = fs.readFileSync(file).subarray(-LOG_LIMIT / 2);
    const start = kept.indexOf(10) + 1;
    fs.writeFileSync(file, kept.subarray(start));
  } catch (_) {
    // The log is for the person; the refusal stands without it.
  }
}

// A string the server (pydantic, lax) reads as a whole number: spaces around
// it, an optional `+`, digits with single `_` between them, a zero fraction.
const NUMBER_TEXT = /^\+?\d+(?:_\d+)*(?:\.0+)?$/;

// A positive task number, or null — read as the server reads the argument:
// such a string is that number, `true` is 1 and `false` is 0 (no parent).
function positiveId(value) {
  if (typeof value === 'boolean') value = value ? 1 : 0;
  if (typeof value === 'string') {
    // trim() keeps U+0085 (NEL), which the server strips as whitespace.
    const text = value.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
    if (NUMBER_TEXT.test(text)) value = Number(text.replace(/_/g, '').replace(/\.0+$/, ''));
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

// The task `id` as the server answers it, read within the request budget.
// No answer, any status but 200, a body that is not a JSON object: Unknown.
async function readTask(route, headers, id) {
  const res = await withinBudget(request('GET',
    `${CONPORT_URL}/api/v1/projects/${route.segment}/tasks/${id}`,
    { headers, timeoutMs: REQUEST_TIMEOUT_MS }), REQUEST_TIMEOUT_MS);
  if (!res) throw new Unknown(`no answer for task ${id}`);
  if (res.status !== 200) throw new Unknown(`HTTP ${res.status} for task ${id}`);
  const body = JSON.parse(res.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Unknown(`bad type body of task ${id}`);
  return body;
}

// Whether the epic has a plan: both facts must be in the answer.
function hasPlan(epic) {
  const progress = epic.epic_progress;
  if (!progress || typeof progress !== 'object') throw new Unknown(fieldCause(epic, 'epic_progress'));
  for (const name of ['plan_started', 'plan_document']) {
    if (typeof progress[name] !== 'boolean') throw new Unknown(fieldCause(progress, name));
  }
  return progress.plan_started || progress.plan_document;
}

// The project of the answer, as the consent keeps it: a handle in lower case.
function answeredProject(epic) {
  if (typeof epic.project !== 'string' || !epic.project) throw new Unknown(fieldCause(epic, 'project'));
  return isHandle(epic.project) ? epic.project.toLowerCase() : epic.project;
}

// The refusal for this call, or null to let it through.
async function decide(input) {
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const epicId = positiveId(toolInput.parent_task_id);
  if (epicId === null) return null;
  try {
    const isUpdate = /__update_task$/.test(String(input.tool_name || ''));
    const project = parseProject(toolInput.project);
    if (!project) throw new Unknown(argumentCause(toolInput, 'project'));
    const route = projectRoute(project);
    const headers = { ...authHeader(), ...route.headers };
    if (typeof toolInput.team === 'string' && toolInput.team.trim()) {
      headers['X-Conport-Team-Id'] = toolInput.team.trim();
    }

    let description = typeof toolInput.description === 'string' ? toolInput.description : '';
    if (isUpdate) {
      const taskId = positiveId(toolInput.task_id);
      if (taskId === null) throw new Unknown(argumentCause(toolInput, 'task_id'));
      const task = await readTask(route, headers, taskId);
      // A task under an epic already: a move between epics, not growth.
      if (task.parent_task_id !== null && task.parent_task_id !== undefined) return null;
      if (typeof toolInput.description !== 'string') {
        description = typeof task.description === 'string' ? task.description : '';
      }
    }

    const epic = await readTask(route, headers, epicId);
    if (typeof epic.kind !== 'string') throw new Unknown(fieldCause(epic, 'kind'));
    if (epic.kind !== 'epic') return null;
    if (typeof epic.title !== 'string') throw new Unknown(fieldCause(epic, 'title'));
    if (epic.title.startsWith(TAILS_TITLE)) return null;
    if (!hasPlan(epic)) return null;
    const handle = answeredProject(epic);

    if (!description.startsWith(PREFIX)) return R1(epicId);
    if (input.agent_id) return R3(epicId);
    if (takeConsent(handle, epicId)) return null;
    return R2(epicId, handle);
  } catch (err) {
    logUnknown(input, epicId, err);
    return R4(epicId);
  }
}

async function main() {
  if (process.env.CONPORT_EPIC_GROWTH_GUARD === 'off') process.exit(0);
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (err) {
    logUnknown(null, '?', err);
    deny(R4('?'));
    process.exit(0);
  }
  let reason;
  try {
    reason = await decide(input || {});
  } catch (err) {
    const epic = positiveId(input && input.tool_input && input.tool_input.parent_task_id) || '?';
    logUnknown(input, epic, err);
    reason = R4(epic);
  }
  if (reason) deny(reason);
  process.exit(0);
}

main();
