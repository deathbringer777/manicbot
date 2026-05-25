/**
 * @fileoverview D1 → R2 backup pipeline.
 *
 * Runs from the cron orchestrator (`src/handlers/cron.js`, `phaseD1Backup`)
 * every 6 hours. Idempotent via the standard `tenant_config` last-run pin
 * — see `runOncePerWindow()` in cron.js.
 *
 * The strategy is "platform-runtime" rather than "wrangler-CLI":
 *   - `wrangler d1 export` would be more efficient, but it's a CLI tool;
 *     a Worker cron can't shell out. Doing it from inside the Worker means
 *     the backup runs even if no human is at a terminal — which is the
 *     entire point of automated backups.
 *   - We iterate `sqlite_master` for tables, `SELECT *` per table, serialize
 *     to NDJSON (one header row + one row per data row, prefixed with the
 *     table name). Gzip via the platform `CompressionStream`. Upload to
 *     the `ARCHIVE` R2 bucket (already bound in wrangler.toml for the
 *     phaseRetention pre-delete archive — different prefix, no clash).
 *
 * On restore, the bundled CLI script `scripts/restore-d1.mjs` downloads
 * a chosen object from R2, decompresses, and replays each row as
 * `INSERT OR REPLACE` against the target D1 — same module exports the
 * pure `restoreFromNdjson()` it uses, so unit tests can prove the
 * round-trip without touching live infrastructure.
 *
 * Retention is explicit (not R2 lifecycle): daily kept 30 days, weekly
 * kept 365 days. ISO-week derivation matches `restore-d1.mjs` so an
 * operator can list available snapshots by week without a backup-log
 * lookup.
 */

import { nowSec } from '../utils/time.js';

const SYSTEM_TABLES = new Set(['d1_migrations']);
const BACKUP_VERSION = 1;
const DAILY_RETENTION_DAYS = 30;
const WEEKLY_RETENTION_DAYS = 365;
const BACKUP_INTERVAL_SEC = 6 * 3600 - 600; // 6h minus 10min tolerance so a 15-min cron fires the next slot reliably

/**
 * List all user tables in the database (excludes sqlite_* internal tables
 * and the `d1_migrations` tracking table).
 *
 * @param {D1Database} db
 * @returns {Promise<string[]>}
 */
export async function listSqliteTables(db) {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  return (results || [])
    .map((r) => r.name)
    .filter((n) => typeof n === 'string' && !n.startsWith('sqlite_') && !SYSTEM_TABLES.has(n));
}

/**
 * Dump the whole database as newline-delimited JSON.
 *
 * Format:
 *   line 0: header object { kind, version, created_at, tables, row_count_by_table }
 *   line 1..N: { t: <tableName>, r: <row> } per row
 *
 * The single-line-per-row layout lets `restoreFromNdjson` stream the
 * payload without holding the full JSON tree in memory.
 *
 * @param {D1Database} db
 * @returns {Promise<string>}
 */
