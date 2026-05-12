import { getAptByIdGlobal } from '../services/appointments.js';
import { log } from '../utils/logger.js';
import { getLang } from '../services/chat.js';
import { makeICS, verifyCalendarSig as verifyCalendarSigSubkey } from '../utils/ics.js';
import { initServices } from '../services/services.js';

const ICS_LINK_MAX_AGE_SEC = 48 * 3600; // 48 hours (reduced from 7 days)
const ICS_HMAC_MIN_KEY_LEN = 32;

// P2-15 — grace window for exp-less URLs. Mints created before this deploy
// don't carry `exp`; rather than 410 them on day one we accept them while
// `ts` is < (now - GRACE_SEC). After this deploy date + 14 days every URL
// without `exp` is 410 Gone. Set to a fixed deploy-time anchor + 14d.
const P2_15_DEPLOY_TS = 1810000000; // 2027-05-13 (deploy anchor; safe future date)
const EXP_GRACE_FROM_DEPLOY_SEC = 14 * 24 * 3600;

/**
 * Calendar-link signature verification with timestamp + expiry policy.
 *
 * Returns:
 *   { ok: true }                   — signature valid AND not expired.
 *   { ok: false, expired: true }   — signature valid BUT past `exp` (410 Gone).
 *   { ok: false }                  — signature invalid or stale ts (403 Forbidden).
 */
async function verifyCalendarSig(aptId, sig, secret, ts, exp) {
  if (!sig || !secret || secret.length < ICS_HMAC_MIN_KEY_LEN) return { ok: false };
  if (!ts) {
    // Old links without ts: refuse — used to be allowed for back-compat with
    // pre-timestamp links, but the link generator has emitted ts since 2025-Q3.
    return { ok: false };
  }
  const nowSec = Date.now() / 1000;
  const age = nowSec - Number(ts);
  if (!Number.isFinite(age) || age > ICS_LINK_MAX_AGE_SEC || age < -300) {
    return { ok: false };
  }

  const sigValid = await verifyCalendarSigSubkey(secret, aptId, ts, sig, exp);
  if (!sigValid) return { ok: false };

  // P2-15 — expiry policy.
  //
  //   * With `exp` in the URL: hard-enforce. `exp` is part of the signed
  //     payload, so an attacker can't extend it without re-signing.
  //   * Without `exp` (URLs minted pre-deploy): accept while we're inside
  //     the 14-day grace window from P2_15_DEPLOY_TS, then 410.
  if (exp) {
    const expSec = Number(exp);
    if (!Number.isFinite(expSec) || nowSec > expSec) {
      return { ok: false, expired: true };
    }
  } else if (nowSec > P2_15_DEPLOY_TS + EXP_GRACE_FROM_DEPLOY_SEC) {
    return { ok: false, expired: true };
  }
  return { ok: true };
}


/**
 * @param {Request} request
 * @param {any} ctx
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryCalendar(request, ctx, url) {
  const calMatch = request.method === 'GET' && url.pathname.match(/^\/calendar\/(.+)$/);
  if (!calMatch) return null;

  const rawId = calMatch[1];
  const aptId = rawId.endsWith('.ics') ? rawId.slice(0, -4) : rawId;
  // `a<digits>_<word>` — real appointments persisted in D1.
  // `demo_<word>`     — landing-preview synthetic appointments cached in KV
  //                     (no D1 row). HMAC signature still authenticates them.
  if (!/^(a\d+|demo)_\w+$/.test(aptId)) {
    return new Response('Invalid appointment ID', { status: 400 });
  }

  const sig = url.searchParams.get('sig') || '';
  const ts = url.searchParams.get('ts') || null;
  const exp = url.searchParams.get('exp') || null; // P2-15
  // Use BOT_ENCRYPTION_KEY exclusively — do NOT fall back to ADMIN_KEY.
  // ADMIN_KEY is an authentication secret for admin endpoints, not a crypto key.
  // Key separation (NIST SP 800-57) prevents key-reuse attacks.
  const secret = ctx.BOT_ENCRYPTION_KEY || '';
  if (!secret || secret.length < ICS_HMAC_MIN_KEY_LEN) {
    log.error('http.calendar', new Error('BOT_ENCRYPTION_KEY missing or too short — calendar links disabled'));
    return new Response('Calendar links not configured', { status: 503 });
  }
  const verifyResult = await verifyCalendarSig(aptId, sig, secret, ts, exp);
  if (!verifyResult.ok) {
    // P2-15 — distinguish expired (410 Gone) from forged/stale (403 Forbidden)
    // so calendar apps can drop the cached URL on 410 instead of retrying.
    if (verifyResult.expired) return new Response('Gone', { status: 410 });
    return new Response('Forbidden', { status: 403 });
  }

  const openInline = url.searchParams.get('open') === '1';
  const icsHeaders = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': openInline ? 'inline; filename="manicure.ics"' : 'attachment; filename="manicure.ics"',
  };

  // Demo (preview) appointments: served from a self-contained KV snapshot;
  // no DB lookup, no tenant resolution. Snapshot is written by saveApt() in
  // preview mode and TTL'd for 24h.
  if (aptId.startsWith('demo_')) {
    const gkv = ctx.globalKv || ctx.kv;
    if (!gkv || typeof gkv.get !== 'function') {
      return new Response('Service unavailable', { status: 503 });
    }
    const cached = await gkv.get(`mb_demo_apt:${aptId}`, 'json');
    if (!cached || !cached.apt || !cached.svc) {
      return new Response('Appointment not found', { status: 404 });
    }
    const synthCtx = { ...ctx, svc: [cached.svc] };
    const ics = makeICS(synthCtx, cached.apt, cached.lang || 'pl');
    if (!ics) return new Response('Error', { status: 500 });
    return new Response(ics, { headers: icsHeaders });
  }

  if (!ctx.db) return new Response('Service unavailable', { status: 503 });
  // Look up without tenant constraint — HMAC signature already authenticates
  const apt = await getAptByIdGlobal(ctx, aptId);
  if (!apt || apt.cx) {
    return new Response('Appointment not found', { status: 404 });
  }
  // Re-init services for the appointment's tenant (calendar links are cross-tenant)
  if (apt.tenantId && apt.tenantId !== ctx.tenantId) {
    ctx.tenantId = apt.tenantId;
  }
  await initServices(ctx);
  const svc = ctx.svc.find(x => x.id === apt.svcId);
  if (!svc) return new Response('Service not found', { status: 404 });

  const userLang = (await getLang(ctx, apt.chatId)) || 'ru';
  const ics = makeICS(ctx, apt, userLang);
  if (!ics) return new Response('Error', { status: 500 });
  return new Response(ics, { headers: icsHeaders });
}
