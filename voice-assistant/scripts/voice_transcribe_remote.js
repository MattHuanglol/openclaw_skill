#!/usr/bin/env node
/**
 * voice_transcribe_remote.js
 *
 * Transcribe audio using a remote Faster-Whisper API.
 *
 * Remote API (default): POST http://100.114.182.68:8000/transcribe
 * Request: multipart/form-data with field name `file` (binary). OGG/Opus supported.
 * Auth (optional/configurable):
 *   - REMOTE_STT_TOKEN
 *   - REMOTE_STT_AUTH_HEADER (default: X-API-Key)
 *
 * Secrets are loaded from process.env, else ~/.openclaw/secrets.env.
 *
 * Usage:
 *   node voice_transcribe_remote.js <audio_file>
 *
 * Output (JSON):
 *   {"text":"...","lang":"zh","seconds":5.2,"backend":"remote"}
 *   {"error":"...","text":null,"lang":null,"seconds":null,"backend":"remote"}
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getSecret } = require('./secrets');

const DEFAULT_REMOTE_STT_URL = 'http://100.114.182.68:8000/transcribe';

const FFPROBE_BIN = process.env.FFPROBE_BIN || path.join(__dirname, '..', '..', '..', '..', 'bin', 'ffprobe');

function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2));
}

function getAudioDurationSeconds(audioPath) {
  try {
    const r = spawnSync(FFPROBE_BIN, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { encoding: 'utf8', timeout: 10000 });

    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      const n = Number(r.stdout.trim());
      if (!Number.isNaN(n)) return n;
    }
  } catch {}
  return null;
}

function guessMimeType(filePath) {
  const ext = (path.extname(filePath) || '').toLowerCase();
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.opus') return 'audio/opus';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

function parseTranscriptFromResponseText(rawText) {
  const t = (rawText || '').trim();
  if (!t) return '';

  // Try JSON parse first.
  try {
    const parsed = JSON.parse(t);

    // Response may be JSON string: "..."
    if (typeof parsed === 'string') {
      const s = parsed.trim();
      // Some servers double-encode JSON (string that contains JSON).
      try {
        const parsed2 = JSON.parse(s);
        if (parsed2 && typeof parsed2 === 'object') {
          if (typeof parsed2.text === 'string') return parsed2.text.trim();
          if (typeof parsed2.full_text === 'string') return parsed2.full_text.trim();
          if (typeof parsed2.transcript === 'string') return parsed2.transcript.trim();
          if (typeof parsed2.result === 'string') return parsed2.result.trim();
          if (parsed2.result && typeof parsed2.result.text === 'string') return parsed2.result.text.trim();
        }
      } catch {}
      return s;
    }

    // Or JSON object: {text:"..."}
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.text === 'string') return parsed.text.trim();
      if (typeof parsed.full_text === 'string') return parsed.full_text.trim();
      if (typeof parsed.transcript === 'string') return parsed.transcript.trim();
      if (typeof parsed.result === 'string') return parsed.result.trim();
      if (parsed.result && typeof parsed.result.text === 'string') return parsed.result.text.trim();
    }
  } catch {
    // Not JSON; treat as plain text.
  }

  return t;
}

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    jsonOut({ error: 'Usage: voice_transcribe_remote.js <audio_file>', text: null, lang: null, seconds: null, backend: 'remote' });
    process.exit(1);
  }

  try {
    if (!fs.existsSync(audioPath)) {
      jsonOut({ error: `File not found: ${audioPath}`, text: null, lang: null, seconds: null, backend: 'remote' });
      process.exit(1);
    }

    const remoteUrl = getSecret('REMOTE_STT_URL') || process.env.REMOTE_STT_URL || DEFAULT_REMOTE_STT_URL;
    const token = getSecret('REMOTE_STT_TOKEN') || process.env.REMOTE_STT_TOKEN || '';
    const authHeader = (getSecret('REMOTE_STT_AUTH_HEADER') || process.env.REMOTE_STT_AUTH_HEADER || 'X-API-Key').trim();

    const seconds = getAudioDurationSeconds(audioPath);

    // Build multipart/form-data
    const bytes = fs.readFileSync(audioPath);
    const mime = guessMimeType(audioPath);

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), path.basename(audioPath));

    const headers = {};
    if (token && authHeader) headers[authHeader] = token;

    const res = await fetch(remoteUrl, {
      method: 'POST',
      headers,
      body: form,
    });

    const bodyText = await res.text().catch(() => '');

    if (!res.ok) {
      throw new Error(`Remote STT HTTP ${res.status} ${res.statusText}${bodyText ? `: ${bodyText}` : ''}`);
    }

    const text = parseTranscriptFromResponseText(bodyText);

    jsonOut({
      text: text || null,
      lang: 'zh',
      seconds: seconds ? Math.round(seconds * 100) / 100 : null,
      backend: 'remote',
      ...(text ? {} : { error: 'No transcript produced' }),
    });

    process.exit(text ? 0 : 1);
  } catch (e) {
    jsonOut({ error: String(e?.message || e), text: null, lang: null, seconds: null, backend: 'remote' });
    process.exit(1);
  }
}

main();
