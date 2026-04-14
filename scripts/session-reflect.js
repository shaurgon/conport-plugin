#!/usr/bin/env node
// SessionEnd: parse JSONL transcript, POST reflection to ConPort.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CONPORT_URL, dataDir, detectProjectIdentifier, authHeader, request, readStdin,
} = require('./_common.js');

const MIN_PROMPTS_FOR_REFLECTION = 5;
const LOG_FILE = path.join(dataDir(), 'session-end.log');

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

function extractUserText(obj) {
  const content = (obj.message && obj.message.content) || [];
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && block.type === 'text') parts.push(block.text || '');
  }
  const text = parts.join('').trim();
  const noisePrefixes = [
    '<local-command', '<command-name', '<system-reminder',
    '[Request interrupted', '[Failed to parse',
  ];
  return noisePrefixes.some(p => text.startsWith(p)) ? '' : text;
}

function processToolCall(block, conportCalls, gitCommits, filesChanged) {
  const name = block.name || '';
  const inp = block.input || {};
  if (name.toLowerCase().includes('conport')) {
    const summary = inp.summary || inp.title || inp.description || inp.name || '';
    conportCalls.push({ tool: name, summary: summary ? summary.slice(0, 200) : '' });
  } else if (name === 'Edit' || name === 'Write') {
    if (inp.file_path) filesChanged.add(inp.file_path);
  } else if (name === 'Bash') {
    const cmd = inp.command || '';
    if (cmd.includes('git commit')) {
      for (const marker of ['-m "', "-m '", '<<']) {
        const i = cmd.indexOf(marker);
        if (i >= 0) { gitCommits.push(cmd.slice(i, i + 200)); break; }
      }
    }
  }
}

function parseTranscript(transcriptPath) {
  const userPrompts = [], assistantTexts = [], conportCalls = [], gitCommits = [];
  const filesChanged = new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (obj.type === 'user') {
      const text = extractUserText(obj);
      if (text && text.length > 10) userPrompts.push(text);
    } else if (obj.type === 'assistant') {
      const content = (obj.message && obj.message.content) || [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text') {
          const t = (block.text || '').trim();
          if (t) assistantTexts.push(t);
        } else if (block.type === 'tool_use') {
          processToolCall(block, conportCalls, gitCommits, filesChanged);
        }
      }
    }
  }
  return {
    user_prompts: userPrompts,
    assistant_texts: assistantTexts,
    conport_calls: conportCalls,
    git_commits: gitCommits,
    files_changed: [...filesChanged].sort(),
  };
}

function buildPayload(sessionId, project, parsed) {
  const meaningful = parsed.user_prompts.filter(p => p.length > 15 && !p.startsWith('Error:'));
  const recent = parsed.assistant_texts.slice(-20);
  const turns = [
    ...meaningful.slice(-15).map(p => ({ role: 'user', text: p.slice(0, 500) })),
    ...recent.map(t => ({ role: 'assistant', text: t.slice(0, 500) })),
  ];
  const saveCalls = parsed.conport_calls.filter(c =>
    c.tool === 'mcp__conport__sync_decision' || c.tool === 'mcp__conport__log_progress'
  ).length;
  return {
    project_id: project,
    session_id: sessionId,
    conversation_turns: turns,
    conport_calls: parsed.conport_calls,
    git_commits: parsed.git_commits,
    files_changed: parsed.files_changed,
    stats: {
      user_prompts: parsed.user_prompts.length,
      meaningful_prompts: meaningful.length,
      assistant_texts: parsed.assistant_texts.length,
      conport_saves: saveCalls,
      git_commits: parsed.git_commits.length,
      files_changed: parsed.files_changed.length,
    },
  };
}

async function main() {
  const project = detectProjectIdentifier();
  if (!project) { log('SKIP: no project identifier'); process.exit(0); }

  let input;
  try { input = JSON.parse(await readStdin()); }
  catch (_) { log('SKIP: failed to parse stdin'); process.exit(0); }

  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || '';
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    log(`SKIP: transcript not found (${transcriptPath})`);
    process.exit(0);
  }

  const parsed = parseTranscript(transcriptPath);
  const meaningful = parsed.user_prompts.filter(p => p.length > 15 && !p.startsWith('Error:')).length;
  if (meaningful < MIN_PROMPTS_FOR_REFLECTION) {
    log(`SKIP: too short (${meaningful} meaningful prompts)`);
    process.exit(0);
  }

  const payload = buildPayload(sessionId, project, parsed);
  try {
    const res = await request('POST', `${CONPORT_URL}/api/v1/hooks/reflect-session`, {
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
      timeoutMs: 30000,
    });
    if (res.status >= 200 && res.status < 300) {
      let decisions = 0, progress = 0;
      try {
        const data = JSON.parse(res.body);
        decisions = data.decisions_created || 0;
        progress = data.progress_created || 0;
      } catch (_) {}
      log(`Reflection OK: decisions=${decisions} progress=${progress}`);
    } else {
      log(`Reflection HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    }
  } catch (e) {
    log(`Reflection failed: ${e.message}`);
  }
  process.exit(0);
}

main();
