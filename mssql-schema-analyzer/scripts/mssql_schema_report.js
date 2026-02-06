#!/usr/bin/env node
/*
  scripts/mssql_schema_report.js

  Reads a MSSQL schema dump JSON (from mssql_schema_dump.js)
  and generates a Markdown report with a Mermaid ERD.

  NOTE: Do NOT log credentials.
*/

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    inPath: '/home/matt/clawd/tmp/mssql-schema-dump.json',
    coreInPath: null,
    outPath: '/home/matt/clawd/tmp/mssql-schema-report.md',
    topN: 20,
    erdMaxColumnsPerTable: 30,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--in') out.inPath = argv[++i];
    else if (a === '--core-in') out.coreInPath = argv[++i];
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--top') out.topN = Number(argv[++i]);
    else if (a === '--erd-max-cols') out.erdMaxColumnsPerTable = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (!out.coreInPath) {
    const p = path.parse(out.inPath);
    out.coreInPath = path.join(p.dir, `${p.name}-core${p.ext || '.json'}`);
  }
  if (!Number.isFinite(out.topN) || out.topN <= 0) out.topN = 20;
  if (!Number.isFinite(out.erdMaxColumnsPerTable) || out.erdMaxColumnsPerTable <= 0) out.erdMaxColumnsPerTable = 30;
  return out;
}

function helpText() {
  return `MSSQL Schema Report\n\nUsage:\n  node scripts/mssql_schema_report.js [--in DUMP.json] [--core-in CORE.json] [--out REPORT.md]\n\nOptions:\n  --in PATH           Full dump JSON path (default: /home/matt/clawd/tmp/mssql-schema-dump.json)\n  --core-in PATH      Core dump JSON path (default: derived from --in)\n  --out PATH          Markdown report output path (default: /home/matt/clawd/tmp/mssql-schema-report.md)\n  --top N             Top N for summary tables (default: 20)\n  --erd-max-cols N    Max columns per table in ERD (default: 30)\n`;
}

function readJson(p) {
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toMermaidId(fullName) {
  // Mermaid identifiers are picky. Use a stable, readable mapping.
  return `T_${fullName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function fmtKB(kb) {
  if (kb == null) return '—';
  const n = Number(kb);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} MB`;
  return `${n.toFixed(0)} KB`;
}

function buildConstraintLookup(dump) {
  const pkColsByTableId = new Map();
  for (const c of dump.constraints || []) {
    if (c.type !== 'PK') continue;
    const arr = pkColsByTableId.get(c.object_id) || [];
    // If multiple PK constraints exist (rare), merge.
    for (const col of c.columns || []) arr.push(col);
    pkColsByTableId.set(c.object_id, arr);
  }
  // de-dupe preserve order
  for (const [id, arr] of pkColsByTableId.entries()) {
    const seen = new Set();
    pkColsByTableId.set(id, arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true))));
  }
  return { pkColsByTableId };
}

function computeConnectivity(dump) {
  const degree = new Map();
  for (const t of dump.tables || []) degree.set(t.object_id, { in: 0, out: 0, total: 0 });
  for (const fk of dump.foreign_keys || []) {
    const a = degree.get(fk.parent_object_id) || { in: 0, out: 0, total: 0 };
    const b = degree.get(fk.ref_object_id) || { in: 0, out: 0, total: 0 };
    a.out += 1;
    b.in += 1;
    degree.set(fk.parent_object_id, a);
    degree.set(fk.ref_object_id, b);
  }
  for (const v of degree.values()) v.total = v.in + v.out;
  return degree;
}

