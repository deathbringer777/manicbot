/**
 * Instagram media import — fetch tenant's IG media list and download selected
 * photos to R2, inserting them into the tenant's photo album.
 *
 * Used by the two admin endpoints in adminKeyHttp.js:
 *   POST /admin/instagram/media  → fetchInstagramMedia
 *   POST /admin/instagram/import → importInstagramPhotos
 */

import { dbAll } from '../utils/db.js';
import { getDecryptedToken } from '../channels/token-manager.js';
import { graphBase, hostForToken, isTokenDead } from '../channels/graph-api.js';
import { buildAssetKey } from './upload.js';
import { envCtx } from '../http/envCtx.js';

const IG_FIELDS = 'id,media_type,media_url,thumbnail_url,timestamp,caption,permalink';
const IG_PAGE_LIMIT = 50;

// IG Graph API error code 200 = missing OAuth scope (not a 200 HTTP status!)
const IG_MISSING_SCOPE_CODE = 200;

/**
 * Fetch the tenant's Instagram media list.
 *
 * @param {object} env  Cloudflare Worker env (DB, BOT_ENCRYPTION_KEY)
 * @param {string} tenantId
 * @returns {Promise<{
 *   media: Array<{id,mediaType,mediaUrl,thumbnailUrl,timestamp,caption,permalink}>,
 *   hasMore: boolean,
 *   missingScope: boolean,
 *   notConnected?: boolean,
 *   error?: string
 * }>}
 */
export async function fetchInstagramMedia(env, tenantId) {
  const ec = envCtx(env);

  const rows = await dbAll(ec,
    `SELECT id, ig_business_id, token_encrypted
     FROM channel_configs
     WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1
     LIMIT 1`,
    tenantId,
  );
  if (!rows.length) return { media: [], hasMore: false, missingScope: false, notConnected: true };

  const row = rows[0];
  const token = await getDecryptedToken(ec, tenantId, row.id, env.BOT_ENCRYPTION_KEY);
  if (!token) return { media: [], hasMore: false, missingScope: false, error: 'token_decrypt_failed' };

  const igUserId = row.ig_business_id;
  if (!igUserId) return { media: [], hasMore: false, missingScope: false, error: 'no_ig_user_id' };

  const base = graphBase(hostForToken(token));
  const apiUrl = `${base}/${igUserId}/media?fields=${IG_FIELDS}&limit=${IG_PAGE_LIMIT}&access_token=${token}`;

  let resp;
  try {
    resp = await fetch(apiUrl, { signal: AbortSignal.timeout(12_000) });
  } catch {
    return { media: [], hasMore: false, missingScope: false, error: 'fetch_failed' };
  }

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const dead = isTokenDead(json);
    const missingScope = dead && (json?.error?.code === IG_MISSING_SCOPE_CODE);
    return { media: [], hasMore: false, missingScope, error: 'api_error' };
  }

  const items = /** @type {any[]} */ (json.data ?? []);
  const hasMore = !!(json.paging?.next);

  const media = items
    .filter(m => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM')
    .map(m => ({
      id: m.id,
      mediaType: m.media_type,
      // CAROUSEL_ALBUM has a cover; IMAGE has media_url directly
      mediaUrl: m.media_url ?? m.thumbnail_url ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp ?? null,
      caption: typeof m.caption === 'string' ? m.caption.slice(0, 200) : null,
      permalink: m.permalink ?? null,
    }))
    .filter(m => m.mediaUrl);

  return { media, hasMore, missingScope: false };
}

/**
 * Download selected IG media IDs to R2 and append them to album_photos.
 * Safe to call with the same IDs twice — R2 key is content-addressed (idempotent)
 * and the INSERT OR IGNORE guard deduplicates by photo_r2_key.
 *
 * @param {object} env             Cloudflare Worker env (DB, ASSETS, BOT_ENCRYPTION_KEY)
 * @param {string} tenantId
 * @param {string} albumId
 * @param {string[]} mediaIds      IG media IDs to import (max 50)
 * @param {string} workerOrigin    e.g. "https://manicbot.com" — prefixed to /cdn/ URL
 * @returns {Promise<{ imported: number, errors: Array<{mediaId:string,error:string}> }>}
 */
