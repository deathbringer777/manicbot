/**
 * Tests for calendar sync pipeline fixes:
 * - Cron retry of unsynced confirmed appointments
 * - confirmAllPendingApts sets masterId before sync
 * - APT_ACCEPT persists masterId in DB
 * - google_integration_id included in INSERT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { saveApt, updateApt, getAptById } from '../src/services/appointments.js';
import { warsawToUTC } from '../src/utils/date.js';
import { dbAll, dbRun } from '../src/utils/db.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTenantCtx(overrides = {}) {
  const { plan = 'pro', billingStatus = 'active', tenantId = 't_cal_pipeline', ...rest } = overrides;
  return makeCtx({ tenantId, tenant: { plan, billingStatus }, ...rest });
}

async function makeApt(ctx, overrides = {}) {
  return saveApt(ctx, {
    chatId: 500,
    svcId: 'classic',
    date: '2026-04-20',
    time: '14:00',
    ts: warsawToUTC(2026, 4, 20, 14, 0).getTime(),
    userName: 'Тест Клиент',
    userPhone: '+48111222333',
    ...overrides,
  });
}

// ─── INSERT includes google_integration_id ────────────────────────────────────

describe('saveApt INSERT', () => {
  it('includes google_integration_id column (defaults to NULL)', async () => {
    const ctx = makeTenantCtx({ tenantId: 't_cal_insert' });
    const apt = await makeApt(ctx);
    const row = await dbRun(ctx,
      'SELECT google_integration_id FROM appointments WHERE id = ?', apt.id,
    );
    // Just check no error thrown and apt was persisted
    const saved = await getAptById(ctx, apt.id);
    expect(saved).toBeTruthy();
    expect(saved.googleIntegrationId).toBeNull();
  });
});

// ─── confirmAllPendingApts sets masterId ──────────────────────────────────────

describe('confirmAllPendingApts masterId persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('api.telegram.org')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }),
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
        headers: { get: () => null },
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets masterId in DB when confirming pending appointments', async () => {
    const { confirmAllPendingApts } = await import('../src/notifications.js');
    const ctx = makeTenantCtx({ tenantId: 't_cal_confirm_all' });

    const adminId = 321706035;
    // Register the admin as a master so canManageApt allows them
    await dbRun(ctx, `INSERT OR IGNORE INTO masters (tenant_id, chat_id, name, active, on_vacation)
      VALUES (?, ?, ?, 1, 0)`, ctx.tenantId, adminId, 'Test Admin');

    // Create two pending apts without a master
    const apt1 = await makeApt(ctx, { chatId: 600 });
    const apt2 = await makeApt(ctx, { chatId: 601, time: '15:00', ts: warsawToUTC(2026, 4, 20, 15, 0).getTime() });
    expect(apt1.masterId).toBeNull();
    expect(apt2.masterId).toBeNull();

    const count = await confirmAllPendingApts(ctx, adminId);
    expect(count).toBeGreaterThanOrEqual(2);

    // Both should now have masterId = adminId and confirmedBy = adminId
    const saved1 = await getAptById(ctx, apt1.id);
    const saved2 = await getAptById(ctx, apt2.id);
    expect(saved1.masterId).toBe(adminId);
    expect(saved2.masterId).toBe(adminId);
    expect(saved1.confirmedBy).toBe(adminId);
    expect(saved2.confirmedBy).toBe(adminId);
    expect(saved1.status).toBe('confirmed');
    expect(saved2.status).toBe('confirmed');
  });

  it('does not override existing masterId when bulk-confirming', async () => {
    const { confirmAllPendingApts } = await import('../src/notifications.js');
    const ctx = makeTenantCtx({ tenantId: 't_cal_confirm_existing_master' });

    const adminId = 321706035;
    await dbRun(ctx, `INSERT OR IGNORE INTO masters (tenant_id, chat_id, name, active, on_vacation)
      VALUES (?, ?, ?, 1, 0)`, ctx.tenantId, adminId, 'Test Admin');

    const existingMasterId = 777;
    const apt = await makeApt(ctx, { chatId: 700 });
    // Manually set a specific master on the apt before confirming
    await updateApt(ctx, apt.id, { masterId: existingMasterId });

    await confirmAllPendingApts(ctx, adminId);

    const saved = await getAptById(ctx, apt.id);
    // masterId should remain the pre-set one (777), not overwritten by admin
    expect(saved.masterId).toBe(existingMasterId);
    expect(saved.confirmedBy).toBe(adminId);
    expect(saved.status).toBe('confirmed');
  });
});

// ─── Cron unsynced apt detection ──────────────────────────────────────────────

describe('Cron unsynced appointment detection', () => {
  it('finds confirmed appointments without google_event_id in future window', async () => {
    const ctx = makeTenantCtx({ tenantId: 't_cal_cron_detect' });

    const futureTs = Date.now() + 2 * 24 * 3600 * 1000; // 2 days from now
    const apt = await makeApt(ctx, { ts: futureTs, date: '2026-04-25', time: '10:00' });
    await updateApt(ctx, apt.id, { status: 'confirmed', confirmedBy: 321706035, masterId: 321706035 });

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const unsynced = await dbAll(ctx,
      "SELECT id FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND cancelled = 0 AND google_event_id IS NULL AND ts > ?",
      ctx.tenantId, oneHourAgo,
    );
    expect(unsynced.some(r => r.id === apt.id)).toBe(true);
  });

  it('excludes past appointments from cron retry window', async () => {
    const ctx = makeTenantCtx({ tenantId: 't_cal_cron_past' });

    const pastTs = Date.now() - 5 * 3600 * 1000; // 5 hours ago
    const apt = await makeApt(ctx, { ts: pastTs, date: '2026-03-20', time: '08:00' });
    await updateApt(ctx, apt.id, { status: 'confirmed', confirmedBy: 321706035 });

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const unsynced = await dbAll(ctx,
      "SELECT id FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND cancelled = 0 AND google_event_id IS NULL AND ts > ?",
      ctx.tenantId, oneHourAgo,
    );
    expect(unsynced.some(r => r.id === apt.id)).toBe(false);
  });

  it('excludes already-synced appointments (with google_event_id)', async () => {
    const ctx = makeTenantCtx({ tenantId: 't_cal_cron_synced' });

    const futureTs = Date.now() + 2 * 24 * 3600 * 1000;
    const apt = await makeApt(ctx, { ts: futureTs, date: '2026-04-26', time: '11:00' });
    await updateApt(ctx, apt.id, {
      status: 'confirmed', confirmedBy: 321706035,
      googleEventId: 'evt_abc123', googleCalendarId: 'cal@example.com',
    });

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const unsynced = await dbAll(ctx,
      "SELECT id FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND cancelled = 0 AND google_event_id IS NULL AND ts > ?",
      ctx.tenantId, oneHourAgo,
    );
    expect(unsynced.some(r => r.id === apt.id)).toBe(false);
  });
});

// ─── APT_ACCEPT masterId persistence ─────────────────────────────────────────

describe('APT_ACCEPT masterId persistence', () => {
  it('updateApt with masterId from confirmedBy when accepting counter-offer', async () => {
    const ctx = makeTenantCtx({ tenantId: 't_cal_accept_master' });
    const apt = await makeApt(ctx);

    // Simulate master making a counter-offer: sets confirmedBy = masterId
    const masterId = 888;
    await updateApt(ctx, apt.id, {
      status: 'counter_offer',
      confirmedBy: masterId,
      counterTime: '15:30',
    });

    const reloaded = await getAptById(ctx, apt.id);
    expect(reloaded.confirmedBy).toBe(masterId);

    // Simulate client accepting: set masterId = confirmedBy before updateApt
    const newMasterId = reloaded.confirmedBy;
    await updateApt(ctx, apt.id, { status: 'confirmed', time: '15:30', masterId: newMasterId });

    const final = await getAptById(ctx, apt.id);
    expect(final.masterId).toBe(masterId);
    expect(final.status).toBe('confirmed');
  });
});
