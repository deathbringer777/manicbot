import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  normalizeEmail,
  normalizePhone,
  buildUserData,
  sendCapiEvent,
} from '../src/marketing/metaCapi.js';

// Independent reference hash (Meta requires SHA-256 of normalized PII).
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const PIXEL = '869658089071782';
const TOKEN = 'EAA-capi-test-token';

function ctxWith(extra = {}) {
  return { metaCapiPixelId: PIXEL, metaCapiToken: TOKEN, ...extra };
}

function makeFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('metaCapi — PII normalization', () => {
  it('lowercases + trims email', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('strips non-digits from phone', () => {
    expect(normalizePhone('+48 (600) 123-456')).toBe('48600123456');
  });
});

describe('metaCapi — buildUserData match keys', () => {
  it('hashes email + phone, passes fbp/fbc/ip/ua through un-hashed', async () => {
    const ud = await buildUserData({
      email: '  Owner@Salon.com ',
      phone: '+48 (600) 123-456',
      clientIp: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      fbp: 'fb.1.123.abc',
      fbc: 'fb.1.123.click',
    });
    // PII (em/ph) must be SHA-256 hashed of the normalized value
    expect(ud.em).toEqual([sha256('owner@salon.com')]);
    expect(ud.ph).toEqual([sha256('48600123456')]);
    // Meta match keys are already opaque → forwarded raw, never hashed
    expect(ud.client_ip_address).toBe('203.0.113.7');
    expect(ud.client_user_agent).toBe('Mozilla/5.0');
    expect(ud.fbp).toBe('fb.1.123.abc');
    expect(ud.fbc).toBe('fb.1.123.click');
    // raw PII must never survive into the payload
    expect(JSON.stringify(ud).toLowerCase()).not.toContain('owner@salon.com');
    expect(JSON.stringify(ud)).not.toContain('48600123456');
  });

  it('omits absent fields — empty input yields an empty object', async () => {
    expect(await buildUserData({})).toEqual({});
  });
});

describe('metaCapi — feature flag', () => {
  it('no-ops (skipped) when pixel id is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendCapiEvent({ metaCapiToken: TOKEN }, { eventName: 'Purchase', email: 'a@b.com' });
    expect(res.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops (skipped) when token is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendCapiEvent({ metaCapiPixelId: PIXEL }, { eventName: 'Purchase', email: 'a@b.com' });
    expect(res.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('metaCapi — sendCapiEvent payload', () => {
  it('POSTs to /{pixelId}/events with bearer token and hashed PII', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { events_received: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendCapiEvent(ctxWith(), {
      eventName: 'Purchase',
      eventId: 'inv_123',
      email: '  Owner@Salon.com ',
      value: 45,
      currency: 'pln',
      eventSourceUrl: 'https://manicbot.com',
    });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PIXEL}/events`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);

    const sent = JSON.parse(init.body);
    const ev = sent.data[0];
    expect(ev.event_name).toBe('Purchase');
    expect(ev.event_id).toBe('inv_123');
    expect(ev.action_source).toBe('website');
    expect(ev.event_source_url).toBe('https://manicbot.com');
    expect(ev.custom_data.value).toBe(45);
    expect(ev.custom_data.currency).toBe('PLN');
    // PII must be SHA-256 hashed, never plaintext
    expect(ev.user_data.em).toEqual([sha256('owner@salon.com')]);
    expect(JSON.stringify(sent)).not.toContain('Owner@Salon.com');
    expect(JSON.stringify(sent)).not.toContain('owner@salon.com');
  });

  it('includes test_event_code when ctx.metaCapiTestCode is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { events_received: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendCapiEvent(ctxWith({ metaCapiTestCode: 'TEST123' }), {
      eventName: 'CompleteRegistration',
      eventId: 'reg_1',
      email: 'a@b.com',
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.test_event_code).toBe('TEST123');
  });

  it('never throws when the network rejects — returns ok:false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendCapiEvent(ctxWith(), { eventName: 'Purchase', email: 'a@b.com' });
    expect(res.ok).toBe(false);
  });

  it('requires an event name', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendCapiEvent(ctxWith(), { email: 'a@b.com' });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:false on a Meta error envelope without throwing (4xx is terminal, no retry)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(400, { error: { message: 'Invalid OAuth access token', code: 190 } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendCapiEvent(ctxWith(), { eventName: 'Purchase', email: 'a@b.com' });
    expect(res.ok).toBe(false);
    // an auth error (190) is not retried — exactly one network attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
