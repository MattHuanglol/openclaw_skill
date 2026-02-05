#!/usr/bin/env node
/**
 * voice_handle_inbound.js
 *
 * Handler for inbound Telegram voice/audio messages.
 * Implements A+1 workflow: transcribe → reply with transcript → propose command draft if starts with "指令"
 *
 * Usage:
 *   node voice_handle_inbound.js --path <audio_path> --message-id <id> [--file-unique-id <fuid>]
 *
 * Output (JSON):
 *   {
 *     "requestId": "...",
 *     "transcript": "...",
 *     "isCommand": true/false,
 *     "draftCommand": "/remind ..." or null,
 *     "suggestedReplyText": "你剛剛說：\n「...」",
 *     "error": "..." (only on failure)
 *   }
 *
 * Process:
 *   1. Check dedup using file-unique-id or message-id
 *   2. Transcribe using voice_transcribe_whisper.py
 *   3. Mark as processed (only after successful transcription)
 *   4. Parse for command intent if transcript starts with "指令"
 *   5. Return structured JSON result
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const fs = require('fs');

const SCRIPTS_DIR = __dirname;
const DEDUP_SCRIPT = path.join(SCRIPTS_DIR, 'voice_dedup.js');
const TRANSCRIBE_WHISPER_SCRIPT = path.join(SCRIPTS_DIR, 'voice_transcribe_whisper.py');
const TRANSCRIBE_GEMINI_SCRIPT = path.join(SCRIPTS_DIR, 'voice_transcribe_gemini.js');
const TRANSCRIBE_REMOTE_SCRIPT = path.join(SCRIPTS_DIR, 'voice_transcribe_remote.js');
const PENDING_STATE_FILE = path.join(process.env.HOME || '/tmp', '.clawd-voice-pending.json');

const { getSecret } = require('./secrets');

// Use whisper venv python to run the whisper/OpenCC scripts
const PYTHON_BIN = process.env.HOME + '/.venvs/whisper/bin/python';

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = {
    path: null,
    messageId: null,
    fileUniqueId: null,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];

    if (arg === '--path' && next) {
      args.path = next;
      i++;
    } else if (arg === '--message-id' && next) {
      args.messageId = next;
      i++;
    } else if (arg === '--file-unique-id' && next) {
      args.fileUniqueId = next;
      i++;
    }
  }

  return args;
}

/**
 * Generate stable request ID from fileUniqueId or messageId
 * Uses sha256 of (fileUniqueId || messageId) for stability
 */
