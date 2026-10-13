#!/usr/bin/env node
// SessionStart hook: fetch deny-list from ConPort. Graceful degradation on failure.
'use strict';

const fs = require('fs');
const {
  CONPORT_URL, detectProject, denyListPath, authHeader, request,
} = require('./_common.js');

async function main() {
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
