#!/usr/bin/env node
/**
 * voice_scan_inbound.js
 *
 * Scan OpenClaw inbound media directory for new Telegram voice/audio files,
 * transcribe via voice_handle_inbound.js, and emit JSON actions.
 *
 * This is a bridge until we have a first-class inbound hook for voice.
 * Intended to run via cron every 30–60s.
 *
 * Confirmation buttons are context-aware based on commandType:
 *   - 'idea' → "💡 儲存點子"
 *   - 'task' → "📋 建立任務"
 *   - default → "✅ 執行"
 *
 * Output JSON:
 *   { ok:true, actions:[ { kind:'sendDraft', requestId, text, buttons } ... ] }
 * If nothing to do: { ok:true, actions:[] }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const INBOUND_DIR = process.env.INBOUND_DIR || path.join(process.env.HOME || '/tmp', '.openclaw', 'media', 'inbound');
const STATE_FILE = process.env.SCAN_STATE_FILE || path.join(process.env.HOME || '/tmp', '.clawd-voice-scan.json');
const HANDLE = path.join(__dirname, 'voice_handle_inbound.js');

const MAX_FILES = Number(process.env.MAX_FILES || 10);
const MAX_AGE_MIN = Number(process.env.MAX_AGE_MIN || 60 * 12); // 12h

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (j && typeof j === 'object') {
        if (!j.seen) j.seen = {};
        return j;
      }
    }
  } catch {}
  return { seen: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function listAudioFiles() {
  if (!fs.existsSync(INBOUND_DIR)) return [];
  const entries = fs.readdirSync(INBOUND_DIR);
  const files = entries
    .filter((f) => f.endsWith('.ogg') || f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a'))
    .map((f) => {
      const p = path.join(INBOUND_DIR, f);
      const st = fs.statSync(p);
      return { file: f, path: p, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function makeButtons(requestId, commandType) {
  let confirmLabel = '✅ 執行';
  if (commandType === 'idea') {
    confirmLabel = '💡 儲存點子';
  } else if (commandType === 'task') {
    confirmLabel = '📋 建立任務';
  }

  return [
    { text: confirmLabel, callback_data: `voice_confirm:${requestId}:execute` },
    { text: '✏️ 修改', callback_data: `voice_confirm:${requestId}:modify` },
    { text: '❌ 取消', callback_data: `voice_confirm:${requestId}:cancel` },
  ];
}

function runHandle(audioPath, dedupId) {
  const r = spawnSync('node', [HANDLE, '--path', audioPath, '--message-id', dedupId, '--file-unique-id', dedupId], {
    encoding: 'utf8',
    timeout: 600000,
  });
  const out = (r.stdout || '').trim();
  if (!out) return { error: `no output (code=${r.status})`, raw: (r.stderr || '').trim() };
  try {
    return JSON.parse(out);
  } catch (e) {
    return { error: `json parse failed: ${e.message}`, raw: out.slice(0, 500) };
  }
}

(async () => {
  const state = loadState();
  const now = Date.now();
  const cutoff = now - MAX_AGE_MIN * 60 * 1000;

  const files = listAudioFiles().filter((f) => f.mtimeMs >= cutoff).slice(0, MAX_FILES);

  const actions = [];

  for (const f of files) {
    const dedupId = `file:${f.file}`;
    if (state.seen[dedupId]) continue;

    // Mark seen early to avoid loops if transcription is slow/crashes; we still rely on voice_dedup for safety.
    state.seen[dedupId] = { firstSeenAt: new Date().toISOString(), mtimeMs: f.mtimeMs, size: f.size };
    saveState(state);

    const handled = runHandle(f.path, dedupId);

    if (handled?.isDuplicate) continue;
    if (handled?.error) {
      actions.push({
        kind: 'sendText',
        requestId: handled.requestId || dedupId,
        text: `（語音轉寫失敗）${handled.error}`,
        buttons: [],
      });
      continue;
    }

    if (handled?.suggestedReplyText) {
      // Always send transcript text first
      actions.push({
        kind: 'sendText',
        requestId: handled.requestId,
        text: handled.suggestedReplyText,
        buttons: handled.isCommand ? makeButtons(handled.requestId, handled.commandType) : [],
      });
    }
  }

  // prune old state entries (best-effort)
  const pruneCutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const [k, v] of Object.entries(state.seen || {})) {
    const ms = typeof v?.mtimeMs === 'number' ? v.mtimeMs : 0;
    if (ms && ms < pruneCutoff) delete state.seen[k];
  }
  saveState(state);

  process.stdout.write(JSON.stringify({ ok: true, actions }, null, 2));
})();
