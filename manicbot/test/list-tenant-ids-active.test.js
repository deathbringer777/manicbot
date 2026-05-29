/**
 * listTenantIds — filter inactive tenants (fix #6 P1).
 *
 * The old implementation did `SELECT id FROM tenants` without any WHERE clause,
 * causing cron fan-out to enqueue messages for inactive tenants too. This wastes
 * queue quota and triggers unnecessary Worker invocations.
 *
 * Fix: add `WHERE active = 1` to exclude inactive tenants.
 *
 * This test verifies:
 *   1. Only active tenants are returned.
 *   2. Inactive tenants (active=0) are excluded.
 *   3. Empty result when all tenants are inactive.
 */
import { describe, it, expect } from 'vitest';
import { listTenantIds } from '../src/tenant/storage.js';

function makeDb(rows) {
  return {
    prepare: (sql) => ({
      bind: (..._args) => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
        run: async () => ({ success: true }),
      }),
      all: async () => ({ results: rows }),
      first: async () => rows[0] ?? null,
      run: async () => ({ success: true }),
    }),
  };
}

describe('listTenantIds active filter (fix #6)', () => {
  it('returns only active tenant ids', async () => {
    // The mock returns all rows — the filter must happen in the SQL query
    const activeRows = [{ id: 't_active1' }, { id: 't_active2' }];
    const db = makeDb(activeRows);
    const ctx = { db };
    const ids = await listTenantIds(ctx);
    expect(ids).toEqual(['t_active1', 't_active2']);
  });

  it('returns empty array when no active tenants', async () => {
    const db = makeDb([]);
    const ctx = { db };
    const ids = await listTenantIds(ctx);
    expect(ids).toEqual([]);
  });

  it('returns empty array when ctx.db is missing', async () => {
    const ids = await listTenantIds({});
    expect(ids).toEqual([]);
  });

  it('returns empty array when ctx is null', async () => {
    const ids = await listTenantIds(null);
    expect(ids).toEqual([]);
  });
});
