/**
 * messagingHttp — the server-to-server seam for the System & Seasonal Messaging
 * service's ThinkPad tier. The ThinkPad crons (holidays-sync, content-plan-builder,
 * preset-generator) and the tg-bot approval surface cannot hold a NextAuth
 * session, so they reach the shared D1 through these Worker endpoints instead of
 * writing the database directly (the Worker owns the binding).
 *
 * Auth: Bearer MESSAGING_TOKEN — a NEW low-privilege secret that can ONLY touch
 * the messaging tables (templates / holidays / campaign drafts / promo mint),
 * never any other admin operation (mirrors the NOTIFY_TOKEN split). ADMIN_KEY is
 * accepted as a superuser fallback. Constant-time compare; no token in query.
 *
 * Everything written here lands as DRAFT and is inert until an operator approves
 * (here or in the Broadcasts UI) AND the global MESSAGING_SEND_ENABLED flag is on.
 */

import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { envCtx } from './envCtx.js';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { ulid } from '../utils/ulid.js';
import { mintSeasonalPromo } from '../billing/promoCodes.js';

const MAX_BODY_LEN = 8000;
const MAX_ROWS = 500;

/** Bearer MESSAGING_TOKEN (or ADMIN_KEY) — constant-time. */
function isMessagingAuthValid(env, request) {
  const authHeader = request?.headers?.get?.('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const presented = authHeader.slice(7);
  if (env.MESSAGING_TOKEN && timingSafeEqual(presented, env.MESSAGING_TOKEN)) return true;
  if (env.ADMIN_KEY && timingSafeEqual(presented, env.ADMIN_KEY)) return true;
  return false;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Strip control chars and cap length — light guard on generated/remote text. */
function clean(s, max = MAX_BODY_LEN) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, max);
}

/** Recursively clean every string value in a per-channel bodies object. */
function cleanBodies(bodies) {
  if (!bodies || typeof bodies !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(bodies)) {
    if (typeof v === 'string') out[k] = clean(v);
    else if (v && typeof v === 'object') out[k] = cleanBodies(v);
  }
  return out;
}

// ── Endpoint handlers ────────────────────────────────────────────────────────

