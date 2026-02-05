#!/usr/bin/env node
/**
 * Move message(s) to target folder. If --archive is set, attempts to discover a Gmail archive folder.
 *
 * Examples:
 *   node mail_move.js --target "[Gmail]/All Mail" 41909
 *   node mail_move.js --archive 41909
 */

const { runHimalayaJson, runHimalaya } = require('./himalaya_util');

function parseArgs(argv) {
  const out = { folder: 'INBOX', account: 'hmattwork' };
  const ids = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--archive') out.archive = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else ids.push(a);
  }
  out.ids = ids;
  return out;
}

function pickArchiveFolder(folders) {
  const names = (folders || []).map(f => (typeof f === 'string' ? f : f.name)).filter(Boolean);
  const lowered = names.map(n => ({ n, l: n.toLowerCase() }));
  // Common Gmail/IMAP names
  const candidates = [
    '[gmail]/all mail',
    '[google mail]/all mail',
    'all mail',
    'archive',
    '[gmail]/archive',
    '[google mail]/archive',
  ];
  for (const c of candidates) {
    const hit = lowered.find(x => x.l === c);
    if (hit) return hit.n;
  }
  // fallback: contains
  const hit2 = lowered.find(x => x.l.includes('all mail')) || lowered.find(x => x.l.includes('archive'));
  return hit2 ? hit2.n : null;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.archive && !args.target) || args.ids.length === 0) {
    console.log('Usage: node mail_move.js (--target <folder> | --archive) <id...> [--account hmattwork] [--folder INBOX]');
    process.exit((args.archive || args.target) && args.ids.length ? 0 : 2);
  }

  let target = args.target;
  if (args.archive) {
    const folders = runHimalayaJson(['folder', 'list', '-a', args.account]);
    target = pickArchiveFolder(folders);
    if (!target) {
      throw new Error('Could not find an archive folder. Please pass --target explicitly.');
    }
  }

  runHimalaya(['message', 'move', '-a', args.account, '-f', args.folder, target, ...args.ids.map(String)], { output: 'plain' });

  console.log(JSON.stringify({ ok: true, folder: args.folder, target, ids: args.ids.map(String) }, null, 2));
}

main();
