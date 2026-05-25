#!/usr/bin/env node
/**
 * Restore D1 from an R2 backup.
 *
 * Usage:
 *   node scripts/restore-d1.mjs --latest                 # newest daily snapshot
 *   node scripts/restore-d1.mjs --key backups/daily/2026-05-25T06-00Z.ndjson.gz
 *   node scripts/restore-d1.mjs --list                   # list available snapshots, exit
 *   node scripts/restore-d1.mjs --latest --local         # restore against the LOCAL D1 (dev only)
 *   node scripts/restore-d1.mjs --latest --dry-run       # show what would be restored, don't write
 *
 * Required CLI tool: wrangler (already in devDependencies).
 *
 * Operator runbook (RU): docs/runbooks/d1-restore.md
 *
 * What this script DOES NOT do — by design:
 *   - It does NOT delete existing rows in target tables. Restore writes
 *     `INSERT OR REPLACE`, so existing rows with matching PKs get the
 *     backup value, but rows that exist locally but NOT in the backup
 *     are LEFT IN PLACE. If you want a hard "wipe + load", that's a
 *     separate operation (drop + re-create the DB) — refuse to bake it
 *     in here because a fat-fingered restore-with-wipe at 3am ends the
 *     business.
 *   - It does NOT migrate schema. Schema must already match. If you
 *     restored an old backup onto a newer schema, missing columns get
 *     written as NULL. Run `wrangler d1 migrations apply` first if the
 *     schemas drifted.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) {
  process.stdout.write(__usage());
  process.exit(0);
}

const BUCKET = ARGS.bucket || 'manicbot-archive';
const DB_NAME = ARGS.db || 'manicbot-db';
const REMOTE_FLAG = ARGS.local ? '--local' : '--remote';

main().catch((e) => {
  console.error(`[restore-d1] FAIL — ${e.message}`);
  process.exit(1);
});

async function main() {
  if (ARGS.list) {
    await listBackups();
    return;
  }
  const key = ARGS.latest ? await pickLatestKey() : ARGS.key;
  if (!key) {
    throw new Error('no key chosen — pass --latest or --key <r2-key>');
  }
  console.log(`[restore-d1] selected backup: ${key}`);
  const compressed = await fetchR2Object(key);
  console.log(`[restore-d1] downloaded ${compressed.byteLength.toLocaleString()} bytes`);
  const ndjson = gunzipSync(compressed).toString('utf-8');
  const { header, statements, rowCount } = ndjsonToSqlStatements(ndjson);
  console.log(`[restore-d1] backup created_at: ${new Date(header.created_at * 1000).toISOString()}`);
  console.log(`[restore-d1] tables: ${header.tables.length}, total rows: ${rowCount}`);
  if (ARGS['dry-run']) {
    console.log('[restore-d1] DRY-RUN — first 5 statements:');
    statements.slice(0, 5).forEach((s, i) => console.log(`  [${i + 1}] ${s.slice(0, 200)}${s.length > 200 ? '...' : ''}`));
    return;
  }
  // Write SQL to a tmp file (wrangler d1 execute reads --file)
  const dir = mkdtempSync(join(tmpdir(), 'd1restore-'));
  const sqlPath = join(dir, 'restore.sql');
  // SQLite expects each statement terminated by `;` and ideally on its own line.
  // We chunk into batches because D1 has per-request size limits.
  const BATCH = 500;
  for (let i = 0; i < statements.length; i += BATCH) {
    const batch = statements.slice(i, i + BATCH).join(';\n') + ';\n';
    writeFileSync(sqlPath, batch);
    console.log(`[restore-d1] applying batch ${i + 1}..${Math.min(i + BATCH, statements.length)} of ${statements.length}`);
    await runWrangler(['d1', 'execute', DB_NAME, REMOTE_FLAG, '--file', sqlPath]);
  }
  try { unlinkSync(sqlPath); } catch { /* ok */ }
  console.log(`[restore-d1] DONE — ${rowCount} rows restored to ${DB_NAME} (${REMOTE_FLAG.slice(2)})`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--latest') out.latest = true;
    else if (a === '--list') out.list = true;
    else if (a === '--local') out.local = true;
    else if (a === '--dry-run') out['dry-run'] = true;
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--bucket') out.bucket = argv[++i];
    else if (a === '--db') out.db = argv[++i];
  }
  return out;
}

function __usage() {
  return `Usage: node scripts/restore-d1.mjs [options]

  --latest                Pick the newest object under backups/daily/
  --key <r2-key>          Restore a specific R2 object
  --list                  List available backups and exit
  --local                 Target the LOCAL D1 (default: --remote)
  --dry-run               Print what would happen, don't write
  --bucket <name>         Override the R2 bucket (default: manicbot-archive)
  --db <name>             Override the D1 database name (default: manicbot-db)
  --help                  This text

Operator runbook (RU): docs/runbooks/d1-restore.md
`;
}

async function listBackups() {
  console.log(`[restore-d1] listing backups in r2:${BUCKET}/backups/`);
  const daily = await r2List('backups/daily/');
  const weekly = await r2List('backups/weekly/');
  console.log(`\nDaily snapshots (${daily.length}):`);
  daily.slice(-12).forEach((k) => console.log(`  ${k}`));
  if (daily.length > 12) console.log(`  ... (${daily.length - 12} older)`);
  console.log(`\nWeekly snapshots (${weekly.length}):`);
  weekly.forEach((k) => console.log(`  ${k}`));
}

async function pickLatestKey() {
  const keys = await r2List('backups/daily/');
  if (keys.length === 0) throw new Error('no daily backups found in R2');
  return keys.sort().reverse()[0];
}

async function r2List(prefix) {
  const out = await runWrangler(['r2', 'object', 'list', BUCKET, '--prefix', prefix], true);
  // wrangler emits a list of `key   size   modified` rows
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.split(/\s+/)[0]);
}

async function fetchR2Object(key) {
  const dir = mkdtempSync(join(tmpdir(), 'r2get-'));
  const outPath = join(dir, 'object.gz');
  await runWrangler(['r2', 'object', 'get', `${BUCKET}/${key}`, '--file', outPath]);
  const { readFileSync } = await import('node:fs');
  return readFileSync(outPath);
}

function ndjsonToSqlStatements(ndjson) {
  const lines = ndjson.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error('empty backup');
  const header = JSON.parse(lines[0]);
  if (header.kind !== 'manicbot-d1-backup') throw new Error(`unrecognized header kind: ${header.kind}`);
  const statements = [];
  const columnsByTable = {};
  let rowCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const { t, r } = JSON.parse(lines[i]);
    if (!t || !r) continue;
    if (!columnsByTable[t]) columnsByTable[t] = Object.keys(r);
    const cols = columnsByTable[t];
    const colList = cols.map((c) => `"${c}"`).join(',');
    const valList = cols.map((c) => sqlLit(r[c])).join(',');
    statements.push(`INSERT OR REPLACE INTO "${t}" (${colList}) VALUES (${valList})`);
    rowCount++;
  }
  return { header, statements, rowCount };
}

function sqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  // String. Escape single quotes by doubling. Strip NUL bytes (SQLite refuses them).
  const s = String(v).replace(/'/g, "''").replace(/\0/g, '');
  return `'${s}'`;
}

function runWrangler(args, captureStdout = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['wrangler', ...args], {
      stdio: captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      env: process.env,
    });
    let buf = '';
    if (captureStdout) proc.stdout.on('data', (chunk) => { buf += chunk.toString(); });
    proc.on('exit', (code) => {
      if (code === 0) resolve(buf);
      else reject(new Error(`wrangler ${args.join(' ')} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}
