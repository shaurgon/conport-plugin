// The person's one-time consent to grow an epic that has a plan. The
// UserPromptSubmit hook records it from the person's own message
// (`allow epic <N> in <project>`, or `allow epic <N>` when the session has a
// project); the epic growth hook spends it on the call it lets through. Only
// the person's message gives it — the agent never writes the file.
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir, parseProject } = require('./_common.js');
const { isHandle } = require('./project-config.js');

const CONSENT_FILE = 'epic-growth-allow.json';

// The whole message, nothing before or after it but spaces and line breaks.
// The project is the rest of the line: a name may hold spaces.
const PHRASE = /^allow[ \t]+epic[ \t]+(\d+)(?:[ \t]+in[ \t]+([^\r\n]+))?$/i;

function consentPath() {
  return path.join(dataDir(), CONSENT_FILE);
}

// A handle is lower case; a name keeps its spelling.
function normalProject(raw) {
  return isHandle(raw) ? raw.toLowerCase() : raw;
}

// The consent a message gives: { project, epic } with the project as the
// message (or the session) names it, { needsProject, epic } for the short
// form in a session with no project, or null when the message is not the
// phrase as a whole.
function parseConsentPhrase(text, sessionProject) {
  if (typeof text !== 'string') return null;
  const match = PHRASE.exec(text.trim());
  if (!match) return null;
  const epic = Number(match[1]);
  if (!Number.isSafeInteger(epic) || epic <= 0) return null;
  if (match[2] === undefined) {
    if (!sessionProject || !sessionProject.raw) return { needsProject: true, epic };
    return { project: normalProject(sessionProject.raw), epic };
  }
  const project = parseProject(match[2]);
  if (!project) return null;
  return { project: normalProject(project.raw), epic };
}

// Records the consent, replacing any earlier one. Written whole: a reader
// never sees half a file.
function writeConsent({ project, epic }) {
  const target = consentPath();
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ project, epic }));
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function readConsentFile() {
  try {
    const value = JSON.parse(fs.readFileSync(consentPath(), 'utf8'));
    if (!value || typeof value.project !== 'string' || !Number.isSafeInteger(value.epic)) return null;
    return { project: value.project, epic: value.epic };
  } catch (_) {
    return null;
  }
}

// Removes the consent; false when it is already gone — a parallel call spent
// it first.
function spend() {
  try {
    fs.unlinkSync(consentPath());
    return true;
  } catch (_) {
    return false;
  }
}

// What `promise` settles to within `ms`: its value, or null when it rejects or
// takes longer. A request's own timeout arms only once its socket connects,
// so a call to an unroutable host is held to the budget here.
function withinBudget(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(promise).catch(() => null), late])
    .finally(() => clearTimeout(timer));
}

// Whether the person consented to grow epic `epic` of the project with this
// handle: a matching consent is removed and answers true; one for another
// project or epic stays where it is.
function takeConsent(handle, epic) {
  const found = readConsentFile();
  return Boolean(found && found.project === handle && found.epic === epic && spend());
}

module.exports = {
  CONSENT_FILE, parseConsentPhrase, writeConsent, takeConsent, isHandle, withinBudget,
};
