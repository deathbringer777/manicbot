/**
 * Regression: the IG/WhatsApp registration infinite loop.
 *
 * A new Instagram/WhatsApp visitor arrives with no `first_name`. The old code
 * fabricated `tgName='?'`, asked REG_CONFIRM ("is '?' correct?"), persisted
 * name='?' on "Yes", and isRegComplete() rejects '?' → bounce back to
 * REG_CONFIRM → loop. Web already dodged this by routing to REG_NAME; this
 * test pins that ANY channel lacking a real first_name does the same, and that
 * the phone prompt never ships a phantom Telegram reply-keyboard off-Telegram.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasRealName, regPhonePrompt } from '../src/utils/helpers.js';
import { STEP } from '../src/config.js';

// ── Pure helpers ────────────────────────────────────────────────────────────
describe('hasRealName', () => {
  it('true only when a non-empty first/last name is present', () => {
    expect(hasRealName({ first_name: 'Аня' })).toBe(true);
    expect(hasRealName({ last_name: 'Котова' })).toBe(true);
    expect(hasRealName({ first_name: '', last_name: '' })).toBe(false);
    expect(hasRealName({ first_name: '   ' })).toBe(false);
    expect(hasRealName({})).toBe(false);
    expect(hasRealName(null)).toBe(false);
    expect(hasRealName(undefined)).toBe(false);
  });
});

describe('regPhonePrompt', () => {
  it('attaches the request_contact reply-keyboard on Telegram', () => {
    const tg = regPhonePrompt({ channel: { type: 'telegram' } }, 'ru', 'Аня');
    expect(tg.extra?.reply_markup?.keyboard?.[0]?.[0]?.request_contact).toBe(true);
    // missing channel defaults to Telegram
    const def = regPhonePrompt({}, 'ru', 'Аня');
    expect(def.extra?.reply_markup?.keyboard?.[0]?.[0]?.request_contact).toBe(true);
  });

  it('ships NO reply_markup on web/instagram/whatsapp (phantom-button fix)', () => {
    for (const type of ['web', 'instagram', 'whatsapp']) {
      const p = regPhonePrompt({ channel: { type } }, 'ru', 'Аня');
      expect(p.extra).toEqual({});
      expect(p.extra.reply_markup).toBeUndefined();
      // copy must not promise a button that never renders
      expect(p.text).not.toMatch(/нажми кнопку/i);
    }
  });
});

// ── startBooking routing ─────────────────────────────────────────────────────
const send = vi.fn(async () => {});
const setState = vi.fn(async () => {});
vi.mock('../src/telegram.js', () => ({ send: (...a) => send(...a) }));
vi.mock('../src/services/state.js', () => ({ setState: (...a) => setState(...a) }));
vi.mock('../src/services/chat.js', () => ({ getLang: vi.fn(async () => 'ru') }));
vi.mock('../src/services/users.js', () => ({
  getUser: vi.fn(async () => null),       // unregistered
  isRegComplete: vi.fn(() => false),
  listMasters: vi.fn(async () => []),
  getFavoriteMasterId: vi.fn(async () => null),
}));
vi.mock('../src/services/appointments.js', () => ({ getApts: vi.fn(async () => []), getSlots: vi.fn(async () => []) }));
vi.mock('../src/services/services.js', () => ({ getFavoriteSuggest: vi.fn(async () => null) }));

import { startBooking } from '../src/ui/booking.js';

function igCtx() {
  return { tenantId: 't1', channel: { type: 'instagram' }, env: {}, svc: [], svcIds: new Set() };
}

describe('startBooking — Instagram visitor without first_name', () => {
  beforeEach(() => { send.mockClear(); setState.mockClear(); });

  it('routes to REG_NAME (typed name), never REG_CONFIRM — no loop', async () => {
    await startBooking(igCtx(), 5550001, { id: 5550001 /* no first_name */ });

    // State must land on REG_NAME, not the confirm step that fabricates '?'
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][2]).toMatchObject({ step: STEP.REG_NAME });
    expect(setState.mock.calls[0][2].tgName).toBeUndefined();

    // Prompt must be the name-entry copy, not the "is '?' correct?" confirm.
    expect(send).toHaveBeenCalledTimes(1);
    const sentText = send.mock.calls[0][2];
    expect(sentText).toMatch(/Введи своё имя/);
    expect(sentText).not.toContain('?');
  });

  it('Telegram visitor WITH first_name still gets REG_CONFIRM', async () => {
    const ctx = { tenantId: 't1', channel: { type: 'telegram' }, env: {}, svc: [], svcIds: new Set() };
    await startBooking(ctx, 42, { id: 42, first_name: 'Аня' });

    expect(setState.mock.calls[0][2]).toMatchObject({ step: 'rc', tgName: 'Аня' });
  });
});
