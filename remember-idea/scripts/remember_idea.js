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

    // In many non-interactive runners, stdin is a pipe that never closes.
    // Treat stdin as "empty" unless we actually receive data quickly.
    if (process.stdin.isTTY) return resolve('');

    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      try { process.stdin.removeAllListeners('data'); } catch {}
      try { process.stdin.removeAllListeners('end'); } catch {}
      resolve(v);
    };

    const timer = setTimeout(() => {
      // No data arrived soon → assume no stdin content
      settle('');
    }, 50);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      clearTimeout(timer);
      data += c;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      settle(data);
    });
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

function extractTerms(text) {
  const t = String(text || '');
  const terms = new Set();

  // English / numbers
  for (const m of t.toLowerCase().matchAll(/[a-z0-9][a-z0-9\-_.]{1,30}/g)) {
    const w = m[0];
    if (w.length < 2) continue;
    if (['the','and','for','with','from','that','this','into','are','was','were','you','your','their','have','has','will','can','could','should','to','of','in','on','at','as','is','it'].includes(w)) continue;
    terms.add(w);
  }

  // CJK bigrams
  for (const m of t.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const s = m[0];
    for (let i = 0; i < s.length - 1; i++) {
      terms.add(s.slice(i, i + 2));
      if (terms.size > 500) break;
    }
    if (terms.size > 500) break;
  }

  return terms;
}

async function jfetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const txt = await res.text();
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${txt}`);
    e.status = res.status;
    e.body = txt;
    throw e;
  }
  return j;
}

async function ensureTag(base, { name, color }) {
  const created = await jfetch(`${base}/api/tags`, {
    method: 'POST',
    body: JSON.stringify({ name, color })
  });
  return created;
}

function defaultTagColor(name) {
  // deterministic palette based on simple hash
  const palette = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#dc2626', '#059669', '#111827', '#0891b2', '#9f1239'];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function parseTagsArg(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

(async () => {
  const base = (process.env.KANBAN_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

  const title = required(arg('title'), 'Missing --title');
  const url = arg('url', '');
  const summary = required(arg('summary'), 'Missing --summary (TL;DR)');

  const tagsCsv = arg('tags', '');
  const explicitTags = parseTagsArg(tagsCsv);
  const autoTagEnabled = !hasFlag('no-auto-tags');
  const maxAutoTags = Number(arg('max-auto-tags', '7'));

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

  // Append AI discussion (avoid duplicates)
  // Note: Kanban server already auto-creates an initial AI template discussion.
  // If it exists, do not add another one.
  const aiText = buildAiTemplate(summary);

  let aiDiscussionAdded = false;
  let discussionId = null;

  const existingDiscussions = Array.isArray(created?.discussions) ? created.discussions : [];
  const hasInitialTemplate = existingDiscussions.some(d => {
    const author = String(d?.author || '').trim();
    const head = String(d?.text || '').trim().slice(0, 30);
    return author === '妲己' && head.startsWith('【我先理解的版本】');
  });

  if (hasInitialTemplate) {
    aiDiscussionAdded = true;
    discussionId = existingDiscussions.find(d => String(d?.author||'').trim()==='妲己' && String(d?.text||'').trim().startsWith('【我先理解的版本】'))?.id || null;
  } else {
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
    aiDiscussionAdded = true;
    discussionId = j2?.created?.id || null;
  }

  // Auto-tagging (deterministic): reference existing ideas & their tags
  const tagsApplied = [];
  const tagsSuggested = [];

  try {
    const newTerms = extractTerms(`${title}\n${summary}\n${raw}`);

    // 1) Load existing interests (ideas) + tags
    const interests = await jfetch(`${base}/api/interests`, { method: 'GET', headers: {} });

    // tagName -> score
    const tagScore = new Map();

    for (const it of (Array.isArray(interests) ? interests : [])) {
      const itTags = Array.isArray(it?.tags) ? it.tags : [];
      if (!itTags.length) continue;

      const itText = `${it.title || ''}\n${it.summary || ''}\n${it.description || ''}`;
      const itTerms = extractTerms(itText);

      // overlap count
      let overlap = 0;
      for (const term of itTerms) {
        if (newTerms.has(term)) overlap++;
        if (overlap > 50) break;
      }
      if (overlap === 0) continue;

      for (const tg of itTags) {
        const name = typeof tg === 'string' ? tg : String(tg?.name || '').trim();
        if (!name) continue;
        tagScore.set(name, (tagScore.get(name) || 0) + overlap);
      }
    }

    // 2) Combine: explicit tags first, then scored auto tags
    const chosen = [];
    for (const t of explicitTags) if (!chosen.includes(t)) chosen.push(t);

    if (autoTagEnabled) {
      const sorted = [...tagScore.entries()].sort((a, b) => b[1] - a[1]);
      for (const [name] of sorted) {
        if (chosen.includes(name)) continue;
        chosen.push(name);
        if (chosen.length >= (explicitTags.length + maxAutoTags)) break;
      }
      tagsSuggested.push(...chosen.filter(x => !explicitTags.includes(x)).slice(0, maxAutoTags));
    }

    if (chosen.length) {
      // Ensure tags exist and link to this interest
      const existingTags = await jfetch(`${base}/api/tags`, { method: 'GET', headers: {} });
      const byName = new Map((Array.isArray(existingTags) ? existingTags : []).map(t => [String(t.name), t]));

      for (const name of chosen) {
        let tag = byName.get(name);
        if (!tag) {
          tag = await ensureTag(base, { name, color: defaultTagColor(name) });
          byName.set(name, tag);
        }
        await jfetch(`${base}/api/interests/${id}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tagId: tag.id })
        });
        tagsApplied.push(name);
      }
    }
  } catch (e) {
    // Never fail the whole script due to tagging.
  }

  console.log(JSON.stringify({
    ok: true,
    id,
    title: created.title,
    url: created.url || url,
    aiDiscussionAdded,
    discussionId,
    tagsApplied,
    tagsSuggested,
  }, null, 2));

  process.exit(0);
})();
