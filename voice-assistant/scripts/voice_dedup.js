#!/usr/bin/env node
/**
 * voice_dedup.js
 *
 * Deduplication manager for Telegram voice messages.
 * Uses message_id or file_unique_id to prevent duplicate processing.
 *
 * Usage:
 *   node voice_dedup.js --check --id <message_id|file_unique_id>
 *   node voice_dedup.js --mark  --id <message_id|file_unique_id> [--transcript "..."]
 *   node voice_dedup.js --list
 *   node voice_dedup.js --clean [--max-age <hours>]
 *
 * State is stored in: ~/.clawd-voice-dedup.json
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.env.HOME || '/tmp', '.clawd-voice-dedup.json');
const DEFAULT_MAX_AGE_HOURS = 24;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(`Warning: Failed to load state: ${e.message}`);
  }
  return { processed: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function arg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function checkDuplicate(id) {
  const state = loadState();
  const entry = state.processed[id];
  if (entry) {
    console.log(JSON.stringify({
      duplicate: true,
      id,
      processedAt: entry.processedAt,
      transcript: entry.transcript || null
    }));
    return true;
  }
  console.log(JSON.stringify({ duplicate: false, id }));
  return false;
}

function markProcessed(id, transcript = null) {
  const state = loadState();
  state.processed[id] = {
    processedAt: new Date().toISOString(),
    transcript: transcript || null
  };
  saveState(state);
  console.log(JSON.stringify({
    ok: true,
    id,
    action: 'marked',
    processedAt: state.processed[id].processedAt
  }));
}

function listAll() {
  const state = loadState();
  const entries = Object.entries(state.processed).map(([id, data]) => ({
    id,
    ...data
  }));
  console.log(JSON.stringify({ count: entries.length, entries }, null, 2));
}

function cleanOld(maxAgeHours) {
  const state = loadState();
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  const before = Object.keys(state.processed).length;

  for (const [id, data] of Object.entries(state.processed)) {
    const ts = new Date(data.processedAt).getTime();
    if (ts < cutoff) {
      delete state.processed[id];
    }
  }

  const after = Object.keys(state.processed).length;
  saveState(state);

  console.log(JSON.stringify({
    ok: true,
    action: 'clean',
    removed: before - after,
    remaining: after,
    maxAgeHours
  }));
}

// Main
const id = arg('id');

if (hasFlag('check')) {
  if (!id) {
    console.error('Missing --id for --check');
    process.exit(2);
  }
  const isDup = checkDuplicate(id);
  process.exit(isDup ? 1 : 0);
} else if (hasFlag('mark')) {
  if (!id) {
    console.error('Missing --id for --mark');
    process.exit(2);
  }
  markProcessed(id, arg('transcript'));
} else if (hasFlag('list')) {
  listAll();
} else if (hasFlag('clean')) {
  const maxAge = parseInt(arg('max-age', DEFAULT_MAX_AGE_HOURS), 10);
  cleanOld(maxAge);
} else {
  console.log(`Usage:
  node voice_dedup.js --check --id <id>     Check if ID was already processed
  node voice_dedup.js --mark  --id <id>     Mark ID as processed
  node voice_dedup.js --list                List all processed IDs
  node voice_dedup.js --clean [--max-age N] Remove entries older than N hours (default: 24)
`);
  process.exit(1);
}
