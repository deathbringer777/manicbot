/**
 * markOutboundDeliveryState — advances an outbound message's persisted
 * delivery_state from WA/IG receipts. Terminal-guarded + tenant-scoped +
 * idempotent (Meta retries webhooks for up to 24h).
 */
import { describe, it, expect } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import { markOutboundDeliveryState } from '../src/services/messengerThreads.js';

function ctxWithRows(rows) {
  const db = createMockD1();
  const table = db._getTable('thread_messages');
  for (const r of rows) table.push(r);
  return { db, tenantId: 't_a' };
}
function row(over = {}) {
  return {
    id: 'm1',
    tenant_id: 't_a',
    external_msg_id: 'wamid.X',
    delivery_state: 'sent',
    delivery_error: null,
    ...over,
  };
}
async function read(ctx, extId = 'wamid.X') {
  return ctx.db
    .prepare(`SELECT delivery_state, delivery_error FROM thread_messages WHERE external_msg_id = ?`)
    .bind(extId)
    .first();
}

describe('markOutboundDeliveryState', () => {
  it('advances sent → delivered', async () => {
    const ctx = ctxWithRows([row({ delivery_state: 'sent' })]);
    expect(await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'delivered')).toBe(true);
    expect((await read(ctx)).delivery_state).toBe('delivered');
  });

  it('advances pending → delivered', async () => {
    const ctx = ctxWithRows([row({ delivery_state: 'pending' })]);
    await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'delivered');
    expect((await read(ctx)).delivery_state).toBe('delivered');
  });

  it('terminal guard: delivered stays delivered', async () => {
    const ctx = ctxWithRows([row({ delivery_state: 'delivered' })]);
    await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'delivered');
    expect((await read(ctx)).delivery_state).toBe('delivered');
  });

  it('never resurrects a NULL (untracked) row', async () => {
    const ctx = ctxWithRows([row({ delivery_state: null })]);
    await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'delivered');
    expect((await read(ctx)).delivery_state).toBeNull();
  });

  it('marks failed with the error label', async () => {
    const ctx = ctxWithRows([row({ delivery_state: 'sent' })]);
    await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'failed', 'undeliverable');
    const r = await read(ctx);
    expect(r.delivery_state).toBe('failed');
    expect(r.delivery_error).toBe('undeliverable');
  });

  it('is tenant-scoped — will not touch another tenant row', async () => {
    const ctx = ctxWithRows([row({ tenant_id: 't_b', delivery_state: 'sent' })]);
    await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'delivered');
    expect((await read(ctx)).delivery_state).toBe('sent');
  });

  it('ignores empty args + unknown state', async () => {
    const ctx = ctxWithRows([row()]);
    expect(await markOutboundDeliveryState(ctx, 't_a', '', 'delivered')).toBe(false);
    expect(await markOutboundDeliveryState(ctx, 't_a', 'wamid.X', 'sent')).toBe(false);
  });
});
