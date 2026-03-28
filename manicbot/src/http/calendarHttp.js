import { getAptById } from '../services/appointments.js';
import { getLang } from '../services/chat.js';
import { makeICS } from '../utils/ics.js';
import { initServices } from '../services/services.js';

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
