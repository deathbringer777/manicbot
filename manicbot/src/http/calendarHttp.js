import { getAptById } from '../services/appointments.js';
import { getLang } from '../services/chat.js';
import { makeICS } from '../utils/ics.js';
import { initServices } from '../services/services.js';

const ICS_LINK_MAX_AGE_SEC = 7 * 24 * 3600; // 7 days

async function verifyCalendarSig(aptId, sig, secret, ts) {
  if (!sig || !secret) return false;
  // If timestamp provided, reject links older than 7 days
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
  const secret = ctx.BOT_ENCRYPTION_KEY || ctx.ADMIN_KEY || '';
  if (!await verifyCalendarSig(aptId, sig, secret, ts)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!ctx.db) return new Response('Service unavailable', { status: 503 });
  await initServices(ctx);
  const apt = await getAptById(ctx, aptId);
  if (!apt || apt.cx) {
    return new Response('Appointment not found', { status: 404 });
  }
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
