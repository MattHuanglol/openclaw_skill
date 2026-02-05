#!/usr/bin/env node
/**
 * List envelopes (default: INBOX) sorted by date desc.
 *
 * Example:
 *   node mail_list.js --folder INBOX --limit 5
 */

const { runHimalayaJson, formatEnvelopeRow } = require('./himalaya_util');

function parseArgs(argv) {
  const out = { folder: 'INBOX', limit: 10, page: 1, account: 'hmattwork' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--page') out.page = Number(argv[++i]);
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node mail_list.js [--account hmattwork] [--folder INBOX] [--limit 10] [--page 1]');
    process.exit(0);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error('--limit must be a positive number');

  const data = runHimalayaJson(
    ['envelope', 'list', '-a', args.account, '-f', args.folder, '-p', String(args.page), '-s', String(args.limit), 'order', 'by', 'date', 'desc']
  );

  const rows = (data || []).map(formatEnvelopeRow);
  console.log(JSON.stringify({ folder: args.folder, page: args.page, limit: args.limit, items: rows }, null, 2));
}

main();