function generateRequestId(fileUniqueId, messageId) {
  const data = fileUniqueId || messageId;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Check if message was already processed
 * @returns {object} { isDuplicate: boolean, transcript?: string }
 */
function checkDedup(dedupId) {
  try {
    const result = spawnSync('node', [DEDUP_SCRIPT, '--check', '--id', dedupId], {
      encoding: 'utf8',
      timeout: 5000,
    });

    // Exit code 1 = duplicate, 0 = new
    const output = JSON.parse(result.stdout.trim());
    return {
      isDuplicate: output.duplicate === true,
      existingTranscript: output.transcript || null,
    };
  } catch (e) {
    // If dedup check fails, proceed with transcription
    return { isDuplicate: false, existingTranscript: null };
  }
}

/**
 * Load pending drafts state
 */
function loadPendingState() {
  try {
    if (fs.existsSync(PENDING_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(PENDING_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    // Non-fatal
  }
  return { pending: {} };
}

/**
 * Save pending drafts state
 */
function savePendingState(state) {
  fs.writeFileSync(PENDING_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Store a pending command draft for later confirmation
 */
function storePendingDraft(requestId, messageId, fileUniqueId, audioPath, transcript, draftCommand) {
  const state = loadPendingState();
  state.pending[requestId] = {
    createdAt: new Date().toISOString(),
    messageId,
    fileUniqueId: fileUniqueId || null,
    audioPath,
    transcript,
    draftCommand,
  };
  savePendingState(state);
}

/**
 * Mark message as processed
 */
function markProcessed(dedupId, transcript) {
  try {
    spawnSync('node', [DEDUP_SCRIPT, '--mark', '--id', dedupId, '--transcript', transcript], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) {
    // Non-fatal, log but continue
    console.error(`Warning: Failed to mark as processed: ${e.message}`);
  }
}

/**
 * Transcribe audio file.
 * Preference chain:
 *   1) Remote Faster-Whisper (if REMOTE_STT_URL is set)
 *   2) Gemini STT (if GEMINI_API_KEY is present)
 *   3) Local Whisper
 *
 * @returns {object} { text, lang, seconds, backend, error? , sttError? }
 */
function transcribe(audioPath) {
  const remoteUrl = getSecret('REMOTE_STT_URL');
  const geminiKey = getSecret('GEMINI_API_KEY');

  const errors = [];

  function runJson(cmd, args, backendLabel) {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 600000, // 10 min timeout for long audio
      env: process.env,
    });

    if (result.error) {
      return { parsed: null, err: `Spawn error: ${result.error.message}`, backend: backendLabel };
    }

    const output = (result.stdout || '').trim();
    if (!output) {
      const msg = `No output from transcription. stderr: ${(result.stderr || '').toString().trim()}`.trim();
      return { parsed: null, err: msg, backend: backendLabel };
    }

    try {
      const parsed = JSON.parse(output);
      return { parsed, err: null, backend: backendLabel };
    } catch (e) {
      return { parsed: null, err: `Invalid JSON output: ${e.message}. Raw: ${output.slice(0, 200)}`, backend: backendLabel };
    }
  }

  try {
    // 1) Remote
    if (remoteUrl) {
      const r = runJson('node', [TRANSCRIBE_REMOTE_SCRIPT, audioPath], 'remote');
      if (r.parsed && !r.parsed.error && r.parsed.text) {
        return { ...r.parsed, backend: 'remote' };
      }
      errors.push(r.parsed?.error || r.err || 'Remote STT failed');
    }

    // 2) Gemini
    if (geminiKey) {
      const r = runJson('node', [TRANSCRIBE_GEMINI_SCRIPT, audioPath], 'gemini');
      if (r.parsed && !r.parsed.error && r.parsed.text) {
        return {
          ...r.parsed,
          backend: 'gemini',
          ...(errors.length ? { sttError: errors.join(' | ') } : {}),
        };
      }
      errors.push(r.parsed?.error || r.err || 'Gemini STT failed');
    }

    // 3) Local Whisper
    const r = runJson(PYTHON_BIN, [TRANSCRIBE_WHISPER_SCRIPT, audioPath], 'local');
    if (r.parsed && !r.parsed.error && r.parsed.text) {
      return {
        ...r.parsed,
        backend: 'local',
        ...(errors.length ? { sttError: errors.join(' | ') } : {}),
      };
    }

    // Total failure
    const finalError = r.parsed?.error || r.err || 'Local whisper failed';
    errors.push(finalError);
    return {
      text: null,
      lang: null,
      seconds: r.parsed?.seconds ?? null,
      backend: 'local',
      error: errors.join(' | '),
    };
  } catch (e) {
    return {
      text: null,
      lang: null,
      seconds: null,
      backend: null,
      error: `Transcription failed: ${e.message}`,
    };
  }
}

/**
 * Parse command from transcript if it starts with "指令"
 * Currently supports: reminders
 *
 * Examples:
 *   "指令 提醒我明天早上九點開會" → "/remind 09:00 開會"
 *   "指令 十分鐘後提醒我喝水" → "/remind +10m 喝水"
 *   "指令 提醒我下午三點去看醫生" → "/remind 15:00 去看醫生"
 */
function parseCommand(transcript) {
  const normalized = transcript.trim();

  if (!normalized.startsWith('指令')) {
    return { isCommand: false, draftCommand: null };
  }

  // Remove "指令" prefix and extra whitespace
  const content = normalized.replace(/^指令\s*/, '').trim();

  if (!content) {
    return {
      isCommand: true,
      draftCommand: null, // No content after keyword
    };
  }

  // Try to parse as reminder command
  const reminderDraft = parseReminderCommand(content);

  if (reminderDraft) {
    return {
      isCommand: true,
      draftCommand: reminderDraft,
    };
  }

  // Unknown command type - return the raw content as suggestion
  return {
    isCommand: true,
    draftCommand: `# 無法識別的指令: ${content}`,
  };
}

/**
 * Parse reminder patterns from Chinese text
 *
 * Patterns supported:
 *   - "提醒我<time><task>" or "提醒<task>在<time>"
 *   - Time formats:
 *     - Absolute: 九點, 15:00, 下午三點
 *     - Relative: 十分鐘後, 半小時後, 一小時後
 *
 * @returns {string|null} Draft command like "/remind 09:00 開會" or null
 */
function parseReminderCommand(content) {
  // Check if this looks like a reminder
  if (!content.includes('提醒')) {
    return null;
  }

  // Remove "提醒我" or "提醒" prefix
  let task = content.replace(/提醒我?/, '').trim();

  // Time pattern extraction
  let time = null;

  // Pattern: Relative time - "X分鐘後", "半小時後", "一小時後"
  const relativePatterns = [
    { regex: /(\d+)\s*分鐘後/, format: (m) => `+${m[1]}m` },
    { regex: /(半)\s*小時後/, format: () => '+30m' },
    { regex: /(\d+)\s*小時後/, format: (m) => `+${m[1]}h` },
    { regex: /(一刻鐘|十五分鐘)後/, format: () => '+15m' },
  ];

  for (const p of relativePatterns) {
    const match = task.match(p.regex);
    if (match) {
      time = p.format(match);
      task = task.replace(p.regex, '').trim();
      break;
    }
  }

  // Pattern: Chinese hour numbers (一到十二點)
  if (!time) {
    const chineseHourMap = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
      '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12,
    };

    // Match "上午/早上X點" or "下午/晚上X點" or just "X點"
    const hourMatch = task.match(/(上午|早上|下午|晚上|中午)?\s*(一|二|三|四|五|六|七|八|九|十|十一|十二)\s*點/);
    if (hourMatch) {
      const period = hourMatch[1] || '';
      const hourChinese = hourMatch[2];
      let hour = chineseHourMap[hourChinese] || parseInt(hourChinese);

      // Adjust for PM
      if ((period === '下午' || period === '晚上') && hour < 12) {
        hour += 12;
      } else if (period === '中午') {
        hour = 12;
      } else if ((period === '上午' || period === '早上') && hour === 12) {
        hour = 0;
      }

      time = `${hour.toString().padStart(2, '0')}:00`;
      task = task.replace(/(上午|早上|下午|晚上|中午)?\s*(一|二|三|四|五|六|七|八|九|十|十一|十二)\s*點/, '').trim();
    }
  }

  // Pattern: Digital time format "HH:MM" or "H點M分"
  if (!time) {
    const digitalMatch = task.match(/(\d{1,2})\s*[:：點]\s*(\d{2})?\s*分?/);
    if (digitalMatch) {
      const hour = digitalMatch[1].padStart(2, '0');
      const minute = digitalMatch[2] || '00';
      time = `${hour}:${minute}`;
      task = task.replace(/(\d{1,2})\s*[:：點]\s*(\d{2})?\s*分?/, '').trim();
    }
  }

  // Pattern: "明天", "後天"
  let datePrefix = '';
  if (task.includes('明天')) {
    datePrefix = 'tomorrow ';
    task = task.replace('明天', '').trim();
  } else if (task.includes('後天')) {
    datePrefix = '+2d ';
    task = task.replace('後天', '').trim();
  }

  // Clean up task
  task = task.replace(/^(去|要)/, '').trim();

  if (!task) {
    task = '（待補充）';
  }

  // If we found a time, construct the command
  if (time) {
    return `/remind ${datePrefix}${time} ${task}`;
  }

  // No time found - return generic reminder
  return `/remind ${datePrefix}${task}`;
}

/**
 * Format suggested reply text
 */
function formatReplyText(transcript, isCommand, draftCommand, sttBackend) {
  let reply = `你剛剛說：\n「${transcript}」`;

  if (isCommand && draftCommand) {
    reply += `\n\n（草稿）${draftCommand}\n\n請確認：\n✅ 執行  ✏️ 修改  ❌ 取消`;
  }

  // Always include STT backend info as a final line for debugging/ops.
  reply += `\n\n(STT: ${sttBackend || 'unknown'})`;

  return reply;
}

/**
 * Main handler
 */
function main() {
  const args = parseArgs();

  // Validate required args
  if (!args.path) {
    console.log(JSON.stringify({
      error: 'Missing required --path argument',
      transcript: null,
      isCommand: false,
      draftCommand: null,
      suggestedReplyText: null,
      requestId: null,
    }));
    process.exit(1);
  }

  if (!args.messageId) {
    console.log(JSON.stringify({
      error: 'Missing required --message-id argument',
      transcript: null,
      isCommand: false,
      draftCommand: null,
      suggestedReplyText: null,
      requestId: null,
    }));
    process.exit(1);
  }

  // Dedup IDs:
  // - Prefer Telegram file_unique_id (stable across retries)
  // - Also check/mark by inbound filename to avoid double-replies when both
  //   a scanner (file-based) and a direct handler (file_unique_id-based) run.
  const fileBasedId = `file:${path.basename(args.path)}`;
  const primaryDedupId = args.fileUniqueId || args.messageId;
  const dedupIds = Array.from(new Set([primaryDedupId, fileBasedId]));

  const requestId = generateRequestId(args.fileUniqueId, args.messageId);

  // Step 1: Check dedup (but don't mark yet)
  for (const did of dedupIds) {
    const dedupResult = checkDedup(did);
    if (dedupResult.isDuplicate) {
      console.log(JSON.stringify({
        requestId,
        transcript: dedupResult.existingTranscript,
        isCommand: false,
        draftCommand: null,
        suggestedReplyText: '這則語音我已經處理過囉～',
        isDuplicate: true,
      }));
      process.exit(0);
    }
  }

  // Step 2: Transcribe
  const transcribeResult = transcribe(args.path);

  if (transcribeResult.error || !transcribeResult.text) {
    console.log(JSON.stringify({
      requestId,
      transcript: null,
      isCommand: false,
      draftCommand: null,
      suggestedReplyText: '我有收到語音，但轉寫失敗。請稍後再試，或直接用文字輸入。',
      error: transcribeResult.error || 'No transcript produced',
      seconds: transcribeResult.seconds,
      sttBackend: transcribeResult.backend || null,
      sttError: transcribeResult.sttError || transcribeResult.error || null,
    }));
    process.exit(1);
  }

  const transcript = transcribeResult.text;

  // Step 3: Mark as processed (only after successful transcription)
  for (const did of dedupIds) {
    markProcessed(did, transcript);
  }

  // Step 4: Parse command
  const { isCommand, draftCommand } = parseCommand(transcript);

  // Step 5: Store pending draft if this is a command with a draft
  if (isCommand && draftCommand) {
    storePendingDraft(requestId, args.messageId, args.fileUniqueId, args.path, transcript, draftCommand);
  }

  // Step 6: Format reply
  const suggestedReplyText = formatReplyText(transcript, isCommand, draftCommand, transcribeResult.backend);

  // Output result
  const result = {
    requestId,
    transcript,
    isCommand,
    draftCommand,
    suggestedReplyText,
    lang: transcribeResult.lang,
    seconds: transcribeResult.seconds,
    sttBackend: transcribeResult.backend || null,
    sttError: transcribeResult.sttError || null,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Also export for testing
module.exports = {
  parseCommand,
  parseReminderCommand,
  formatReplyText,
};
