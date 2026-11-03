#!/usr/bin/env node
// SessionStart hook: inject the Superpowers overlay rules when the overlay is
// on, then fetch the deny-list from ConPort. Graceful degradation on failure.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, detectProject, denyListPath, authHeader, request, readStdin,
  overlayEnabled,
} = require('./_common.js');

const OVERLAY_RULES = path.join(
  __dirname, '..', 'skills', 'conport', 'references', 'superpowers-overlay.md');

// The session's directory: `cwd` from the hook input when present, else the
// process's own. Empty or invalid input is not an error.
function sessionDir(raw) {
  try {
    const cwd = JSON.parse(raw).cwd;
    if (typeof cwd === 'string' && cwd) return cwd;
  } catch (_) {}
  return process.cwd();
}

// The overlay rules as the session's additional context. Runs whether or not
// a ConPort project is configured; an unreadable rules file says nothing.
async function injectOverlayRules(dir) {
  if (!overlayEnabled(dir)) return;
  let rules;
  try {
    rules = fs.readFileSync(OVERLAY_RULES, 'utf8');
  } catch (_) {
    return;
  }
  const out = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules },
  });
  // Wait for the write: on a pipe stdout is asynchronous, and the exit below
  // would cut it short.
  await new Promise((resolve) => process.stdout.write(out, resolve));
}

async function main() {
  await injectOverlayRules(sessionDir(await readStdin()));

  const project = detectProject();
  if (!project) process.exit(0);

  const target = denyListPath(project);
  const url = `${CONPORT_URL}/api/v1/hooks/conventions?project_id=${encodeURIComponent(project.raw)}`;

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
