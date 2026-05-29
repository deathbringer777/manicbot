/**
 * P0-1 — cron.tenant.skipped is emitted with a rate-limit window so a single
 * broken tenant doesn't drown the activity feed every 15 min.
 *
 * The rate-limit key is `cronskip:{tenantId}:{reason}` with 1h TTL. A second
 * call within the window MUST NOT prepend another event to the ring buffer.
 *
 * Fix #5: tenant events now land in per-tenant keys `adminlog:tenant:{tenantId}`
 * instead of the global `adminlog:recent` to prevent RMW collisions under cron
 * fan-out. Tests updated to read from the correct per-tenant key.
 */
import { describe, it, expect } from 'vitest';
import { emitCronSkipRateLimited } from '../src/utils/events.js';

/** Per-tenant KV key used by logEvent when tenantId is set (fix #5). */
function tenantKey(tenantId) { return `adminlog:tenant:${tenantId}`; }

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.get(key) ?? null; },
    async put(key, val, _opts) { store.set(key, val); },
    async delete(key) { store.delete(key); },
  };
}

describe('emitCronSkipRateLimited (P0-1)', () => {
  it('emits the first cron.tenant.skipped event', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    // Tenant events land in the per-tenant key (fix #5).
    const raw = kv.store.get(tenantKey('t_1'));
    expect(raw).toBeTruthy();
    const events = JSON.parse(raw);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('cron.tenant.skipped');
    expect(events[0].tenantId).toBe('t_1');
    expect(events[0].data).toMatchObject({ reason: 'no_bots' });
  });

  it('rate-limits a second emit for the same (tenant, reason) within the window', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    const events = JSON.parse(kv.store.get(tenantKey('t_1')));
    expect(events).toHaveLength(1);
  });

  it('emits separately for different reasons on the same tenant', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    await emitCronSkipRateLimited(ctx, 't_1', 'bot_unresolved');
    // Both events land in the same per-tenant key for t_1.
    const events = JSON.parse(kv.store.get(tenantKey('t_1')));
    expect(events).toHaveLength(2);
    const reasons = events.map(e => e.data?.reason).sort();
    expect(reasons).toEqual(['bot_unresolved', 'no_bots']);
  });

  it('emits separately for different tenants on the same reason', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    await emitCronSkipRateLimited(ctx, 't_2', 'no_bots');
    // Each tenant's events are isolated in their own key (the RMW fix).
    const t1Events = JSON.parse(kv.store.get(tenantKey('t_1')));
    const t2Events = JSON.parse(kv.store.get(tenantKey('t_2')));
    expect(t1Events).toHaveLength(1);
    expect(t1Events[0].tenantId).toBe('t_1');
    expect(t2Events).toHaveLength(1);
    expect(t2Events[0].tenantId).toBe('t_2');
  });

  it('sets the rate-limit marker under cronskip:{tid}:{reason}', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_x', 'bot_unresolved');
    expect(kv.store.get('cronskip:t_x:bot_unresolved')).toBe('1');
  });

  it('does nothing when ctx has no globalKv', async () => {
    await expect(emitCronSkipRateLimited({}, 't_1', 'no_bots')).resolves.toBeUndefined();
  });

  it('does nothing on missing tenantId or reason', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, null, 'no_bots');
    await emitCronSkipRateLimited(ctx, 't_1', null);
    // No event written anywhere — neither per-tenant nor global.
    expect(kv.store.size).toBe(0);
  });

  it('emits again once the marker is cleared (simulating TTL expiry)', async () => {
    const kv = makeKv();
    const ctx = { globalKv: kv };
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    // Simulate TTL expiry — delete the marker.
    kv.store.delete('cronskip:t_1:no_bots');
    await emitCronSkipRateLimited(ctx, 't_1', 'no_bots');
    const events = JSON.parse(kv.store.get(tenantKey('t_1')));
    expect(events).toHaveLength(2);
  });
});
