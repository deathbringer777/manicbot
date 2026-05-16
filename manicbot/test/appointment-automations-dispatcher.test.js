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

  it('appointment.no_show_client — silent (no client message) but analytics fires', async () => {
    const { ctx, runCalls } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.no_show_client');

    expect(result.notified).toBe(false);
    expect(sentMessages).toHaveLength(0);
    expect(runCalls.some(c => /analytics_events/.test(c.sql))).toBe(true);
  });

  it('appointment.no_show_master — apology message with rebook button', async () => {
    const { ctx } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.no_show_master');

    expect(result.notified).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toMatch(/Извините|Перебронируйте|мастер/);
    expect(sentMessages[0].opts?.reply_markup?.inline_keyboard).toBeTruthy();
  });

  it('respects suppressDefault opt — runs side-effects but no default send', async () => {
    const { ctx } = makeCtx();
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.done', { suppressDefault: true });

    expect(result.notified).toBe(false);
    expect(sentMessages).toHaveLength(0);
  });

  it('reports automationsFired = number of enabled marketing_automations rows', async () => {
    const { ctx } = makeCtx([{ id: 'auto_1', steps_json: '[]' }, { id: 'auto_2', steps_json: '[]' }]);
    const apt = { id: 'apt_1', chatId: 555, date: '2026-05-15', time: '12:00', svcId: 'svc_a', masterId: 42 };

    const result = await dispatchAppointmentAutomation(ctx, apt, 'appointment.done');

    expect(result.automationsFired).toBe(2);
  });

  it('returns zeros and no throw on a missing apt or tenantId', async () => {
    const { ctx } = makeCtx();
    ctx.tenantId = null;

    const result = await dispatchAppointmentAutomation(ctx, { id: 'apt_1' }, 'appointment.done');

    expect(result).toEqual({ notified: false, sideEffects: false, automationsFired: 0 });
    expect(sentMessages).toHaveLength(0);
  });
});
