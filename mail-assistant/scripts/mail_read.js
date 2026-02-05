#!/usr/bin/env node
/**
 * Read message by envelope id and print a safe summary.
 * Output includes headers + first ~30 lines of body.
 *
 * By default, uses --preview to avoid implicitly marking as Seen.
 */

const { runHimalayaJson } = require('./himalaya_util');

function parseArgs(argv) {
  const out = { folder: 'INBOX', account: 'hmattwork', preview: true, lines: 30 };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--preview') out.preview = true;
    else if (a === '--no-preview') out.preview = false;
    else if (a === '--lines') out.lines = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.id = rest[0];
  return out;
}

function parseHeaderBlock(text) {
  const lines = text.split(/\r?\n/);
  const headers = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { i++; break; }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, bodyLines: lines.slice(i) };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.id) {
    console.log('Usage: node mail_read.js <id> [--account hmattwork] [--folder INBOX] [--preview|--no-preview] [--lines 30]');
    process.exit(args.id ? 0 : 2);
  }

  const cmd = ['message', 'read', '-a', args.account, '-f', args.folder];
  if (args.preview) cmd.push('--preview');
  // ensure key headers exist near top if message contains them
  cmd.push('-H', 'Date', '-H', 'From', '-H', 'To', '-H', 'Subject');
  cmd.push(String(args.id));

  const raw = runHimalayaJson(cmd);
  // When output=json, himalaya returns a JSON string.
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

  const { headers, bodyLines } = parseHeaderBlock(text);
  const bodyPreview = bodyLines
    .slice(0, Math.max(1, args.lines))
    .join('\n')
    .trimEnd();

  const summary = {
    id: String(args.id),
    folder: args.folder,
    subject: headers.subject || '',
    from: headers.from || '',
    to: headers.to || '',
    date: headers.date || '',
    preview: !!args.preview,
    body_preview_lines: Math.max(1, args.lines),
    body_preview: bodyPreview,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
