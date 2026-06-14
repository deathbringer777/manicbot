/**
 * Booking registration gating at the service-pick (`sv:<id>`) step.
 *
 * WEB (low-friction): an unregistered visitor must NOT be gated on registration
 * up front — picking a service drops them straight onto date selection. Name +
 * phone are collected later, at the confirmation step (see
 * test/booking-defer-registration.test.js).
 *
 * OTHER channels (Telegram / IG / WA): keep the up-front gate, threading the
 * picked service into the registration flow so finishPhone() resumes straight to
 * date selection instead of re-asking for a service. This pins the caller
 * contract: startBooking() must receive the `{ svcId }` booking intent.
 *
 * The onCb preamble + sv: branch touch many collaborators; we mock them so the
 * handler runs hermetically and we can spy the exact calls.
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
  deferBookingRegistration: vi.fn(async () => {}),
}));

import { onCb } from '../src/handlers/callback.js';
import { setState } from '../src/services/state.js';
import { startBooking, startBookingWithService } from '../src/ui/booking.js';
import { STEP } from '../src/config.js';

function makeCtx(channelType = 'web') {
  return {
    tenantId: 't1',
    channel: { type: channelType },
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

describe('booking registration gate at service pick', () => {
  beforeEach(() => vi.clearAllMocks());

  it('WEB: unregistered visitor goes straight to date selection (no up-front reg gate)', async () => {
    const ctx = makeCtx('web');
    await onCb(ctx, makeCb(CB.SERVICE + 'classic'));

    // No registration gate — falls through to date selection.
    expect(startBooking).not.toHaveBeenCalled();
    const dateCall = setState.mock.calls.find(c => c[2]?.step === STEP.DATE);
    expect(dateCall).toBeTruthy();
    expect(dateCall[2]).toMatchObject({ step: STEP.DATE, svcId: 'classic' });
  });

  it('NON-WEB: unregistered visitor is gated up front with { svcId } threaded', async () => {
    const ctx = makeCtx('instagram');
    await onCb(ctx, makeCb(CB.SERVICE + 'classic'));

    expect(startBooking).toHaveBeenCalledTimes(1);
    const args = startBooking.mock.calls[0];
    expect(args[1]).toBe(-12345);
    expect(args[2]).toMatchObject({ id: 999 });
    expect(args[3]).toEqual({ svcId: 'classic' });
    expect(startBookingWithService).not.toHaveBeenCalled();
  });
});
