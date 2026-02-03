#!/usr/bin/env node
/**
 * Kanban Dev Monitor (event-driven)
 *
 * - Polls Kanban API for in-progress tasks
 * - Detects changes (status/version/open subtasks)
 * - Detects stuck: updatedAt unchanged for >= STUCK_MINUTES (default 30)
 * - Persists snapshots to STATE_PATH
 * - Notifies main agent via: `openclaw sessions send --agent main --message ...`
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URLS = (process.env.KANBAN_URLS || 'http://localhost:3001,http://100.96.208.119:3001')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const STATE_PATH = process.env.STATE_PATH || '/home/matt/clawd/memory/kanban-monitor-state.json';
const STUCK_MINUTES = Number(process.env.STUCK_MINUTES || 30);
const ONLY_ASSIGNEE = process.env.ONLY_ASSIGNEE || '妲己';

function nowIso() { return new Date().toISOString(); }

function readState() {
  try {
    const txt = fs.readFileSync(STATE_PATH, 'utf8');
    const j = JSON.parse(txt);
    if (!j || typeof j !== 'object') return { updatedAt: nowIso(), tasks: {} };
    if (!j.tasks || typeof j.tasks !== 'object') j.tasks = {};
    return j;
  } catch {
    return { updatedAt: nowIso(), tasks: {} };
  }
}

function writeState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = nowIso();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}

async function fetchTasks() {
  let lastErr = null;
  for (const base of URLS) {
    try {
      const j = await fetchJson(`${base.replace(/\/$/, '')}/api/tasks`);
      return { base, tasks: j };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all kanban urls failed');
}

function safeParseTime(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function snapshotTask(t) {
  const openSubs = Array.isArray(t.subtasks)
    ? t.subtasks.filter(st => !st.done).map(st => String(st.title || '').trim()).filter(Boolean)
    : [];

  return {
    taskId: t.id,
    seq: t.seq,
    title: t.title,
    status: t.status,
    assignee: t.assignee || '',
    version: t.version,
    updatedAt: t.updatedAt,
    openSubs
  };
}

function hasChanged(prev, cur) {
  if (!prev) return { changed: true, reasons: ['new'] };

  const reasons = [];
  if (prev.status !== cur.status) reasons.push(`status ${prev.status}→${cur.status}`);
  if (prev.version !== cur.version) reasons.push(`version ${prev.version}→${cur.version}`);

  const prevSubs = Array.isArray(prev.openSubs) ? prev.openSubs.join('\n') : '';
  const curSubs = Array.isArray(cur.openSubs) ? cur.openSubs.join('\n') : '';
  if (prevSubs !== curSubs) reasons.push('openSubs changed');

  return { changed: reasons.length > 0, reasons };
}

function isStuck(prev, cur) {
  // We detect stuck only if updatedAt is unchanged between snapshots
  // AND the last updatedAt is older than threshold.
  if (!prev) return false;
  if (!cur.updatedAt || !prev.updatedAt) return false;
  if (String(cur.updatedAt) !== String(prev.updatedAt)) return false;

  const updatedMs = safeParseTime(cur.updatedAt);
  if (!updatedMs) return false;
  const ageMinutes = (Date.now() - updatedMs) / 60000;
  return ageMinutes >= STUCK_MINUTES;
}

function sendToMain(message) {
  // Use OpenClaw CLI to wake main agent (internal messaging).
  // Keep it short to avoid spam.
  execFileSync('openclaw', ['sessions', 'send', '--agent', 'main', '--message', message], { stdio: 'ignore' });
}

(async () => {
  const state = readState();

  let fetched;
  try {
    fetched = await fetchTasks();
  } catch (e) {
    const msg = `🚨 Kanban Dev Monitor: Kanban API unreachable (tried ${URLS.join(', ')}). Error: ${String(e)}. Suggest: restart in /home/matt/clawd/project-kanban (node server.js).`;
    try { sendToMain(msg); } catch {}
    // Persist minimal state so next run can continue.
    writeState(state);
    process.exit(0);
  }

  const tasks = Array.isArray(fetched.tasks) ? fetched.tasks : [];
  const inProgress = tasks.filter(t => t && t.status === 'in-progress' && (!ONLY_ASSIGNEE || String(t.assignee || '') === ONLY_ASSIGNEE));

  const events = [];

  for (const t of inProgress) {
    const cur = snapshotTask(t);
    const prev = state.tasks[cur.taskId];

    const change = hasChanged(prev, cur);
    const stuck = isStuck(prev, cur);

    if (change.changed) {
      events.push({ kind: 'change', cur, reasons: change.reasons });
    }
    if (stuck) {
      events.push({ kind: 'stuck', cur, reasons: [`no updatedAt change for >= ${STUCK_MINUTES}m`] });
    }

    state.tasks[cur.taskId] = cur;
  }

  // Cleanup state for tasks no longer in-progress
  const inProgressIds = new Set(inProgress.map(t => t.id));
  for (const taskId of Object.keys(state.tasks)) {
    if (!inProgressIds.has(taskId)) {
      // keep historical snapshot but mark as not monitored? simplest: delete.
      delete state.tasks[taskId];
    }
  }

  writeState(state);

  if (events.length === 0) process.exit(0);

  // Dedup: if both change+stuck occur, prefer stuck message.
  const grouped = new Map();
  for (const e of events) {
    const k = e.cur.taskId;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }

  for (const [taskId, evs] of grouped.entries()) {
    const stuckEvt = evs.find(e => e.kind === 'stuck');
    const changeEvts = evs.filter(e => e.kind === 'change');

    if (stuckEvt) {
      const t = stuckEvt.cur;
      const msg = `🚨 Dev Monitor: Task #${t.seq}「${t.title}」疑似卡住（updatedAt=${t.updatedAt}，>=${STUCK_MINUTES}m 無更新）。建議：PM 決定是否重跑 phase/重啟服務。`;
      try { sendToMain(msg); } catch {}
      continue;
    }

    // Change event
    const t = changeEvts[0].cur;
    const reasons = [...new Set(changeEvts.flatMap(e => e.reasons))].join(', ');
    const msg = `🛰️ Dev Monitor: Task #${t.seq}「${t.title}」狀態變更：${reasons}. openSubs=${t.openSubs.length}`;
    try { sendToMain(msg); } catch {}
  }

  process.exit(0);
})().catch(() => process.exit(0));
