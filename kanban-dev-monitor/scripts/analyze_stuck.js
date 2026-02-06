#!/usr/bin/env node
/**
 * analyze_stuck.js
 *
 * Weekly stuck analysis: scans all Kanban tasks for "妲己" discussion
 * comments containing "偵測到任務疑似卡住" within the last N days.
 * Outputs a Markdown report and optionally posts it to the Idea Bank
 * via remember_idea.js.
 *
 * Usage:
 *   node analyze_stuck.js [--dry-run] [--days N]
 */

const { execFile } = require('child_process');

// ── CLI args ────────────────────────────────────────────────────────

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

const DRY_RUN = hasFlag('dry-run');
const DAYS = Number(arg('days', '7'));

// ── Config ──────────────────────────────────────────────────────────

const URLS = (process.env.KANBAN_URLS || 'http://localhost:3001,http://100.96.208.119:3001')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const REMEMBER_IDEA_PATH = '/home/matt/clawd/skills/custom/remember-idea/scripts/remember_idea.js';
const STUCK_KEYWORD = '偵測到任務疑似卡住';
const STUCK_AUTHOR = '妲己';

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(opts.json ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers || {})
    },
    body: opts.json ? JSON.stringify(opts.json) : undefined
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!res.ok) {
    const msg = json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ''}` : text || `${res.status} ${res.statusText}`;
    const e = new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`);
    e.status = res.status;
    e.body = json || text;
    throw e;
  }

  return json;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── Data Collection ─────────────────────────────────────────────────

async function fetchAllTasks() {
  let lastErr = null;
  for (const base of URLS) {
    try {
      const baseClean = base.replace(/\/$/, '');
      const tasks = await fetchJson(`${baseClean}/api/tasks?include_archived=1`);
      return { base: baseClean, tasks };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all kanban urls failed');
}

function collectStuckEvents(tasks, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byTask = new Map();

  for (const task of tasks) {
    if (!Array.isArray(task.discussion)) continue;

    for (const msg of task.discussion) {
      if (msg.author !== STUCK_AUTHOR) continue;
      if (!msg.text || !msg.text.includes(STUCK_KEYWORD)) continue;

      const at = Date.parse(msg.at);
      if (!Number.isFinite(at) || at < cutoff) continue;

      if (!byTask.has(task.id)) {
        byTask.set(task.id, {
          taskId: task.id,
          seq: task.seq,
          title: task.title,
          status: task.status,
          count: 0
        });
      }
      byTask.get(task.id).count += 1;
    }
  }

  const stats = Array.from(byTask.values());
  stats.sort((a, b) => b.count - a.count);
  return stats;
}

// ── Report Generation ───────────────────────────────────────────────

function buildReport(stats) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
  const totalEvents = stats.reduce((s, t) => s + t.count, 0);
  const totalTasks = stats.length;

  const lines = [];
  lines.push(`📊 本週卡點分析週報 (${fmtDate(weekAgo)} ~ ${fmtDate(now)})`);
  lines.push('');
  lines.push(`本週共偵測到 **${totalEvents}** 次卡住事件，涉及 **${totalTasks}** 個任務。`);
  lines.push('');

  if (stats.length > 0) {
    lines.push('### Top Stuck Tasks');
    lines.push('');
    const top = stats.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      lines.push(`${i + 1}. **[Task #${t.seq}]** ${t.title} (Count: ${t.count}) [${t.status}]`);
    }
    lines.push('');
  }

  lines.push('_(自動生成 by analyze_stuck.js)_');
  return lines.join('\n');
}

// ── Output / Persistence ────────────────────────────────────────────

function postToIdeaBank(reportContent, totalEvents) {
  const today = fmtDate(new Date());
  const title = `📊 卡點週報 (${today})`;
  const summary = `本週卡住 ${totalEvents} 次`;

  return new Promise((resolve, reject) => {
    const child = execFile('node', [
      REMEMBER_IDEA_PATH,
      '--title', title,
      '--summary', summary,
      '--tags', 'weekly-report,stuck-analysis'
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[postToIdeaBank] error:', err.message);
        if (stderr) console.error('[postToIdeaBank] stderr:', stderr);
        return reject(err);
      }
      console.log('[postToIdeaBank] stdout:', stdout);
      resolve(stdout);
    });

    // Pipe report content via stdin
    child.stdin.write(reportContent);
    child.stdin.end();
  });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`[analyze_stuck] days=${DAYS} dry-run=${DRY_RUN}`);

  const { tasks } = await fetchAllTasks();
  console.log(`[analyze_stuck] fetched ${tasks.length} tasks`);

  const stats = collectStuckEvents(tasks, DAYS);
  const totalEvents = stats.reduce((s, t) => s + t.count, 0);
  console.log(`[analyze_stuck] found ${totalEvents} stuck events across ${stats.length} tasks`);

  if (totalEvents === 0) {
    console.log('[analyze_stuck] No stuck events this week. Nothing to report.');
    return;
  }

  const report = buildReport(stats);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: Report ---');
    console.log(report);
    console.log('--- END ---\n');
    return;
  }

  await postToIdeaBank(report, totalEvents);
  console.log('[analyze_stuck] Done. Idea created.');
}

main().catch(e => {
  console.error('[analyze_stuck] FATAL:', e.message || e);
  process.exit(1);
});