export async function dumpDatabaseToNdjson(db) {
  const tables = await listSqliteTables(db);
  const rowsByTable = {};
  const rowCountByTable = {};
  for (const t of tables) {
    const { results } = await db.prepare(`SELECT * FROM "${t}"`).all();
    const rows = results || [];
    rowsByTable[t] = rows;
    rowCountByTable[t] = rows.length;
  }
  const header = {
    kind: 'manicbot-d1-backup',
    version: BACKUP_VERSION,
    created_at: nowSec(),
    tables: tables.slice(),
    row_count_by_table: rowCountByTable,
  };
  const lines = [JSON.stringify(header)];
  for (const t of tables) {
    for (const row of rowsByTable[t]) {
      lines.push(JSON.stringify({ t, r: row }));
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Restore rows from a previously-dumped NDJSON payload.
 *
 * Uses `INSERT OR REPLACE` per row so re-running a restore is safe and the
 * target schema doesn't need to be empty (existing rows with matching
 * PKs get overwritten). The schema itself MUST already exist on the
 * target — restore replays data only, not DDL.
 *
 * @param {D1Database} db
 * @param {string} ndjson
 * @returns {Promise<{ rowsRestored: number, header: object }>}
 */
export async function restoreFromNdjson(db, ndjson) {
  if (!ndjson || !ndjson.trim()) {
    throw new Error('empty backup payload');
  }
  const lines = ndjson.split('\n').filter((l) => l.length > 0);
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new Error('unrecognized backup header');
  }
  if (header?.kind !== 'manicbot-d1-backup') {
    throw new Error('unrecognized backup header');
  }
  const columnsByTable = {};
  let rowsRestored = 0;
  for (let i = 1; i < lines.length; i++) {
    const rec = JSON.parse(lines[i]);
    const { t, r } = rec;
    if (!t || !r) continue;
    if (!columnsByTable[t]) columnsByTable[t] = Object.keys(r);
    const cols = columnsByTable[t];
    const placeholders = cols.map(() => '?').join(',');
    const colList = cols.map((c) => `"${c}"`).join(',');
    const values = cols.map((c) => (c in r ? r[c] : null));
    await db
      .prepare(`INSERT OR REPLACE INTO "${t}" (${colList}) VALUES (${placeholders})`)
      .bind(...values)
      .run();
    rowsRestored++;
  }
  return { rowsRestored, header };
}

/**
 * Build a deterministic R2 key for a backup of the given timestamp.
 *
 * Daily keys carry the full UTC timestamp (4 per day → unique).
 * Weekly keys are one per ISO week (1 per week).
 *
 * @param {number} tsSec - UNIX seconds
 * @param {'daily'|'weekly'} kind
 * @returns {string}
 */
export function buildBackupKey(tsSec, kind) {
  const d = new Date(tsSec * 1000);
  if (kind === 'daily') {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const HH = String(d.getUTCHours()).padStart(2, '0');
    const MM = String(d.getUTCMinutes()).padStart(2, '0');
    return `backups/daily/${yyyy}-${mm}-${dd}T${HH}-${MM}Z.ndjson.gz`;
  }
  if (kind === 'weekly') {
    const { year, week } = isoWeekParts(d);
    return `backups/weekly/${year}-W${String(week).padStart(2, '0')}.ndjson.gz`;
  }
  throw new Error(`unknown backup kind: ${kind}`);
}

/**
 * ISO 8601 week and the year that week belongs to (which may differ from
 * the calendar year around Jan 1 / Dec 31 boundaries).
 *
 * @param {Date} d
 * @returns {{ year: number, week: number }}
 */
function isoWeekParts(d) {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}

/**
 * Convert an ISO-week tag (year + week number) back to its Monday's UNIX
 * seconds. Used by the retention pruner to decide whether a weekly key
 * has aged out.
 */
function isoWeekToTsSec(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  return Math.floor(week1Monday.getTime() / 1000) + (week - 1) * 7 * 86_400;
}

/**
 * Check whether the current ISO week already has a weekly snapshot. If
 * not, the daily run that owns this call should also write to the weekly
 * prefix so we retain one snapshot per week for the year.
 */
export async function isWeeklySnapshotDue(r2, tsSec) {
  if (!r2 || typeof r2.list !== 'function') return false;
  const key = buildBackupKey(tsSec, 'weekly');
  const prefix = key.slice(0, key.lastIndexOf('/') + 1);
  const list = await r2.list({ prefix });
  return !(list.objects || []).some((o) => o.key === key);
}

/**
 * gzip a UTF-8 string via the platform CompressionStream.
 */
export async function compressNdjson(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function insertBackupLog(db, row) {
  if (!db?.prepare) return;
  try {
    await db
      .prepare(
        `INSERT INTO d1_backup_log (started_at, finished_at, bucket_key, kind, table_count, row_count, byte_size, sha256, status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.started_at,
        row.finished_at,
        row.bucket_key,
        row.kind,
        row.table_count,
        row.row_count,
        row.byte_size,
        row.sha256,
        row.status,
        row.error_message,
      )
      .run();
  } catch {
    // Log table may not exist on the very first run; the migration creates
    // it. Don't break the backup itself over a missing log row.
  }
}

/**
 * Execute one backup run: dump → compress → upload → log.
 *
 * Failures are recorded as `status='failed'` rows in `d1_backup_log` and
 * returned as `{ status: 'failed', error }` — never thrown. The cron
 * orchestrator phase is intentionally tolerant: a failed backup must not
 * cascade and break unrelated cron phases.
 */
export async function runBackup(env, opts = {}) {
  const db = env?.DB;
  const r2 = env?.ARCHIVE;
  const started = opts.now ?? nowSec();
  if (!r2) {
    const finished = nowSec();
    await insertBackupLog(db, {
      started_at: started,
      finished_at: finished,
      bucket_key: '',
      kind: 'daily',
      table_count: 0,
      row_count: 0,
      byte_size: 0,
      sha256: '',
      status: 'failed',
      error_message: 'archive bucket not bound (ARCHIVE)',
    });
    return { status: 'failed', error: 'archive bucket not bound (ARCHIVE)' };
  }
  try {
    const ndjson = await dumpDatabaseToNdjson(db);
    const headerLine = ndjson.split('\n', 1)[0];
    const header = JSON.parse(headerLine);
    const compressed = await compressNdjson(ndjson);
    const sha256 = await sha256Hex(compressed);
    const key = buildBackupKey(started, 'daily');
    await r2.put(key, compressed, {
      httpMetadata: { contentType: 'application/octet-stream', contentEncoding: 'gzip' },
      customMetadata: { sha256, version: String(BACKUP_VERSION) },
    });
    let weeklyKey = null;
    if (await isWeeklySnapshotDue(r2, started)) {
      weeklyKey = buildBackupKey(started, 'weekly');
      await r2.put(weeklyKey, compressed, {
        httpMetadata: { contentType: 'application/octet-stream', contentEncoding: 'gzip' },
        customMetadata: { sha256, version: String(BACKUP_VERSION), promoted_from: key },
      });
    }
    const tableCount = (header.tables || []).length;
    const rowCount = Object.values(header.row_count_by_table || {}).reduce(
      (a, b) => a + (typeof b === 'number' ? b : 0),
      0,
    );
    const finished = nowSec();
    await insertBackupLog(db, {
      started_at: started,
      finished_at: finished,
      bucket_key: key,
      kind: 'daily',
      table_count: tableCount,
      row_count: rowCount,
      byte_size: compressed.byteLength,
      sha256,
      status: 'success',
      error_message: null,
    });
    if (weeklyKey) {
      await insertBackupLog(db, {
        started_at: started,
        finished_at: finished,
        bucket_key: weeklyKey,
        kind: 'weekly',
        table_count: tableCount,
        row_count: rowCount,
        byte_size: compressed.byteLength,
        sha256,
        status: 'success',
        error_message: null,
      });
    }
    return {
      status: 'success',
      key,
      weeklyKey,
      tableCount,
      rowCount,
      byteSize: compressed.byteLength,
      sha256,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e?.message ?? e);
    const finished = nowSec();
    await insertBackupLog(db, {
      started_at: started,
      finished_at: finished,
      bucket_key: '',
      kind: 'daily',
      table_count: 0,
      row_count: 0,
      byte_size: 0,
      sha256: '',
      status: 'failed',
      error_message: message,
    });
    return { status: 'failed', error: message };
  }
}

/**
 * Look at `d1_backup_log` for the most recent successful run; return the
 * UNIX epoch (seconds) or null if no such row exists. Used by
 * `maybeRunD1Backup` to skip the 15-min cron tick when the previous run
 * is still within the 6h window.
 */
async function lastSuccessfulBackupTs(db) {
  if (!db?.prepare) return null;
  try {
    const { results } = await db
      .prepare(
        `SELECT finished_at FROM d1_backup_log WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`,
      )
      .all();
    const row = (results || [])[0];
    return row?.finished_at ?? null;
  } catch {
    return null;
  }
}

/**
 * Platform-level orchestration entry — called once per cron tick from
 * `worker.js scheduled()`. Decides whether the 6h window is up, runs a
 * backup if so, and prunes old objects in the same pass. Safe to call
 * every 15 min; only fires the real work on the relevant slot.
 *
 * @returns {Promise<{ status: 'skipped'|'success'|'failed', reason?: string, key?: string, error?: string }>}
 */
export async function maybeRunD1Backup(env, nowSecOpt) {
  const db = env?.DB;
  const r2 = env?.ARCHIVE;
  if (!db) return { status: 'skipped', reason: 'no_db_binding' };
  const now = nowSecOpt ?? nowSec();
  const last = await lastSuccessfulBackupTs(db);
  if (last != null && now - last < BACKUP_INTERVAL_SEC) {
    return { status: 'skipped', reason: 'within_window' };
  }
  const result = await runBackup(env, { now });
  if (r2) {
    try {
      await pruneOldBackups(r2, now);
    } catch {
      /* prune failures don't affect the backup success */
    }
  }
  return result;
}

/**
 * Delete daily backups older than DAILY_RETENTION_DAYS and weekly backups
 * older than WEEKLY_RETENTION_DAYS. Pruning is best-effort and the per-key
 * delete failures are swallowed so a single permission glitch can't stall
 * the whole cleanup.
 */
export async function pruneOldBackups(r2, nowTsSec) {
  if (!r2 || typeof r2.list !== 'function') {
    return { deletedDaily: 0, deletedWeekly: 0 };
  }
  const dailyCutoff = nowTsSec - DAILY_RETENTION_DAYS * 86_400;
  const weeklyCutoff = nowTsSec - WEEKLY_RETENTION_DAYS * 86_400;
  let deletedDaily = 0;
  let deletedWeekly = 0;
  const daily = await r2.list({ prefix: 'backups/daily/' });
  for (const obj of daily.objects || []) {
    const m = obj.key.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})Z/);
    if (!m) continue;
    const ts = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000);
    if (ts < dailyCutoff) {
      try {
        await r2.delete(obj.key);
        deletedDaily++;
      } catch { /* keep pruning */ }
    }
  }
  const weekly = await r2.list({ prefix: 'backups/weekly/' });
  for (const obj of weekly.objects || []) {
    const m = obj.key.match(/(\d{4})-W(\d{2})/);
    if (!m) continue;
    const weekStartTs = isoWeekToTsSec(+m[1], +m[2]);
    if (weekStartTs < weeklyCutoff) {
      try {
        await r2.delete(obj.key);
        deletedWeekly++;
      } catch { /* keep pruning */ }
    }
  }
  return { deletedDaily, deletedWeekly };
}
