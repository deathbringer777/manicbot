/**
 * Upload + CDN routes for salon branding assets.
 *
 * Routes:
 *   POST /upload/asset?t=<token>&kind=<kind>   — multipart upload, returns {key, url}
 *   GET  /cdn/<key>                            — public read-through for R2 objects
 *
 * Security model:
 *   - Upload tokens are minted in the admin-app (tRPC) after verifying the caller
 *     owns the tenant; they are HMAC-SHA256 signed with UPLOAD_TOKEN_SECRET and
 *     expire in 5 minutes.
 *   - The Worker verifies the token, validates MIME/size, then writes the bytes
 *     to R2 under a content-addressed key `t/{tid}/{kind}-{sha12}.{ext}`.
 *   - CDN reads are unauthenticated and cached for 1 year (keys are hash-addressed
 *     so cache invalidation is unnecessary).
 */

import {
  verifyUploadToken,
  claimUploadNonce,
  buildAssetKey,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
} from '../services/upload.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';
import { log } from '../utils/logger.js';

const CDN_PATH_PREFIX = '/cdn/';

/**
 * P2-13 — magic-byte sniff. Confirms the file actually starts with the bytes
 * that match its declared `image/*` MIME so a polyglot (e.g. an HTML file
 * with a PNG-shaped suffix) cannot be uploaded as `image/png` and later
 * served back to a browser. Headers on the read path stop sniffing as a
 * second layer of defence.
 *
 * Signatures (8 bytes is enough for all three formats):
 *   PNG  89 50 4E 47 0D 0A 1A 0A
 *   JPEG FF D8 FF
 *   WEBP 52 49 46 46 .. .. .. .. 57 45 42 50  (RIFF....WEBP)
 *
 * @param {Uint8Array} bytes
 * @param {string} declaredMime
 * @returns {boolean} true when the magic bytes match the declared MIME.
 */
export function magicBytesMatchMime(bytes, declaredMime) {
  if (!bytes || bytes.length < 4) return false;
  if (declaredMime === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (declaredMime === 'image/jpeg' || declaredMime === 'image/jpg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (declaredMime === 'image/webp') {
    if (bytes.length < 12) return false;
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function jsonError(message, status, extra = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryUpload(request, env, url) {
  // ─── GET /cdn/<key> — public read ─────────────────────────────────────────
  if (request.method === 'GET' && url.pathname.startsWith(CDN_PATH_PREFIX)) {
    if (!env.ASSETS) return new Response('R2 not bound', { status: 500 });
    const key = decodeURIComponent(url.pathname.slice(CDN_PATH_PREFIX.length));
    if (!key || key.includes('..') || key.length > 256) {
      return new Response('Bad key', { status: 400 });
    }
    const obj = await env.ASSETS.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    // Hash-addressed keys are immutable — safe to cache aggressively.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', obj.httpEtag);
    headers.set('Access-Control-Allow-Origin', '*');
    // P2-13 — defence in depth against polyglot uploads. `nosniff` prevents
    // browsers from sniffing a PNG-with-HTML-prefix as text/html when served
    // cross-origin; `Content-Disposition: inline` keeps legitimate <img>
    // rendering working without inviting downloads with attacker-controlled
    // filenames. Magic-byte validation on the WRITE path (below) is the
    // primary defence; these headers are belt-and-braces.
    headers.set('X-Content-Type-Options', 'nosniff');
    if (!headers.has('Content-Disposition')) {
      headers.set('Content-Disposition', 'inline');
    }
    return new Response(obj.body, { headers });
  }

  // ─── CORS preflight for /upload/asset ─────────────────────────────────────
  if (request.method === 'OPTIONS' && url.pathname === '/upload/asset') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ─── POST /upload/asset — signed upload ───────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/upload/asset') {
    if (!env.ASSETS) return jsonError('R2 not bound', 500);
    if (!env.UPLOAD_TOKEN_SECRET) return jsonError('UPLOAD_TOKEN_SECRET not set', 500);

    const token = url.searchParams.get('t') || '';
    const kindParam = url.searchParams.get('kind') || '';
    const claim = await verifyUploadToken(token, env.UPLOAD_TOKEN_SECRET);
    if (!claim) return jsonError('Invalid or expired token', 401);
    if (claim.kind !== kindParam) return jsonError('Kind mismatch', 400);

    // A5 — single-use: a valid token redeems at most once. A leaked or replayed
    // token (valid HMAC, still inside its 5-min TTL) is rejected here, before
    // any file work, so a replay can't even force a multipart parse.
    const firstUse = await claimUploadNonce(env, claim.jti, claim.exp);
    if (!firstUse) return jsonError('Token already used', 409);

    let form;
    try {
      form = await request.formData();
    } catch {
      return jsonError('Invalid multipart form', 400);
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return jsonError('file field required', 400);

    const mime = file.type || '';
    const ext = ALLOWED_MIME.get(mime);
    if (!ext) return jsonError(`Unsupported content type: ${mime || 'unknown'}`, 415);

    const size = file.size || 0;
    if (size <= 0) return jsonError('Empty file', 400);
    if (size > MAX_UPLOAD_BYTES) {
      return jsonError(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // P2-13 — reject polyglots whose actual bytes don't match the declared
    // MIME. 415 (Unsupported Media Type) per the read-path semantics.
    if (!magicBytesMatchMime(bytes, mime)) {
      return jsonError(`Content does not match declared type: ${mime}`, 415);
    }

    const key = await buildAssetKey(claim.tid, claim.kind, bytes, ext);

    try {
      await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: mime } });
    } catch (e) {
      log.error('http.upload', e instanceof Error ? e : new Error(String(e?.message)), { action: 'r2_put' });
      return jsonError('Storage write failed', 500);
    }

    const publicUrl = `${url.origin}${CDN_PATH_PREFIX}${key}`;
    void logEvent(envCtx(env), 'branding.asset_uploaded', {
      tenantId: claim.tid,
      level: 'info',
      message: `${claim.kind} uploaded (${size} bytes)`,
      data: { kind: claim.kind, size, key, uid: claim.uid ?? null },
    });

    return new Response(JSON.stringify({ ok: true, key, url: publicUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  return null;
}
