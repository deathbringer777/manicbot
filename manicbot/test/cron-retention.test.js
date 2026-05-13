/**
 * phaseRetention — R2 archive + dry-run + row-count guard.
 *
 * Covers the new behaviour layered on top of P1-10:
 *   - RETENTION_DRY_RUN=1 → no DELETE, no R2 put, dryrun event per table
 *   - count > RETENTION_MAX_ROWS → table skipped, cron.retention.skipped emitted
 *   - normal path → R2 put precedes DELETE, both fire
 *   - R2 put failure → archive_failed event, DELETE still runs
 */
import { describe, it, expect } from 'vitest';
import { phaseRetention, RETENTION_MAX_ROWS, archiveKey } from '../src/handlers/cron.js';

const RETENTION_TABLES = [
  'audit_log',
  'error_log',
  'analytics_events',
  'permission_elevation_codes',
  'stripe_events',
  'marketing_sends',
];

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.get(key) ?? null; },
    async put(key, val, _opts) { store.set(key, val); },
    async delete(key) { store.delete(key); },
  };
}

/**
 * D1 stub with per-table count + row fixtures. `counts[table]` drives the
 * COUNT(*) result; `rows[table]` is what SELECT * returns. DELETEs and
 * SELECTs are recorded for assertion.
 */
