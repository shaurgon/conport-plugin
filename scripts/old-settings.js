// The places ConPort settings were kept before .conport.json, and the one line
// the session start says while they are still in use. Built-in modules only.
'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION_URL = 'https://conport.app/docs/projects/project-settings.md';

const ENV_PLACE = 'CONPORT_PROJECT_NAME in the environment';
const LOCAL_CLAUDE_PLACE = 'env.CONPORT_PROJECT_NAME in .claude/settings.local.json';
const CLAUDE_PLACE = 'env.CONPORT_PROJECT_NAME in .claude/settings.json';
const OVERLAY_PLACE = 'conport in .superpowers/config.json';

// Places named only by the line that asks for the move: the variable is a
// source for good. `.conport/units.json` is no old place: no ConPort component
// reads `units`, so there is nothing to move.
const MOVE_ONLY = new Set([ENV_PLACE]);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The parsed JSON object in `file`, or null when there is none, it cannot be
// read or it is not an object.
function readObject(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return isObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function claudeSettingsName(file) {
  const data = readObject(file);
  return Boolean(data && isObject(data.env) && has(data.env, 'CONPORT_PROJECT_NAME'));
}

function overlayKey(root) {
  const data = readObject(path.join(root, '.superpowers', 'config.json'));
  return Boolean(data && has(data, 'conport'));
}

// The old places that still hold ConPort settings for the project at `root`
// (the root of the current worktree; `mainRoot` the root of the main one, or
// null), in the order the line names them.
function findOldPlaces({ root, mainRoot, env }) {
  const places = [];
  const variable = env && env.CONPORT_PROJECT_NAME;
  if (typeof variable === 'string' && variable.trim()) places.push(ENV_PLACE);
  if (!root) return places;
  if (claudeSettingsName(path.join(root, '.claude', 'settings.local.json'))) places.push(LOCAL_CLAUDE_PLACE);
  if (claudeSettingsName(path.join(root, '.claude', 'settings.json'))) places.push(CLAUDE_PLACE);
  if (overlayKey(root) || (mainRoot && mainRoot !== root && overlayKey(mainRoot))) places.push(OVERLAY_PLACE);
  return places;
}

// The line about old places, or null. Without .conport.json every old place
// asks for the move; beside it only the personal places left behind are named.
function oldSettingsLine({ hasShared, places }) {
  if (!hasShared) {
    if (!places.length) return null;
    return `ConPort settings are in the old places (${places.join(', ')}): move them to .conport.json — ${MIGRATION_URL}`;
  }
  const left = places.filter((p) => !MOVE_ONLY.has(p));
  if (!left.length) return null;
  return `Old ConPort settings left (${left.join(', ')}): remove them — ${MIGRATION_URL}`;
}

module.exports = { findOldPlaces, oldSettingsLine };
