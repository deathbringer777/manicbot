/**
 * Worker-side tests for the review-collector plugin helper.
 *
 * The helper appends a Google / Yandex CTA via send() after the existing
 * 4⭐/5⭐ thank-you message — only when the plugin install row exists,
 * is enabled, and carries at least one configured URL. Anything else =>
 * silent no-op. The original rating UX must never regress because the
 * plugin is misconfigured or absent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

let mockInstallRow = null;
let mockDbThrows = false;
const sendCalls = [];

vi.mock('../src/utils/db.js', () => ({
  dbGet: vi.fn(async () => {
    if (mockDbThrows) throw new Error('boom');
    return mockInstallRow;
  }),
}));

vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async (ctx, cid, text, opts) => {
    sendCalls.push({ cid, text, opts });
    return { ok: true };
  }),
}));

const { maybeSendReviewCta } = await import('../src/plugins/reviewCollectorCta.js');

const baseCtx = { tenantId: 't_pro', db: {} };

beforeEach(() => {
  mockInstallRow = null;
  mockDbThrows = false;
  sendCalls.length = 0;
});

describe('maybeSendReviewCta — rating gate', () => {
  it('skips for ratings under 4', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ googleReviewUrl: 'https://g.page/r/x' }) };
    for (const r of [1, 2, 3]) {
      const sent = await maybeSendReviewCta(baseCtx, 999, r);
      expect(sent).toBe(false);
    }
    expect(sendCalls).toHaveLength(0);
  });

  it('skips on NaN / undefined rating', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ googleReviewUrl: 'https://g.page/r/x' }) };
    expect(await maybeSendReviewCta(baseCtx, 999, NaN)).toBe(false);
    expect(await maybeSendReviewCta(baseCtx, 999, undefined)).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });
});

describe('maybeSendReviewCta — install row gate', () => {
  it('skips when no tenantId (legacy single-bot mode)', async () => {
    const sent = await maybeSendReviewCta({ db: {} }, 999, 5);
    expect(sent).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });

  it('skips when no install row found', async () => {
    mockInstallRow = null;
    const sent = await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sent).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });

  it('skips when install row has null settings_json', async () => {
    mockInstallRow = { settings_json: null };
    const sent = await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sent).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });

  it('skips when settings_json is malformed JSON', async () => {
    mockInstallRow = { settings_json: '{not json' };
    const sent = await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sent).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });

  it('skips silently when dbGet throws (plugin must never break core)', async () => {
    mockDbThrows = true;
    const sent = await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sent).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });
});

describe('maybeSendReviewCta — URL gate', () => {
  it('skips when both URLs are empty / missing', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ googleReviewUrl: '', yandexReviewUrl: '' }) };
    expect(await maybeSendReviewCta(baseCtx, 999, 5)).toBe(false);
    expect(sendCalls).toHaveLength(0);

    mockInstallRow = { settings_json: JSON.stringify({}) };
    expect(await maybeSendReviewCta(baseCtx, 999, 5)).toBe(false);
    expect(sendCalls).toHaveLength(0);
  });

  it('sends Google-only when only google URL is set', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ googleReviewUrl: 'https://g.page/r/xyz' }) };
    const sent = await maybeSendReviewCta(baseCtx, 5551, 5);
    expect(sent).toBe(true);
    expect(sendCalls).toHaveLength(1);
    const buttons = sendCalls[0].opts.reply_markup.inline_keyboard;
    expect(buttons).toHaveLength(1);
    expect(buttons[0][0].text).toMatch(/Google/);
    expect(buttons[0][0].url).toBe('https://g.page/r/xyz');
  });

  it('sends Yandex-only when only yandex URL is set', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ yandexReviewUrl: 'https://yandex.ru/maps/org/123' }) };
    const sent = await maybeSendReviewCta(baseCtx, 5551, 4);
    expect(sent).toBe(true);
    expect(sendCalls).toHaveLength(1);
    const buttons = sendCalls[0].opts.reply_markup.inline_keyboard;
    expect(buttons).toHaveLength(1);
    expect(buttons[0][0].text).toMatch(/Яндекс/);
    expect(buttons[0][0].url).toBe('https://yandex.ru/maps/org/123');
  });

  it('sends both buttons when both URLs are set (rating=4, lowest happy)', async () => {
    mockInstallRow = {
      settings_json: JSON.stringify({
        googleReviewUrl: 'https://g.page/r/abc',
        yandexReviewUrl: 'https://yandex.ru/maps/org/456',
      }),
    };
    const sent = await maybeSendReviewCta(baseCtx, 5551, 4);
    expect(sent).toBe(true);
    const buttons = sendCalls[0].opts.reply_markup.inline_keyboard;
    expect(buttons).toHaveLength(2);
    expect(buttons[0][0].url).toBe('https://g.page/r/abc');
    expect(buttons[1][0].url).toBe('https://yandex.ru/maps/org/456');
  });
});

describe('maybeSendReviewCta — message text', () => {
  it('uses the default polite ask when no customMessage configured', async () => {
    mockInstallRow = { settings_json: JSON.stringify({ googleReviewUrl: 'https://g.page/r/x' }) };
    await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sendCalls[0].text).toContain('Спасибо за оценку');
  });

  it('uses the custom message when configured', async () => {
    mockInstallRow = {
      settings_json: JSON.stringify({
        googleReviewUrl: 'https://g.page/r/x',
        customMessage: 'Друг, кинь нам пять звёзд на Google 🙏',
      }),
    };
    await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sendCalls[0].text).toBe('Друг, кинь нам пять звёзд на Google 🙏');
  });

  it('caps custom message to 280 chars (anti-abuse)', async () => {
    const long = 'a'.repeat(500);
    mockInstallRow = {
      settings_json: JSON.stringify({
        googleReviewUrl: 'https://g.page/r/x',
        customMessage: long,
      }),
    };
    await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sendCalls[0].text).toHaveLength(280);
  });

  it('falls back to default message when customMessage is whitespace-only', async () => {
    mockInstallRow = {
      settings_json: JSON.stringify({
        googleReviewUrl: 'https://g.page/r/x',
        customMessage: '   \n   ',
      }),
    };
    await maybeSendReviewCta(baseCtx, 999, 5);
    expect(sendCalls[0].text).toContain('Спасибо за оценку');
  });
});
