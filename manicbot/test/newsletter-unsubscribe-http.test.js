import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const checkAndIncrement = vi.fn(async () => ({ limited: false }));

vi.mock('../src/utils/db.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
}));
vi.mock('../src/utils/rateLimit.js', () => ({
  checkAndIncrement: (...args) => checkAndIncrement(...args),
}));

const { handleNewsletterUnsubscribeRequest } = await import(
  '../src/http/newsletterUnsubscribeHttp.js'
);

const VALID_TOKEN = 'c'.repeat(32);

function makeReq(url = `https://manicbot.com/newsletter/unsubscribe?token=${VALID_TOKEN}`) {
  return new Request(url, { method: 'GET', headers: { 'cf-connecting-ip': '1.2.3.4' } });
}

function makeEnv() {
  return { DB: {} };
}

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  checkAndIncrement.mockReset();
  checkAndIncrement.mockResolvedValue({ limited: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleNewsletterUnsubscribeRequest — method gate', () => {
  it('returns 405 for non-GET', async () => {
    const req = new Request('https://manicbot.com/newsletter/unsubscribe?token=' + VALID_TOKEN, {
      method: 'POST',
    });
    const res = await handleNewsletterUnsubscribeRequest(req, makeEnv());
    expect(res.status).toBe(405);
  });
});

describe('handleNewsletterUnsubscribeRequest — token validation', () => {
  it('400 + error page for missing token', async () => {
    const res = await handleNewsletterUnsubscribeRequest(
      new Request('https://manicbot.com/newsletter/unsubscribe'),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('400 + error page for malformed token', async () => {
    const res = await handleNewsletterUnsubscribeRequest(
      new Request('https://manicbot.com/newsletter/unsubscribe?token=ABC'),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe('handleNewsletterUnsubscribeRequest — happy path', () => {
  it('stamps unsubscribed_at on first hit + returns localized success', async () => {
    dbGet.mockResolvedValueOnce({ email: 'a@b.com', lang: 'pl', unsubscribed_at: null });
    dbRun.mockResolvedValueOnce({ meta: { changes: 1 } });

    const res = await handleNewsletterUnsubscribeRequest(makeReq(), makeEnv());

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/wypisan/i);
    const updateCall = dbRun.mock.calls[0];
    expect(updateCall[1]).toMatch(/UPDATE newsletter_subscribers/);
    expect(updateCall[1]).toMatch(/unsubscribed_at/);
  });

  it('idempotent: already-unsubscribed row → 200 without re-UPDATE', async () => {
    dbGet.mockResolvedValueOnce({
      email: 'a@b.com',
      lang: 'en',
      unsubscribed_at: 1_700_000_000,
    });

    const res = await handleNewsletterUnsubscribeRequest(makeReq(), makeEnv());

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/unsubscribed/i);
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('handleNewsletterUnsubscribeRequest — unknown token', () => {
  it('returns generic error page for unknown token (no enumeration)', async () => {
    dbGet.mockResolvedValueOnce(null);
    const res = await handleNewsletterUnsubscribeRequest(makeReq(), makeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/Something went wrong|Что-то пошло/);
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('handleNewsletterUnsubscribeRequest — rate limit', () => {
  it('returns 429 when limiter blocks', async () => {
    checkAndIncrement.mockResolvedValueOnce({ limited: true });
    const res = await handleNewsletterUnsubscribeRequest(makeReq(), makeEnv());
    expect(res.status).toBe(429);
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('fails-open if limiter throws', async () => {
    checkAndIncrement.mockRejectedValueOnce(new Error('limiter dead'));
    dbGet.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleNewsletterUnsubscribeRequest(makeReq(), makeEnv());
    expect([200, 404]).toContain(res.status);
    errSpy.mockRestore();
  });
});
