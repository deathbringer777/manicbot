import { describe, expect, it } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { saveApt, updateApt, getAptById, getSlots } from '../src/services/appointments.js';
import { saveGoogleIntegration } from '../src/services/google-calendar-oauth.js';
import { dbRun } from '../src/utils/db.js';
import { warsawToUTC } from '../src/utils/date.js';

describe('Google Calendar sync plumbing', () => {
  it('persists time and ts updates for counter-offer acceptance', async () => {
    const ctx = makeCtx({ tenantId: 't_gcal_updates' });
    const apt = await saveApt(ctx, {
      chatId: 101,
      svcId: 'classic',
      date: '2026-04-10',
      time: '10:00',
      ts: warsawToUTC(2026, 4, 10, 10, 0).getTime(),
      userName: 'Client',
      userPhone: '+48111111111',
    });

    const newTs = warsawToUTC(2026, 4, 10, 12, 30).getTime();
    await updateApt(ctx, apt.id, { status: 'confirmed', time: '12:30', ts: newTs });

    const saved = await getAptById(ctx, apt.id);
    expect(saved.status).toBe('confirmed');
    expect(saved.time).toBe('12:30');
    expect(saved.ts).toBe(newTs);
  });

  it('blocks slots that overlap external Google busy events', async () => {
    const ctx = makeCtx({ tenantId: 't_gcal_busy' });
    const integration = await saveGoogleIntegration(ctx, {
      scope: 'tenant',
      calendarId: 'salon@example.com',
      calendarSummary: 'Salon calendar',
      providerAccountEmail: 'owner@example.com',
      refreshTokenEnc: 'encrypted-refresh-token',
      syncEnabled: true,
      syncDirection: 'two_way',
    });

    const startTs = warsawToUTC(2026, 4, 11, 10, 15).getTime();
    const endTs = warsawToUTC(2026, 4, 11, 11, 15).getTime();
    await dbRun(ctx,
      `INSERT OR REPLACE INTO google_busy_blocks
        (id, integration_id, tenant_id, calendar_id, external_event_id, summary, start_ts, end_ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `${integration.id}:evt-1`,
      integration.id,
      ctx.tenantId,
      integration.calendarId,
      'evt-1',
      'Busy event',
      startTs,
      endTs,
      Date.now(),
    );

    const slots = await getSlots(ctx, '2026-04-11', 'classic');
    expect(slots).toContain('09:00');
    expect(slots).not.toContain('10:00');
    expect(slots).not.toContain('10:30');
    expect(slots).not.toContain('11:00');
  });
});