export async function importInstagramPhotos(env, tenantId, albumId, mediaIds, workerOrigin) {
  const ec = envCtx(env);

  // Verify album belongs to tenant
  const albumRow = await env.DB.prepare(
    `SELECT id FROM photo_albums WHERE tenant_id = ? AND id = ? LIMIT 1`,
  ).bind(tenantId, albumId).first();
  if (!albumRow) throw new Error('album_not_found');

  // Resolve token
  const rows = await dbAll(ec,
    `SELECT id, ig_business_id, token_encrypted
     FROM channel_configs
     WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1
     LIMIT 1`,
    tenantId,
  );
  if (!rows.length) throw new Error('instagram_not_connected');

  const row = rows[0];
  const token = await getDecryptedToken(ec, tenantId, row.id, env.BOT_ENCRYPTION_KEY);
  if (!token) throw new Error('token_decrypt_failed');

  const base = graphBase(hostForToken(token));

  // Current max sort_order so new photos append after existing ones
  const maxRes = await env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM album_photos WHERE tenant_id = ? AND album_id = ?`,
  ).bind(tenantId, albumId).first();
  let nextOrder = Number(maxRes?.m ?? -1) + 1;

  let imported = 0;
  const errors = [];
  const now = Math.floor(Date.now() / 1000);

  for (const mediaId of mediaIds.slice(0, 50)) {
    try {
      // Re-fetch to get a fresh (non-expired) media_url from the API
      const detailUrl = `${base}/${mediaId}?fields=media_type,media_url,thumbnail_url&access_token=${token}`;
      const detailResp = await fetch(detailUrl, { signal: AbortSignal.timeout(12_000) });
      if (!detailResp.ok) { errors.push({ mediaId, error: 'api_detail_error' }); continue; }

      const detail = await detailResp.json().catch(() => null);
      if (!detail) { errors.push({ mediaId, error: 'parse_error' }); continue; }

      // Videos: fall back to thumbnail_url (a still frame)
      const imageUrl = detail.media_type === 'VIDEO'
        ? detail.thumbnail_url
        : (detail.media_url ?? detail.thumbnail_url);
      if (!imageUrl) { errors.push({ mediaId, error: 'no_url' }); continue; }

      // Download from Instagram CDN (short-lived URL — must happen now)
      const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!imgResp.ok) { errors.push({ mediaId, error: 'download_failed' }); continue; }

      const bytes = new Uint8Array(await imgResp.arrayBuffer());
      if (bytes.length === 0) { errors.push({ mediaId, error: 'empty_file' }); continue; }

      // Infer format from content-type header
      const mime = imgResp.headers.get('content-type') ?? 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const contentType = mime.includes('png') ? 'image/png' : mime.includes('webp') ? 'image/webp' : 'image/jpeg';

      // Content-addressed R2 key — same bytes → same key → idempotent
      const key = await buildAssetKey(tenantId, 'portfolio', bytes, ext);
      await env.ASSETS.put(key, bytes, { httpMetadata: { contentType } });

      const photoUrl = `${workerOrigin}/cdn/${key}`;
      const photoId = `ap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

      // INSERT OR IGNORE: duplicate key from a re-import silently skipped
      await env.DB.prepare(
        `INSERT OR IGNORE INTO album_photos
           (tenant_id, album_id, id, photo_url, photo_r2_key, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(tenantId, albumId, photoId, photoUrl, key, nextOrder, now).run();

      nextOrder++;
      imported++;
    } catch (e) {
      errors.push({ mediaId, error: e?.message ?? 'unknown' });
    }
  }

  // Sync album cover if it's still empty
  if (imported > 0) {
    const cover = await env.DB.prepare(
      `SELECT cover_url FROM photo_albums WHERE tenant_id = ? AND id = ?`,
    ).bind(tenantId, albumId).first();
    if (!cover?.cover_url) {
      const first = await env.DB.prepare(
        `SELECT photo_url FROM album_photos WHERE tenant_id = ? AND album_id = ?
         ORDER BY sort_order ASC LIMIT 1`,
      ).bind(tenantId, albumId).first();
      if (first?.photo_url) {
        await env.DB.prepare(
          `UPDATE photo_albums SET cover_url = ? WHERE tenant_id = ? AND id = ?`,
        ).bind(first.photo_url, tenantId, albumId).run();
      }
    }
  }

  return { imported, errors };
}
