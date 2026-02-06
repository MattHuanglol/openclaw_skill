#!/usr/bin/env node
/*
  scripts/mssql_schema_dump.js

  READ-ONLY MSSQL schema + size dumper.

  - Connects using the `mssql` npm package.
  - Loads secrets from process.env, else ~/.openclaw/secrets.env

  Outputs:
    1) Full dump JSON (default: /home/matt/clawd/tmp/mssql-schema-dump.json)
    2) Core dump JSON (default: ...-core.json)

  NOTE: Do NOT log credentials.
*/

'use strict';

const fs = require('fs');
const path = require('path');

const sql = require('mssql');
const { getSecret } = require('./secrets');

function parseBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return def;
}

function parseArgs(argv) {
  const out = {
    outPath: '/home/matt/clawd/tmp/mssql-schema-dump.json',
    coreOutPath: null,
    coreTopN: 20,
    coreDepth: 1,
    timeoutMs: 60_000,
    connectionTimeoutMs: 15_000,
    maxTextBytes: 2_000_000,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--core-out') out.coreOutPath = argv[++i];
    else if (a === '--core-top') out.coreTopN = Number(argv[++i]);
    else if (a === '--core-depth') out.coreDepth = Number(argv[++i]);
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--connection-timeout-ms') out.connectionTimeoutMs = Number(argv[++i]);
    else if (a === '--max-text-bytes') out.maxTextBytes = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.coreOutPath) {
    const p = path.parse(out.outPath);
    out.coreOutPath = path.join(p.dir, `${p.name}-core${p.ext || '.json'}`);
  }
  if (!Number.isFinite(out.coreTopN) || out.coreTopN <= 0) out.coreTopN = 20;
  if (!Number.isFinite(out.coreDepth) || out.coreDepth < 0) out.coreDepth = 1;
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) out.timeoutMs = 60_000;
  if (!Number.isFinite(out.connectionTimeoutMs) || out.connectionTimeoutMs <= 0) out.connectionTimeoutMs = 15_000;
  if (!Number.isFinite(out.maxTextBytes) || out.maxTextBytes <= 0) out.maxTextBytes = 2_000_000;
  return out;
}

function helpText() {
  return `MSSQL Schema Dump (READ-ONLY)\n\nUsage:\n  node scripts/mssql_schema_dump.js [--out PATH] [--core-out PATH] [--core-top N] [--core-depth N]\n\nOptions:\n  --out PATH                 Full JSON dump output path\n  --core-out PATH            Core JSON output path\n  --core-top N               Top N biggest tables to seed core (default: 20)\n  --core-depth N             FK neighborhood depth (default: 1)\n  --timeout-ms MS            Per-request timeout (default: 60000)\n  --connection-timeout-ms MS Connection timeout (default: 15000)\n  --max-text-bytes BYTES     Guardrail for JSON file size (default: 2000000)\n\nSecrets/env (process.env or ~/.openclaw/secrets.env):\n  MSSQL_HOST, MSSQL_PORT, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD\n  MSSQL_ENCRYPT (true/false), MSSQL_TRUST_CERT (true/false)\n  MSSQL_TLS_MIN_VERSION (optional, e.g. TLSv1.2; for legacy servers)\n`;
}

