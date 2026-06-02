/**
 * syncStripeLedger — incremental mirror of Stripe balance_transactions into the
 * D1 `stripe_ledger` table. Runs from the 15-min cron. The ledger is the source
 * of truth for the multi-month revenue chart and net/fee aggregation in the
 * admin Billing dashboard.
 *
 * Contract under test:
 *   - no STRIPE_SECRET_KEY / no DB → skip cleanly (no fetch, no throw)
 *   - first run (no cursor) → full backfill, no created[gte] filter
 *   - rows upserted by id → idempotent across overlapping windows
 *   - cursor stored in platform_config, advanced to max(created) seen
 *   - subsequent runs are incremental (created[gte] = cursor)
 *   - pagination follows has_more via starting_after
 *   - Stripe failure mid-sync → cursor is NOT advanced (safe retry next tick)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncStripeLedger } from '../src/billing/ledgerSync.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeEnv(extra = {}) {
  const db = extra.db || createMockD1();
  const env = { DB: db, MANICBOT: makeMockKv(), STRIPE_SECRET_KEY: 'sk_test_ledger', ...extra.env };
  return { env, db };
}

function txn(id, created, over = {}) {
  return {
    id,
    type: 'charge',
    reporting_category: 'charge',
    amount: 4500,
    fee: 100,
    net: 4400,
    currency: 'pln',
    source: 'ch_' + id,
    created,
    available_on: created + 100,
    description: null,
    ...over,
  };
}

const ledgerRows = (db) => db._getTable('stripe_ledger');
const cursorRow = (db) => db._getTable('platform_config').find((r) => r.key === 'stripe_ledger_cursor');

describe('syncStripeLedger', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips cleanly when STRIPE_SECRET_KEY is absent', async () => {
    const res = await syncStripeLedger({ DB: createMockD1(), MANICBOT: makeMockKv() });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips cleanly when the D1 binding is absent', async () => {
    const res = await syncStripeLedger({ STRIPE_SECRET_KEY: 'sk_test', MANICBOT: makeMockKv() });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_db');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('first run backfills (no created[gte] filter), inserts rows, and writes the cursor', async () => {
    const { env, db } = makeEnv();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [txn('a', 1000), txn('b', 2000)], has_more: false }),
    });

    const res = await syncStripeLedger(env);

    expect(res.synced).toBe(2);
    expect(ledgerRows(db)).toHaveLength(2);
    const stored = ledgerRows(db).find((r) => r.id === 'a');
    expect(stored.amount).toBe(4500);
    expect(stored.net).toBe(4400);
    expect(stored.source).toBe('ch_a');
    expect(cursorRow(db).value).toBe('2000');

    const u = new URL(String(fetchMock.mock.calls[0][0]));
    expect(u.searchParams.get('created[gte]')).toBeNull();
  });

  it('is idempotent across overlapping windows — upsert by id, no duplicates', async () => {
    const { env, db } = makeEnv();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [txn('a', 1000), txn('b', 2000)], has_more: false }),
    });
    await syncStripeLedger(env);

    // Second run: cursor=2000 → incremental created[gte]=2000 re-includes the
    // boundary row b and adds c. b must dedupe, not duplicate.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [txn('b', 2000), txn('c', 3000)], has_more: false }),
    });
    const res2 = await syncStripeLedger(env);

    const u2 = new URL(String(fetchMock.mock.calls[1][0]));
    expect(u2.searchParams.get('created[gte]')).toBe('2000');
    expect(ledgerRows(db)).toHaveLength(3);
    expect(ledgerRows(db).map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect(cursorRow(db).value).toBe('3000');
    expect(res2.synced).toBe(2);
  });

  it('updates an existing row when the same id comes back with new values', async () => {
    const { env, db } = makeEnv();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [txn('a', 1000, { net: 4400 })], has_more: false }),
    });
    await syncStripeLedger(env);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [txn('a', 1000, { net: 0, description: 'reversed' })], has_more: false }),
    });
    await syncStripeLedger(env);

    expect(ledgerRows(db)).toHaveLength(1);
    expect(ledgerRows(db)[0].net).toBe(0);
    expect(ledgerRows(db)[0].description).toBe('reversed');
  });

  it('paginates via starting_after until has_more is false', async () => {
    const { env, db } = makeEnv();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [txn('p1', 1000)], has_more: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [txn('p2', 2000)], has_more: false }) });

    const res = await syncStripeLedger(env);

    expect(res.pages).toBe(2);
    expect(ledgerRows(db)).toHaveLength(2);
    const u2 = new URL(String(fetchMock.mock.calls[1][0]));
    expect(u2.searchParams.get('starting_after')).toBe('p1');
    expect(cursorRow(db).value).toBe('2000');
  });

  it('does NOT advance the cursor when Stripe fails mid-sync', async () => {
    const { env, db } = makeEnv();
    db._getTable('platform_config').push({
      key: 'stripe_ledger_cursor', value: '5000', updated_at: 1, updated_by: 'seed',
    });
    fetchMock.mockRejectedValueOnce(new Error('stripe down'));

    const res = await syncStripeLedger(env);

    expect(res.error).toBeTruthy();
    expect(cursorRow(db).value).toBe('5000');
    expect(ledgerRows(db)).toHaveLength(0);
  });
});
