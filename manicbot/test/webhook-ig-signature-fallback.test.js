/**
 * Regression tests for the IG webhook signature secret fallback
 * introduced on 2026-05-14.
 *
 * Background: the post-Mar-2026 Meta Instagram Login product signs IG
 * webhooks with a separate App Secret (METAINSTAGRAM_APP_SECRET) — NOT
 * the parent FB App Secret. Our verifier originally only knew
 * META_APP_SECRET, so every IG POST returned 403 silently. The fix:
 *   1. Try META_APP_SECRET first (legacy / FB-product webhooks).
 *   2. If that fails AND META_INSTAGRAM_APP_SECRET is configured,
 *      try the IG secret.
 *   3. If BOTH fail, captureError() a row in the God Mode `/errors`
 *      dashboard so a future secret rotation is visible immediately.
 *
 * These tests pin the policy. The full handler is exercised by other
 * suites; here we only need to know which secret won, by stubbing
 * verifyMetaSignature.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyMetaSignature: vi.fn(),
  captureError: vi.fn(async () => {}),
}));
vi.mock('../src/channels/meta-verify.js', async () => {
  const actual = await vi.importActual('../src/channels/meta-verify.js');
  return {
    ...actual,
    verifyMetaSignature: mocks.verifyMetaSignature,
  };
});
vi.mock('../src/utils/errorCapture.js', () => ({
  captureError: mocks.captureError,
}));
vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));

import { tryMetaWebhooks } from '../src/http/metaWebhooksHttp.js';

const FB_SECRET = 'fb_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const IG_SECRET = '359baa27896826abb89d3adbcccd7ea1';

function igPostRequest(body = '{"object":"instagram","entry":[]}') {
  return new Request('https://manicbot.com/webhook/ig', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=deadbeefcafebabe' + '0'.repeat(48),
    },
    body,
  });
}

function makeEnv({ fb = FB_SECRET, ig } = {}) {
  return {
    META_APP_SECRET: fb,
    ...(ig !== undefined ? { META_INSTAGRAM_APP_SECRET: ig } : {}),
    META_VERIFY_TOKEN_IG: 'verify123',
    DB: { prepare() { return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } }; } },
  };
}

describe('IG webhook signature: secret fallback', () => {
  beforeEach(() => {
    mocks.verifyMetaSignature.mockReset();
    mocks.captureError.mockReset();
  });

  it('503 when no META_APP_SECRET at all', async () => {
    const env = makeEnv({ fb: null });
    const res = await tryMetaWebhooks(igPostRequest(), env, new URL('https://manicbot.com/webhook/ig'), {});
    expect(res?.status).toBe(503);
    expect(mocks.verifyMetaSignature).not.toHaveBeenCalled();
  });

  it('accepts when META_APP_SECRET is correct on first try (legacy)', async () => {
    // First call returns true → no fallback attempt.
    mocks.verifyMetaSignature.mockResolvedValueOnce(true);
    const env = makeEnv({ ig: IG_SECRET });
    const res = await tryMetaWebhooks(igPostRequest(), env, new URL('https://manicbot.com/webhook/ig'), {});
    expect(res?.status).toBe(200);
    expect(mocks.verifyMetaSignature).toHaveBeenCalledTimes(1);
    expect(mocks.verifyMetaSignature.mock.calls[0][2]).toBe(FB_SECRET);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it('falls back to META_INSTAGRAM_APP_SECRET when FB secret fails', async () => {
    mocks.verifyMetaSignature
      .mockResolvedValueOnce(false)   // FB secret check fails
      .mockResolvedValueOnce(true);   // IG secret check succeeds
    const env = makeEnv({ ig: IG_SECRET });
    const res = await tryMetaWebhooks(igPostRequest(), env, new URL('https://manicbot.com/webhook/ig'), {});
    expect(res?.status).toBe(200);
    expect(mocks.verifyMetaSignature).toHaveBeenCalledTimes(2);
    expect(mocks.verifyMetaSignature.mock.calls[0][2]).toBe(FB_SECRET);
    expect(mocks.verifyMetaSignature.mock.calls[1][2]).toBe(IG_SECRET);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it('does NOT attempt IG fallback when META_INSTAGRAM_APP_SECRET is unset', async () => {
    mocks.verifyMetaSignature.mockResolvedValueOnce(false);
    const env = makeEnv({ ig: undefined });
    const res = await tryMetaWebhooks(igPostRequest(), env, new URL('https://manicbot.com/webhook/ig'), {});
    expect(res?.status).toBe(403);
    expect(mocks.verifyMetaSignature).toHaveBeenCalledTimes(1);
  });

  it('on both-fail: captureError fires with sig prefix + bodyLen + secret-set flags', async () => {
    mocks.verifyMetaSignature.mockResolvedValue(false);
    const env = makeEnv({ ig: IG_SECRET });
    const res = await tryMetaWebhooks(igPostRequest(), env, new URL('https://manicbot.com/webhook/ig'), {});
    expect(res?.status).toBe(403);
    expect(mocks.captureError).toHaveBeenCalledTimes(1);
    const [, , ctx] = mocks.captureError.mock.calls[0];
    expect(ctx.severity).toBe('error');
    expect(ctx.source).toBe('webhook.ig');
    expect(ctx.path).toBe('/webhook/ig');
    expect(ctx.hasMetaAppSecret).toBe('yes');
    expect(ctx.hasInstagramAppSecret).toBe('yes');
    expect(ctx.sigPrefix).toMatch(/^sha256=/);
    expect(typeof ctx.bodyLen).toBe('number');
  });
});
