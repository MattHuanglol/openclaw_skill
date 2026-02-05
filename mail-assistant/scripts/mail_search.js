#!/usr/bin/env node
/**
 * Search envelopes with filters (from/to/subject/body) and pagination.
 *
 * Example:
 *   node mail_search.js --folder INBOX --to matt.huang@xummit.com.tw --limit 5 --page 1
 */

const { runHimalayaJson, formatEnvelopeRow } = require('./himalaya_util');

function parseArgs(argv) {
  const out = { folder: 'INBOX', limit: 10, page: 1, account: 'hmattwork' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--page') out.page = Number(argv[++i]);
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--subject') out.subject = argv[++i];
    else if (a === '--body') out.body = argv[++i];
    else if (a === '--unread') out.unread = true;
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function buildQuery(args) {
  const parts = [];
  if (args.unread) parts.push('not flag seen');
  if (args.from) parts.push(`from ${JSON.stringify(args.from)}`);
  if (args.to) parts.push(`to ${JSON.stringify(args.to)}`);
  if (args.subject) parts.push(`subject ${JSON.stringify(args.subject)}`);
  if (args.body) parts.push(`body ${JSON.stringify(args.body)}`);

  // Himalaya query is token-based; using JSON.stringify adds quotes to preserve spaces.
  const filter = parts.length ? parts.join(' and ') : '';
  const sort = 'order by date desc';
  return [filter, sort].filter(Boolean).join(' ');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node mail_search.js [--account hmattwork] [--folder INBOX] [--limit 10] [--page 1] [--unread] [--from X] [--to Y] [--subject S] [--body B]');
    process.exit(0);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error('--limit must be a positive number');

  const query = buildQuery(args);

  const cmd = ['envelope', 'list', '-a', args.account, '-f', args.folder, '-p', String(args.page), '-s', String(args.limit)];
  // Pass query as a single argument to preserve quotes/spaces.
  if (query) cmd.push(query);

  const data = runHimalayaJson(cmd);

  const rows = (data || []).map(formatEnvelopeRow);
  console.log(JSON.stringify({ folder: args.folder, page: args.page, limit: args.limit, query, items: rows }, null, 2));
}

main();
