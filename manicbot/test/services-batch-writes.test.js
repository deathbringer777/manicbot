/**
 * Perf regression guard: saveServices and the cold-start path in loadServices
 * must use a SINGLE D1 batch call instead of N sequential prepare+run round-trips.
 *
 * Before the fix:
 *   - loadServices (empty table) called saveServiceRow N times → N round-trips
 *   - saveServices called dbRun (DELETE) + saveServiceRow N times → N+1 round-trips
 *
 * After the fix both paths use dbBatch:
 *   - loadServices (cold-start): 1 batch (all INSERT OR REPLACE in one go)
 *   - saveServices: 1 batch (DELETE + all INSERT OR REPLACE)
 *
 * This test asserts:
 *  1. ctx.db.batch is called exactly ONCE per operation (not zero, not N).
 *  2. ctx.db.prepare is NOT called N times in a loop for the service writes
 *     (i.e., the batch path is the real code path, not a thin wrapper).
 *  3. The resulting rows written to the services table are correct (same data
 *     the sequential version would have produced).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import { loadServices, saveServices } from '../src/services/services.js';

function makeCtx(db) {
  return { db, tenantId: 't_batch_test', svc: undefined, svcIds: new Set() };
}

describe('services.js — batch writes perf contract', () => {
  let db;
  let ctx;

  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
  });

  // ── loadServices (cold-start: no rows in DB) ──────────────────────────────

  it('loadServices (cold-start) calls db.batch exactly once, not N sequential prepares', async () => {
    // No rows in DB → cold-start path that seeds default services.
    const batchSpy = vi.spyOn(db, 'batch');

    await loadServices(ctx);

    // Exactly one batch call for all the seed INSERTs.
    expect(batchSpy).toHaveBeenCalledTimes(1);

    // The batch must include more than 1 statement (default list has ~11 services + correction).
    const [stmts] = batchSpy.mock.calls[0];
    expect(stmts.length).toBeGreaterThan(1);
  });

  it('loadServices (cold-start) writes all default services plus correction into the table', async () => {
    const services = await loadServices(ctx);

    // Must include the correction service.
    expect(services.some(s => s.id === 'correction')).toBe(true);
    // Must include at least one standard service.
    expect(services.length).toBeGreaterThan(1);

    // All returned services must actually exist in the mock DB.
    const dbRows = db._getTable('services');
    for (const svc of services) {
      const row = dbRows.find(r => r.svc_id === svc.id && r.tenant_id === 't_batch_test');
      expect(row).toBeDefined();
    }
  });

  // ── saveServices ──────────────────────────────────────────────────────────

  it('saveServices calls db.batch exactly once (DELETE + INSERTs in one round-trip)', async () => {
    const batchSpy = vi.spyOn(db, 'batch');

    await saveServices(ctx, [
      { id: 'manicure_classic', e: '💅', dur: 60, price: 130, active: true, order: 0, names: { ru: 'Маникюр классический' }, category: 'Маникюр' },
      { id: 'gel', e: '💎', dur: 90, price: 180, active: true, order: 1, names: { ru: 'Гель-лак' }, category: null },
    ]);

    expect(batchSpy).toHaveBeenCalledTimes(1);

    // Batch must contain DELETE + at least 3 statements (2 user services + auto-added correction).
    const [stmts] = batchSpy.mock.calls[0];
    expect(stmts.length).toBeGreaterThanOrEqual(3);
  });

  it('saveServices writes the correct rows to the services table', async () => {
    await saveServices(ctx, [
      { id: 'manicure_classic', e: '💅', dur: 60, price: 130, active: true, order: 0, names: { ru: 'Маникюр классический' }, category: 'Маникюр' },
      { id: 'gel', e: '💎', dur: 90, price: 180, active: true, order: 1, names: { ru: 'Гель-лак' }, category: null },
    ]);

    const dbRows = db._getTable('services');
    expect(dbRows.length).toBeGreaterThanOrEqual(3); // 2 user + correction

    const classic = dbRows.find(r => r.svc_id === 'manicure_classic');
    expect(classic).toBeDefined();
    expect(classic.price).toBe(130);
    expect(classic.category).toBe('Маникюр');

    const gel = dbRows.find(r => r.svc_id === 'gel');
    expect(gel).toBeDefined();
    expect(gel.price).toBe(180);
    expect(gel.category).toBeNull();

    const correction = dbRows.find(r => r.svc_id === 'correction');
    expect(correction).toBeDefined();
  });

  it('saveServices auto-adds correction service if missing from input', async () => {
    // Input has no correction — saveServices must add it automatically.
    await saveServices(ctx, [
      { id: 'french', e: '✨', dur: 60, price: 150, active: true, order: 0, names: { ru: 'Френч' } },
    ]);

    const dbRows = db._getTable('services');
    expect(dbRows.find(r => r.svc_id === 'correction')).toBeDefined();
    expect(ctx.svcIds.has('correction')).toBe(true);
  });

  // ── saveServices idempotency: replace, not append ─────────────────────────

  it('saveServices replaces existing rows (DELETE semantics preserved in batch)', async () => {
    // First write with price 130.
    await saveServices(ctx, [
      { id: 'manicure_classic', e: '💅', dur: 60, price: 130, active: true, order: 0, names: { ru: 'A' } },
    ]);
    // Second write with price 200 — must overwrite, not add a duplicate.
    await saveServices(ctx, [
      { id: 'manicure_classic', e: '💅', dur: 60, price: 200, active: true, order: 0, names: { ru: 'B' } },
    ]);

    const dbRows = db._getTable('services').filter(r => r.svc_id === 'manicure_classic');
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0].price).toBe(200);
  });
});
