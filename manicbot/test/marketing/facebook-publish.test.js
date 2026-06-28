import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPhotoPost, getFbPostPermalink } from '../../src/channels/facebook-publish.js';

const PAGE_ID = '1008301152373103';
const TOKEN = 'EAA-test-token'; // EAA prefix → graph.facebook.com host
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marketing/facebook-publish — createPhotoPost', () => {
  it('POSTs to /{pageId}/photos with url + caption + published, returns post_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { id: 'PHOTO1', post_id: '1008_999' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPhotoPost({
      pageId: PAGE_ID,
      imageUrl: IMAGE_URL,
      caption: CAPTION,
      token: TOKEN,
    });

    expect(res).toEqual({ ok: true, postId: '1008_999' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PAGE_ID}/photos`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body);
    expect(body.url).toBe(IMAGE_URL);
    expect(body.caption).toBe(CAPTION);
    expect(body.published).toBe(true);
  });

  it('falls back to id when post_id absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'PHOTO_ONLY' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPhotoPost({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: 'x', token: TOKEN });
    expect(res).toEqual({ ok: true, postId: 'PHOTO_ONLY' });
  });

  it('rejects missing pageId/imageUrl/token without calling Meta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r1 = await createPhotoPost({ pageId: '', imageUrl: IMAGE_URL, caption: '', token: TOKEN });
    const r2 = await createPhotoPost({ pageId: PAGE_ID, imageUrl: '', caption: '', token: TOKEN });
    const r3 = await createPhotoPost({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: '', token: '' });

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces token-dead from Meta error (code 190)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(401, { error: { code: 190, type: 'OAuthException', message: 'invalid token' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPhotoPost({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: 'x', token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.tokenDead).toBe(true);
    expect(res.status).toBe(401);
  });

  it('returns ok:false when Meta omits id and post_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { weird: 'shape' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPhotoPost({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: 'x', token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no id/);
  });

  it('retries on 429 then succeeds (reuses graphPost backoff)', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return makeFetchResponse(429, { error: { message: 'rate limited' } });
      return makeFetchResponse(200, { id: 'P', post_id: 'OK' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPhotoPost({ pageId: PAGE_ID, imageUrl: IMAGE_URL, caption: 'x', token: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.postId).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('marketing/facebook-publish — getFbPostPermalink', () => {
  it('GETs /{postId}?fields=permalink_url and returns permalink', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(200, { permalink_url: 'https://www.facebook.com/1008/posts/999' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await getFbPostPermalink({ postId: '1008_999', token: TOKEN });
    expect(res).toEqual({ ok: true, permalink: 'https://www.facebook.com/1008/posts/999' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/1008_999');
    expect(url).toContain('fields=permalink_url');
    expect(init.method).toBe('GET');
  });

  it('fails when permalink_url missing in response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: '1008_999' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await getFbPostPermalink({ postId: '1008_999', token: TOKEN });
    expect(res.ok).toBe(false);
  });

  it('rejects missing inputs', async () => {
    const r1 = await getFbPostPermalink({ postId: '', token: TOKEN });
    const r2 = await getFbPostPermalink({ postId: 'X', token: '' });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
});
