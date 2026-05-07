/**
 * #P1-3 — getState MUST surface a marker when the conversation state has
 * lapsed mid-flow. Previously the bot silently restarted with no notice;
 * now the read path returns `{ step: 'idle', _expired: true }` and clears
 * the KV row, and the message handler sends the i18n notice.
 */
import { describe, it, expect } from 'vitest';
import { getState, setState } from '../src/services/state.js';
import { kvPut, kvGet } from '../src/utils/kv.js';
import { STATE_TTL_SEC } from '../src/config.js';

function makeKvCtx() {
  const store = new Map();
  const ctx = {
    prefix: 't:test:',
    kv: {
      async get(key, type) {
        const raw = store.get(key);
        if (raw == null) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value /*, opts */) {
        store.set(key, typeof value === 'string' ? value : String(value));
      },
      async delete(key) {
        store.delete(key);
      },
    },
  };
  return { ctx, store };
}

describe('getState — TTL expiry detection (#P1-3)', () => {
  it('returns a fresh idle state when no row exists', async () => {
    const { ctx } = makeKvCtx();
    const s = await getState(ctx, 'cid_unknown');
    expect(s).toEqual({ step: 'idle' });
    expect(s._expired).toBeUndefined();
  });

  it('returns _expired:true and purges the row when expiresAt is in the past', async () => {
    const { ctx, store } = makeKvCtx();
    // Stash a stale state directly so we don't depend on setState's clock.
    await kvPut(ctx, 'st:cid_old', {
      step: 'BOOK_TIME',
      svcId: 'classic',
      expiresAt: Math.floor(Date.now() / 1000) - 10, // 10s in the past
    });
    expect(store.has('t:test:st:cid_old')).toBe(true);
    const s = await getState(ctx, 'cid_old');
    expect(s.step).toBe('idle');
    expect(s._expired).toBe(true);
    // Row was deleted.
    expect(store.has('t:test:st:cid_old')).toBe(false);
  });

  it('preserves a non-expired session', async () => {
    const { ctx } = makeKvCtx();
    await setState(ctx, 'cid_live', { step: 'BOOK_DATE', svcId: 'classic' });
    const s = await getState(ctx, 'cid_live');
    expect(s.step).toBe('BOOK_DATE');
    expect(s.svcId).toBe('classic');
    expect(s._expired).toBeUndefined();
    // expiresAt is set far enough in the future that this won't flake.
    expect(s.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + STATE_TTL_SEC - 60);
  });

  it('legacy state without expiresAt is treated as live (back-compat)', async () => {
    // Pre-#P1-3 KV rows have no `expiresAt`. The KV TTL backstop will
    // eventually evict them; in the meantime they remain valid.
    const { ctx } = makeKvCtx();
    await kvPut(ctx, 'st:cid_legacy', { step: 'BOOK_TIME', svcId: 'classic' });
    const s = await getState(ctx, 'cid_legacy');
    expect(s.step).toBe('BOOK_TIME');
    expect(s._expired).toBeUndefined();
  });

  it('setState writes a value with expiresAt in the future', async () => {
    const { ctx } = makeKvCtx();
    await setState(ctx, 'cid_x', { step: 'REG_PHONE' });
    const raw = await kvGet(ctx, 'st:cid_x');
    expect(raw.step).toBe('REG_PHONE');
    expect(raw.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
