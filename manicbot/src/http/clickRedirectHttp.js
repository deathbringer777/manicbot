/**
 * Public click-tracking redirect: GET /r/{token}.
 *
 * Campaign emails rewrite their links through this endpoint (see
 * services/marketing/linkRewrite.js). The flow:
 *   1. Verify the signed token (HMAC over the SIGNED destination URL — a
 *      tampered token or a forged destination fails verification → 404).
 *   2. Best-effort record the click in the marketing_link_clicks table (the
 *      attribution source for conversions), storing a salted ip_hash, never
 *      the raw IP.
 *   3. 302 to the destination, appending `?mc=<sendId>` so a downstream
 *      booking flow could read the attribution.
 *
 * Public by design — token-only, no auth. The token is never echoed back on
 * failure. Open-redirect-safe: the destination is inside the signed payload,
 * so the endpoint can only ever forward where the sender originally pointed.
 */

import { dbRun } from '../utils/db.js';
import { envCtx } from './envCtx.js';
import { log } from '../utils/logger.js';
import { verifyClickToken } from '../services/marketing/clickToken.js';

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function appendMc(url, sendId) {
  if (!sendId) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('mc', sendId);
    return u.toString();
  } catch {
    return url;
  }
}

async function hashIp(ip, salt) {
  if (!ip) return null;
  try {
    const data = new TextEncoder().encode(`${salt}:${ip}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * @param {Request} request
 * @param {string} token
 * @param {any} env
 * @param {{ waitUntil?: (p: Promise<unknown>) => void }=} executionCtx
 * @returns {Promise<Response>}
 */
export async function handleClickRedirect(request, token, env, executionCtx) {
  const secret = (env?.CLICK_TOKEN_SECRET || '').trim();
  if (!secret) return new Response('Not found', { status: 404 });

  const claims = await verifyClickToken(secret, token);
  // Reject unknown/forged/expired tokens AND any non-http(s) destination
  // (defense-in-depth even though the URL was signed).
  if (!claims || !/^https?:\/\//i.test(claims.url)) {
    return new Response('Not found', { status: 404 });
  }

  // Best-effort click log — must never block or fail the redirect.
  const recordClick = (async () => {
    try {
      const ctx = envCtx(env);
      if (!ctx?.db) return;
      const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for');
      // Domain-separate the IP-hash salt from the HMAC signing key. The same
      // CLICK_TOKEN_SECRET signs redirect tokens, so deriving the salt with a
      // distinct prefix keeps the two uses cryptographically independent rather
      // than feeding the raw signing key straight into the hash.
      const ipHash = await hashIp(ip, `ip-hash:${secret}`);
      const nowS = Math.floor(Date.now() / 1000);
      await dbRun(
        ctx,
        `INSERT INTO marketing_link_clicks (id, tenant_id, campaign_id, send_id, contact_id, url, clicked_at, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        rid('clk'), claims.tenantId, claims.campaignId, claims.sendId,
        claims.contactId, claims.url.slice(0, 2000), nowS, ipHash,
      );
      // Mirror the click onto the send row so the campaign funnel's
      // Delivered / Opened / Clicked counts reflect first-party clicks —
      // independent of Resend's open/click tracking (which needs a custom
      // tracking subdomain that prod does not run). A click necessarily
      // implies the mail was delivered AND opened, so backfill all three.
      // Without delivered_at the report rates Open/Click against delivered=0
      // and shows 0% on every tracked campaign, violating its own
      // Delivered >= Opened >= Clicked invariant. The funnel counts
      // `*_at IS NOT NULL`; `IS NULL` guards keep it idempotent and never
      // overwrite an earlier real timestamp. Status is left untouched so a
      // prior bounce/complaint is never masked. marketing_sends has no
      // tenant_id column (scoped via campaign_id); the send id is from the
      // signed token.
      if (claims.sendId) {
        await dbRun(ctx, 'UPDATE marketing_sends SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL', nowS, claims.sendId);
        await dbRun(ctx, 'UPDATE marketing_sends SET opened_at = ? WHERE id = ? AND opened_at IS NULL', nowS, claims.sendId);
        await dbRun(ctx, 'UPDATE marketing_sends SET clicked_at = ? WHERE id = ? AND clicked_at IS NULL', nowS, claims.sendId);
      }
    } catch (e) {
      log.warn('http.clickRedirect', { action: 'insert_click_failed', error: e?.message, campaignId: claims.campaignId });
    }
  })();

  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(recordClick);
  } else {
    await recordClick;
  }

  return new Response(null, {
    status: 302,
    headers: { Location: appendMc(claims.url, claims.sendId), 'Cache-Control': 'no-store' },
  });
}
