#!/usr/bin/env node
/**
 * Daily summary: counts unread and prints top N unread.
 *
 * Uses rules.daily_summary if present; otherwise uses CLI defaults.
 */

const { runHimalayaJson, formatEnvelopeRow } = require('./himalaya_util');
const { loadRules } = require('./rules_util');

function parseArgs(argv) {
  const out = { account: 'hmattwork', folder: 'INBOX', top: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--account') out.account = argv[++i];
    else if (a === '--rules') out.rulesPath = argv[++i];
    else if (a === '--folder') out.folder = argv[++i];
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node notify_daily_summary.js [--account hmattwork] [--rules <path>] [--folder INBOX] [--top 10] [--json]');
    process.exit(0);
  }

  const { rules, path } = loadRules(args.rulesPath);
  const cfg = (rules && rules.daily_summary && rules.daily_summary.enabled !== false) ? rules.daily_summary : {};

  const folder = args.folder || cfg.folder || 'INBOX';
  const topN = Number.isFinite(args.top) ? args.top : Number(cfg.top_n || 10);
  const maxPages = Number(cfg.max_pages || 10);
  const pageSize = Number(cfg.page_size || 50);

  let unreadCount = 0;
  let topItems = [];

  for (let page = 1; page <= maxPages; page++) {
    const envs = runHimalayaJson(
      ['envelope', 'list', '-a', args.account, '-f', folder, '-p', String(page), '-s', String(pageSize), 'not flag seen order by date desc']
    );

    if (!Array.isArray(envs) || envs.length === 0) break;

    unreadCount += envs.length;
    if (topItems.length < topN) {
      topItems.push(...envs.slice(0, Math.max(0, topN - topItems.length)));
    }

    if (envs.length < pageSize) break;
  }

  const top = topItems.map(formatEnvelopeRow);

  if (args.json) {
    console.log(JSON.stringify({ ok: true, rulesPath: path, folder, unreadCount, top }, null, 2));
    return;
  }

  const lines = [];
  lines.push(`DAILY_SUMMARY`);
  lines.push(`folder: ${folder}`);
  lines.push(`unread: ${unreadCount}`);
  lines.push(`rules: ${path}`);
  lines.push('---');
  for (const e of top) {
    lines.push(`- [${e.id}] ${e.subject} | from: ${e.from} | date: ${e.date} | flags: ${e.flags}`);
  }
  console.log(lines.join('\n'));
}

main();
