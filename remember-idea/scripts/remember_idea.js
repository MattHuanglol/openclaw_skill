#!/usr/bin/env node
/**
 * remember_idea.js
 *
 * Create an Idea Bank item (interest) while preserving RAW + TL;DR,
 * and append an initial AI discussion message.
 *
 * Default base URL: http://localhost:3001
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

function required(v, msg) {
  if (!v || !String(v).trim()) {
    console.error(msg);
    process.exit(2);
  }
  return String(v);
}

function buildAiTemplate(summary) {
  const s = (summary || '').trim();
  return [
    '【我先理解的版本】',
    s ? s : '（請補：用 1–2 句重述點子）',
    '',
    '【亮點 / 可能價值】',
    '- ...',
    '',
    '【風險 / 需要釐清】',
    '- ...',
    '',
    '【建議下一步（最小可行）】',
    '- ...',
    '',
    '【我想問你的問題】',
    '1) ...',
  ].join('\n');
}

(async () => {
  const base = (process.env.KANBAN_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

  const title = required(arg('title'), 'Missing --title');
  const url = arg('url', '');
  const summary = required(arg('summary'), 'Missing --summary (TL;DR)');

  const rawFile = arg('raw-file');
  const stdinRaw = await readStdin();
  const raw = (rawFile ? fs.readFileSync(rawFile, 'utf8') : stdinRaw) || '';

  // Try preferred fields first; if server ignores them, fallback to description formatting.
  const preferRawFields = !hasFlag('no-raw-fields');

  const payload = {
    title,
    url,
    summary: preferRawFields ? summary : undefined,
    rawText: preferRawFields ? raw : undefined,
    description: preferRawFields ? '' : `【妲己整理 / TL;DR】\n${summary}\n\n--- 原文 RAW ---\n${raw}`,
    status: arg('status', 'new'),
    targetAudience: arg('targetAudience', ''),
    painPoints: arg('painPoints', ''),
  };

  // Remove undefined keys
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  const r = await fetch(`${base}/api/interests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    console.error(`Failed to create idea: HTTP ${r.status}`);
    console.error(await r.text());
    process.exit(1);
  }

  const created = await r.json();
  const id = created && created.id;
  if (!id) {
    console.error('Create succeeded but no id returned');
    console.error(created);
    process.exit(1);
  }

  // Append AI discussion
  const aiText = buildAiTemplate(summary);
  const r2 = await fetch(`${base}/api/interests/${id}/discussions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: '妲己', text: aiText }),
  });

  if (!r2.ok) {
    console.error(`Idea created (${id}) but failed to append discussion: HTTP ${r2.status}`);
    console.error(await r2.text());
    process.exit(1);
  }

  const j2 = await r2.json();

  console.log(JSON.stringify({
    ok: true,
    id,
    title: created.title,
    url: created.url || url,
    aiDiscussionAdded: true,
    discussionId: j2?.created?.id || null,
  }, null, 2));
})();
