/**
 * Regression: an unregistered web visitor who picks a service from the catalog
 * ("Записаться на эту услугу" → `sv:<id>`) must NOT lose that service across the
 * name/phone registration gate.
 *
 * The resume machinery already exists end-to-end:
 *   - startBooking(ctx, cid, from, bookingIntent) spreads { svcId } into REG state
 *     (src/ui/booking.js)
 *   - the REG_NAME handler preserves state in place (src/handlers/message.js)
 *   - finishPhone() sees flow==='book' && svcId and resumes via
 *     startBookingWithService() straight to date selection
 *
 * The bug was in the CALLER: callback.js dispatched the `sv:` tap with
 * `startBooking(ctx, cid, cb.from)` — without the 4th `bookingIntent` argument —
 * so svcId was never stashed and the user was re-asked to choose a service after
 * registering. This test pins the caller contract.
 *
 * The onCb preamble + sv: branch touch many collaborators; we mock them so the
 * handler runs hermetically and we can spy the exact startBooking() call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CB } from '../src/config.js';

vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
  answerCb: vi.fn(async () => {}),
  api: vi.fn(async () => {}),
}));
vi.mock('../src/services/state.js', () => ({
  getState: vi.fn(async () => ({})),
  setState: vi.fn(async () => {}),
  clearState: vi.fn(async () => {}),
  checkRateLimit: vi.fn(async () => true),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'),
  setLang: vi.fn(async () => {}),
}));
vi.mock('../src/billing/features.js', () => ({
  isInactive: vi.fn(() => false),
  canUse: vi.fn(() => true),
  getMastersLimit: vi.fn(() => 99),
}));
vi.mock('../src/services/users.js', () => ({
  getUser: vi.fn(async () => null), // unregistered
  isRegComplete: vi.fn(() => false),
  isBlocked: vi.fn(async () => false),
  isPlatformAdmin: vi.fn(async () => false),
  getRole: vi.fn(async () => 'client'),
  isAdmin: vi.fn(async () => false),
  isMaster: vi.fn(async () => false),
  canManageApt: vi.fn(async () => false),
  getAdminId: vi.fn(async () => null),
  getMaster: vi.fn(async () => null),
  saveMaster: vi.fn(async () => {}),
  deleteMaster: vi.fn(async () => {}),
  blockUser: vi.fn(async () => {}),
  unblockUser: vi.fn(async () => {}),
  listMasters: vi.fn(async () => []),
}));
vi.mock('../src/ui/booking.js', () => ({
  startBooking: vi.fn(async () => {}),
  startBookingWithService: vi.fn(async () => {}),
  showCancelAllConfirm: vi.fn(async () => {}),
  showMasterPick: vi.fn(async () => {}),
  enterBookingAdjustState: vi.fn(async () => {}),
}));

import { onCb } from '../src/handlers/callback.js';
import { startBooking, startBookingWithService } from '../src/ui/booking.js';

function makeCtx() {
  return {
    tenantId: 't1',
    channel: { type: 'web' },
    env: {},
    tenant: { billingStatus: 'active', plan: 'pro' },
    svc: [{ id: 'classic', e: '💅', dur: 60, price: 80, active: true }],
    svcIds: new Set(['classic']),
  };
}

function makeCb(data, cid = -12345) {
  return {
    id: 'cb_1',
    data,
    from: { id: 999, first_name: 'Тест' },
    message: { message_id: 11, chat: { id: cid, type: 'private' } },
  };
}

describe('booking resume after registration (web sv: gate)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes { svcId } into startBooking when an unregistered user picks a service', async () => {
    const ctx = makeCtx();
    await onCb(ctx, makeCb(CB.SERVICE + 'classic'));

    expect(startBooking).toHaveBeenCalledTimes(1);
    const args = startBooking.mock.calls[0];
    // args = (ctx, cid, from, bookingIntent)
    expect(args[1]).toBe(-12345);
    expect(args[2]).toMatchObject({ id: 999 });
    expect(args[3]).toEqual({ svcId: 'classic' }); // ← the fix: intent must be threaded

    // Must go through the registration gate, not jump straight to date selection.
    expect(startBookingWithService).not.toHaveBeenCalled();
  });
});
