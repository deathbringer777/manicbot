/**
 * Low-friction web booking: name + phone are collected AFTER the slot is chosen.
 *
 * When an unregistered WEB visitor picks a time (`tm:HH:MM`), the handler must
 * route into the deferred registration helper (name → phone) instead of showing
 * a confirmation card with "—" placeholders. Registered visitors (and all
 * non-web channels, which are gated up front) skip straight to the confirm card.
 *
 * booking.js is mocked so we can spy the exact deferBookingRegistration() call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CB, STEP } from '../src/config.js';

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
  getUser: vi.fn(async () => null),
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
import { getState, setState } from '../src/services/state.js';
import { getUser, isRegComplete } from '../src/services/users.js';
import { deferBookingRegistration } from '../src/ui/booking.js';

// Must sit inside isValidDate()'s window (this year .. +2 years).
const FUTURE_DATE = '2026-12-15';

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
    from: { id: 999, first_name: 'Тест', username: 'tester' },
    message: { message_id: 11, chat: { id: cid, type: 'private' } },
  };
}

describe('web booking defers registration to the time-pick step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getState.mockResolvedValue({ step: STEP.TIME, svcId: 'classic', date: FUTURE_DATE, masterId: null });
  });

  it('unregistered web visitor → deferBookingRegistration with the full slot, no confirm card', async () => {
    getUser.mockResolvedValue(null);
    isRegComplete.mockReturnValue(false);

    await onCb(makeCtx('web'), makeCb(CB.TIME + '14:00'));

    expect(deferBookingRegistration).toHaveBeenCalledTimes(1);
    const slot = deferBookingRegistration.mock.calls[0][3];
    expect(slot).toEqual({ svcId: 'classic', date: FUTURE_DATE, time: '14:00', masterId: null });
    // Must NOT advance to the confirmation step.
    expect(setState.mock.calls.some(c => c[2]?.step === STEP.CONFIRM)).toBe(false);
  });

  it('registered web visitor → straight to confirmation, no deferral', async () => {
    getUser.mockResolvedValue({ name: 'Аня', phone: '+48123456789' });
    isRegComplete.mockReturnValue(true);

    await onCb(makeCtx('web'), makeCb(CB.TIME + '14:00'));

    expect(deferBookingRegistration).not.toHaveBeenCalled();
    expect(setState.mock.calls.some(c => c[2]?.step === STEP.CONFIRM)).toBe(true);
  });
});
