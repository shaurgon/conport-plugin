#!/usr/bin/env node
// SessionStart hook: fetch deny-list from ConPort. Graceful degradation on failure.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, dataDir, detectProjectIdentifier, authHeader, request,
} = require('./_common.js');

async function main() {
  const project = detectProjectIdentifier();
  if (!project) process.exit(0);

  const target = path.join(dataDir(), 'deny-list.json');
  const url = `${CONPORT_URL}/api/v1/hooks/conventions?project_id=${encodeURIComponent(project)}`;

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
