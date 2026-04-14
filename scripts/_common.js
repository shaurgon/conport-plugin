// Shared helpers for ConPort plugin hooks (Node.js, built-ins only).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CONPORT_URL = process.env.CONPORT_URL || 'https://api.conport.app';

function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), '.claude', 'plugin-data', 'conport');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function detectProjectIdentifier() {
  const id = (process.env.CONPORT_PROJECT_ID || '').trim();
  if (id) return id;
  const name = (process.env.CONPORT_PROJECT_NAME || '').trim();
  if (name) return name;
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim();
    if (url) {
      let base = url.replace(/\/+$/, '').split('/').pop() || '';
      if (base.endsWith('.git')) base = base.slice(0, -4);
      if (base) return base;
    }
  } catch (_) {}
  return path.basename(process.cwd()) || null;
}

function authHeader() {
  const key = (process.env.CONPORT_API_KEY || '').trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function request(method, urlStr, { headers = {}, body = null, timeoutMs = 10000 } = {}) {
  const url = new URL(urlStr);
  const lib = url.protocol === 'http:' ? require('http') : require('https');
  return new Promise((resolve, reject) => {
    const req = lib.request({
      method, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(''));
  });
}

module.exports = {
  CONPORT_URL, dataDir, detectProjectIdentifier, authHeader, request, readStdin,
};
