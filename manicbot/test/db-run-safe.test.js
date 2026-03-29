import { describe, it, expect } from 'vitest';
import { dbRunSafe } from '../src/utils/db.js';

describe('dbRunSafe', () => {
  it('returns { ok: true } on successful run', async () => {
    const ctx = {
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => ({ success: true }),
          }),
        }),
      },
    };
    const result = await dbRunSafe(ctx, 'UPDATE foo SET bar = ?', 1);
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, error } on SQL error instead of throwing', async () => {
    const ctx = {
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => { throw new Error('D1_ERROR: constraint violation'); },
          }),
        }),
      },
    };
    const result = await dbRunSafe(ctx, 'INSERT INTO foo VALUES (?)', 1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('constraint violation');
  });

  it('does not throw even on catastrophic failure', async () => {
    const ctx = {
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => { throw new Error('network error'); },
          }),
        }),
      },
    };
    await expect(dbRunSafe(ctx, 'SELECT 1')).resolves.toMatchObject({ ok: false });
  });
});
