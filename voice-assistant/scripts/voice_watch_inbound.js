#!/usr/bin/env node
/**
 * voice_watch_inbound.js
 *
 * True-ish inbound hook (filesystem event-driven): watch OpenClaw inbound media dir
 * for new voice/audio files and enqueue actions for the sender job.
 *
 * Why queue?
 * - This watcher is long-running and should not directly send Telegram messages.
 * - A separate cron agentTurn can flush the queue using the message tool.
 *
 * Writes JSONL lines to QUEUE_FILE:
 *   {"kind":"sendText","requestId":"...","text":"...","buttons":[...]}
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const INBOUND_DIR = process.env.INBOUND_DIR || path.join(process.env.HOME || '/tmp', '.openclaw', 'media', 'inbound');
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(process.env.HOME || '/tmp', '.clawd-voice-queue.jsonl');
const HANDLE = path.join(__dirname, 'voice_handle_inbound.js');

const STABLE_MS = Number(process.env.STABLE_MS || 800);
const ALLOWED_EXT = new Set(['.ogg', '.mp3', '.wav', '.m4a']);

function isAudioFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

function makeButtons(requestId) {
  return [
    { text: '✅ 執行', callback_data: `voice_confirm:${requestId}:execute` },
    { text: '✏️ 修改', callback_data: `voice_confirm:${requestId}:modify` },
    { text: '❌ 取消', callback_data: `voice_confirm:${requestId}:cancel` },
  ];
}

function enqueue(action) {
  fs.appendFileSync(QUEUE_FILE, JSON.stringify(action) + '\n', 'utf8');
}

function handleFile(fullPath) {
  const base = path.basename(fullPath);
  const dedupId = `file:${base}`;

  const r = spawnSync('node', [HANDLE, '--path', fullPath, '--message-id', dedupId, '--file-unique-id', dedupId], {
    encoding: 'utf8',
    timeout: 600000,
  });

  const out = (r.stdout || '').trim();
  if (!out) return;

  let handled;
  try { handled = JSON.parse(out); } catch { return; }

  if (handled?.isDuplicate) return;
  if (handled?.suggestedReplyText) {
    enqueue({
      kind: 'sendText',
      requestId: handled.requestId || dedupId,
      text: handled.suggestedReplyText,
      buttons: handled.isCommand ? makeButtons(handled.requestId) : [],
    });
  }
}

function waitStableThenHandle(fullPath) {
  // Wait briefly so file write finishes.
  setTimeout(() => {
    try {
      const st = fs.statSync(fullPath);
      if (!st.isFile()) return;
      handleFile(fullPath);
    } catch {}
  }, STABLE_MS);
}

if (!fs.existsSync(INBOUND_DIR)) {
  console.error(`INBOUND_DIR not found: ${INBOUND_DIR}`);
  process.exit(1);
}

console.log(`voice_watch_inbound watching: ${INBOUND_DIR}`);
console.log(`queue: ${QUEUE_FILE}`);

fs.watch(INBOUND_DIR, { persistent: true }, (eventType, filename) => {
  if (!filename) return;
  if (!isAudioFile(filename)) return;
  const fullPath = path.join(INBOUND_DIR, filename);
  waitStableThenHandle(fullPath);
});

// Keep alive
setInterval(() => {}, 1 << 30);
