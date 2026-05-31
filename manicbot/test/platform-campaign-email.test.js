/**
 * platformCampaignEmail — Resend transport for the email channel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliverEmail } from '../src/services/platformCampaignEmail.js';

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const ctx = { resendApiKey: 'rk_test', resendFrom: 'ManicBot <noreply@manicbot.com>' };

describe('deliverEmail', () => {
  it('POSTs to Resend with from/to/subject/html and the bearer key', async () => {
    const res = await deliverEmail(ctx, { to: 'owner@salon.com', subject: 'Hi', html: '<p>x</p>' });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer rk_test');
    const sent = JSON.parse(opts.body);
    expect(sent).toMatchObject({ from: ctx.resendFrom, to: ['owner@salon.com'], subject: 'Hi', html: '<p>x</p>' });
  });

  it('falls back to raw env vars (RESEND_API_KEY / RESEND_FROM)', async () => {
    const envCtx = { RESEND_API_KEY: 'rk_env', RESEND_FROM: 'from@x.com' };
    const res = await deliverEmail(envCtx, { to: 'a@b.com', subject: 's', html: '<i>h</i>' });
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer rk_env');
  });

  it('skips (no throw, no fetch) when Resend is unconfigured', async () => {
    const res = await deliverEmail({}, { to: 'a@b.com', subject: 's', html: 'h' });
    expect(res).toEqual({ ok: false, error: 'resend_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error (no throw) on a non-2xx Resend response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'bad' });
    const res = await deliverEmail(ctx, { to: 'a@b.com', subject: 's', html: 'h' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('422');
  });

  it('requires to/subject/html', async () => {
    expect((await deliverEmail(ctx, { to: '', subject: 's', html: 'h' })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
