#!/usr/bin/env node
/**
 * voice_queue_flush.js
 *
 * Flush queued voice assistant actions from ~/.clawd-voice-queue.jsonl.
 * Prints JSON: { ok:true, actions:[...] }
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = process.env.QUEUE_FILE || path.join(process.env.HOME || '/tmp', '.clawd-voice-queue.jsonl');
const MAX_ACTIONS = Number(process.env.MAX_ACTIONS || 20);

function readLines(p) {
  if (!fs.existsSync(p)) return [];
  const txt = fs.readFileSync(p, 'utf8');
  return txt.split('\n').map(l => l.trim()).filter(Boolean);
}

function writeLines(p, lines) {
  if (lines.length === 0) {
    try { fs.unlinkSync(p); } catch {}
    return;
  }
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
}

const lines = readLines(QUEUE_FILE);
const take = lines.slice(0, MAX_ACTIONS);
const rest = lines.slice(MAX_ACTIONS);

const actions = [];
for (const l of take) {
  try {
    const j = JSON.parse(l);
    if (j && typeof j === 'object') actions.push(j);
  } catch {}
}

writeLines(QUEUE_FILE, rest);
process.stdout.write(JSON.stringify({ ok: true, actions }, null, 2));
