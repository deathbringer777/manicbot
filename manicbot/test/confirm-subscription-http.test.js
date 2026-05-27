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

const { handleConfirmSubscriptionRequest, __test } = await import(
  '../src/http/confirmSubscriptionHttp.js'
);

const VALID_TOKEN = 'a'.repeat(32);
const NEW_UNSUB_TOKEN = 'b'.repeat(32);

function makeRequest(url = `https://manicbot.com/confirm-subscription?token=${VALID_TOKEN}`) {
  return new Request(url, { method: 'GET', headers: { 'cf-connecting-ip': '1.2.3.4' } });
}

function makeEnv() {
  return {
    DB: {},
    INTERNAL_API_TOKEN: 'internal-shhh',
    ADMIN_APP_URL: 'https://admin.test',
  };
}

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  checkAndIncrement.mockReset();
  checkAndIncrement.mockResolvedValue({ limited: false });
  vi.unstubAllGlobals();
  // Deterministic token mint for assertions.
  vi.spyOn(__test, 'mintTokenForTest').mockReturnValue(NEW_UNSUB_TOKEN);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleConfirmSubscriptionRequest — method gate', () => {
  it('returns 405 for non-GET', async () => {
    const req = new Request('https://manicbot.com/confirm-subscription?token=' + VALID_TOKEN, {
      method: 'POST',
    });
    const res = await handleConfirmSubscriptionRequest(req, makeEnv());
    expect(res.status).toBe(405);
  });
});

describe('handleConfirmSubscriptionRequest — token validation', () => {
  it('400-equivalent error page on missing token', async () => {
    const res = await handleConfirmSubscriptionRequest(
      new Request('https://manicbot.com/confirm-subscription'),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toMatch(/<!DOCTYPE html>/);
  });

  it('400-equivalent error page on malformed token', async () => {
    const res = await handleConfirmSubscriptionRequest(
      new Request('https://manicbot.com/confirm-subscription?token=ABC123'),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe('handleConfirmSubscriptionRequest — happy path', () => {
  it('stamps confirmed_at + mints unsub token + dispatches welcome + 200', async () => {
    dbGet.mockResolvedValueOnce({
      email: 'a@b.com',
      lang: 'pl',
      confirm_token_expires_at: 9_999_999_999,
      confirmed_at: null,
    });
    dbRun.mockResolvedValueOnce({ meta: { changes: 1 } });

    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/subskrypc/i); // Polish
    // The UPDATE binds the new unsub token + clears confirm_token
    const updateCall = dbRun.mock.calls[0];
    expect(updateCall[1]).toMatch(/UPDATE newsletter_subscribers/);
    // Args: ...confirmedAt, unsubscribe_token, email
    expect(updateCall).toContain(NEW_UNSUB_TOKEN);
    expect(updateCall).toContain('a@b.com');
    // Welcome dispatch fired with the new unsubscribe token
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admin.test/api/internal/newsletter-welcome');
    expect(init.headers.authorization).toBe('Bearer internal-shhh');
    const json = JSON.parse(init.body);
    expect(json.email).toBe('a@b.com');
    expect(json.lang).toBe('pl');
    expect(json.unsubscribeToken).toBe(NEW_UNSUB_TOKEN);
  });

  it('is idempotent: already-confirmed row returns 200 without re-dispatch', async () => {
    dbGet.mockResolvedValueOnce({
      email: 'a@b.com',
      lang: 'ru',
      confirm_token_expires_at: 9_999_999_999,
      confirmed_at: 1_700_000_000,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());

    expect(res.status).toBe(200);
    // Body still success page
    expect(await res.text()).toMatch(/Подписка подтверждена/);
    expect(dbRun).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleConfirmSubscriptionRequest — token not found / expired', () => {
  it('returns generic error page for unknown token (no enumeration)', async () => {
    dbGet.mockResolvedValueOnce(null);
    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/Что-то пошло не так|Something went wrong/);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('returns the expired page when confirm_token_expires_at is in the past', async () => {
    dbGet.mockResolvedValueOnce({
      email: 'a@b.com',
      lang: 'en',
      confirm_token_expires_at: 1, // ancient
      confirmed_at: null,
    });
    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/expired/i);
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('handleConfirmSubscriptionRequest — rate limit', () => {
  it('returns 429 when limiter blocks', async () => {
    checkAndIncrement.mockResolvedValueOnce({ limited: true });
    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());
    expect(res.status).toBe(429);
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('fails-open if limiter throws (never blocks legit confirms)', async () => {
    checkAndIncrement.mockRejectedValueOnce(new Error('limiter down'));
    dbGet.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());
    expect([200, 404]).toContain(res.status);
    errSpy.mockRestore();
  });
});

describe('handleConfirmSubscriptionRequest — welcome dispatch failure does not block confirm', () => {
  it('confirms the row even when admin-app POST fails', async () => {
    dbGet.mockResolvedValueOnce({
      email: 'a@b.com',
      lang: 'ru',
      confirm_token_expires_at: 9_999_999_999,
      confirmed_at: null,
    });
    dbRun.mockResolvedValueOnce({ meta: { changes: 1 } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    const res = await handleConfirmSubscriptionRequest(makeRequest(), makeEnv());

    expect(res.status).toBe(200);
    expect(dbRun).toHaveBeenCalledTimes(1); // UPDATE ran
  });
});