async function queryAll(pool, timeoutMs) {
  const request = pool.request();
  request.timeout = timeoutMs;

  const qSchemas = `
    SELECT schema_id, name
    FROM sys.schemas
    ORDER BY name;
  `;

  const qTables = `
    SELECT
      t.object_id,
      s.name AS schema_name,
      t.name AS table_name,
      t.create_date,
      t.modify_date
    FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name;
  `;

  const qColumns = `
    SELECT
      c.object_id,
      c.column_id,
      c.name AS column_name,
      ty.name AS type_name,
      c.max_length,
      c.precision,
      c.scale,
      c.is_nullable,
      c.is_identity,
      c.is_computed
    FROM sys.columns c
    INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    WHERE t.is_ms_shipped = 0
    ORDER BY c.object_id, c.column_id;
  `;

  const qKeyConstraints = `
    SELECT
      kc.parent_object_id AS object_id,
      kc.name AS constraint_name,
      kc.type AS constraint_type, -- PK / UQ
      ic.key_ordinal,
      col.name AS column_name
    FROM sys.key_constraints kc
    INNER JOIN sys.indexes i
      ON kc.parent_object_id = i.object_id
     AND kc.unique_index_id = i.index_id
    INNER JOIN sys.index_columns ic
      ON i.object_id = ic.object_id
     AND i.index_id = ic.index_id
    INNER JOIN sys.columns col
      ON ic.object_id = col.object_id
     AND ic.column_id = col.column_id
    INNER JOIN sys.tables t
      ON kc.parent_object_id = t.object_id
    WHERE t.is_ms_shipped = 0
    ORDER BY kc.parent_object_id, kc.name, ic.key_ordinal;
  `;

  const qIndexes = `
    SELECT
      i.object_id,
      i.index_id,
      i.name AS index_name,
      i.type_desc,
      i.is_unique,
      i.is_primary_key,
      i.is_unique_constraint,
      ic.key_ordinal,
      ic.is_descending_key,
      ic.is_included_column,
      col.name AS column_name
    FROM sys.indexes i
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    LEFT JOIN sys.index_columns ic
      ON i.object_id = ic.object_id
     AND i.index_id = ic.index_id
    LEFT JOIN sys.columns col
      ON ic.object_id = col.object_id
     AND ic.column_id = col.column_id
    WHERE t.is_ms_shipped = 0
      AND i.is_hypothetical = 0
      AND i.index_id > 0
    ORDER BY i.object_id, i.index_id, ic.key_ordinal, ic.index_column_id;
  `;

  const qForeignKeys = `
    SELECT
      fk.object_id AS fk_object_id,
      fk.name AS fk_name,
      fk.parent_object_id AS parent_object_id,
      ps.name AS parent_schema,
      pt.name AS parent_table,
      fk.referenced_object_id AS ref_object_id,
      rs.name AS ref_schema,
      rt.name AS ref_table,
      fkc.constraint_column_id AS ordinal,
      pc.name AS parent_column,
      rc.name AS ref_column,
      fk.delete_referential_action_desc AS on_delete,
      fk.update_referential_action_desc AS on_update,
      fk.is_disabled,
      fk.is_not_trusted
    FROM sys.foreign_keys fk
    INNER JOIN sys.tables pt ON fk.parent_object_id = pt.object_id
    INNER JOIN sys.schemas ps ON pt.schema_id = ps.schema_id
    INNER JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
    INNER JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
    INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
    WHERE pt.is_ms_shipped = 0 AND rt.is_ms_shipped = 0
    ORDER BY fk.object_id, fkc.constraint_column_id;
  `;

  const qSizes = `
    SELECT
      t.object_id,
      s.name AS schema_name,
      t.name AS table_name,
      SUM(ps.row_count) AS row_count,
      SUM(ps.reserved_page_count) * 8 AS reserved_kb,
      SUM(ps.used_page_count) * 8 AS used_kb,
      SUM(ps.in_row_data_page_count + ps.lob_used_page_count + ps.row_overflow_used_page_count) * 8 AS data_kb
    FROM sys.dm_db_partition_stats ps
    INNER JOIN sys.tables t ON ps.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.is_ms_shipped = 0
      AND ps.index_id IN (0,1)
    GROUP BY t.object_id, s.name, t.name
    ORDER BY reserved_kb DESC;
  `;

  // Run sequentially to keep resource usage low and predictable.
  const schemas = (await request.query(qSchemas)).recordset;
  const tables = (await request.query(qTables)).recordset;
  const columns = (await request.query(qColumns)).recordset;
  const keyConstraints = (await request.query(qKeyConstraints)).recordset;
  const indexes = (await request.query(qIndexes)).recordset;
  const foreignKeys = (await request.query(qForeignKeys)).recordset;
  const sizes = (await request.query(qSizes)).recordset;

  return { schemas, tables, columns, keyConstraints, indexes, foreignKeys, sizes };
}

