#!/usr/bin/env node

// Update project-kanban task/subtasks/discussion via SQLite (source of truth)
// and keep mirror tasks.json in sync.
//
// Usage examples:
//   node ./skills/coding-workflow/scripts/kanban_update.js \
//     --task b00e10cc-e442-4b76-ad55-69601802aac4 \
//     --set-status review \
//     --done-subtask "回歸測試：重啟 server 後可正常讀寫" \
//     --append-discussion "需要主人驗收：拖拉狀態/任務頁編輯"

const path = require('path');

const ROOT = '/home/matt/clawd';
const KANBAN_DIR = path.join(ROOT, 'project-kanban');
const TASKS_JSON = path.join(KANBAN_DIR, 'tasks.json');
const MAILBOXES_JSON = path.join(KANBAN_DIR, 'mailboxes.json');

function usage(exitCode = 2) {
  const msg = `
kanban_update.js

Required:
  --task <uuid>

Optional:
  --set-status <todo|in-progress|review|done>
  --done-subtask <title>        (repeatable; marks matching subtask done)
  --undone-subtask <title>      (repeatable; marks matching subtask not done)
  --append-discussion <text>    (adds one discussion entry, author=妲己)
  --author <name>               (default: 妲己)
  --at <iso>                    (default: now)
  --dry-run

Examples:
  node ./skills/coding-workflow/scripts/kanban_update.js \\
    --task <uuid> --set-status review \\
    --append-discussion "需要主人驗收：..."
`;
  console.error(msg.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    task: null,
    setStatus: null,
    doneSubtasks: [],
    undoneSubtasks: [],
    appendDiscussion: null,
    author: '妲己',
    at: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task') out.task = argv[++i];
    else if (a === '--set-status') out.setStatus = argv[++i];
    else if (a === '--done-subtask') out.doneSubtasks.push(argv[++i]);
    else if (a === '--undone-subtask') out.undoneSubtasks.push(argv[++i]);
    else if (a === '--append-discussion') out.appendDiscussion = argv[++i];
    else if (a === '--author') out.author = argv[++i];
    else if (a === '--at') out.at = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') usage(0);
    else {
      console.error(`Unknown arg: ${a}`);
      usage(2);
    }
  }
  if (!out.task) usage(2);
  return out;
}

function normalizeStatus(s) {
  if (!s) return null;
  const v = String(s).trim();
  const allowed = new Set(['todo', 'in-progress', 'review', 'done']);
  if (!allowed.has(v)) throw new Error(`invalid status: ${v}`);
  return v;
}

function matchesTitle(subtaskTitle, needle) {
  const a = String(subtaskTitle || '').trim();
  const b = String(needle || '').trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  args.setStatus = normalizeStatus(args.setStatus);
  const now = args.at || new Date().toISOString();

  const dbMod = require(path.join(KANBAN_DIR, 'db.js'));
  const db = dbMod.openDb();
  dbMod.migrate(db);

  const task = dbMod.getTaskById(db, String(args.task));
  if (!task) {
    console.error(`Task not found: ${args.task}`);
    process.exit(1);
  }

  let subtasks = Array.isArray(task.subtasks) ? task.subtasks.map(s => ({ ...s })) : [];

  if (args.doneSubtasks.length) {
    for (const needle of args.doneSubtasks) {
      const hit = subtasks.find(s => matchesTitle(s.title, needle));
      if (!hit) {
        // don't create new subtasks silently (safer)
        console.error(`Subtask not found (cannot mark done): ${needle}`);
        process.exit(1);
      }
      hit.done = true;
      hit.completedAt = hit.completedAt || now;
    }
  }

  if (args.undoneSubtasks.length) {
    for (const needle of args.undoneSubtasks) {
      const hit = subtasks.find(s => matchesTitle(s.title, needle));
      if (!hit) {
        console.error(`Subtask not found (cannot mark undone): ${needle}`);
        process.exit(1);
      }
      hit.done = false;
      delete hit.completedAt;
    }
  }

  const patch = {};
  if (args.setStatus) patch.status = args.setStatus;
  if (args.doneSubtasks.length || args.undoneSubtasks.length) patch.subtasks = subtasks;

  if (args.appendDiscussion) {
    patch.discussionAppend = {
      author: args.author,
      text: args.appendDiscussion,
      at: now,
    };
  }

  if (Object.keys(patch).length === 0) {
    console.error('Nothing to update (no patch fields).');
    process.exit(2);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, taskId: task.id, ifVersion: task.version, patch }, null, 2));
    process.exit(0);
  }

  const r = dbMod.patchTask(db, String(task.id), {
    ifVersion: Number(task.version || 1),
    patch,
    mirror: { tasksJsonPath: TASKS_JSON, mailboxesJsonPath: MAILBOXES_JSON },
  });

  if (r.status !== 200) {
    console.error('Patch failed:', r);
    process.exit(1);
  }

  const latest = dbMod.getTaskById(db, String(task.id));
  console.log(JSON.stringify({ success: true, task: { id: latest.id, version: latest.version, status: latest.status } }, null, 2));
}

main();
