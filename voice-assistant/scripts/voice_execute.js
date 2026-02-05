#!/usr/bin/env node
/**
 * voice_execute.js
 *
 * Execute a confirmed draft command from voice_assistant.
 * Currently supports: /remind (+Nm|+Nh) <text>  OR  /remind <N分鐘後/半小時後/一小時後> <text>
 *
 * Side effects:
 * - Creates a cron one-shot job (isolated agentTurn) that sends a Telegram message to Matt.
 */

const { execFileSync } = require('child_process');

function arg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

function parseDelayMs(command) {
  // Try /remind +10m 喝水
  const m = command.match(/^\s*\/remind\s+\+(\d+)\s*(m|h)\s+(.*)$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const text = (m[3] || '').trim();
    const ms = unit === 'h' ? n * 60 * 60 * 1000 : n * 60 * 1000;
    return { ms, text };
  }

  // Try Chinese: /remind 一分鐘後喝水  or /remind 1 分鐘後 喝水
  const m2 = command.match(/^\s*\/remind\s+(.+)$/i);
  if (!m2) return null;
  const rest = (m2[1] || '').trim();

  // 1分鐘後
  let mm = rest.match(/^(\d+)\s*分鐘後\s*(.*)$/);
  if (mm) return { ms: Number(mm[1]) * 60 * 1000, text: (mm[2] || '').trim() || '（提醒）' };

  // 一分鐘後
  mm = rest.match(/^一\s*分鐘後\s*(.*)$/);
  if (mm) return { ms: 1 * 60 * 1000, text: (mm[1] || '').trim() || '（提醒）' };

  // 半小時後
  mm = rest.match(/^半\s*小時後\s*(.*)$/);
  if (mm) return { ms: 30 * 60 * 1000, text: (mm[1] || '').trim() || '（提醒）' };

  // 一小時後
  mm = rest.match(/^一\s*小時後\s*(.*)$/);
  if (mm) return { ms: 60 * 60 * 1000, text: (mm[1] || '').trim() || '（提醒）' };

  // 十分鐘後（簡易：只處理十）
  mm = rest.match(/^十\s*分鐘後\s*(.*)$/);
  if (mm) return { ms: 10 * 60 * 1000, text: (mm[1] || '').trim() || '（提醒）' };

  return null;
}

function main() {
  const cmd = arg('command');
  if (!cmd) {
    console.error('Missing --command');
    process.exit(2);
  }

  const parsed = parseDelayMs(cmd);
  if (!parsed) {
    console.log(JSON.stringify({ ok: false, error: 'unsupported command', command: cmd }, null, 2));
    process.exit(1);
  }

  const text = `⏰ 提醒：${parsed.text}`;

  // Format duration for OpenClaw cron CLI: +<duration>
  const totalSeconds = Math.max(1, Math.round(parsed.ms / 1000));
  const durationStr = (totalSeconds % 3600 === 0)
    ? `${totalSeconds / 3600}h`
    : (totalSeconds % 60 === 0)
      ? `${totalSeconds / 60}m`
      : `${totalSeconds}s`;

  const name = `提醒（語音）：${parsed.text}`.slice(0, 80);
  const agentMsg = `請用 message tool 直接發 Telegram 給 Matt（target=894437982）：${text} 不要追加多餘文字。完成後輸出 NO_REPLY。`;

  const out = execFileSync('openclaw', [
    'cron', 'add',
    '--name', name,
    '--session', 'isolated',
    '--at', durationStr,
    '--message', agentMsg,
    '--timeout-seconds', '20',
    '--json'
  ], { encoding: 'utf8' });

  let created = null;
  try { created = JSON.parse(out); } catch {}
  console.log(JSON.stringify({ ok: true, createdJobId: created?.id || created?.jobId || null, duration: durationStr, text, command: cmd }, null, 2));
}

main();
