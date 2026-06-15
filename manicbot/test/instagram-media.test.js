/**
 * Worker-level tests for the Instagram media import service
 * (src/services/instagram-media.js).
 *
 * The admin-app `salon-albums.test.ts` covers only the tRPC proxy layer; these
 * pin the Worker code that actually talks to the IG Graph API and writes to
 * R2 + D1 — fetchInstagramMedia (media listing, scope/error handling) and
 * importInstagramPhotos (download → R2 → album_photos, idempotency, cover sync).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';

// token-manager does real AES decryption; stub it so tests control the token.
vi.mock('../src/channels/token-manager.js', () => ({
  getDecryptedToken: vi.fn(),
}));

import { fetchInstagramMedia, importInstagramPhotos } from '../src/services/instagram-media.js';
import { getDecryptedToken } from '../src/channels/token-manager.js';

const TENANT = 't_ig';
const ALBUM = 'alb_1';
const ORIGIN = 'https://manicbot.com';

function makeEnv(db) {
  const r2 = new Map();
  const env = {
    DB: db,
    MANICBOT: null,
    BOT_ENCRYPTION_KEY: 'k'.repeat(32),
    ASSETS: {
      put: vi.fn(async (key, bytes) => { r2.set(key, bytes); }),
    },
  };
  return { env, r2 };
}

function seedIgChannel(db, { active = 1, igUserId = 'ig_user_1' } = {}) {
  db._getTable('channel_configs').push({
    id: 'cc_ig', tenant_id: TENANT, channel_type: 'instagram',
    active, ig_business_id: igUserId, token_encrypted: 'enc',
  });
}

function seedAlbum(db, { cover_url = null } = {}) {
  db._getTable('photo_albums').push({
    tenant_id: TENANT, id: ALBUM, name: 'Portfolio',
    cover_url, sort_order: 0, created_at: 1,
  });
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Route IG Graph "media detail" + CDN-download fetches from a fixture map.
 *   { m1: { media_url, bytes?, contentType?, media_type?, detailStatus?, downloadStatus? } }
 */
function installImportFetch(byId) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    const detail = u.match(/\/([^/?]+)\?fields=media_type/);
    if (detail) {
      const d = byId[detail[1]];
      if (!d || d.detailStatus) return json(d?.detailStatus ?? 404, { error: {} });
      return json(200, {
        media_type: d.media_type ?? 'IMAGE',
        media_url: d.media_url,
        thumbnail_url: d.thumbnail_url,
      });
    }
    for (const d of Object.values(byId)) {
      const dl = d.media_url ?? d.thumbnail_url;
      if (dl && u === dl) {
        if (d.downloadStatus) return new Response('err', { status: d.downloadStatus });
        const bytes = d.bytes ?? new Uint8Array([1, 2, 3]);
        return new Response(bytes, { status: 200, headers: { 'content-type': d.contentType ?? 'image/jpeg' } });
      }
    }
    throw new Error('unexpected fetch ' + u);
  });
}

beforeEach(() => getDecryptedToken.mockReset());
afterEach(() => vi.restoreAllMocks());

// ─── fetchInstagramMedia ─────────────────────────────────────────────────────

describe('fetchInstagramMedia', () => {
  it('returns notConnected when the tenant has no active IG channel', async () => {
    const { env } = makeEnv(createMockD1());
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res).toEqual({ media: [], hasMore: false, missingScope: false, notConnected: true });
  });

  it('returns token_decrypt_failed when the token cannot be decrypted', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    getDecryptedToken.mockResolvedValue(null);
    const { env } = makeEnv(db);
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res.error).toBe('token_decrypt_failed');
  });

  it('returns no_ig_user_id when the channel has no ig_business_id', async () => {
    const db = createMockD1();
    seedIgChannel(db, { igUserId: null });
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res.error).toBe('no_ig_user_id');
  });

  it('maps IMAGE + CAROUSEL_ALBUM media, drops videos/url-less, reports hasMore', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {
      data: [
        { id: 'm1', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg', caption: 'hi', permalink: 'p1' },
        { id: 'm2', media_type: 'CAROUSEL_ALBUM', thumbnail_url: 'https://cdn/2.jpg' },
        { id: 'm3', media_type: 'VIDEO', media_url: 'https://cdn/3.mp4' },
        { id: 'm4', media_type: 'IMAGE' },
      ],
      paging: { next: 'https://next' },
    }));
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res.hasMore).toBe(true);
    expect(res.media.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(res.media[0].mediaUrl).toBe('https://cdn/1.jpg');
    expect(res.media[1].mediaUrl).toBe('https://cdn/2.jpg');
  });

  it('flags missingScope on Graph error code 200', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(400, { error: { code: 200, message: 'no scope' } }));
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res.missingScope).toBe(true);
    expect(res.error).toBe('api_error');
  });

  it('returns fetch_failed when the network call throws', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await fetchInstagramMedia(env, TENANT);
    expect(res.error).toBe('fetch_failed');
  });
});

