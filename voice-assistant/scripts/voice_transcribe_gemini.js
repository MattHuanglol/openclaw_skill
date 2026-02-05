#!/usr/bin/env node
/**
 * voice_transcribe_gemini.js
 *
 * Transcribe audio using Google AI Studio (Gemini) API.
 *
 * Reads GEMINI_API_KEY from process.env, else ~/.openclaw/secrets.env.
 *
 * Usage:
 *   node voice_transcribe_gemini.js <audio_file>
 *
 * Output (JSON):
 *   {"text":"...","lang":"zh","seconds":5.2}
 *   {"error":"...","text":null,"lang":null,"seconds":null}
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { getSecret } = require('./secrets');

const GEMINI_API_KEY = getSecret('GEMINI_API_KEY');
const GEMINI_MODEL = process.env.GEMINI_STT_MODEL || 'gemini-2.5-flash';

const FFMPEG_BIN = process.env.FFMPEG_BIN || path.join(__dirname, '..', '..', '..', '..', 'bin', 'ffmpeg');
const FFPROBE_BIN = process.env.FFPROBE_BIN || path.join(__dirname, '..', '..', '..', '..', 'bin', 'ffprobe');

const PYTHON_BIN = (process.env.HOME || '') + '/.venvs/whisper/bin/python';
const OPENCC_CONVERT_SCRIPT = path.join(__dirname, 'voice_convert_opencc.py');

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

function convertToWav16kMono(inputPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-gemini-stt-'));
  const outPath = path.join(tmpDir, path.basename(inputPath).replace(/\.[^.]+$/, '') + '.wav');

  const r = spawnSync(FFMPEG_BIN, [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    outPath,
  ], { encoding: 'utf8', timeout: 120000 });

  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').toString().trim();
    throw new Error(`ffmpeg convert failed: ${err || 'unknown error'}`);
  }

  return outPath;
}

async function geminiTranscribeWav(wavPath) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY (set env or ~/.openclaw/secrets.env)');
  }

  const audioBytes = fs.readFileSync(wavPath);
  const audioB64 = audioBytes.toString('base64');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const prompt = [
    '請將這段語音逐字轉寫成「繁體中文」。',
    '只輸出轉寫文字，不要加上任何前後說明、不要加標點風格描述、不要加時間戳。',
    '若有英文或數字請照原樣輸出。',
  ].join('\n');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: audioB64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini API error: HTTP ${res.status} ${res.statusText} ${t}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  return text.trim();
}

function convertToTraditionalBestEffort(text) {
  // Use OpenCC in whisper venv if available; otherwise return as-is.
  try {
    const r = spawnSync(PYTHON_BIN, [OPENCC_CONVERT_SCRIPT], {
      input: text,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.trim()) {
      return r.stdout.trim();
    }
  } catch {}
  return text;
}

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    jsonOut({ error: 'Usage: voice_transcribe_gemini.js <audio_file>', text: null, lang: null, seconds: null });
    process.exit(1);
  }

  try {
    if (!fs.existsSync(audioPath)) {
      jsonOut({ error: `File not found: ${audioPath}`, text: null, lang: null, seconds: null });
      process.exit(1);
    }

    const seconds = getAudioDurationSeconds(audioPath);
    const wavPath = convertToWav16kMono(audioPath);
    let text = await geminiTranscribeWav(wavPath);
    if (text) text = convertToTraditionalBestEffort(text);

    jsonOut({ text: text || null, lang: 'zh', seconds: seconds ? Math.round(seconds * 100) / 100 : null });
    process.exit(text ? 0 : 1);
  } catch (e) {
    jsonOut({ error: String(e?.message || e), text: null, lang: null, seconds: null });
    process.exit(1);
  }
}

main();
