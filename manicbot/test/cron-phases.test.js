/**
 * P1-1 — per-phase idempotency + per-phase try/catch.
 *
 * Each phase reads `cron:phase:{name}:last` from tenant_config and skips
 * if invoked within the configured window. Phase errors emit
 * `cron.phase.error` but don't abort the orchestrator.
 *
 * P1-10 — phaseRetention runs the 6 DELETE SQL statements; each in its own
 * try/catch.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PHASE_WINDOWS,
  shouldRunPhase,
  phaseCleanup,
  phaseRetention,
} from '../src/handlers/cron.js';

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.get(key) ?? null; },
    async put(key, val, _opts) { store.set(key, val); },
    async delete(key) { store.delete(key); },
  };
}

/** Minimal D1 stub with a per-key in-memory tenant_config table. */
function makeDb() {
  const tenantConfig = new Map();
  const deletes = [];
  return {
    tenantConfig,
    deletes,
    prepare(sql) {
      let boundArgs = [];
      return {
        bind(...args) { boundArgs = args; return this; },
        async first() {
          if (/SELECT value FROM tenant_config WHERE tenant_id = \? AND key = \?/i.test(sql)) {
            const key = `${boundArgs[0]}|${boundArgs[1]}`;
            const val = tenantConfig.get(key);
            return val !== undefined ? { value: val } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (/INSERT OR REPLACE INTO tenant_config/i.test(sql)) {
            const key = `${boundArgs[0]}|${boundArgs[1]}`;
            tenantConfig.set(key, boundArgs[2]);
          } else if (/^DELETE FROM/i.test(sql.trim())) {
            deletes.push({ sql: sql.trim(), args: boundArgs });
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

describe('PHASE_WINDOWS (P1-1)', () => {
  it('declares the expected per-phase windows', () => {
    expect(PHASE_WINDOWS.reviews).toBe(24 * 60 * 60);
    expect(PHASE_WINDOWS.gcalSync).toBe(10 * 60);
    expect(PHASE_WINDOWS.postVisit).toBe(60 * 60);
    expect(PHASE_WINDOWS.promos).toBe(24 * 60 * 60);
    expect(PHASE_WINDOWS.cleanup).toBe(24 * 60 * 60);
    expect(PHASE_WINDOWS.retention).toBe(24 * 60 * 60);
  });
});

describe('shouldRunPhase idempotency (P1-1)', () => {
  it('returns true when no prior run is recorded', async () => {
    const ctx = { db: makeDb(), tenantId: 't_1', globalKv: makeKv() };
    const nowSec = Math.floor(Date.now() / 1000);
    expect(await shouldRunPhase(ctx, 'gcalSync', nowSec)).toBe(true);
  });

  it('returns false when last-run is inside the window', async () => {
    const db = makeDb();
    const tenantId = 't_1';
    const nowSec = Math.floor(Date.now() / 1000);
    // Pretend reviews ran 1h ago — well inside the 24h window
    db.tenantConfig.set(`${tenantId}|cron:phase:reviews:last`, String(nowSec - 3600));
    const ctx = { db, tenantId };
    expect(await shouldRunPhase(ctx, 'reviews', nowSec)).toBe(false);
  });

  it('returns true when last-run is outside the window', async () => {
    const db = makeDb();
    const tenantId = 't_1';
    const nowSec = Math.floor(Date.now() / 1000);
    // 25h ago > 24h window
    db.tenantConfig.set(`${tenantId}|cron:phase:reviews:last`, String(nowSec - 25 * 3600));
    const ctx = { db, tenantId };
    expect(await shouldRunPhase(ctx, 'reviews', nowSec)).toBe(true);
  });

  it('returns true for unknown phase (no window)', async () => {
    const ctx = { db: makeDb(), tenantId: 't_1' };
    expect(await shouldRunPhase(ctx, 'unknown', 0)).toBe(true);
  });
});

describe('phaseCleanup (P1-1)', () => {
  it('issues the 3 cleanup DELETE SQLs', async () => {
    const db = makeDb();
    const ctx = { db, tenantId: 't_1' };
    await phaseCleanup(ctx, Date.now());
    const sqls = db.deletes.map(d => d.sql);
    expect(sqls.some(s => /DELETE FROM appointments/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM message_windows/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM rate_limits/i.test(s))).toBe(true);
  });
});

describe('phaseRetention (P1-10)', () => {
  it('issues 6 retention DELETE SQLs with strftime() guards', async () => {
    const db = makeDb();
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    const sqls = db.deletes.map(d => d.sql);
    expect(sqls).toHaveLength(6);
    expect(sqls.some(s => /DELETE FROM audit_log.*-180 days/i.test(s))).toBe(true);
    // error_log retention was widened 30 → 90 days during the pre-prod
    // hardening pass (matches stripe_events / marketing_sends retention).
    expect(sqls.some(s => /DELETE FROM error_log.*-90 days/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM analytics_events.*-365 days/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM permission_elevation_codes.*-7 days/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM stripe_events.*-90 days/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM marketing_sends.*-90 days/i.test(s))).toBe(true);
  });

  it('uses the correct timestamp column per table', async () => {
    const db = makeDb();
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    const sqls = db.deletes.map(d => d.sql);
    // marketing_sends gates on sent_at, not created_at
    expect(sqls.find(s => /marketing_sends/i.test(s))).toMatch(/sent_at/i);
    // stripe_events gates on received_at
    expect(sqls.find(s => /stripe_events/i.test(s))).toMatch(/received_at/i);
    // permission_elevation_codes gates on expires_at
    expect(sqls.find(s => /permission_elevation_codes/i.test(s))).toMatch(/expires_at/i);
  });

  it('emits cron.retention.pruned events per successful delete', async () => {
    const db = makeDb();
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    // Tenant events land in per-tenant key (fix #5 RMW fix).
    const raw = kv.store.get('adminlog:tenant:t_1');
    expect(raw).toBeTruthy();
    const events = JSON.parse(raw);
    const prunedEvents = events.filter(e => e.type === 'cron.retention.pruned');
    expect(prunedEvents.length).toBe(6);
    const tables = prunedEvents.map(e => e.data?.table).sort();
    expect(tables).toEqual([
      'analytics_events',
      'audit_log',
      'error_log',
      'marketing_sends',
      'permission_elevation_codes',
      'stripe_events',
    ]);
  });

  it('isolates failures — one bad table does not block the others', async () => {
    // Throw on audit_log delete; rest should still run.
    const db = makeDb();
    const kv = makeKv();
    const original = db.prepare;
    db.prepare = function(sql) {
      const stmt = original.call(this, sql);
      if (/DELETE FROM audit_log/i.test(sql)) {
        return { ...stmt, bind() { return this; }, run: async () => { throw new Error('boom'); } };
      }
      return stmt;
    };
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    // Tenant events land in per-tenant key (fix #5 RMW fix).
    const events = JSON.parse(kv.store.get('adminlog:tenant:t_1') ?? '[]');
    expect(events.some(e => e.type === 'cron.phase.error')).toBe(true);
    // 5 successful prunes + 1 failure event = 6 total events
    expect(events.filter(e => e.type === 'cron.retention.pruned').length).toBe(5);
  });

  it('returns silently when ctx.db is missing', async () => {
    const ctx = { tenantId: 't_1' };
    await expect(phaseRetention(ctx, 't_1', Date.now())).resolves.toBeUndefined();
  });
});

describe('phase SQL planner-OK assertions (P1-10)', () => {
  it('all retention SQLs use strftime() with negative day modifiers', async () => {
    const db = makeDb();
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    const sqls = db.deletes.map(d => d.sql);
    for (const sql of sqls) {
      // Use strftime with unixepoch + a negative day modifier; that's the
      // only D1-supported form for relative date arithmetic.
      expect(sql).toMatch(/strftime\('%s','now','-\d+ days'\)/);
    }
  });

  it('retention SQLs are parameter-free (no bound args, just literals)', async () => {
    const db = makeDb();
    const kv = makeKv();
    const ctx = { db, tenantId: 't_1', globalKv: kv };
    await phaseRetention(ctx, 't_1', Date.now());
    for (const { args } of db.deletes) {
      // No SQL injection surface — these are static admin maintenance queries.
      expect(args).toEqual([]);
    }
  });
});
