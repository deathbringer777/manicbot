import { getAptByIdGlobal } from '../services/appointments.js';
import { log } from '../utils/logger.js';
import { getLang } from '../services/chat.js';
import { makeICS, verifyCalendarSig as verifyCalendarSigSubkey } from '../utils/ics.js';
import { initServices } from '../services/services.js';

const ICS_LINK_MAX_AGE_SEC = 48 * 3600; // 48 hours (reduced from 7 days)
const ICS_HMAC_MIN_KEY_LEN = 32;

/**
 * Verify a calendar link signature with timestamp freshness check.
 * Delegates the actual HMAC math to ics.js (which handles HKDF subkey + legacy
 * raw-key fallback during the rotation grace window). This wrapper layers in
 * the timestamp age check, which is a presentation-tier policy not a crypto one.
 */
async function verifyCalendarSig(aptId, sig, secret, ts) {
  if (!sig || !secret || secret.length < ICS_HMAC_MIN_KEY_LEN) return false;
  if (ts) {
    const age = Date.now() / 1000 - Number(ts);
    if (!Number.isFinite(age) || age > ICS_LINK_MAX_AGE_SEC || age < -300) return false;
  } else {
    // Old links without ts: refuse — used to be allowed for back-compat with
    // pre-timestamp links, but the link generator has emitted ts since 2025-Q3.
    return false;
  }
  return verifyCalendarSigSubkey(secret, aptId, ts, sig);
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
  if (!/^a\d+_\w+$/.test(aptId)) {
    return new Response('Invalid appointment ID', { status: 400 });
  }

  const sig = url.searchParams.get('sig') || '';
  const ts = url.searchParams.get('ts') || null;
  // Use BOT_ENCRYPTION_KEY exclusively — do NOT fall back to ADMIN_KEY.
  // ADMIN_KEY is an authentication secret for admin endpoints, not a crypto key.
  // Key separation (NIST SP 800-57) prevents key-reuse attacks.
  const secret = ctx.BOT_ENCRYPTION_KEY || '';
  if (!secret || secret.length < ICS_HMAC_MIN_KEY_LEN) {
    log.error('http.calendar', new Error('BOT_ENCRYPTION_KEY missing or too short — calendar links disabled'));
    return new Response('Calendar links not configured', { status: 503 });
  }
  if (!await verifyCalendarSig(aptId, sig, secret, ts)) {
    return new Response('Forbidden', { status: 403 });
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
  const openInline = url.searchParams.get('open') === '1';
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': openInline ? 'inline; filename="manicure.ics"' : 'attachment; filename="manicure.ics"',
    },
  });
}
