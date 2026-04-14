#!/usr/bin/env node
// PreToolUse(Bash): block commands matching ConPort deny-list patterns.
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir, readStdin } = require('./_common.js');

function loadConventions() {
  const p = path.join(dataDir(), 'deny-list.json');
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data.conventions) ? data.conventions : [];
  } catch (_) {
    return [];
  }
}

async function main() {
  const conventions = loadConventions();
  if (!conventions.length) process.exit(0);

  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (_) {
    process.exit(0);
  }

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command) process.exit(0);

  for (const conv of conventions) {
    const pattern = conv.pattern;
    if (!pattern) continue;
    let re;
    try { re = new RegExp(pattern); } catch (_) { continue; }
    if (re.test(command)) {
      const reason = conv.reason || 'Convention violation';
      let msg = `BLOCKED: ${reason}`;
      if (conv.replacement) msg += `\nUse instead: ${conv.replacement}`;
      process.stderr.write(`${msg}\n`);
      process.exit(2);
    }
  }
  process.exit(0);
}

main();
