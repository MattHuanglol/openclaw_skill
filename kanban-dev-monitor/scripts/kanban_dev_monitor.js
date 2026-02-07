#!/usr/bin/env node
/**
 * Kanban Dev Monitor (event-driven)
 *
 * - Polls Kanban API for in-progress tasks
 * - Detects changes (status/version/open subtasks)
 * - Detects stuck: updatedAt unchanged for >= STUCK_MINUTES (default 30)
 * - Detects finish: tasks that WERE in-progress in previous snapshot but are no longer in-progress now
 * - Persists snapshots to STATE_PATH
 * - Notifies main agent via: `openclaw sessions send --agent main --message ...`
 *
 * Deterministic automations (no LLM):
 * A) service-down: best-effort restart `project-kanban.service`, retry fetch once
 * B) stuck: append a discussion template once per stuck episode
 * C) finish: smoke-test localhost → move to Review (never Done) + prepend result to acceptance checklist (dedup)
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
const SMOKE_TEST_URL = process.env.SMOKE_TEST_URL || 'http://localhost:3001';

function nowIso() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function readState() {
  try {
    const txt = fs.readFileSync(STATE_PATH, 'utf8');
    const j = JSON.parse(txt);
    if (!j || typeof j !== 'object') throw new Error('bad state');
    if (!j.tasks || typeof j.tasks !== 'object') j.tasks = {};

    // Backward compatible meta
    if (!j.stuckCommentAtMs || typeof j.stuckCommentAtMs !== 'object') j.stuckCommentAtMs = {};
    if (!j.finishHandledAtMs || typeof j.finishHandledAtMs !== 'object') j.finishHandledAtMs = {};

    return j;
  } catch {
    return { updatedAt: nowIso(), tasks: {}, stuckCommentAtMs: {}, finishHandledAtMs: {} };
  }
}

function writeState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = nowIso();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

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

async function fetchTasks() {
  let lastErr = null;
  for (const base of URLS) {
    try {
      const baseClean = base.replace(/\/$/, '');
      // include_archived=1 keeps tasks visible even if archived
      const j = await fetchJson(`${baseClean}/api/tasks?include_archived=1`);
      return { base: baseClean, tasks: j };
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
  // stuck only if updatedAt unchanged between snapshots AND older than threshold
  if (!prev) return false;
  if (!cur.updatedAt || !prev.updatedAt) return false;
  if (String(cur.updatedAt) !== String(prev.updatedAt)) return false;

  const updatedMs = safeParseTime(cur.updatedAt);
  if (!updatedMs) return false;
  const ageMinutes = (Date.now() - updatedMs) / 60000;
  return ageMinutes >= STUCK_MINUTES;
}

function sendToMain(message) {
  execFileSync('openclaw', ['sessions', 'send', '--agent', 'main', '--message', message], { stdio: 'ignore' });
}

function bestEffortRestartKanbanService() {
  try {
    execFileSync('systemctl', ['--user', 'restart', 'project-kanban.service'], { stdio: 'ignore' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function patchTask(base, taskId, { ifVersion, patch }) {
  const body = { patch };
  if (typeof ifVersion === 'number') body.ifVersion = ifVersion;
  return await fetchJson(`${base}/api/tasks/${encodeURIComponent(String(taskId))}`, { method: 'PATCH', json: body });
}

function buildStuckTemplate(t) {
  const lines = [
    `偵測到任務疑似卡住（>=${STUCK_MINUTES} 分鐘無更新）。`,
    '',
    '卡點/阻塞：',
    '- （請填寫）',
    '',
    '下一步：',
    '- （請填寫：要拆子任務/要我協助查 log/要重跑 phase 等）'
  ];
  return lines.join('\n');
}

function buildAcceptanceChecklist(t) {
  const lines = [
    '🚀 交付完成，請主人驗收：',
    '- [ ] 功能是否符合需求',
    '- [ ] 主要流程是否可正常操作',
    '- [ ] 邊界情境/錯誤提示是否合理',
    '- [ ] 若有需要：回歸測試/效能確認',
    '',
    '（如有問題直接回覆這張卡，我再修。）'
  ];
  return lines.join('\n');
}

async function smokeTest(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

(async () => {
  const state = readState();

  let fetched;
  let restartAttempted = false;
  let restartResult = null;

  try {
    fetched = await fetchTasks();
  } catch (e1) {
    // A) service-down auto-restart + retry once
    restartAttempted = true;
    restartResult = bestEffortRestartKanbanService();

    try {
      fetched = await fetchTasks();
      const msg = `🛠️ Kanban Dev Monitor: Kanban API unreachable, attempted restart project-kanban.service (ok=${restartResult.ok}). Retry succeeded.`;
      try { sendToMain(msg); } catch {}
    } catch (e2) {
      const msg = `🚨 Kanban Dev Monitor: Kanban API unreachable (tried ${URLS.join(', ')}). Restart attempted (ok=${restartResult.ok}). Error: ${String(e2)}.`;
      try { sendToMain(msg); } catch {}
      writeState(state);
      process.exit(0);
    }
  }

  const base = fetched.base;
  const tasks = Array.isArray(fetched.tasks) ? fetched.tasks : [];

  const curAllById = new Map();
  for (const t of tasks) {
    if (!t) continue;
    if (ONLY_ASSIGNEE && String(t.assignee || '') !== ONLY_ASSIGNEE) continue;
    curAllById.set(String(t.id), t);
  }

  const prevInProgress = Object.values(state.tasks || {}).filter(s => s && s.status === 'in-progress');
  const prevInProgressIds = new Set(prevInProgress.map(s => String(s.taskId)));

  // Build current in-progress
  const inProgress = Array.from(curAllById.values()).filter(t => t.status === 'in-progress');

  const events = [];

  // Detect finish: was in-progress, now not in-progress (but still exists)
  for (const prevId of prevInProgressIds) {
    const cur = curAllById.get(String(prevId));
    if (!cur) continue;
    if (cur.status === 'in-progress') continue;

    const lastHandled = Number(state.finishHandledAtMs?.[String(prevId)] || 0);
    // Dedup within 6 hours
    if (nowMs() - lastHandled < 6 * 60 * 60 * 1000) continue;

    const curSnap = snapshotTask(cur);
    events.push({ kind: 'finish', cur: curSnap, reasons: [`status in-progress→${curSnap.status}`] });
  }

  // Per in-progress task: change/stuck detection
  for (const t of inProgress) {
    const cur = snapshotTask(t);
    const prev = state.tasks[cur.taskId];

    const change = hasChanged(prev, cur);
    const stuck = isStuck(prev, cur);

    // Reset stuck episode if updatedAt changed
    if (prev && cur.updatedAt && prev.updatedAt && String(cur.updatedAt) !== String(prev.updatedAt)) {
      if (state.stuckCommentAtMs) delete state.stuckCommentAtMs[String(cur.taskId)];
    }

    if (change.changed) {
      events.push({ kind: 'change', cur, reasons: change.reasons });
    }
    if (stuck) {
      events.push({ kind: 'stuck', cur, reasons: [`no updatedAt change for >= ${STUCK_MINUTES}m`] });
    }

    state.tasks[cur.taskId] = cur;
  }

  // Cleanup state: keep only current in-progress snapshots
  const inProgressIds = new Set(inProgress.map(t => String(t.id)));
  for (const taskId of Object.keys(state.tasks || {})) {
    if (!inProgressIds.has(String(taskId))) delete state.tasks[taskId];
  }

  // Execute deterministic automations for stuck/finish
  for (const e of events) {
    if (e.kind === 'stuck') {
      const t = e.cur;
      const already = Number(state.stuckCommentAtMs?.[String(t.taskId)] || 0);
      if (!already) {
        try {
          await patchTask(base, t.taskId, {
            ifVersion: t.version,
            patch: {
              discussionAppend: {
                author: '妲己',
                text: buildStuckTemplate(t),
                at: nowIso()
              }
            }
          });
          state.stuckCommentAtMs[String(t.taskId)] = nowMs();
          e.reasons = [...(e.reasons || []), 'auto-commented'];
        } catch (err) {
          e.reasons = [...(e.reasons || []), `auto-comment failed: ${String(err)}`];
        }
      } else {
        e.reasons = [...(e.reasons || []), 'comment already added for this stuck episode'];
      }
    }

    if (e.kind === 'finish') {
      const t = e.cur;
      try {
        // Run smoke test before patching
        const smokeResult = await smokeTest(SMOKE_TEST_URL);
        const smokeLine = smokeResult.ok
          ? '✅ 自動 Smoke Test 通過 (HTTP 200)'
          : '❌ 自動 Smoke Test 失敗 (服務無法連線)';

        const checklist = buildAcceptanceChecklist(t);
        const combinedText = smokeLine + '\n\n' + checklist;

        // Never set to done. Ensure review unless archived.
        const patch = {
          discussionAppend: {
            author: '妲己',
            text: combinedText,
            at: nowIso()
          }
        };

        // If current status already review, skip status change.
        if (t.status !== 'review' && t.status !== 'archived') {
          patch.status = 'review';
        }

        await patchTask(base, t.taskId, {
          ifVersion: t.version,
          patch
        });

        state.finishHandledAtMs[String(t.taskId)] = nowMs();
        e.smokeOk = smokeResult.ok;
        e.reasons = [...(e.reasons || []), 'moved-to-review+checklist'];
      } catch (err) {
        e.reasons = [...(e.reasons || []), `finish handling failed: ${String(err)}`];
      }
    }
  }

  writeState(state);

  if (events.length === 0) process.exit(0);

  // Emit a deterministic JSON summary for cron runners (used to decide whether to notify).
  try {
    const out = {
      at: nowIso(),
      base,
      events: events.map(e => ({
        kind: e.kind,
        taskId: String(e.cur.taskId),
        seq: e.cur.seq,
        title: e.cur.title,
        status: e.cur.status,
        reasons: e.reasons || []
      }))
    };
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch {}

  // Group by taskId, prefer stuck over change; finish is separate.
  const grouped = new Map();
  for (const e of events) {
    const k = String(e.cur.taskId);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }

  for (const [taskId, evs] of grouped.entries()) {
    const finishEvt = evs.find(x => x.kind === 'finish');
    const stuckEvt = evs.find(x => x.kind === 'stuck');
    const changeEvts = evs.filter(x => x.kind === 'change');

    if (finishEvt) {
      const t = finishEvt.cur;
      const smokeEmoji = finishEvt.smokeOk ? '✅' : '❌';
      const reasons = [...new Set((finishEvt.reasons || []))].join(', ');
      const msg = `✅ Dev Monitor: Task #${t.seq}「${t.title}」完成（smoke: ${smokeEmoji}）。已移到 Review。（${reasons}）`;
      try { sendToMain(msg); } catch {}
      continue;
    }

    if (stuckEvt) {
      const t = stuckEvt.cur;
      const reasons = [...new Set((stuckEvt.reasons || []))].join(', ');
      const msg = `🚨 Dev Monitor: Task #${t.seq}「${t.title}」疑似卡住（updatedAt=${t.updatedAt}，>=${STUCK_MINUTES}m 無更新）。${reasons}`;
      try { sendToMain(msg); } catch {}
      continue;
    }

    if (changeEvts.length) {
      const t = changeEvts[0].cur;
      const reasons = [...new Set(changeEvts.flatMap(x => x.reasons || []))].join(', ');
      const msg = `🛰️ Dev Monitor: Task #${t.seq}「${t.title}」狀態變更：${reasons}. openSubs=${t.openSubs.length}`;
      try { sendToMain(msg); } catch {}
    }
  }

  process.exit(0);
})().catch(() => process.exit(0));
