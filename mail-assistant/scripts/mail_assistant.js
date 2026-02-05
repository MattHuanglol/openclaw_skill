#!/usr/bin/env node
/**
 * Unified entrypoint for mail-assistant.
 *
 * This is intended to be called by the voice assistant later.
 * For now it can be run directly via Node.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = {
  list: 'mail_list.js',
  search: 'mail_search.js',
  read: 'mail_read.js',
  mark: 'mail_mark.js',
  move: 'mail_move.js',
  archive: 'mail_move.js',
  'notify-important': 'notify_important_unread.js',
  'notify-daily': 'notify_daily_summary.js',
};

function usage() {
  console.log(`mail-assistant usage:
  node mail_assistant.js list [--folder INBOX] [--limit 10] [--page 1]
  node mail_assistant.js search [--folder INBOX] [--unread] [--from X] [--to Y] [--subject S] [--body B] [--limit 10] [--page 1]
  node mail_assistant.js read <id> [--folder INBOX] [--preview|--no-preview] [--lines 30]
  node mail_assistant.js mark <seen|unseen> <id> [--folder INBOX]
  node mail_assistant.js move --target <folder> <id...> [--folder INBOX]
  node mail_assistant.js archive <id...> [--folder INBOX]
  node mail_assistant.js notify-important [--rules <path>] [--json]
  node mail_assistant.js notify-daily [--rules <path>] [--folder INBOX] [--top 10] [--json]
`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  const script = SCRIPTS[cmd];
  if (!script) {
    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(2);
  }

  const scriptPath = path.join(__dirname, script);
  const childArgs = [scriptPath, ...argv.slice(1)];

  // Implement archive shortcut.
  if (cmd === 'archive') {
    childArgs.splice(1, 0, '--archive');
  }

  const res = spawnSync(process.execPath, childArgs, { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

main();
