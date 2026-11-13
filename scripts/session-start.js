#!/usr/bin/env node
// SessionStart hook: work out the session's ConPort settings once and keep
// them for the other hooks, tell the session the project, the lines of its
// settings and where old settings are still kept, say that CONPORT_PROJECT_ID
// is no longer read when it is set, inject the Superpowers overlay rules when
// the overlay is on, then fetch the deny-list from ConPort. Graceful
// degradation on failure.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, parseProject, sessionSettings, retiredProjectIdNotice, denyListPath, authHeader,
  request, readStdin, overlayFromSettings,
} = require('./_common.js');
const { projectLine } = require('./project-config.js');
const { findOldPlaces, oldSettingsLine } = require('./old-settings.js');

const OVERLAY_RULES = path.join(
  __dirname, '..', 'skills', 'conport', 'references', 'superpowers-overlay.md');

// The hook input as an object; empty or invalid input is not an error.
function hookInput(raw) {
  try {
    const input = JSON.parse(raw);
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  } catch (_) {
    return {};
  }
}

// The overlay rules, or null when the overlay is off. Read whether or not a
// ConPort project is configured; an unreadable rules file says nothing.
function overlayRules(settings) {
  if (!overlayFromSettings(settings)) return null;
  try {
    return fs.readFileSync(OVERLAY_RULES, 'utf8');
  } catch (_) {
    return null;
  }
}

// The line about settings still kept in the old places, or null. Without a
// root (git failed) there is no place to look at.
function oldPlacesLine(settings) {
  if (!settings.root) return null;
  const places = findOldPlaces({ root: settings.root, mainRoot: settings.mainRoot, env: process.env });
  const hasShared = fs.existsSync(path.join(settings.root, '.conport.json'));
  return oldSettingsLine({ hasShared, places });
}

// What the session start says about its settings: the project and its
// source, the lines of the settings, then the line about old places.
function settingsLines(settings) {
  return [projectLine(settings), ...settings.lines, oldPlacesLine(settings)].filter(Boolean);
}

// The sources on which the hook runs again inside a session already told.
const REENTRY_SOURCES = new Set(['resume', 'clear', 'compact']);

// What the session is told, as one JSON document. The settings lines and the
// overlay rules go to the agent on every source: a compacted context needs
// them again. The user is shown the line about the retired variable and the
// settings lines, except on a known re-entry — a resumed, cleared or
// compacted session has been told already. Any other source, none at all or
// unreadable input still gets them: silence there would hide them for good.
// Nothing to say prints nothing.
async function tellSession(input, settings) {
  const lines = settingsLines(settings);
  const rules = overlayRules(settings);
  const user = REENTRY_SOURCES.has(input.source) ? [] : [retiredProjectIdNotice(), ...lines].filter(Boolean);
  const agent = [lines.join('\n'), rules].filter(Boolean).join('\n\n');
  if (!user.length && !agent) return;
  const out = JSON.stringify({
    ...(user.length ? { systemMessage: user.join('\n') } : {}),
    ...(agent ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: agent } } : {}),
  });
  // Wait for the write: on a pipe stdout is asynchronous, and the exit below
  // would cut it short.
  await new Promise((resolve) => process.stdout.write(out, resolve));
}

async function main() {
  const input = hookInput(await readStdin());
  const settings = sessionSettings(input, { fresh: true });
  await tellSession(input, settings);

  const project = parseProject(settings.project);
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
