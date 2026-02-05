#!/usr/bin/env node
/**
 * Mark envelope as seen/unseen.
 *
 * Examples:
 *   node mail_mark.js seen 41909 --folder INBOX
 *   node mail_mark.js unseen 41909 --folder INBOX
 */

const { runHimalaya } = require('./himalaya_util');

function parseArgs(argv) {
  const out = { folder: 'INBOX', account: 'hmattwork' };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.action = rest[0];
  out.id = rest[1];
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.action || !args.id) {
    console.log('Usage: node mail_mark.js <seen|unseen> <id> [--account hmattwork] [--folder INBOX]');
    process.exit(args.action && args.id ? 0 : 2);
  }

  const action = args.action.toLowerCase();
  if (action === 'seen') {
    runHimalaya(['flag', 'add', '-a', args.account, '-f', args.folder, 'seen', String(args.id)], { output: 'plain' });
  } else if (action === 'unseen' || action === 'unread') {
    runHimalaya(['flag', 'remove', '-a', args.account, '-f', args.folder, 'seen', String(args.id)], { output: 'plain' });
  } else {
    throw new Error('Unknown action, expected seen|unseen');
  }

  console.log(JSON.stringify({ ok: true, id: String(args.id), folder: args.folder, action }, null, 2));
}

main();
