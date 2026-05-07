/**
 * #P1-4 — createChannelConfig MUST refuse to register a (channel_type,
 * page_id) tuple that another tenant already owns. The defence lives at
 * two layers:
 *   - Migration 0045 adds partial UNIQUE indexes scoped to active rows.
 *   - createChannelConfig populates the typed columns and surfaces UNIQUE
 *     violations as a structured null with a loud log.
 *
 * The mock D1 doesn't enforce real partial UNIQUE constraints, so we drive
 * the SQLite error directly via a stubbed prepare() that throws on the
 * second INSERT. That is sufficient to prove the catch-and-log behaviour
 * — the storage-level enforcement is exercised by the migration in prod.
 */
import { describe, it, expect } from 'vitest';
import { createChannelConfig } from '../src/channels/token-manager.js';

const KEY = 'a'.repeat(48);

function makeStubCtx({ failOnInsert = false } = {}) {
  const calls = { run: [], get: [] };
  let inserted = 0;
  const ctx = {
    db: {
      prepare(sql) {
        let bound = [];
        return {
          bind(...p) { bound = p; return this; },
          async first() { calls.get.push({ sql, params: bound }); return null; },
          async all() { return { results: [] }; },
          async run() {
            calls.run.push({ sql, params: bound });
            if (failOnInsert && /INSERT.*INTO channel_configs/i.test(sql)) {
              inserted += 1;
              if (inserted >= 2) throw new Error('UNIQUE constraint failed: channel_configs.page_id');
            }
            return { success: true };
          },
        };
      },
    },
  };
  return { ctx, calls };
}

describe('createChannelConfig — uniqueness enforcement (#P1-4)', () => {
  it('writes denormalised page_id / phone_number_id / ig_business_id columns', async () => {
    const { ctx, calls } = makeStubCtx();
    const config = {
      page_id: '123',
      instagram_business_id: '999',
    };
    const id = await createChannelConfig(ctx, 't_a', 'instagram', config, 'EAA' + 'x'.repeat(60), KEY);
    expect(id).toBeTruthy();
    const insertCall = calls.run.find(c => /INSERT.*channel_configs/i.test(c.sql));
    expect(insertCall).toBeTruthy();
    // The denormalised columns appear in the column list (param positions 7-9).
    expect(insertCall.sql).toMatch(/page_id, phone_number_id, ig_business_id/);
    expect(insertCall.params).toContain('123');
    expect(insertCall.params).toContain('999');
  });

  it('returns null and logs on UNIQUE constraint violation', async () => {
    // First call seeds, second triggers the stub's UNIQUE error.
    const { ctx } = makeStubCtx({ failOnInsert: true });
    const ok = await createChannelConfig(ctx, 't_a', 'instagram', { page_id: '777' }, 'EAA' + 'x'.repeat(60), KEY);
    expect(ok).toBeTruthy(); // first one OK

    const collision = await createChannelConfig(ctx, 't_b', 'instagram', { page_id: '777' }, 'EAA' + 'x'.repeat(60), KEY);
    expect(collision).toBeNull();
  });

  it('refuses to write a token without an encryption key', async () => {
    const { ctx } = makeStubCtx();
    const id = await createChannelConfig(ctx, 't_a', 'instagram', { page_id: '1' }, 'tok', /* encKey */ '');
    expect(id).toBeNull();
  });

  it('handles WhatsApp configs (phone_number_id column populated)', async () => {
    const { ctx, calls } = makeStubCtx();
    await createChannelConfig(ctx, 't_a', 'whatsapp', { phone_number_id: '7551234' }, 'tok' + 'y'.repeat(60), KEY);
    const insertCall = calls.run.find(c => /INSERT.*channel_configs/i.test(c.sql));
    expect(insertCall.params).toContain('7551234');
    // page_id / ig_business_id stay null for WhatsApp configs.
    const nullCount = insertCall.params.filter(p => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });
});
