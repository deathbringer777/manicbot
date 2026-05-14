import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMediaContainer,
  getContainerStatus,
  publishMediaContainer,
  getMediaPermalink,
} from '../../src/channels/instagram-publish.js';

const PAGE_ID = '1008301152373103';
const TOKEN = 'EAA-test-token';
const IMAGE_URL = 'https://pub-abc.r2.dev/posts/slot_20260515_0900.png';
const CAPTION = 'Sample caption #ManicBot';

function makeFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('marketing/instagram-publish — createMediaContainer', () => {
  it('POSTs to /{pageId}/media with image_url + caption', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'C123' }));
    globalThis.fetch = fetchMock;

    const res = await createMediaContainer({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: CAPTION,
      token: TOKEN,
    });

    expect(res).toEqual({ ok: true, containerId: 'C123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PAGE_ID}/media`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body);
    expect(body.image_url).toBe(IMAGE_URL);
    expect(body.caption).toBe(CAPTION);
  });

  it('rejects caption >2200 chars without calling Meta', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const long = 'a'.repeat(2201);
    const res = await createMediaContainer({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: long,
      token: TOKEN,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing pageId/imageUrl/token without calling Meta', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const r1 = await createMediaContainer({ pageId: '', imageUrl: IMAGE_URL, caption: '', token: TOKEN });
    const r2 = await createMediaContainer({ pageId: PAGE_ID, imageUrl: '', caption: '', token: TOKEN });
    const r3 = await createMediaContainer({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: '', token: '' });

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces token-dead from Meta error (code 190)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(401, { error: { code: 190, type: 'OAuthException', message: 'invalid token' } }),
    );
    globalThis.fetch = fetchMock;

    const res = await createMediaContainer({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: 'x',
      token: TOKEN,
    });

    expect(res.ok).toBe(false);
    expect(res.tokenDead).toBe(true);
    expect(res.status).toBe(401);
  });

  it('returns ok:false when Meta omits id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { weird: 'shape' }));
    globalThis.fetch = fetchMock;

    const res = await createMediaContainer({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: 'x',
      token: TOKEN,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no id/);
  });
});

describe('marketing/instagram-publish — getContainerStatus', () => {
  it('GETs /{containerId}?fields=status_code,status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { status_code: 'FINISHED', status: 'Finished' }));
    globalThis.fetch = fetchMock;

    const res = await getContainerStatus({ containerId: 'C123', token: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('FINISHED');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/C123');
    expect(url).toContain('fields=status_code');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('returns ok:true with IN_PROGRESS for unfinished containers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { status_code: 'IN_PROGRESS' }));
    globalThis.fetch = fetchMock;

    const res = await getContainerStatus({ containerId: 'C', token: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('IN_PROGRESS');
  });

  it('rejects missing inputs', async () => {
    const r1 = await getContainerStatus({ containerId: '', token: TOKEN });
    const r2 = await getContainerStatus({ containerId: 'C', token: '' });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
});

describe('marketing/instagram-publish — publishMediaContainer', () => {
  it('POSTs to /{pageId}/media_publish with creation_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'IG999' }));
    globalThis.fetch = fetchMock;

    const res = await publishMediaContainer({
      pageId: PAGE_ID,
      containerId: 'C123',
      token: TOKEN,
    });

    expect(res).toEqual({ ok: true, igPostId: 'IG999' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PAGE_ID}/media_publish`);
    const body = JSON.parse(init.body);
    expect(body.creation_id).toBe('C123');
  });

  it('surfaces failure with status + error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(400, { error: { code: 100, message: 'Invalid creation_id' } }),
    );
    globalThis.fetch = fetchMock;

    const res = await publishMediaContainer({
      pageId: PAGE_ID,
      containerId: 'BAD',
      token: TOKEN,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid creation_id/);
    expect(res.status).toBe(400);
  });

  it('rejects missing inputs', async () => {
    const r = await publishMediaContainer({ pageId: '', containerId: 'C', token: TOKEN });
    expect(r.ok).toBe(false);
  });
});

describe('marketing/instagram-publish — getMediaPermalink', () => {
  it('returns permalink from response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(200, { permalink: 'https://instagram.com/p/abc' }),
    );
    globalThis.fetch = fetchMock;

    const res = await getMediaPermalink({ igPostId: 'IG999', token: TOKEN });
    expect(res).toEqual({ ok: true, permalink: 'https://instagram.com/p/abc' });
  });

  it('fails when permalink missing in response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'IG999' }));
    globalThis.fetch = fetchMock;

    const res = await getMediaPermalink({ igPostId: 'IG999', token: TOKEN });
    expect(res.ok).toBe(false);
  });
});

describe('marketing/instagram-publish — graphPost/Get retry behavior reuse', () => {
  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return makeFetchResponse(429, { error: { message: 'rate limited' } });
      return makeFetchResponse(200, { id: 'OK' });
    });
    globalThis.fetch = fetchMock;

    const res = await createMediaContainer({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: 'x',
      token: TOKEN,
    });
    expect(res.ok).toBe(true);
    expect(res.containerId).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
