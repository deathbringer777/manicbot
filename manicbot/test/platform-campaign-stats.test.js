/**
 * platformCampaignStats — per-tenant monthly report.
 *
 * Locks the timestamp-unit footgun: appointments.ts is MILLISECONDS while
 * users.registered_at / thread_messages.created_at / appointments.created_at
 * are SECONDS. The month window must use the right unit per column, and every
 * query must be tenant-scoped + respect soft-deletes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { monthWindow, buildMonthlyReport, renderMonthlyReportBodies } from '../src/services/platformCampaignStats.js';

// April 2026 in Europe/Warsaw (UTC+2 in summer): 2026-04-01 00:00 local = 2026-03-31 22:00 UTC.
const W = monthWindow('2026-04');

async function run(ctx, sql, ...binds) {
  await ctx.db.prepare(sql).bind(...binds).run();
}

async function seedAppointment(ctx, row) {
  await run(ctx,
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, cancelled, cancelled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.tenant_id, row.chat_id ?? 1, row.svc_id ?? 'classic', '2026-04-10', '12:00',
    row.ts ?? 0, row.status ?? 'pending', row.cancelled ?? 0, row.cancelled_at ?? null, row.created_at ?? 0);
}

describe('monthWindow', () => {
  it('computes [start,end) for the period in both ms and sec', () => {
    expect(W.startSec).toBe(Math.floor(W.startMs / 1000));
    expect(W.endSec).toBe(Math.floor(W.endMs / 1000));
    // The window spans ~30 days.
    expect((W.endMs - W.startMs) / 86400000).toBeCloseTo(30, 0);
    expect(W.year).toBe(2026);
    expect(W.month).toBe(4);
  });
});

describe('buildMonthlyReport — tenant-scoped, correct units, soft-deletes', () => {
  let ctx;
  const TID = 't_a';
  beforeEach(() => { ctx = makeCtx({ tenantId: TID }); });

  it('counts booked by created_at (sec), completed/cancelled correctly, isolating tenant', async () => {
    // Booked in April (created_at in sec, inside window).
    await seedAppointment(ctx, { id: 'a1', tenant_id: TID, created_at: W.startSec + 100 });
    await seedAppointment(ctx, { id: 'a2', tenant_id: TID, created_at: W.startSec + 200 });
    // Created before the window → excluded.
    await seedAppointment(ctx, { id: 'a3', tenant_id: TID, created_at: W.startSec - 100 });
    // Other tenant → excluded.
    await seedAppointment(ctx, { id: 'a4', tenant_id: 't_other', created_at: W.startSec + 100 });
    // Completed (status='done', ts in MS inside window).
    await seedAppointment(ctx, { id: 'a5', tenant_id: TID, status: 'done', ts: W.startMs + 5000, created_at: W.startSec + 1 });
    // Cancelled in April.
    await seedAppointment(ctx, { id: 'a6', tenant_id: TID, cancelled: 1, cancelled_at: W.startSec + 300, created_at: W.startSec - 999 });

    const r = await buildMonthlyReport(ctx, '2026-04');
    // booked = a1,a2,a5 created inside window (a6 created before; a3 before; a4 other tenant)
    expect(r.booked).toBe(3);
    expect(r.completed).toBe(1); // a5
    expect(r.cancelled).toBe(1); // a6
  });

  it('new clients: registered_at (sec) in window, excludes soft-deleted + other tenants', async () => {
    await run(ctx, `INSERT INTO users (tenant_id, chat_id, registered_at, deleted_at) VALUES (?, ?, ?, ?)`, TID, 1, W.startSec + 10, null);
    await run(ctx, `INSERT INTO users (tenant_id, chat_id, registered_at, deleted_at) VALUES (?, ?, ?, ?)`, TID, 2, W.startSec + 20, null);
    await run(ctx, `INSERT INTO users (tenant_id, chat_id, registered_at, deleted_at) VALUES (?, ?, ?, ?)`, TID, 3, W.startSec + 30, W.startSec + 40); // soft-deleted
    await run(ctx, `INSERT INTO users (tenant_id, chat_id, registered_at, deleted_at) VALUES (?, ?, ?, ?)`, TID, 4, W.startSec - 10, null); // before window
    await run(ctx, `INSERT INTO users (tenant_id, chat_id, registered_at, deleted_at) VALUES (?, ?, ?, ?)`, 't_other', 5, W.startSec + 10, null);
    const r = await buildMonthlyReport(ctx, '2026-04');
    expect(r.newClients).toBe(2);
  });

  it('messages: thread_messages (sec) in window, excludes deleted + other tenants', async () => {
    await run(ctx, `INSERT INTO thread_messages (id, thread_id, tenant_id, sender_kind, sender_ref, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 'm1', 'th1', TID, 'web_user', 'u', 'hi', W.startSec + 10, null);
    await run(ctx, `INSERT INTO thread_messages (id, thread_id, tenant_id, sender_kind, sender_ref, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 'm2', 'th1', TID, 'external_client', 'c', 'yo', W.startSec + 20, null);
    await run(ctx, `INSERT INTO thread_messages (id, thread_id, tenant_id, sender_kind, sender_ref, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 'm3', 'th1', TID, 'web_user', 'u', 'gone', W.startSec + 30, W.startSec + 31);
    await run(ctx, `INSERT INTO thread_messages (id, thread_id, tenant_id, sender_kind, sender_ref, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 'm4', 'th1', 't_other', 'web_user', 'u', 'x', W.startSec + 10, null);
    const r = await buildMonthlyReport(ctx, '2026-04');
    expect(r.messages).toBe(2);
  });

  it('active masters: snapshot of active, non-archived, non-synthetic', async () => {
    await run(ctx, `INSERT INTO masters (tenant_id, chat_id, active, archived_at, is_synthetic) VALUES (?, ?, ?, ?, ?)`, TID, 1, 1, null, 0);
    await run(ctx, `INSERT INTO masters (tenant_id, chat_id, active, archived_at, is_synthetic) VALUES (?, ?, ?, ?, ?)`, TID, 2, 1, null, 0);
    await run(ctx, `INSERT INTO masters (tenant_id, chat_id, active, archived_at, is_synthetic) VALUES (?, ?, ?, ?, ?)`, TID, 3, 0, null, 0); // inactive
    await run(ctx, `INSERT INTO masters (tenant_id, chat_id, active, archived_at, is_synthetic) VALUES (?, ?, ?, ?, ?)`, TID, 4, 1, 12345, 0); // archived
    await run(ctx, `INSERT INTO masters (tenant_id, chat_id, active, archived_at, is_synthetic) VALUES (?, ?, ?, ?, ?)`, TID, 5, 1, null, 1); // synthetic
    const r = await buildMonthlyReport(ctx, '2026-04');
    expect(r.activeMasters).toBe(2);
  });

  it('top service + estimated revenue from ctx.svc prices', async () => {
    // ctx.svc default: classic price 80, pedi price 120.
    await seedAppointment(ctx, { id: 'd1', tenant_id: TID, status: 'done', svc_id: 'classic', ts: W.startMs + 1, created_at: W.startSec });
    await seedAppointment(ctx, { id: 'd2', tenant_id: TID, status: 'done', svc_id: 'classic', ts: W.startMs + 2, created_at: W.startSec });
    await seedAppointment(ctx, { id: 'd3', tenant_id: TID, status: 'done', svc_id: 'pedi', ts: W.startMs + 3, created_at: W.startSec });
    const r = await buildMonthlyReport(ctx, '2026-04');
    expect(r.topService).toMatchObject({ id: 'classic', count: 2 });
    // revenue = 2*80 + 1*120 = 280
    expect(r.estimatedRevenue).toBe(280);
  });

  it('empty tenant → all zeros, null top service, null revenue', async () => {
    const r = await buildMonthlyReport(ctx, '2026-04');
    expect(r).toMatchObject({ booked: 0, completed: 0, cancelled: 0, newClients: 0, messages: 0, activeMasters: 0, topService: null });
  });
});

describe('renderMonthlyReportBodies', () => {
  const stats = { periodYM: '2026-04', year: 2026, month: 4, booked: 12, completed: 9, cancelled: 2, newClients: 5, messages: 40, activeMasters: 3, topService: { id: 'classic', name: 'Маникюр', count: 7 }, estimatedRevenue: 720 };

  it('produces all channel bodies with the numbers embedded (ru)', () => {
    const b = renderMonthlyReportBodies(stats, 'ru');
    expect(b.title).toBeTruthy();
    expect(b.center).toContain('12');
    expect(b.center).toContain('5');
    expect(b.telegram).toContain('12');
    expect(b.emailSubject).toBeTruthy();
    expect(b.emailHtml).toContain('<');
    expect(b.emailHtml).toContain('12');
  });

  it('localizes (ru ≠ en heading)', () => {
    expect(renderMonthlyReportBodies(stats, 'ru').title).not.toBe(renderMonthlyReportBodies(stats, 'en').title);
  });

  it('omits the revenue line when estimatedRevenue is null', () => {
    const b = renderMonthlyReportBodies({ ...stats, estimatedRevenue: null }, 'ru');
    expect(b.center).not.toMatch(/720/);
  });
});