function makeDb({ counts = {}, rows = {} } = {}) {
  const deletes = [];
  const selects = [];
  return {
    deletes,
    selects,
    prepare(sql) {
      return {
        bind(..._args) { return this; },
        async first() {
          // tenant_config reads from runPhase aren't invoked here (we call
          // phaseRetention directly), so we only handle COUNT.
          const m = sql.match(/SELECT COUNT\(\*\) AS c FROM (\w+)/i);
          if (m) return { c: counts[m[1]] ?? 0 };
          return null;
        },
        async all() {
          const m = sql.match(/SELECT \* FROM (\w+)/i);
          if (m) {
            selects.push({ table: m[1], sql });
            return { results: rows[m[1]] ?? [] };
          }
          return { results: [] };
        },
        async run() {
          if (/^DELETE FROM/i.test(sql.trim())) {
            const m = sql.match(/DELETE FROM (\w+)/i);
            deletes.push({ table: m?.[1], sql });
            return { meta: { changes: counts[m?.[1]] ?? 0 } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

/** R2 stub — records every put, configurable failure. */
function makeArchive({ shouldFail = false } = {}) {
  const puts = [];
  return {
    puts,
    async put(key, body, opts) {
      if (shouldFail) throw new Error('r2 down');
      puts.push({ key, bodyBytes: body?.byteLength ?? 0, opts });
      return { key };
    },
  };
}

function readEvents(kv) {
  return JSON.parse(kv.store.get('adminlog:recent') ?? '[]');
}

describe('phaseRetention — dry-run', () => {
  it('logs counts but issues no DELETE and no R2 put when RETENTION_DRY_RUN="1"', async () => {
    const db = makeDb({ counts: { audit_log: 5, error_log: 3 } });
    const kv = makeKv();
    const archive = makeArchive();
    const ctx = {
      db, tenantId: 't_1', globalKv: kv, ARCHIVE: archive,
      RETENTION_DRY_RUN: '1',
    };
    await phaseRetention(ctx, 't_1', Date.now());

    expect(db.deletes).toEqual([]);
    expect(archive.puts).toEqual([]);

    const events = readEvents(kv);
    const dryrunEvents = events.filter(e => e.type === 'cron.retention.dryrun');
    expect(dryrunEvents.length).toBe(RETENTION_TABLES.length);
    // audit_log reports the count we configured
    const auditDry = dryrunEvents.find(e => e.data?.table === 'audit_log');
    expect(auditDry?.data?.rows).toBe(5);
  });
});

describe('phaseRetention — row-count guard', () => {
  it('skips a table whose count exceeds RETENTION_MAX_ROWS', async () => {
    const db = makeDb({
      counts: {
        audit_log: RETENTION_MAX_ROWS + 1,  // over cap → skip
        error_log: 10,                       // normal → delete
      },
    });
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv, RETENTION_DRY_RUN: '0' };
    await phaseRetention(ctx, 't_1', Date.now());

    // audit_log skipped, other 5 tables deleted normally
    const deletedTables = db.deletes.map(d => d.table);
    expect(deletedTables).not.toContain('audit_log');
    expect(deletedTables).toContain('error_log');
    expect(deletedTables.length).toBe(RETENTION_TABLES.length - 1);

    const events = readEvents(kv);
    const skipped = events.filter(e => e.type === 'cron.retention.skipped');
    expect(skipped.length).toBe(1);
    expect(skipped[0].data?.table).toBe('audit_log');
    expect(skipped[0].data?.cap).toBe(RETENTION_MAX_ROWS);
  });
});

describe('phaseRetention — normal path with R2 archive', () => {
  it('archives rows to R2 before DELETE; archive put precedes delete', async () => {
    const auditRow = { id: 1, event: 'x', created_at: 100 };
    const db = makeDb({
      counts: { audit_log: 1 },
      rows: { audit_log: [auditRow] },
    });
    const kv = makeKv();
    const archive = makeArchive();
    const callOrder = [];
    // Wrap the stubs to record interleaved order
    const origPut = archive.put.bind(archive);
    archive.put = async (k, b, o) => { callOrder.push(`put:${k.split('/')[1]}`); return origPut(k, b, o); };
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      const origRun = stmt.run.bind(stmt);
      stmt.run = async () => {
        const m = sql.match(/DELETE FROM (\w+)/i);
        if (m) callOrder.push(`del:${m[1]}`);
        return origRun();
      };
      return stmt;
    };
    const ctx = { db, tenantId: 't_1', globalKv: kv, ARCHIVE: archive };
    await phaseRetention(ctx, 't_1', Date.now());

    // audit_log: put fired and put came before delete
    expect(archive.puts.length).toBeGreaterThanOrEqual(1);
    const auditPut = archive.puts.find(p => p.key.startsWith('archive/audit_log/'));
    expect(auditPut).toBeTruthy();
    expect(auditPut.opts?.customMetadata?.table).toBe('audit_log');
    expect(auditPut.opts?.customMetadata?.rows).toBe('1');

    const putIdx = callOrder.findIndex(e => e === 'put:audit_log');
    const delIdx = callOrder.findIndex(e => e === 'del:audit_log');
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThan(putIdx);

    // pruned event recorded
    const events = readEvents(kv);
    const pruned = events.filter(e => e.type === 'cron.retention.pruned');
    expect(pruned.length).toBe(RETENTION_TABLES.length);
  });

  it('skips the R2 put when count is 0 but still runs DELETE (no-op delete)', async () => {
    const db = makeDb({ counts: {} }); // all zero
    const kv = makeKv();
    const archive = makeArchive();
    const ctx = { db, tenantId: 't_1', globalKv: kv, ARCHIVE: archive };
    await phaseRetention(ctx, 't_1', Date.now());

    expect(archive.puts).toEqual([]);
    expect(db.deletes.length).toBe(RETENTION_TABLES.length);
  });
});

describe('phaseRetention — R2 archive failure is non-blocking', () => {
  it('logs cron.retention.archive_failed and still runs DELETE when R2 put throws', async () => {
    const db = makeDb({
      counts: { audit_log: 2 },
      rows: { audit_log: [{ id: 1 }, { id: 2 }] },
    });
    const kv = makeKv();
    const archive = makeArchive({ shouldFail: true });
    const ctx = { db, tenantId: 't_1', globalKv: kv, ARCHIVE: archive };
    await phaseRetention(ctx, 't_1', Date.now());

    const events = readEvents(kv);
    const failed = events.filter(e => e.type === 'cron.retention.archive_failed');
    expect(failed.length).toBe(1);
    expect(failed[0].data?.table).toBe('audit_log');
    expect(failed[0].data?.error).toContain('r2 down');

    // DELETE still ran for audit_log
    expect(db.deletes.map(d => d.table)).toContain('audit_log');
    // And pruned event was emitted (archive failure does not block prune logging)
    const pruned = events.filter(e => e.type === 'cron.retention.pruned' && e.data?.table === 'audit_log');
    expect(pruned.length).toBe(1);
  });

  it('logs cron.retention.archive_failed when ARCHIVE binding is absent and still runs DELETE', async () => {
    const db = makeDb({
      counts: { audit_log: 2 },
      rows: { audit_log: [{ id: 1 }, { id: 2 }] },
    });
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };  // no ARCHIVE
    await phaseRetention(ctx, 't_1', Date.now());

    const events = readEvents(kv);
    const failed = events.filter(e => e.type === 'cron.retention.archive_failed' && e.data?.table === 'audit_log');
    expect(failed.length).toBe(1);
    expect(failed[0].data?.error).toBe('no_archive_binding');
    expect(db.deletes.map(d => d.table)).toContain('audit_log');
  });
});

describe('archiveKey', () => {
  it('produces a stable archive/{table}/YYYY-MM-DDTHHmmssZ.jsonl.gz layout', () => {
    const key = archiveKey('audit_log', new Date('2026-05-12T09:36:01.234Z'));
    expect(key).toBe('archive/audit_log/2026-05-12T093601Z.jsonl.gz');
  });
});
