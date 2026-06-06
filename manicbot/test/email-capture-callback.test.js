/**
 * onCb dispatch for the email-capture buttons (EMAIL_YES / EMAIL_NO / EMAIL_OPTOUT).
 * Models the hermetic onCb harness from booking-resume-after-reg.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CB, STEP } from '../src/config.js';

vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async () => {}), edit: vi.fn(async () => {}),
  answerCb: vi.fn(async () => {}), api: vi.fn(async () => {}),
}));
vi.mock('../src/services/state.js', () => ({
  getState: vi.fn(async () => ({})), setState: vi.fn(async () => {}),
  clearState: vi.fn(async () => {}), checkRateLimit: vi.fn(async () => true),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'), setLang: vi.fn(async () => {}),
}));
// Keep the real contacts module except spy setChatEmailOptOut (dynamically imported).
vi.mock('../src/services/marketing/contacts.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setChatEmailOptOut: vi.fn(async () => ({ ok: true })) };
});

import { onCb } from '../src/handlers/callback.js';
import { send } from '../src/telegram.js';
import { setState } from '../src/services/state.js';
import { setChatEmailOptOut } from '../src/services/marketing/contacts.js';

function makeCtx() {
  return { tenantId: 't1', channel: { type: 'telegram' }, env: {}, tenant: { billingStatus: 'active', plan: 'pro' }, svc: [], svcIds: new Set() };
}
function makeCb(data, cid = 555) {
  return { id: 'cb_1', data, from: { id: 555, first_name: 'Анна' }, message: { message_id: 11, chat: { id: cid, type: 'private' } } };
}

describe('email capture callbacks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('EMAIL_YES enters EMAIL_WAIT and prompts for the email', async () => {
    await onCb(makeCtx(), makeCb(CB.EMAIL_YES));
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][2]).toMatchObject({ step: STEP.EMAIL_WAIT });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('EMAIL_NO soft-declines (no state change, no opt-out)', async () => {
    await onCb(makeCtx(), makeCb(CB.EMAIL_NO));
    expect(setState).not.toHaveBeenCalled();
    expect(setChatEmailOptOut).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('EMAIL_OPTOUT unsubscribes via setChatEmailOptOut', async () => {
    await onCb(makeCtx(), makeCb(CB.EMAIL_OPTOUT));
    expect(setChatEmailOptOut).toHaveBeenCalledTimes(1);
    expect(setChatEmailOptOut.mock.calls[0][1]).toBe(555);
    expect(setChatEmailOptOut.mock.calls[0][2]).toMatchObject({ source: 'chat_settings' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
