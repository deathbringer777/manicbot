import { getAptByIdGlobal } from '../services/appointments.js';
import { getLang } from '../services/chat.js';
import { makeICS } from '../utils/ics.js';
import { initServices } from '../services/services.js';

const ICS_LINK_MAX_AGE_SEC = 48 * 3600; // 48 hours (reduced from 7 days)
const ICS_HMAC_MIN_KEY_LEN = 32;

async function verifyCalendarSig(aptId, sig, secret, ts) {
  // Refuse to validate without a strong key — prevents HMAC over empty/short secret
  // which would allow forging valid signatures for any appointment ID.
  if (!sig || !secret || secret.length < ICS_HMAC_MIN_KEY_LEN) return false;
  // If timestamp provided, reject links older than max age
  if (ts) {
    const age = Date.now() / 1000 - Number(ts);
    if (!Number.isFinite(age) || age > ICS_LINK_MAX_AGE_SEC || age < -300) return false;
  }
  const payload = ts ? `${aptId}:${ts}` : aptId; // backward compat: old links have no ts
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
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
    console.error('[calendar] BOT_ENCRYPTION_KEY missing or too short — calendar links disabled');
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
