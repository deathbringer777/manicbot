import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture send / getLang calls so we can assert per-event behavior.
const sentMessages = [];
vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async (_ctx, chatId, text, opts) => {
    sentMessages.push({ chatId, text, opts });
    return { ok: true };
  }),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'),
}));
vi.mock('../src/utils/helpers.js', async (orig) => {
  const mod = await orig();
  return { ...mod, svcName: () => 'Маникюр' };
});

import { dispatchAppointmentAutomation } from '../src/services/appointmentAutomations.js';

function makeCtx(rows = []) {
  const runCalls = [];
  const allCalls = [];
  const ctx = {
    tenantId: 't1',
    svc: [{ id: 'svc_a', dur: 60, price: 100 }],
    db: {
      prepare: (sql) => ({
        bind: (...args) => ({
          run: async () => {
            runCalls.push({ sql, args });
            return { success: true };
          },
          all: async () => {
            allCalls.push({ sql, args });
            return { results: rows };
          },
          // Phase 2C: the marketing-automations dispatcher uses `dbGet`
          // which calls `.first()`. Returns null so the marketing_contact
          // lookup misses — the dispatcher then counts the automation
          // rows but `automationsFired` stays 0 (no contact → no send).
          first: async () => null,
        }),
      }),
    },
  };
  return { ctx, runCalls, allCalls };
}

describe('dispatchAppointmentAutomation', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.clearAllMocks();
  });

  it('appointment.done — bumps lifetime_visits, clears reminders, sends thank-you', async () => {
    const { ctx, runCalls, allCalls } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.done');

    expect(result.sideEffects).toBe(true);
    expect(result.notified).toBe(true);
    // lifetime_visits update
    expect(runCalls.some(c => /lifetime_visits/.test(c.sql))).toBe(true);
    // reminder cleanup
    expect(runCalls.some(c => /rem_h24\s*=\s*1/.test(c.sql))).toBe(true);
    // analytics row
    expect(runCalls.some(c => /analytics_events/.test(c.sql))).toBe(true);
    // marketing_automations lookup
    expect(allCalls.some(c => /marketing_automations/.test(c.sql))).toBe(true);
    // client got the thank-you message
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(555);
    expect(sentMessages[0].text).toMatch(/Спасибо/);
  });

  it('appointment.no_show_client — bumps no_show_count + notifies client by default (neutral)', async () => {
    const { ctx, runCalls } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.no_show_client');

    // Default policy (no tenant_config row → first() null) notifies the client.
    expect(result.notified).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(555);
    expect(sentMessages[0].opts?.reply_markup?.inline_keyboard).toBeTruthy();
    // Client reliability counter bumped …
    expect(runCalls.some(c => /no_show_count\s*=\s*no_show_count\s*\+\s*1/.test(c.sql))).toBe(true);
    // … and the analytics row still fires.
    expect(runCalls.some(c => /analytics_events/.test(c.sql))).toBe(true);
  });

  it('appointment.no_show_master — apology to client, does NOT bump the client no_show_count', async () => {
    const { ctx, runCalls } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.no_show_master');

    expect(result.notified).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toMatch(/Извините|Перебронируйте|мастер/);
    expect(sentMessages[0].opts?.reply_markup?.inline_keyboard).toBeTruthy();
    // A master no-show is NOT the client's fault — counter untouched.
    expect(runCalls.some(c => /no_show_count/.test(c.sql))).toBe(false);
  });

  it('respects suppressDefault opt — runs side-effects but no default send', async () => {
    const { ctx } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.done', { suppressDefault: true });

    expect(result.notified).toBe(false);
    expect(sentMessages).toHaveLength(0);
  });

  it('automationsFired = 0 when matching rows exist but the client has no marketing_contact', async () => {
    // Phase 2C changed the semantics: `automationsFired` is now the count
    // of automations that actually generated at least one send, not the
    // count of matching rows. With `[]` steps_json + no marketing_contact
    // for the apt's chatId, nothing fires — both because the steps are
    // empty and because the contact lookup misses. Detailed dispatch
    // semantics are pinned in `marketing-automations-dispatcher.test.js`.
    const { ctx } = makeCtx([{ id: 'auto_1', steps_json: '[]' }, { id: 'auto_2', steps_json: '[]' }]);
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.done');

    expect(result.automationsFired).toBe(0);
  });

  it('returns zeros and no throw on a missing apt or tenantId', async () => {
    const { ctx } = makeCtx();
    ctx.tenantId = null;

    const result = await dispatchAppointmentAutomation(ctx, { id: 'apt_1' }, 'appointment.done');

    expect(result).toEqual({ notified: false, sideEffects: false, automationsFired: 0 });
    expect(sentMessages).toHaveLength(0);
  });
});