// ─── importInstagramPhotos ───────────────────────────────────────────────────

describe('importInstagramPhotos', () => {
  it('throws album_not_found when the album is not the tenant\'s', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    await expect(importInstagramPhotos(env, TENANT, 'nope', ['m1'], ORIGIN))
      .rejects.toThrow('album_not_found');
  });

  it('throws instagram_not_connected when no IG channel exists', async () => {
    const db = createMockD1();
    seedAlbum(db);
    const { env } = makeEnv(db);
    await expect(importInstagramPhotos(env, TENANT, ALBUM, ['m1'], ORIGIN))
      .rejects.toThrow('instagram_not_connected');
  });

  it('downloads selected media to R2, inserts rows, and sets an empty cover', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    seedAlbum(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env, r2 } = makeEnv(db);
    installImportFetch({
      m1: { media_url: 'https://cdn/m1.jpg', bytes: new Uint8Array([1, 1, 1]) },
      m2: { media_url: 'https://cdn/m2.jpg', bytes: new Uint8Array([2, 2, 2]) },
    });
    const res = await importInstagramPhotos(env, TENANT, ALBUM, ['m1', 'm2'], ORIGIN);
    expect(res.imported).toBe(2);
    expect(res.errors).toEqual([]);
    expect(db._getTable('album_photos')).toHaveLength(2);
    expect(env.ASSETS.put).toHaveBeenCalledTimes(2);
    expect(r2.size).toBe(2);
    expect(db._getTable('photo_albums')[0].cover_url).toMatch(/^https:\/\/manicbot\.com\/cdn\//);
  });

  it('is idempotent — re-importing the same media adds no duplicate rows', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    seedAlbum(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    installImportFetch({
      m1: { media_url: 'https://cdn/m1.jpg', bytes: new Uint8Array([1, 1, 1]) },
      m2: { media_url: 'https://cdn/m2.jpg', bytes: new Uint8Array([2, 2, 2]) },
    });
    await importInstagramPhotos(env, TENANT, ALBUM, ['m1', 'm2'], ORIGIN);
    const second = await importInstagramPhotos(env, TENANT, ALBUM, ['m1', 'm2'], ORIGIN);
    expect(second.imported).toBe(0);
    expect(db._getTable('album_photos')).toHaveLength(2);
  });

  it('records per-media errors without aborting the batch', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    seedAlbum(db);
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    installImportFetch({
      m1: { media_url: 'https://cdn/m1.jpg', bytes: new Uint8Array([1, 1, 1]) },
      m2: { detailStatus: 500 },
      m3: { media_url: 'https://cdn/m3.jpg', downloadStatus: 404 },
    });
    const res = await importInstagramPhotos(env, TENANT, ALBUM, ['m1', 'm2', 'm3'], ORIGIN);
    expect(res.imported).toBe(1);
    expect(res.errors.map(e => e.mediaId).sort()).toEqual(['m2', 'm3']);
    expect(db._getTable('album_photos')).toHaveLength(1);
  });

  it('leaves an existing cover untouched', async () => {
    const db = createMockD1();
    seedIgChannel(db);
    seedAlbum(db, { cover_url: 'https://manicbot.com/cdn/existing.jpg' });
    getDecryptedToken.mockResolvedValue('tok');
    const { env } = makeEnv(db);
    installImportFetch({ m1: { media_url: 'https://cdn/m1.jpg', bytes: new Uint8Array([9, 9, 9]) } });
    await importInstagramPhotos(env, TENANT, ALBUM, ['m1'], ORIGIN);
    expect(db._getTable('photo_albums')[0].cover_url).toBe('https://manicbot.com/cdn/existing.jpg');
  });
});
