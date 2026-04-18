/**
 * @fileoverview Public HTTP routes for landing-page lead capture.
 *
 *   POST /api/leads              — structured lead form
 *   POST /api/email-subscribe    — newsletter email collector
 *
 * Both are rate-limited per-IP (D1 rate_limits) to prevent spam bots.
 * Honeypot `company_name_hp` silently accepted-then-discarded.
 */

import { dbRun } from '../utils/db.js';
import { envCtx } from './envCtx.js';
import { checkAndIncrement } from '../utils/rateLimit.js';
import { logEvent } from '../utils/events.js';
import { notifyAdminNewLead } from '../utils/notifyAdmin.js';

const ALLOWED_SALON_TYPES = new Set(['nail', 'beauty', 'cosmetology', 'barber', 'other']);
const ALLOWED_LOCALES = new Set(['ru', 'uk', 'ua', 'en', 'pl']);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders,
    },
  });
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function tryLeadRoutes(request, env, url) {
  if (request.method === 'OPTIONS' && (url.pathname === '/api/leads' || url.pathname === '/api/email-subscribe')) {
    return json({ ok: true });
  }

  // ── /api/leads ──
  if (request.method === 'POST' && url.pathname === '/api/leads') {
    if (!env.DB) return json({ error: 'db_unbound' }, 500);
    const ec = envCtx(env);
    const ip = clientIp(request);

    // Rate limit: 30 leads per hour per IP (generous — real users may
    // re-submit, and we want every submission to land as a separate lead row)
    const rl = await checkAndIncrement(ec, `lead-form:${ip}`, 'post', 30, 3600);
    if (rl.limited) return json({ error: 'rate_limited' }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

    // Honeypot
    if (body.company_name_hp && String(body.company_name_hp).trim()) {
      return json({ ok: true }); // silently accept bots
    }

    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const salonTypeRaw = String(body.salon_type || 'other').trim();
    const salonType = ALLOWED_SALON_TYPES.has(salonTypeRaw) ? salonTypeRaw : 'other';
    const mastersCount = Number.isFinite(+body.masters_count) && +body.masters_count >= 0 ? Math.min(500, Math.floor(+body.masters_count)) : null;
    const note = String(body.note || '').trim().slice(0, 500);

    if (name.length < 2 || !email.includes('@') || phone.length < 6) {
      return json({ error: 'invalid_fields' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      await dbRun(ec, `
        INSERT INTO leads (name, email, phone, salon_type, masters_count, note, source, ip, user_agent, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `,
        name, email, phone, salonType, mastersCount, note || null,
        'landing', ip,
        (request.headers.get('user-agent') || '').slice(0, 300),
        now,
      );
      await dbRun(ec, `
        INSERT INTO marketing_contacts (email, name, phone, source, first_seen_at, last_seen_at, lead_count)
        VALUES (?, ?, ?, 'landing', ?, ?, 1)
        ON CONFLICT(email) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          last_seen_at = excluded.last_seen_at,
          lead_count = marketing_contacts.lead_count + 1
      `, email, name, phone, now, now).catch((e) => console.error('[leads] contacts upsert failed:', e?.message));
      void logEvent(ec, 'lead.received', {
        level: 'info',
        message: `New lead: ${email}`,
        data: { name, email, salonType, mastersCount, ip },
      });
      await notifyAdminNewLead(env, {
        name, email, phone,
        salon_type: salonType,
        masters_count: mastersCount,
        note,
        source: 'landing',
        ip,
      }).catch((e) => console.error('[leads] notify failed:', e?.message));
    } catch (e) {
      console.error('[leads] insert failed:', e?.message);
      return json({ error: 'db_error' }, 500);
    }
    return json({ ok: true });
  }

  // ── /api/email-subscribe ──
  if (request.method === 'POST' && url.pathname === '/api/email-subscribe') {
    if (!env.DB) return json({ error: 'db_unbound' }, 500);
    const ec = envCtx(env);
    const ip = clientIp(request);

    const rl = await checkAndIncrement(ec, `newsletter:${ip}`, 'post', 5, 3600);
    if (rl.limited) return json({ error: 'rate_limited' }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const localeRaw = String(body.locale || 'ru').trim();
    const locale = ALLOWED_LOCALES.has(localeRaw) ? localeRaw : 'ru';

    if (!email.includes('@') || email.length < 5) return json({ error: 'invalid_email' }, 400);

    const now = Math.floor(Date.now() / 1000);
    try {
      await dbRun(ec, `
        INSERT INTO email_subscribers (email, locale, confirmed, created_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(email) DO UPDATE SET locale = excluded.locale
      `, email, locale, now);
    } catch (e) {
      console.error('[newsletter] insert failed:', e?.message);
      return json({ error: 'db_error' }, 500);
    }
    return json({ ok: true });
  }

  return null;
}
