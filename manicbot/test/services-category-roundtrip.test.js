/**
 * Regression for the data-loss bug in src/services/services.js:
 *   - Migration 0029 added `services.category` (TEXT).
 *   - The admin-app tRPC procs read + write `category` and the SalonDashboard
 *     groups services by it.
 *   - But the Worker's `svcRowToDoc` did not map the column, and
 *     `saveServiceRow` did not bind it. `saveServices` does
 *     `DELETE FROM services WHERE tenant_id = ?` followed by per-row INSERTs,
 *     so any Telegram-side edit (price change, emoji change, etc.) silently
 *     nuked every category the owner had set on the web.
 *
 * This test pins:
 *   1. loadServices() returns `category` on the doc when present in the row.
 *   2. saveServices() persists `category` in the INSERT bind params.
 *   3. category=null (no category) round-trips cleanly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadServices, saveServices } from '../src/services/services.js';

function buildFakeDb(initialRows) {
  const db = { writes: [], rows: initialRows };
  db.prepare = (sql) => ({
    bind: (...params) => ({
      all: async () => ({ results: sql.startsWith('SELECT') ? db.rows : [] }),
      first: async () => db.rows[0] || null,
      run: async () => {
        db.writes.push({ sql, params });
        return { success: true };
      },
    }),
  });
  return db;
}

function buildCtx(db) {
  return { db, tenantId: 't_test', svc: undefined, svcIds: new Set() };
}

describe('services.js — category round-trip (regression for 0029 data-loss bug)', () => {
  let db;
  let ctx;

  beforeEach(() => {
    db = buildFakeDb([]);
    ctx = buildCtx(db);
  });

  it('loadServices maps the category column onto the doc', async () => {
    db.rows = [
      {
        svc_id: 'manicure_classic',
        emoji: '💅',
        duration: 60,
        price: 130,
        active: 1,
        hidden: 0,
        sort_order: 0,
        names: '{"ru":"Маникюр классический"}',
        description: null,
        photos: null,
        category: 'Маникюр',
      },
    ];

    const services = await loadServices(ctx);
    const svc = services.find((s) => s.id === 'manicure_classic');
    expect(svc).toBeDefined();
    expect(svc.category).toBe('Маникюр');
  });

  it('loadServices returns category=null for rows with no category', async () => {
    db.rows = [
      {
        svc_id: 'french',
        emoji: '✨',
        duration: 60,
        price: 150,
        active: 1,
        hidden: 0,
        sort_order: 1,
        names: '{"ru":"Френч"}',
        description: null,
        photos: null,
        category: null,
      },
    ];
    const services = await loadServices(ctx);
    const svc = services.find((s) => s.id === 'french');
    expect(svc).toBeDefined();
    expect(svc.category).toBeNull();
  });

  it('saveServices persists category in INSERT bind params', async () => {
    await saveServices(ctx, [
      {
        id: 'manicure_classic',
        e: '💅',
        dur: 60,
        price: 130,
        active: true,
        order: 0,
        names: { ru: 'Маникюр классический' },
        category: 'Маникюр',
      },
    ]);

    // Find the INSERT for our service (not the DELETE, not the auto-added correction row).
    const insert = db.writes.find(
      (w) => w.sql.startsWith('INSERT OR REPLACE INTO services') && w.params.includes('manicure_classic'),
    );
    expect(insert).toBeDefined();
    // Last bind param in the INSERT must be 'Маникюр' (per the new param list).
    expect(insert.params).toContain('Маникюр');
  });

  it('saveServices writes null when service has no category', async () => {
    await saveServices(ctx, [
      {
        id: 'french',
        e: '✨',
        dur: 60,
        price: 150,
        active: true,
        order: 1,
        names: { ru: 'Френч' },
        // no category field at all
      },
    ]);
    const insert = db.writes.find(
      (w) => w.sql.startsWith('INSERT OR REPLACE INTO services') && w.params.includes('french'),
    );
    expect(insert).toBeDefined();
    // The category slot in the param tuple should be null (not undefined,
    // which would crash D1 .bind()).
    const categoryParam = insert.params[insert.params.length - 1];
    expect(categoryParam).toBeNull();
  });
});