function fullName(schema, table) {
  return `${schema}.${table}`;
}

function buildDump(raw, meta) {
  const tableById = new Map();
  for (const t of raw.tables) {
    tableById.set(t.object_id, {
      object_id: t.object_id,
      schema: t.schema_name,
      name: t.table_name,
      full_name: fullName(t.schema_name, t.table_name),
      create_date: t.create_date,
      modify_date: t.modify_date,
      row_count: null,
      reserved_kb: null,
      used_kb: null,
      data_kb: null,
    });
  }

  for (const sz of raw.sizes) {
    const t = tableById.get(sz.object_id);
    if (!t) continue;
    t.row_count = Number(sz.row_count);
    t.reserved_kb = Number(sz.reserved_kb);
    t.used_kb = Number(sz.used_kb);
    t.data_kb = Number(sz.data_kb);
  }

  const columnsByTableId = new Map();
  for (const c of raw.columns) {
    const arr = columnsByTableId.get(c.object_id) || [];
    arr.push({
      column_id: c.column_id,
      name: c.column_name,
      type: c.type_name,
      max_length: c.max_length,
      precision: c.precision,
      scale: c.scale,
      is_nullable: !!c.is_nullable,
      is_identity: !!c.is_identity,
      is_computed: !!c.is_computed,
    });
    columnsByTableId.set(c.object_id, arr);
  }

  const keyConstraintsByTableId = new Map();
  for (const k of raw.keyConstraints) {
    const arr = keyConstraintsByTableId.get(k.object_id) || [];
    arr.push({
      name: k.constraint_name,
      type: k.constraint_type,
      key_ordinal: k.key_ordinal,
      column: k.column_name,
    });
    keyConstraintsByTableId.set(k.object_id, arr);
  }

  // Aggregate key constraints into PK/UQ with ordered columns.
  const constraints = [];
  for (const [object_id, rows] of keyConstraintsByTableId.entries()) {
    const grouped = new Map();
    for (const r of rows) {
      const key = `${r.type}:${r.name}`;
      const g = grouped.get(key) || { object_id, name: r.name, type: r.type, columns: [] };
      g.columns.push({ name: r.column, ordinal: r.key_ordinal });
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      g.columns.sort((a, b) => a.ordinal - b.ordinal);
      g.columns = g.columns.map((x) => x.name);
      constraints.push(g);
    }
  }

  // Aggregate indexes.
  const idxGrouped = new Map();
  for (const r of raw.indexes) {
    const key = `${r.object_id}:${r.index_id}`;
    const g = idxGrouped.get(key) || {
      object_id: r.object_id,
      index_id: r.index_id,
      name: r.index_name || null,
      type_desc: r.type_desc,
      is_unique: !!r.is_unique,
      is_primary_key: !!r.is_primary_key,
      is_unique_constraint: !!r.is_unique_constraint,
      keys: [],
      includes: [],
    };

    if (r.column_name) {
      if (r.is_included_column) {
        g.includes.push(r.column_name);
      } else if (r.key_ordinal && r.key_ordinal > 0) {
        g.keys.push({
          name: r.column_name,
          ordinal: r.key_ordinal,
          desc: !!r.is_descending_key,
        });
      }
    }
    idxGrouped.set(key, g);
  }

  const indexes = [...idxGrouped.values()].map((g) => {
    g.keys.sort((a, b) => a.ordinal - b.ordinal);
    g.keys = g.keys.map((k) => (k.desc ? `${k.name} DESC` : k.name));
    // includes may contain duplicates due to joins; de-dupe keep order
    const seen = new Set();
    g.includes = g.includes.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    return g;
  });

  // Aggregate FKs.
  const fkGrouped = new Map();
  for (const r of raw.foreignKeys) {
    const g = fkGrouped.get(r.fk_object_id) || {
      fk_object_id: r.fk_object_id,
      name: r.fk_name,
      parent_object_id: r.parent_object_id,
      parent: fullName(r.parent_schema, r.parent_table),
      ref_object_id: r.ref_object_id,
      referenced: fullName(r.ref_schema, r.ref_table),
      columns: [],
      on_delete: r.on_delete,
      on_update: r.on_update,
      is_disabled: !!r.is_disabled,
      is_not_trusted: !!r.is_not_trusted,
    };
    g.columns.push({
      ordinal: r.ordinal,
      parent_column: r.parent_column,
      referenced_column: r.ref_column,
    });
    fkGrouped.set(r.fk_object_id, g);
  }
  const foreignKeys = [...fkGrouped.values()].map((g) => {
    g.columns.sort((a, b) => a.ordinal - b.ordinal);
    return g;
  });

  // Final tables array.
  const tables = [...tableById.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Join table->columns for convenience (kept also as separate list for easy filtering).
  const dump = {
    meta,
    schemas: raw.schemas.map((s) => ({ schema_id: s.schema_id, name: s.name })),
    tables,
    columns: raw.columns.map((c) => ({
      object_id: c.object_id,
      column_id: c.column_id,
      name: c.column_name,
      type: c.type_name,
      max_length: c.max_length,
      precision: c.precision,
      scale: c.scale,
      is_nullable: !!c.is_nullable,
      is_identity: !!c.is_identity,
      is_computed: !!c.is_computed,
    })),
    constraints,
    indexes,
    foreign_keys: foreignKeys,
  };

  // Guardrail: avoid accidentally writing huge files (e.g., if query changed).
  const approxBytes = Buffer.byteLength(JSON.stringify(dump));
  dump.meta.approx_json_bytes = approxBytes;

  return dump;
}

function buildCoreDump(dump, coreTopN, depth) {
  const tablesById = new Map(dump.tables.map((t) => [t.object_id, t]));

  const sortedBySize = [...dump.tables].sort((a, b) => (b.reserved_kb || 0) - (a.reserved_kb || 0));
  const seed = sortedBySize.slice(0, Math.min(coreTopN, sortedBySize.length));
  const coreIds = new Set(seed.map((t) => t.object_id));

  // Build adjacency from FK edges.
  const neighbors = new Map();
  function addEdge(a, b) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  }
  for (const fk of dump.foreign_keys) {
    addEdge(fk.parent_object_id, fk.ref_object_id);
    addEdge(fk.ref_object_id, fk.parent_object_id);
  }

  let frontier = new Set(coreIds);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const id of frontier) {
      const ns = neighbors.get(id);
      if (!ns) continue;
      for (const n of ns) {
        if (!coreIds.has(n)) {
          coreIds.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const coreTables = dump.tables.filter((t) => coreIds.has(t.object_id));
  const coreTableIds = new Set(coreTables.map((t) => t.object_id));

  const core = {
    meta: {
      ...dump.meta,
      core: {
        seed_top_n: coreTopN,
        fk_depth: depth,
        table_count: coreTables.length,
        seed_tables: seed.map((t) => t.full_name),
      },
    },
    schemas: dump.schemas, // keep all; tiny
    tables: coreTables,
    columns: dump.columns.filter((c) => coreTableIds.has(c.object_id)),
    constraints: dump.constraints.filter((c) => coreTableIds.has(c.object_id)),
    indexes: dump.indexes.filter((i) => coreTableIds.has(i.object_id)),
    foreign_keys: dump.foreign_keys.filter((fk) => coreTableIds.has(fk.parent_object_id) && coreTableIds.has(fk.ref_object_id)),
  };

  // Add convenience lookup of missing ids (should be none)
  core.meta.core.missing_table_ids = [...coreTableIds].filter((id) => !tablesById.has(id));

  return core;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }

  const host = getSecret('MSSQL_HOST');
  const port = Number(getSecret('MSSQL_PORT') || 1433);
  const database = getSecret('MSSQL_DATABASE');
  const user = getSecret('MSSQL_USER');
  const password = getSecret('MSSQL_PASSWORD');
  const encrypt = parseBool(getSecret('MSSQL_ENCRYPT'), true);
  const trustServerCertificate = parseBool(getSecret('MSSQL_TRUST_CERT'), false);
  const tlsMinVersion = getSecret('MSSQL_TLS_MIN_VERSION'); // e.g. TLSv1, TLSv1.1, TLSv1.2

  if (!host || !database || !user || !password) {
    throw new Error('Missing MSSQL connection secrets (MSSQL_HOST/MSSQL_DATABASE/MSSQL_USER/MSSQL_PASSWORD).');
  }

  const config = {
    server: host,
    port,
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      ...(tlsMinVersion
        ? { cryptoCredentialsDetails: { minVersion: String(tlsMinVersion) } }
        : {}),
      appName: 'openclaw-mssql-schema-analyzer',
      enableArithAbort: true,
      // Best-effort read-only hint (driver/SQL Server may ignore depending on config)
      applicationIntent: 'ReadOnly',
    },
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 10_000,
    },
    connectionTimeout: args.connectionTimeoutMs,
    requestTimeout: args.timeoutMs,
  };

  const meta = {
    generated_at: new Date().toISOString(),
    target: {
      host,
      port,
      database,
      encrypt,
      trustServerCertificate,
      tlsMinVersion: tlsMinVersion || null,
    },
    limits: {
      request_timeout_ms: args.timeoutMs,
      connection_timeout_ms: args.connectionTimeoutMs,
      core_top_n: args.coreTopN,
      core_depth: args.coreDepth,
      max_text_bytes: args.maxTextBytes,
    },
  };

  const pool = new sql.ConnectionPool(config);

  try {
    await pool.connect();
    const raw = await queryAll(pool, args.timeoutMs);
    const dump = buildDump(raw, meta);

    const json = JSON.stringify(dump, null, 2);
    if (Buffer.byteLength(json) > args.maxTextBytes) {
      throw new Error(`Refusing to write dump larger than --max-text-bytes (${args.maxTextBytes}). Got ${Buffer.byteLength(json)} bytes.`);
    }

    ensureParentDir(args.outPath);
    fs.writeFileSync(args.outPath, json, 'utf8');

    const coreDump = buildCoreDump(dump, args.coreTopN, args.coreDepth);
    const coreJson = JSON.stringify(coreDump, null, 2);
    if (Buffer.byteLength(coreJson) > args.maxTextBytes) {
      throw new Error(`Refusing to write core dump larger than --max-text-bytes (${args.maxTextBytes}). Got ${Buffer.byteLength(coreJson)} bytes.`);
    }

    ensureParentDir(args.coreOutPath);
    fs.writeFileSync(args.coreOutPath, coreJson, 'utf8');

    // Print only safe summary.
    const summary = {
      out: args.outPath,
      core_out: args.coreOutPath,
      counts: {
        schemas: dump.schemas.length,
        tables: dump.tables.length,
        columns: dump.columns.length,
        constraints: dump.constraints.length,
        indexes: dump.indexes.length,
        foreign_keys: dump.foreign_keys.length,
      },
      core_counts: {
        tables: coreDump.tables.length,
        columns: coreDump.columns.length,
        foreign_keys: coreDump.foreign_keys.length,
      },
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    try {
      await pool.close();
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  // Avoid printing config/secrets; only error message + stack.
  process.stderr.write(`ERROR: ${err && err.message ? err.message : String(err)}\n`);
  if (err && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
});
