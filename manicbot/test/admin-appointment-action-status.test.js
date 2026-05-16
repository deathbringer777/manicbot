import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the heavy resolver chain so we can exercise just the routing
//    logic + the new done / no_show_* branches. ─────────────────────
vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

vi.mock('../src/tenant/storage.js', () => ({
  getTenant: vi.fn(async () => ({ id: 't1', plan: 'pro', billingStatus: 'active' })),
  getBotIdsByTenantId: vi.fn(async () => []),
  getBot: vi.fn(async () => null),
  getBotToken: vi.fn(async () => null),
  listTenantIds: vi.fn(async () => []),
}));

vi.mock('../src/tenant/resolver.js', () => ({
  buildTenantCtx: vi.fn((env, resolved) => ({
    env,
    db: env.DB,
    tenantId: resolved.tenantId,
    tenant: resolved.tenant,
    bot: resolved.bot,
    TG: resolved.TG,
  })),
}));

vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async () => undefined),
}));

const aptStub = {
  id: 'apt_done_1',
  chatId: 999,
  tenantId: 't1',
  date: '2026-05-15',
  time: '12:00',
  status: 'confirmed',
  svcId: 'svc_a',
  masterId: 42,
};

vi.mock('../src/services/appointments.js', () => ({
  getAptById: vi.fn(async () => aptStub),
  updateApt: vi.fn(async () => undefined),
}));

const dispatchCalls = [];
vi.mock('../src/services/appointmentAutomations.js', () => ({
  dispatchAppointmentAutomation: vi.fn(async (_ctx, apt, eventType) => {
    dispatchCalls.push({ aptId: apt.id, eventType });
    return { notified: eventType !== 'appointment.no_show_client', automationsFired: 0, sideEffects: true };
  }),
}));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'a'.repeat(48);

function makeEnv() {
  return {
    ADMIN_KEY,
    DB: { prepare: () => ({ bind: () => ({ run: async () => undefined, all: async () => ({ results: [] }), first: async () => null }) }) },
    MANICBOT: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    APP_BASE_URL: 'https://manicbot.com',
  };
}

function makeRequest(body) {
  return new Request('https://manicbot.com/admin/appointment-action', {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    }),
    body: JSON.stringify(body),
  });
}

describe('POST /admin/appointment-action — new status actions', () => {
  beforeEach(() => {
    dispatchCalls.length = 0;
    vi.clearAllMocks();
  });

  it('routes action=done through dispatchAppointmentAutomation with appointment.done', async () => {
    const req = makeRequest({ action: 'done', appointmentId: 'apt_done_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('done');
    expect(body.notified).toBe(true);
    expect(dispatchCalls).toContainEqual({ aptId: 'apt_done_1', eventType: 'appointment.done' });
  });

  it('routes action=no_show_client and dispatcher returns silent (notified=false)', async () => {
    const req = makeRequest({ action: 'no_show_client', appointmentId: 'apt_done_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('no_show_client');
    expect(body.notified).toBe(false);
    expect(dispatchCalls).toContainEqual({
      aptId: 'apt_done_1',
      eventType: 'appointment.no_show_client',
    });
  });

  it('routes action=no_show_master with appointment.no_show_master', async () => {
    const req = makeRequest({ action: 'no_show_master', appointmentId: 'apt_done_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(true);
    expect(dispatchCalls).toContainEqual({
      aptId: 'apt_done_1',
      eventType: 'appointment.no_show_master',
    });
  });

  it('returns 400 for unknown actions', async () => {
    const req = makeRequest({ action: 'teleport', appointmentId: 'apt_done_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN_APPOINTMENT_ACTION');
  });

  it('rejects requests with bad admin key', async () => {
    const req = new Request('https://manicbot.com/admin/appointment-action', {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong',
      }),
      body: JSON.stringify({ action: 'done', appointmentId: 'x', tenantId: 't1' }),
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });
});
