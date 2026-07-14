#!/usr/bin/env node
// Detached child of session-reflect.js: POST a prebuilt reflection payload
// to ConPort. Runs after the SessionEnd hook has already exited, so the
// slow network call never blocks Claude Code shutdown.
'use strict';

const fs = require('fs');
const path = require('path');
const { CONPORT_URL, dataDir, authHeader, request } = require('./_common.js');

const LOG_FILE = path.join(dataDir(), 'session-end.log');

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

async function main() {
  const payloadFile = process.argv[2];
  if (!payloadFile) { log('POST SKIP: no payload file argument'); process.exit(0); }

  let body;
  try {
    body = fs.readFileSync(payloadFile, 'utf8');
  } catch (e) {
    log(`POST SKIP: cannot read payload (${e.message})`);
    process.exit(0);
  }

  try {
    const res = await request('POST', `${CONPORT_URL}/api/v1/hooks/reflect-session`, {
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body,
      timeoutMs: 30000,
    });
    if (res.status >= 200 && res.status < 300) {
      let decisions = 0, progress = 0;
      try {
        const data = JSON.parse(res.body);
        decisions = data.decisions_created || 0;
        progress = data.progress_created || 0;
      } catch (_) {}
      log(`Reflection OK (HTTP ${res.status}): decisions=${decisions} progress=${progress}`);
    } else {
      log(`Reflection HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }
  } catch (e) {
    log(`Reflection failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (_) {}
  }
  process.exit(0);
}

main();
