/**
 * visit_ok callback → immediate post-visit review prompt.
 *
 * Regression guard for the dead-button bug: the inline stars MUST use the
 * `rev:` callback prefix (the only handler — `d.startsWith('rev:')`), NOT the
 * old `rate:` prefix which had no handler. The prompt is gated on the tenant's
 * `reviews_enabled` + `reviews_prompt_timing` (default off; immediate by
 * default when enabled; "delayed" defers to the phaseReviews cron).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted with the vi.mock factories (which vitest hoists to the top of the
// file) so the factories can reference these without a TDZ ReferenceError.
const h = vi.hoisted(() => {
  let cfg = {};
  return {
    markReviewRequested: vi.fn(async () => {}),
    apptRow: { id: 'apt_1', chat_id: 555, master_id: 999, tenant_id: 't1', status: 'confirmed' },
    getCfg: () => cfg,
    setCfg: (c) => { cfg = c; },
  };
});

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
vi.mock('../src/services/users.js', async (importOriginal) => ({
  ...await importOriginal(),
  getRole: vi.fn(async () => 'tenant_owner'),
}));
vi.mock('../src/utils/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    dbGet: vi.fn(async (_ctx, sql) => (String(sql).includes('appointments') ? h.apptRow : null)),
    dbRun: vi.fn(async () => ({})),
  };
});
vi.mock('../src/services/services.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getConfig: vi.fn(async (_ctx, key) => h.getCfg()[key]) };
});
vi.mock('../src/services/reviews.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, markReviewRequested: h.markReviewRequested };
});

import { onCb } from '../src/handlers/callback.js';
import { send } from '../src/telegram.js';

function makeCtx() {
  return { tenantId: 't1', channel: { type: 'telegram' }, env: {}, tenant: { billingStatus: 'active', plan: 'pro' }, svc: [], svcIds: new Set() };
}
function makeCb(data, cid = 555) {
  return { id: 'cb_1', data, from: { id: cid, first_name: 'Мастер' }, message: { message_id: 11, chat: { id: cid, type: 'private' } } };
}
// Find the send() call carrying the star rating keyboard.
function reviewPromptCall() {
  return send.mock.calls.find(
    (c) => c[3]?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('rev:'),
  );
}

describe('visit_ok → post-visit review prompt', () => {
  beforeEach(() => { vi.clearAllMocks(); h.setCfg({}); });

  it('enabled + immediate → sends a rev: prompt and marks review_requested', async () => {
    h.setCfg({ reviews_enabled: '1', reviews_prompt_timing: 'immediate' });
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));
    const call = reviewPromptCall();
    expect(call).toBeDefined();
    const kb = call[3].reply_markup.inline_keyboard[0];
    expect(kb).toHaveLength(5);
    expect(kb.every((b) => b.callback_data.startsWith('rev:apt_1:'))).toBe(true);
    expect(kb.some((b) => b.callback_data.startsWith('rate:'))).toBe(false);
    expect(h.markReviewRequested).toHaveBeenCalledTimes(1);
  });

  it('disabled (default) → no review prompt at all', async () => {
    h.setCfg({});
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));
    expect(reviewPromptCall()).toBeUndefined();
    expect(h.markReviewRequested).not.toHaveBeenCalled();
  });

  it('enabled + delayed → no immediate prompt (cron sends it later)', async () => {
    h.setCfg({ reviews_enabled: '1', reviews_prompt_timing: 'delayed' });
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));
    expect(reviewPromptCall()).toBeUndefined();
    expect(h.markReviewRequested).not.toHaveBeenCalled();
  });
});
