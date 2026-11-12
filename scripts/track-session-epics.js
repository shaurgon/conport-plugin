#!/usr/bin/env node
// PostToolUse(conport add_task / update_task / delete_task): remember which epics this
// session changed, so the Stop hook can hold the turn while their children
// are still open, and drop the cached [TAILS] rows of UserPromptSubmit, which
// the write has just made stale. Silent and best-effort — never blocks or
// slows a tool call.
'use strict';

const fs = require('fs');
const { readStdin, sessionEpicsPath, dropEpicTailsCaches } = require('./_common.js');

const TRACKED_TOOL = /__(add_task|update_task|delete_task)$/;
const MAX_DEPTH = 6;

// The server echoes `epic_progress` (epic_id, epic_title, …) on exactly the
// writes that change an epic's children: add_task under an epic, update_task
// on a child whose status changed or that was re-parented, and delete_task of
// a child. That
// echo is the definition of "this session touched the epic". The MCP result
// reaches the hook wrapped (content blocks, JSON text, structured content) —
// walk it instead of assuming one shape.
function findEpicProgress(value, state, depth = 0) {
  if (value == null || depth > MAX_DEPTH) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) return null;
    try { return findEpicProgress(JSON.parse(s), state, depth + 1); } catch (_) { return null; }
  }
  if (typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    // A task payload, not a content-block wrapper: the result was readable.
    if ('id' in value || 'summary' in value) state.sawPayload = true;
    const ep = value.epic_progress;
    if (ep && typeof ep === 'object' && Number.isInteger(ep.epic_id)) return ep;
  }
  for (const v of Object.values(value)) {
    const found = findEpicProgress(v, state, depth + 1);
    if (found) return found;
  }
  return null;
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  const toolName = String(input.tool_name || '');
  const match = TRACKED_TOOL.exec(toolName);
  if (!match || !toolName.includes('conport')) process.exit(0);

  // Any task write, the epic's own included (it echoes no epic_progress), may
  // change the tails: the next prompt fetches them again.
  dropEpicTailsCaches();

  // The project as the call named it — a handle or a name; the Stop hook
  // addresses it the same way.
  const toolInput = input.tool_input || {};
  const project = toolInput.project;
  if (project === undefined || project === null || project === '') process.exit(0);

  const parseState = { sawPayload: false };
  const progress = findEpicProgress(input.tool_response, parseState);
  let epicId = progress ? progress.epic_id : null;
  const title = progress ? (progress.epic_title || '') : '';
  // Unreadable result (no task payload anywhere, e.g. content blocks of
  // non-JSON text): an add_task under an epic still names its epic in the
  // input. A readable task payload without the echo (a write that moved no
  // tail) records nothing.
  if (epicId === null && !parseState.sawPayload && match[1] === 'add_task'
      && Number.isInteger(toolInput.parent_task_id) && toolInput.parent_task_id > 0) {
    epicId = toolInput.parent_task_id;
  }
  if (epicId === null) process.exit(0);

  const sessionId = input.session_id || 'unknown';
  try {
    fs.appendFileSync(sessionEpicsPath(sessionId),
      JSON.stringify({ project: String(project), epic_id: epicId, title }) + '\n');
  } catch (_) {}
  process.exit(0);
}

main();
