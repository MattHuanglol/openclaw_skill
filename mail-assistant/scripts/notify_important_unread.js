#!/usr/bin/env node
/**
 * Important unread check.
 *
 * Rules file (user editable): ~/.openclaw/mail-assistant.rules.json
 * If rules missing/empty => print exactly: NO_REPLY
 */

const { runHimalayaJson, formatEnvelopeRow } = require('./himalaya_util');
const { loadRules, isEmptyRules, matchRule } = require('./rules_util');

function parseArgs(argv) {
  const out = { account: 'hmattwork' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--account') out.account = argv[++i];
    else if (a === '--rules') out.rulesPath = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node notify_important_unread.js [--account hmattwork] [--rules <path>] [--json]');
    process.exit(0);
  }

  const { path, rules } = loadRules(args.rulesPath);
  if (isEmptyRules(rules)) {
    process.stdout.write('NO_REPLY');
    return;
  }

  const imp = rules.important_unread || {};
  if (!imp.enabled || !Array.isArray(imp.match_any) || imp.match_any.length === 0) {
    process.stdout.write('NO_REPLY');
    return;
  }

  const folder = imp.folder || 'INBOX';
  const maxScan = Number(imp.max_scan || 50);

  const envs = runHimalayaJson(
    ['envelope', 'list', '-a', args.account, '-f', folder, '-p', '1', '-s', String(maxScan), 'not flag seen order by date desc']
  );

  const matches = [];
  for (const env of envs || []) {
    for (const rule of imp.match_any) {
      if (matchRule(env, rule)) {
        matches.push({ rule: rule.name || 'unnamed', envelope: formatEnvelopeRow(env) });
        break;
      }
    }
  }

  if (matches.length === 0) {
    process.stdout.write('NO_REPLY');
    return;
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: true, rulesPath: path, folder, matches }, null, 2));
    return;
  }

  const lines = [];
  lines.push(`IMPORTANT_UNREAD (${matches.length})`);
  lines.push(`folder: ${folder}`);
  lines.push(`rules: ${path}`);
  for (const m of matches.slice(0, 10)) {
    const e = m.envelope;
    lines.push(`- [${e.id}] ${e.subject} | from: ${e.from} | date: ${e.date} | flags: ${e.flags} | rule: ${m.rule}`);
  }
  console.log(lines.join('\n'));
}

main();
