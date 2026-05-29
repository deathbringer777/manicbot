/**
 * Tests for src/services/messengerRequests.js — booking-request cards posted
 * into the per-tenant "Заявки" (requests) inbox thread.
 *
 * The requests thread (threads.kind='requests', deterministic id rq_<tenant>)
 * is where every new booking lands as an actionable card, so masters can
 * claim/confirm from the dashboard. Telegram fan-out + bell rows are unchanged
 * and handled elsewhere — this module only writes the inbox card.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import {
  ensureRequestsThread,
  postBookingRequest,
  requestsThreadId,
} from '../src/services/messengerRequests.js';

function seedStaff(ctx, tenantId) {
  ctx.db._getTable('web_users').push(
    { id: 'wu_owner', tenant_id: tenantId, role: 'tenant_owner' },
    { id: 'wu_m1', tenant_id: tenantId, role: 'master' },
  );
  ctx.db._getTable('masters').push(
    { tenant_id: tenantId, chat_id: 111, name: 'Anna', web_user_id: 'wu_m1', active: 1, archived_at: null },
    { tenant_id: tenantId, chat_id: 222, name: 'Bea', web_user_id: null, active: 1, archived_at: null },
  );
}

function aptOf(overrides = {}) {
  return {
    id: 'apt_1', chatId: 900, svcId: 'classic', date: '2026-06-01', time: '12:00',
    masterId: null, userName: 'Client', userPhone: '+48500', ...overrides,
  };
}

describe('messengerRequests', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeCtx({ tenantId: 't1' });
    seedStaff(ctx, 't1');
  });

  it('requestsThreadId is deterministic per tenant', () => {
    expect(requestsThreadId('t1')).toBe('rq_t1');
  });

  it('ensureRequestsThread creates exactly one requests thread (idempotent)', async () => {
    const id1 = await ensureRequestsThread(ctx, 't1');
    const id2 = await ensureRequestsThread(ctx, 't1');
    expect(id1).toBe('rq_t1');
    expect(id2).toBe('rq_t1');
    const threads = ctx.db._getTable('threads').filter((r) => r.kind === 'requests');
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe('Заявки');
    expect(threads[0].tenant_id).toBe('t1');
  });

  it('seeds owner + all active masters as members of the requests thread', async () => {
    await ensureRequestsThread(ctx, 't1');
    const members = ctx.db._getTable('thread_members').filter((m) => m.thread_id === 'rq_t1');
    // owner (web_user) + master Anna (web_user) + master Bea (master placeholder)
    const refs = members.map((m) => `${m.member_kind}:${m.member_ref}`).sort();
    expect(refs).toContain('web_user:wu_owner');
    expect(refs).toContain('web_user:wu_m1');
    expect(refs).toContain('master:222');
  });

  it('posts an unassigned pending booking request card', async () => {
    const res = await postBookingRequest(ctx, aptOf(), {
      autoConfirmed: false, lang: 'pl', svcName: 'Manicure', when: '2026-06-01 12:00',
      clientName: 'Client', clientPhone: '+48500', channel: 'web', masterId: null, masterName: null,
    });
    expect(res?.threadId).toBe('rq_t1');
    const msgs = ctx.db._getTable('thread_messages').filter((m) => m.thread_id === 'rq_t1');
    expect(msgs).toHaveLength(1);
    const card = msgs[0];
    expect(card.ref_kind).toBe('booking_request');
    expect(card.ref_id).toBe('apt_1');
    expect(card.sender_kind).toBe('system');
    const meta = JSON.parse(card.meta_json);
    expect(meta.autoConfirmed).toBe(false);
    expect(meta.status).toBe('pending');
    expect(meta.channel).toBe('web');
    expect(meta.masterId).toBeNull();
  });

  it('posts an assigned auto-confirmed booking request card', async () => {
    const res = await postBookingRequest(ctx, aptOf({ id: 'apt_2', masterId: 111 }), {
      autoConfirmed: true, lang: 'ru', svcName: 'Маникюр', when: '2026-06-02 10:00',
      clientName: 'Client', clientPhone: '+48500', channel: 'telegram', masterId: 111, masterName: 'Anna',
    });
    expect(res?.threadId).toBe('rq_t1');
    const card = ctx.db._getTable('thread_messages').find((m) => m.ref_id === 'apt_2');
    const meta = JSON.parse(card.meta_json);
    expect(meta.autoConfirmed).toBe(true);
    expect(meta.status).toBe('confirmed');
    expect(meta.masterId).toBe(111);
    expect(meta.masterName).toBe('Anna');
    // assigned master name is surfaced in the card body
    expect(card.body).toContain('Anna');
  });

  it('is idempotent per appointment — re-posting updates, does not duplicate', async () => {
    await postBookingRequest(ctx, aptOf(), {
      autoConfirmed: false, lang: 'pl', svcName: 'Manicure', when: '2026-06-01 12:00',
      clientName: 'Client', clientPhone: '+48500', channel: 'web', masterId: null, masterName: null,
    });
    // Re-post the same appointment, now confirmed.
    await postBookingRequest(ctx, aptOf(), {
      autoConfirmed: true, lang: 'pl', svcName: 'Manicure', when: '2026-06-01 12:00',
      clientName: 'Client', clientPhone: '+48500', channel: 'web', masterId: null, masterName: null,
    });
    const cards = ctx.db._getTable('thread_messages').filter((m) => m.ref_id === 'apt_1');
    expect(cards).toHaveLength(1);
    expect(JSON.parse(cards[0].meta_json).status).toBe('confirmed');
  });

  it('isolates tenants — a request for t1 never lands in t2 thread', async () => {
    const ctx2 = makeCtx({ tenantId: 't2' });
    seedStaff(ctx2, 't2');
    // Share the same backing tables so cross-tenant leakage would be visible.
    ctx2.db = ctx.db;
    await postBookingRequest(ctx, aptOf(), {
      autoConfirmed: false, lang: 'pl', svcName: 'M', when: 'x', clientName: 'C', clientPhone: 'p',
      channel: 'web', masterId: null, masterName: null,
    });
    const t2cards = ctx.db._getTable('thread_messages').filter((m) => m.tenant_id === 't2');
    expect(t2cards).toHaveLength(0);
  });
});
