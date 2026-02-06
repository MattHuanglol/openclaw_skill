#!/usr/bin/env node
/**
 * voice_execute.js
 *
 * Execute a confirmed draft command from voice_assistant.
 * Dispatches based on commandType:
 *   - 'idea'  → Calls remember_idea.js to save to Idea Bank
 *   - 'task'  → POSTs to Kanban API to create a new task
 *   - 'exec'  → Existing /remind cron flow
 *
 * Usage:
 *   node voice_execute.js --command <cmd> [--command-type idea|task|exec] [--transcript <text>]
 *
 * Side effects:
 * - idea: Creates an entry in the Idea Bank via remember_idea.js
 * - task: Creates a Kanban task via POST /api/tasks
 * - exec: Creates a cron one-shot job (isolated agentTurn) that sends a Telegram message
 */

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REMEMBER_IDEA_SCRIPT = path.join(__dirname, '..', '..', 'remember-idea', 'scripts', 'remember_idea.js');
const KANBAN_BASE_URL = (process.env.KANBAN_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

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

/**
 * Execute idea creation via remember_idea.js
 */
function executeIdea(content, transcript) {
  const title = content.slice(0, 30).replace(/\n/g, ' ');
  const summary = content;

  const args = [
    REMEMBER_IDEA_SCRIPT,
    '--title', title,
    '--summary', summary,
    '--no-auto-tags',
  ];

  // Write transcript to a temp file for --raw-file
  let tmpFile = null;
  if (transcript) {
    tmpFile = path.join(process.env.HOME || '/tmp', `.clawd-voice-idea-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, transcript, 'utf8');
    args.push('--raw-file', tmpFile);
  }

  try {
    const result = spawnSync('node', args, { encoding: 'utf8', timeout: 30000, env: process.env });
    const output = (result.stdout || '').trim();

    // Cleanup temp file
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    if (!output) {
      return { ok: false, error: `remember_idea.js produced no output. stderr: ${(result.stderr || '').trim()}` };
    }

    try {
      const parsed = JSON.parse(output);
      if (parsed.ok) {
        return {
          ok: true,
          replyText: `✅ 已存入點子庫：${parsed.title || title}`,
          ideaId: parsed.id || null,
        };
      }
      return { ok: false, error: parsed.error || 'remember_idea.js returned ok=false' };
    } catch (e) {
      return { ok: false, error: `Invalid JSON from remember_idea.js: ${output.slice(0, 200)}` };
    }
  } catch (e) {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    return { ok: false, error: `Failed to run remember_idea.js: ${e.message}` };
  }
}

/**
 * Execute task creation via Kanban API
 */
function executeTask(content) {
  const title = content.replace(/\n/g, ' ').trim();

  try {
    const payload = JSON.stringify({
      title,
      status: 'todo',
      assignee: '妲己',
    });

    const result = spawnSync('curl', [
      '-s', '-X', 'POST',
      `${KANBAN_BASE_URL}/api/tasks`,
      '-H', 'Content-Type: application/json',
      '-d', payload,
      '--max-time', '10',
    ], { encoding: 'utf8', timeout: 15000 });

    const output = (result.stdout || '').trim();
    if (!output) {
      return { ok: false, error: `Kanban API returned no output. stderr: ${(result.stderr || '').trim()}` };
    }

    try {
      const parsed = JSON.parse(output);
      if (parsed.error) {
        return { ok: false, error: parsed.error };
      }
      const taskId = parsed.id || parsed.taskId || null;
      return {
        ok: true,
        replyText: `✅ 已建立任務：${title}`,
        taskId,
      };
    } catch (e) {
      return { ok: false, error: `Invalid JSON from Kanban API: ${output.slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, error: `Failed to call Kanban API: ${e.message}` };
  }
}

/**
 * Execute existing remind/exec command
 */
function executeRemind(cmd) {
  const parsed = parseDelayMs(cmd);
  if (!parsed) {
    return { ok: false, error: 'unsupported command', command: cmd };
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
  return { ok: true, createdJobId: created?.id || created?.jobId || null, duration: durationStr, text, command: cmd };
}

function main() {
  const cmd = arg('command');
  const commandType = arg('command-type', 'exec');
  const transcript = arg('transcript');

  if (!cmd) {
    console.error('Missing --command');
    process.exit(2);
  }

  let result;

  switch (commandType) {
    case 'idea': {
      // Extract content after /idea prefix
      const content = cmd.replace(/^\/idea\s*/, '').trim();
      if (!content) {
        result = { ok: false, error: 'Empty idea content' };
      } else {
        result = executeIdea(content, transcript);
      }
      break;
    }

    case 'task': {
      // Extract content after /task prefix
      const content = cmd.replace(/^\/task\s*/, '').trim();
      if (!content) {
        result = { ok: false, error: 'Empty task content' };
      } else {
        result = executeTask(content);
      }
      break;
    }

    default: {
      result = executeRemind(cmd);
      break;
    }
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
