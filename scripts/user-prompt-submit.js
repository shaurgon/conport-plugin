#!/usr/bin/env node
// UserPromptSubmit: restore context on first prompt + remind to save every N messages.
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir, readStdin } = require('./_common.js');

const MESSAGES_BEFORE_REMINDER = 5;
const REMINDER_COOLDOWN_MINUTES = 15;

function sessionFlagPath(sessionId) {
  const dir = path.join(dataDir(), 'session_logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId}_restored.flag`);
}

function stateFilePath() {
  const dir = path.join(dataDir(), 'hook_state');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'conport_reminder.json');
}

function loadState() {
  const p = stateFilePath();
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return { last_save_reminder: null, messages_since_save: 0 };
}

function saveState(state) {
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
}

function shouldRestoreContext(sessionId) {
  const p = sessionFlagPath(sessionId);
  if (!fs.existsSync(p)) return true;
  const ageMs = Date.now() - fs.statSync(p).mtimeMs;
  return ageMs > 60 * 60 * 1000;  // >1h → treat as new session
}

function markSessionRestored(sessionId) {
  const p = sessionFlagPath(sessionId);
  fs.closeSync(fs.openSync(p, 'w'));
}

function shouldRemindSave(state) {
  if ((state.messages_since_save || 0) < MESSAGES_BEFORE_REMINDER) return false;
  const last = state.last_save_reminder;
  if (last) {
    const ts = Date.parse(last);
    if (!Number.isNaN(ts) && Date.now() - ts < REMINDER_COOLDOWN_MINUTES * 60 * 1000) {
      return false;
    }
  }
  return true;
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  const sessionId = input.session_id || 'unknown';

  const messages = [];
  if (shouldRestoreContext(sessionId)) {
    messages.push('ConPort: run mcp__conport__init() before responding.');
    markSessionRestored(sessionId);
  }

  const state = loadState();
  state.messages_since_save = (state.messages_since_save || 0) + 1;

  if (shouldRemindSave(state)) {
    messages.push(
      `ConPort: ${state.messages_since_save} changes without save. ` +
      'Use sync_decision / log_progress.'
    );
    state.last_save_reminder = new Date().toISOString();
  }
  saveState(state);

  if (messages.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: messages.join('\n\n'),
      },
    }));
  }
  process.exit(0);
}

main();
