#!/usr/bin/env node
/**
 * send_voice_notification.js
 *
 * Deterministic script for sending Telegram voice notifications via TTS.
 * Designed for cron jobs and automated workflows.
 *
 * Usage:
 *   node send_voice_notification.js --text "提醒：機車保養"
 *   node send_voice_notification.js --text "..." --target 894437982
 *   cat message.txt | node send_voice_notification.js --text-stdin
 *
 * Environment:
 *   TELEGRAM_TARGET   Default target (defaults to 894437982)
 *   OPENCLAW_API      OpenClaw API endpoint (if applicable)
 *
 * Output: JSON with status
 *
 * Note: This script outputs the INTENDED workflow. Actual TTS + message
 * sending requires OpenClaw agent execution. Use this script's output
 * as the payload for an agentTurn cron job.
 */

const fs = require('fs');

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

async function readStdin() {
  return await new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  const target = arg('target', process.env.TELEGRAM_TARGET || '894437982');

  let text = arg('text');
  if (hasFlag('text-stdin') || (!text && !process.stdin.isTTY)) {
    text = (await readStdin()).trim();
  }

  if (!text) {
    console.error('Missing --text or --text-stdin');
    console.error('Usage: node send_voice_notification.js --text "message"');
    process.exit(2);
  }

  // Output the agent instruction payload
  // This is meant to be used with OpenClaw's agentTurn / isolated session
  const agentPayload = {
    kind: 'agentTurn',
    sessionTarget: 'isolated',
    message: `Send a Telegram voice notification to ${target} with the following message:

"${text}"

Steps:
1. Call tts(text="${text}") to generate the audio file
2. Call message(action="send", channel="telegram", target="${target}", path=<MEDIA from step 1>, asVoice=true)

This is an automated notification. Do not add extra commentary.`,
    metadata: {
      source: 'send_voice_notification.js',
      timestamp: new Date().toISOString(),
      target,
      textLength: text.length
    }
  };

  console.log(JSON.stringify(agentPayload, null, 2));
})();
