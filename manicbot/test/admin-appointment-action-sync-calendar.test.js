import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the heavy resolver chain so we exercise only the routing +
//    the new `sync_calendar` branch. ──────────────────────────────────
vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const getTenant = vi.fn(async () => ({ id: 't1', plan: 'pro', billingStatus: 'active' }));
vi.mock('../src/tenant/storage.js', () => ({
  getTenant: (...a) => getTenant(...a),
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
  id: 'apt_manual_1',
  chatId: -1717,
  tenantId: 't1',
  date: '2026-09-12',
  time: '11:00',
  status: 'confirmed',
  svcId: 'svc_a',
  masterId: 42,
};

vi.mock('../src/services/appointments.js', () => ({
  getAptById: vi.fn(async () => aptStub),
  updateApt: vi.fn(async () => undefined),
}));

// Calendar sync spy — assert it is (or isn't) invoked.
const syncAppointmentCalendar = vi.fn(async () => ({ ok: true, mode: 'oauth', action: 'created' }));
vi.mock('../src/services/google-calendar-oauth.js', () => ({
  syncAppointmentCalendar: (...a) => syncAppointmentCalendar(...a),
}));

// Client-notification spy — sync_calendar must NEVER message the client.
const sendAptConfirmedToClient = vi.fn(async () => undefined);
vi.mock('../src/notifications.js', () => ({
  sendAptConfirmedToClient: (...a) => sendAptConfirmedToClient(...a),
  notifyStaffAptCancelled: vi.fn(async () => undefined),
  sendAptRescheduledToClient: vi.fn(async () => undefined),
  notifyStaffAptRescheduled: vi.fn(async () => undefined),
}));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'a'.repeat(48);

function makeEnv() {
  return {
    ADMIN_KEY,
    DB: { prepare: () => ({ bind: () => ({ run: async () => undefined, all: async () => ({ results: [] }), first: async () => null }) }) },
    MANICBOT: { get: async () => null, put: async () => undefined, delete: async () => undefined },
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

describe('POST /admin/appointment-action — sync_calendar action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenant.mockResolvedValue({ id: 't1', plan: 'pro', billingStatus: 'active' });
  });

  it('pushes the appointment to Google Calendar (plan allows calendar)', async () => {
    const req = makeRequest({ action: 'sync_calendar', appointmentId: 'apt_manual_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe('sync_calendar');
    expect(body.calendarSynced).toBe(true);
    expect(syncAppointmentCalendar).toHaveBeenCalledTimes(1);
    expect(syncAppointmentCalendar.mock.calls[0][1]).toMatchObject({ id: 'apt_manual_1' });
  });

  it('does NOT message the client (calendar-only — manual booking stays silent)', async () => {
    const req = makeRequest({ action: 'sync_calendar', appointmentId: 'apt_manual_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    const body = await res.json();
    expect(body.notified).toBe(false);
    expect(sendAptConfirmedToClient).not.toHaveBeenCalled();
  });

  it('skips the push when the plan does not include calendar (start plan)', async () => {
    getTenant.mockResolvedValue({ id: 't1', plan: 'start', billingStatus: 'active' });
    const req = makeRequest({ action: 'sync_calendar', appointmentId: 'apt_manual_1', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calendarSynced).toBe(false);
    expect(syncAppointmentCalendar).not.toHaveBeenCalled();
  });

  it('returns 404 when the appointment is missing', async () => {
    const { getAptById } = await import('../src/services/appointments.js');
    vi.mocked(getAptById).mockResolvedValueOnce(null);
    const req = makeRequest({ action: 'sync_calendar', appointmentId: 'nope', tenantId: 't1' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(404);
    expect(syncAppointmentCalendar).not.toHaveBeenCalled();
  });

  // ── Read-after-write fallback ──────────────────────────────────────────
  // A manual dashboard booking inserts the row, then immediately calls this
  // endpoint. The row may not yet be visible to this Worker's D1 read, which
  // used to 404 and silently drop the push to the ≤15-min cron. The
  // sync_calendar action now accepts a tenant-matched appointment payload
  // from the request body as a fallback.
  const bodyApt = {
    id: 'apt_manual_1',
    tenantId: 't1',
    chatId: -1717,
    svcId: 'svc_a',
    date: '2026-09-12',
    time: '11:00',
    ts: 1789000000000,
    status: 'confirmed',
    masterId: 42,
  };

  it('falls back to the request-body apt when the freshly-written row is not yet readable', async () => {
    const { getAptById } = await import('../src/services/appointments.js');
    vi.mocked(getAptById).mockResolvedValueOnce(null); // replica lag: row not visible yet
    const req = makeRequest({ action: 'sync_calendar', appointmentId: 'apt_manual_1', tenantId: 't1', apt: bodyApt });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calendarSynced).toBe(true);
    expect(syncAppointmentCalendar).toHaveBeenCalledTimes(1);
    expect(syncAppointmentCalendar.mock.calls[0][1]).toMatchObject({ id: 'apt_manual_1', tenantId: 't1' });
  });

  it('rejects a body apt whose tenantId does not match the authenticated tenant (tenant isolation)', async () => {
    const { getAptById } = await import('../src/services/appointments.js');
    vi.mocked(getAptById).mockResolvedValueOnce(null);
    const req = makeRequest({
      action: 'sync_calendar',
      appointmentId: 'apt_manual_1',
      tenantId: 't1',
      apt: { ...bodyApt, tenantId: 't2' },
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(404);
    expect(syncAppointmentCalendar).not.toHaveBeenCalled();
  });

  it('ignores a body apt whose id does not match the appointmentId', async () => {
    const { getAptById } = await import('../src/services/appointments.js');
    vi.mocked(getAptById).mockResolvedValueOnce(null);
    const req = makeRequest({
      action: 'sync_calendar',
      appointmentId: 'apt_manual_1',
      tenantId: 't1',
      apt: { ...bodyApt, id: 'someone_else' },
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(404);
    expect(syncAppointmentCalendar).not.toHaveBeenCalled();
  });

  it('does not use a body apt for non-calendar actions (confirm still 404s on a missing row)', async () => {
    const { getAptById } = await import('../src/services/appointments.js');
    vi.mocked(getAptById).mockResolvedValueOnce(null);
    const req = makeRequest({ action: 'confirm', appointmentId: 'apt_manual_1', tenantId: 't1', apt: bodyApt });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(404);
    expect(syncAppointmentCalendar).not.toHaveBeenCalled();
  });
});
