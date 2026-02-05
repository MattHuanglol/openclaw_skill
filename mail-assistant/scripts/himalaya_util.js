#!/usr/bin/env node
/**
 * Himalaya CLI helper.
 *
 * Notes:
 * - himalaya sometimes prints WARN logs before JSON output; we strip everything before the first
 *   JSON token.
 * - we set env to reduce noise (NO_COLOR, RUST_LOG=error).
 */

const { spawnSync } = require('node:child_process');

function runHimalaya(args, { output = 'json', cwd, timeoutMs = 60_000 } = {}) {
  const finalArgs = [];
  if (output) finalArgs.push('-o', output);
  finalArgs.push(...args);

  const env = {
    ...process.env,
    NO_COLOR: '1',
    RUST_LOG: process.env.RUST_LOG || 'error',
  };

  const res = spawnSync('himalaya', finalArgs, {
    encoding: 'utf8',
    env,
    cwd,
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = (res.stdout || '').toString();
  const stderr = (res.stderr || '').toString();
  const combined = `${stdout}${stderr}`;

  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    const msg = [
      `himalaya failed (code=${res.status})`,
      `args: ${JSON.stringify(finalArgs)}`,
      stderr && `stderr:\n${stderr.trim()}`,
      stdout && `stdout:\n${stdout.trim()}`,
    ].filter(Boolean).join('\n');
    throw new Error(msg);
  }

  return combined;
}

function extractJsonFromMixedOutput(text) {
  if (!text) throw new Error('Empty output');
  const idx = (() => {
    const candidates = [text.indexOf('['), text.indexOf('{'), text.indexOf('"')].filter(i => i >= 0);
    return candidates.length ? Math.min(...candidates) : -1;
  })();
  if (idx < 0) {
    throw new Error(`Could not find JSON in output (first 200 chars): ${text.slice(0, 200)}`);
  }
  return text.slice(idx).trim();
}

function runHimalayaJson(args, opts = {}) {
  const raw = runHimalaya(args, { ...opts, output: 'json' });
  const jsonText = extractJsonFromMixedOutput(raw);
  return JSON.parse(jsonText);
}

function normalizeAddr(addrObj) {
  if (!addrObj) return '';
  if (typeof addrObj === 'string') return addrObj;
  const name = addrObj.name;
  const addr = addrObj.addr;
  if (name && addr) return `${name} <${addr}>`;
  return addr || name || '';
}

function formatEnvelopeRow(env) {
  const flags = (env.flags || []).join(',');
  return {
    id: env.id,
    subject: env.subject || '',
    from: normalizeAddr(env.from),
    to: normalizeAddr(env.to),
    date: env.date || '',
    flags,
    has_attachment: !!env.has_attachment,
  };
}

module.exports = {
  runHimalaya,
  runHimalayaJson,
  normalizeAddr,
  formatEnvelopeRow,
};
