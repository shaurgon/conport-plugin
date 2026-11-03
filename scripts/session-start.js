#!/usr/bin/env node
// SessionStart hook: say that CONPORT_PROJECT_ID is no longer read when it is
// set, inject the Superpowers overlay rules when the overlay is on, then fetch
// the deny-list from ConPort. Graceful degradation on failure.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, detectProject, retiredProjectIdNotice, denyListPath, authHeader,
  request, readStdin, overlayEnabled,
} = require('./_common.js');

const OVERLAY_RULES = path.join(
  __dirname, '..', 'skills', 'conport', 'references', 'superpowers-overlay.md');

// The hook input as an object; empty or invalid input is not an error.
function hookInput(raw) {
  try {
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : {};
  } catch (_) {
    return {};
  }
}

// The session's directory: `cwd` from the hook input when present, else the
// process's own.
function sessionDir(input) {
  return typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
}

// The overlay rules, or null when the overlay is off. Read whether or not a
// ConPort project is configured; an unreadable rules file says nothing.
function overlayRules(dir) {
  if (!overlayEnabled(dir)) return null;
  try {
    return fs.readFileSync(OVERLAY_RULES, 'utf8');
  } catch (_) {
    return null;
  }
}

// The sources on which the hook runs again inside a session already told.
const REENTRY_SOURCES = new Set(['resume', 'clear', 'compact']);

// What the session is told, as one JSON document: the line about the retired
// variable goes to the user, except on a known re-entry — a resumed, cleared or
// compacted session has been told already. Any other source, none at all or
// unreadable input still gets it: silence there would hide the line for good.
// The overlay rules go to the agent on every source: a compacted context needs
// them again. Nothing to say prints nothing.
async function tellSession(input) {
  const notice = REENTRY_SOURCES.has(input.source) ? null : retiredProjectIdNotice();
  const rules = overlayRules(sessionDir(input));
  if (!notice && !rules) return;
  const out = JSON.stringify({
    ...(notice ? { systemMessage: notice } : {}),
    ...(rules ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } } : {}),
  });
  // Wait for the write: on a pipe stdout is asynchronous, and the exit below
  // would cut it short.
  await new Promise((resolve) => process.stdout.write(out, resolve));
}

async function main() {
  await tellSession(hookInput(await readStdin()));

  const project = detectProject();
  if (!project) process.exit(0);

  const target = denyListPath(project);
  const url = `${CONPORT_URL}/api/v1/hooks/conventions?project=${encodeURIComponent(project.raw)}`;

  try {
    const res = await request('GET', url, {
      headers: { Accept: 'application/json', ...authHeader() },
      timeoutMs: 5000,
    });
    if (res.status >= 200 && res.status < 300 && res.body) {
      fs.writeFileSync(target, res.body);
    }
  } catch (_) {
    // offline / 401 / timeout — degrade silently
  }
  process.exit(0);
}

main();