function mdTable(rows) {
  // rows: [ [h1,h2...], [r1c1,...], ... ]
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const header = `| ${rows[0].map(esc).join(' | ')} |`;
  const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
  const body = rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`).join('\n');
  return [header, sep, body].filter(Boolean).join('\n');
}

function buildMermaidERD(coreDump, erdMaxColumnsPerTable) {
  const { pkColsByTableId } = buildConstraintLookup(coreDump);

  const tablesById = new Map(coreDump.tables.map((t) => [t.object_id, t]));
  const colsByTableId = new Map();
  for (const c of coreDump.columns || []) {
    const arr = colsByTableId.get(c.object_id) || [];
    arr.push(c);
    colsByTableId.set(c.object_id, arr);
  }

  const lines = [];
  lines.push('```mermaid');
  lines.push('erDiagram');

  // Entities
  for (const t of coreDump.tables) {
    const id = toMermaidId(t.full_name);
    const cols = (colsByTableId.get(t.object_id) || []).slice(0, erdMaxColumnsPerTable);
    const pkCols = new Set(pkColsByTableId.get(t.object_id) || []);

    lines.push(`  ${id} {`);
    for (const c of cols) {
      const pkTag = pkCols.has(c.name) ? ' PK' : '';
      // Keep datatype short
      const dt = String(c.type || '');
      lines.push(`    ${dt} ${c.name}${pkTag}`);
    }
    const totalCols = (colsByTableId.get(t.object_id) || []).length;
    if (totalCols > cols.length) {
      lines.push(`    string _more_${totalCols - cols.length}_cols`);
    }
    lines.push('  }');
  }

  // Relationships
  for (const fk of coreDump.foreign_keys || []) {
    const parent = tablesById.get(fk.parent_object_id);
    const ref = tablesById.get(fk.ref_object_id);
    if (!parent || !ref) continue;
    const childId = toMermaidId(parent.full_name);
    const parentId = toMermaidId(ref.full_name);

    // One referenced row can have many child rows.
    lines.push(`  ${parentId} ||--o{ ${childId} : "${fk.name}"`);
  }

  lines.push('```');

  // Also include mapping to original names
  const mappingRows = [['MermaidId', 'Table']];
  for (const t of coreDump.tables) mappingRows.push([toMermaidId(t.full_name), t.full_name]);

  return {
    mermaid: lines.join('\n'),
    mappingTable: mdTable(mappingRows),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }

  const dump = readJson(args.inPath);
  const core = fs.existsSync(args.coreInPath) ? readJson(args.coreInPath) : null;
  const focus = core || dump;

  const connectivity = computeConnectivity(dump);

  const tablesBySize = [...dump.tables].sort((a, b) => (b.reserved_kb || 0) - (a.reserved_kb || 0));
  const topBig = tablesBySize.slice(0, Math.min(args.topN, tablesBySize.length));

  const topConn = [...dump.tables]
    .map((t) => {
      const d = connectivity.get(t.object_id) || { in: 0, out: 0, total: 0 };
      return { t, ...d };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.min(args.topN, dump.tables.length));

  const meta = dump.meta || {};
  const target = (meta && meta.target) || {};

  const parts = [];
  parts.push(`# MSSQL Schema 報告\n`);
  parts.push(`- 產生時間：${meta.generated_at || '—'}`);
  parts.push(`- 目標：${target.host || '—'}:${target.port || '—'} / ${target.database || '—'}`);
  parts.push(`- 來源檔案：\`${args.inPath}\``);
  if (core) parts.push(`- Core 檔案：\`${args.coreInPath}\``);
  parts.push('');

  parts.push('## 摘要');
  parts.push('');
  parts.push(mdTable([
    ['項目', '數量'],
    ['Schemas', dump.schemas?.length ?? 0],
    ['Tables', dump.tables?.length ?? 0],
    ['Columns', dump.columns?.length ?? 0],
    ['PK/UQ Constraints', dump.constraints?.length ?? 0],
    ['Indexes', dump.indexes?.length ?? 0],
    ['Foreign Keys', dump.foreign_keys?.length ?? 0],
    ['Core Tables', focus.tables?.length ?? 0],
    ['Core Foreign Keys', focus.foreign_keys?.length ?? 0],
  ]));
  parts.push('');

  parts.push(`## 最大的 ${Math.min(args.topN, topBig.length)} 張表（依 reserved_kb）`);
  parts.push('');
  parts.push(mdTable([
    ['#', 'Table', 'Rows(est.)', 'Reserved', 'Used', 'Data'],
    ...topBig.map((t, i) => [
      i + 1,
      t.full_name,
      t.row_count ?? '—',
      fmtKB(t.reserved_kb),
      fmtKB(t.used_kb),
      fmtKB(t.data_kb),
    ]),
  ]));
  parts.push('');

  parts.push(`## 連結度最高的 ${Math.min(args.topN, topConn.length)} 張表（依 FK 連結數）`);
  parts.push('');
  parts.push(mdTable([
    ['#', 'Table', 'FK In', 'FK Out', 'Total'],
    ...topConn.map((x, i) => [
      i + 1,
      x.t.full_name,
      x.in,
      x.out,
      x.total,
    ]),
  ]));
  parts.push('');

  parts.push('## Core（聚焦區）');
  parts.push('');
  if (core && core.meta && core.meta.core) {
    const c = core.meta.core;
    parts.push(`- Seed（Top N）：${c.seed_top_n}`);
    parts.push(`- FK 鄰域深度：${c.fk_depth}`);
    parts.push(`- Seed tables：${(c.seed_tables || []).join(', ') || '—'}`);
    parts.push('');
  } else {
    parts.push('未提供 core 檔案，以下 ERD 以完整 dump 生成（可能較大）。');
    parts.push('');
  }

  const { mermaid, mappingTable } = buildMermaidERD(focus, args.erdMaxColumnsPerTable);
  parts.push('## Mermaid ERD');
  parts.push('');
  parts.push(mermaid);
  parts.push('');
  parts.push('### Mermaid ID 對照');
  parts.push('');
  parts.push(mappingTable);
  parts.push('');

  const md = parts.join('\n');
  ensureParentDir(args.outPath);
  fs.writeFileSync(args.outPath, md, 'utf8');

  process.stdout.write(JSON.stringify({ out: args.outPath, focus_tables: focus.tables?.length ?? 0 }, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err && err.message ? err.message : String(err)}\n`);
  if (err && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
});
