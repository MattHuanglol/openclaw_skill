#!/usr/bin/env node
/**
 * Important unread check.
 *
 * Rules file (user editable): ~/.openclaw/mail-assistant.rules.json
 * If rules missing/empty => print exactly: NO_REPLY
 */

const { runHimalaya, runHimalayaJson, formatEnvelopeRow } = require('./himalaya_util');
const { loadRules, isEmptyRules, matchRule } = require('./rules_util');

function parseArgs(argv) {
  const out = { account: 'hmattwork' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--account') out.account = argv[++i];
    else if (a === '--rules') out.rulesPath = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--no-mark') out.noMark = true;
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

  // Mark matched emails as seen (so they won't trigger again next check)
  if (!args.noMark) {
    for (const m of matches) {
      try {
        runHimalaya(
          ['flag', 'add', '-a', args.account, '-f', folder, m.envelope.id, 'seen'],
          { output: null }
        );
      } catch (e) {
        // non-fatal: log but continue
        process.stderr.write(`WARN: failed to mark ${m.envelope.id} as seen: ${e.message}\n`);
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: true, rulesPath: path, folder, matches, markedSeen: !args.noMark }, null, 2));
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
  if (!args.noMark) lines.push(`(已標記 ${matches.length} 封為已讀)`);
  console.log(lines.join('\n'));
}

main();