async function handleHolidaysUpsert(ctx, body) {
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  let upserted = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    if (!r?.date || !r?.occasion_key) continue;
    const existing = await dbGet(
      ctx, 'SELECT id FROM holiday_calendar WHERE occasion_key = ? AND date = ? LIMIT 1', r.occasion_key, r.date,
    ).catch(() => null);
    if (existing?.id) {
      await dbRun(
        ctx,
        'UPDATE holiday_calendar SET country = ?, name_pl = ?, name_ru = ?, name_uk = ?, name_en = ?, type = ?, recurrence_json = ?, updated_at = ? WHERE id = ?',
        r.country || 'PL', clean(r.name_pl, 200), clean(r.name_ru, 200), clean(r.name_uk, 200), clean(r.name_en, 200),
        r.type || 'observance', r.recurrence ? JSON.stringify(r.recurrence) : null, nowSec, existing.id,
      ).catch(() => {});
    } else {
      await dbRun(
        ctx,
        `INSERT INTO holiday_calendar (id, date, country, occasion_key, name_pl, name_ru, name_uk, name_en, type, recurrence_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `hol_${ulid()}`, r.date, r.country || 'PL', r.occasion_key,
        clean(r.name_pl, 200), clean(r.name_ru, 200), clean(r.name_uk, 200), clean(r.name_en, 200),
        r.type || 'observance', r.recurrence ? JSON.stringify(r.recurrence) : null, nowSec, nowSec,
      ).catch(() => {});
    }
    upserted += 1;
  }
  return json({ ok: true, upserted });
}

async function handleTemplateDraft(ctx, body) {
  const { template_key, locale, name, category, channels, bodies, variables } = body || {};
  if (!template_key || !locale) return json({ ok: false, error: 'template_key_and_locale_required' }, 400);
  const nowSec = Math.floor(Date.now() / 1000);
  const cleanedBodies = JSON.stringify(cleanBodies(bodies));
  const existing = await dbGet(
    ctx,
    // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100) — operator template library, not tenant data.
    'SELECT id FROM platform_message_templates WHERE template_key = ? AND locale = ? LIMIT 1', template_key, locale,
  ).catch(() => null);
  if (existing?.id) {
    // Never silently downgrade an approved/builtin row to draft via the seam.
    await dbRun(
      ctx,
      // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
      'UPDATE platform_message_templates SET name = ?, category = ?, channels_json = ?, bodies_json = ?, variables_json = ?, updated_at = ? WHERE id = ? AND is_builtin = 0',
      clean(name, 200) || template_key, clean(category, 60) || 'seasonal',
      JSON.stringify(Array.isArray(channels) ? channels : ['center']), cleanedBodies,
      variables ? JSON.stringify(variables) : null, nowSec, existing.id,
    ).catch(() => {});
    return json({ ok: true, id: existing.id, updated: true });
  }
  const id = `pmt_${ulid()}`;
  await dbRun(
    ctx,
    // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
    `INSERT INTO platform_message_templates (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?)`,
    id, clean(name, 200) || template_key, clean(category, 60) || 'seasonal',
    JSON.stringify(Array.isArray(channels) ? channels : ['center']), cleanedBodies, locale,
    template_key, variables ? JSON.stringify(variables) : null, nowSec, nowSec,
  ).catch(() => {});
  return json({ ok: true, id, created: true });
}

async function handleCampaignDraft(ctx, body) {
  const { occasion_key, template_key, title, bodies, channels, audience, scheduled_at, year } = body || {};
  if (!occasion_key) return json({ ok: false, error: 'occasion_key_required' }, 400);
  const nowSec = Math.floor(Date.now() / 1000);

  // Idempotent per (occasion_key, year): one draft seasonal campaign per occasion
  // per year. The ThinkPad builder re-runs daily; this stops it spawning rows.
  const yr = Number(year) || new Date((scheduled_at || nowSec) * 1000).getUTCFullYear();
  const existing = await dbAll(
    ctx, 'SELECT id, scheduled_at FROM platform_campaigns WHERE occasion_key = ?', occasion_key,
  ).catch(() => []);
  for (const c of existing || []) {
    const cYear = c.scheduled_at ? new Date(c.scheduled_at * 1000).getUTCFullYear() : null;
    if (cYear === yr) return json({ ok: true, id: c.id, deduped: true });
  }

  const id = `pc_${ulid()}`;
  await dbRun(
    ctx,
    `INSERT INTO platform_campaigns
       (id, kind, title, body, bodies_json, audience_filter_json, channels_json, schedule_kind, scheduled_at, status, occasion_key, template_key, created_by, created_at, updated_at)
     VALUES (?, 'announcement', ?, ?, ?, ?, ?, 'once', ?, 'draft', ?, ?, 'thinkpad', ?, ?)`,
    id, clean(title, 200) || occasion_key, clean(bodies?.center, MAX_BODY_LEN),
    JSON.stringify(cleanBodies(bodies)), audience ? JSON.stringify(audience) : null,
    JSON.stringify(Array.isArray(channels) ? channels : ['center', 'bell']),
    scheduled_at || null, occasion_key, template_key || null, nowSec, nowSec,
  ).catch(() => {});
  return json({ ok: true, id, created: true });
}

async function handleApprove(ctx, body) {
  const { id, status } = body || {};
  const allowed = new Set(['active', 'scheduled', 'paused', 'skipped']);
  if (!id || !allowed.has(status)) return json({ ok: false, error: 'invalid_id_or_status' }, 400);
  const nowSec = Math.floor(Date.now() / 1000);
  // 'skipped' maps to 'done' (one-shot finalized without sending).
  const dbStatus = status === 'skipped' ? 'done' : status;
  // Approving to active/scheduled makes the campaign visible to the dispatch
  // scan immediately (next_run_at = now).
  const nextRun = (dbStatus === 'active' || dbStatus === 'scheduled') ? nowSec : null;
  await dbRun(
    ctx,
    'UPDATE platform_campaigns SET status = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    dbStatus, nextRun, nowSec, id,
  ).catch(() => {});
  return json({ ok: true, id, status: dbStatus });
}

async function handleListDrafts(ctx) {
  const campaigns = await dbAll(
    ctx,
    "SELECT id, kind, title, occasion_key, template_key, scheduled_at, status FROM platform_campaigns WHERE status = 'draft' ORDER BY created_at DESC LIMIT 100",
  ).catch(() => []);
  const templates = await dbAll(
    ctx,
    // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
    "SELECT id, name, template_key, locale, category, status FROM platform_message_templates WHERE status = 'draft' ORDER BY created_at DESC LIMIT 100",
  ).catch(() => []);
  return json({ ok: true, campaigns: campaigns || [], templates: templates || [] });
}

async function handlePromoMint(ctx, body) {
  const { campaign_id, code, percent_off, duration, duration_months, expires_days, max_redemptions, created_by } = body || {};
  const expiresAt = Number.isInteger(expires_days) && expires_days > 0
    ? Math.floor(Date.now() / 1000) + expires_days * 86400
    : null;
  const res = await mintSeasonalPromo(ctx, {
    code: clean(code, 40),
    percentOff: Number(percent_off),
    duration: duration || 'once',
    durationMonths: duration_months ?? null,
    expiresAt,
    maxRedemptions: max_redemptions ?? null,
    campaignId: campaign_id || null,
    createdBy: created_by || 'thinkpad',
  });
  if (res.error) return json({ ok: false, error: res.error }, 400);
  return json({ ok: true, promo: { code: res.data.code, expires_at: res.data.expires_at, livemode: res.data.livemode } });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>} null when the path is not a messaging route.
 */
export async function tryMessagingRoutes(request, env, url) {
  if (!url.pathname.startsWith('/admin/messaging/')) return null;
  if (!isMessagingAuthValid(env, request)) return new Response('Forbidden', { status: 403 });

  const ctx = envCtx(env);
  if (!ctx.db) return json({ ok: false, error: 'db_unavailable' }, 503);

  const route = url.pathname.slice('/admin/messaging/'.length);

  try {
    if (request.method === 'GET' && route === 'drafts') {
      return await handleListDrafts(ctx);
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const body = await request.json().catch(() => ({}));
    switch (route) {
      case 'holidays-upsert': return await handleHolidaysUpsert(ctx, body);
      case 'template-draft': return await handleTemplateDraft(ctx, body);
      case 'campaign-draft': return await handleCampaignDraft(ctx, body);
      case 'approve': return await handleApprove(ctx, body);
      case 'promo-mint': return await handlePromoMint(ctx, body);
      default: return new Response('Not Found', { status: 404 });
    }
  } catch (e) {
    log.error('messaging.http', e instanceof Error ? e : new Error(String(e?.message)), { route });
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
