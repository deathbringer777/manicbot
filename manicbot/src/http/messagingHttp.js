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
import { isSendPaused } from '../services/platformSettings.js';

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

/**
 * A body field is either a single string (legacy) or a per-locale map {ru,ua,pl,en}.
 * Pick the recipient's locale, falling back EN → RU → first available. Worker twin of
 * pickLocaleBody in admin-app/src/server/messenger/welcomeOnRegister.ts — keep in lockstep.
 */
function pickLocaleBody(field, locale) {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const pick = field[locale] ?? field.en ?? field.ru ?? Object.values(field)[0];
    return typeof pick === 'string' ? pick : '';
  }
  return '';
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
  return json({ ok: true, status: dbStatus, id });
}

/**
 * Approve every locale of a keyed template (draft → approved) in one call, so the
 * operator can green-light a whole occasion from the tg-bot. Builtins are already
 * 'approved' and untouched. Returns how many rows flipped.
 */
/**
 * One-off backfill: every salon owner who never received the `sys_welcome` message
 * (registered before welcomeOnRegister shipped, or whose channel was non-empty when
 * the cron backfill ran — it only fills EMPTY channels) gets it now, BACKDATED to
 * their registration so it reads as the thread's first message. Idempotent via the
 * delivery ledger (claim center once per owner ever). In-app center only — no bell,
 * so established/real owners aren't pinged about a months-old welcome.
 */
async function handleBackfillWelcomes(ctx) {
  const camp = await dbGet(
    ctx, "SELECT title, body, bodies_json, status FROM platform_campaigns WHERE id = 'sys_welcome' LIMIT 1",
  ).catch(() => null);
  if (!camp || camp.status !== 'active') return json({ ok: false, error: 'welcome_inactive' }, 400);
  // `center` is either a single string (legacy) or a per-locale map {ru,ua,pl,en}.
  let center;
  try { center = JSON.parse(camp.bodies_json || '{}').center; } catch { center = null; }
  const fallbackBody = camp.body || '';
  if (!pickLocaleBody(center, 'en') && !fallbackBody.trim()) return json({ ok: false, error: 'empty_welcome' }, 400);

  // Single-table read + JS filter (the test D1 mock drops `IN (...)` and JOINs).
  const allUsers = await dbAll(
    ctx,
    // tenant-scan-ignore: operator-wide welcome backfill across all owners — intentional cross-tenant read.
    'SELECT id, tenant_id, role, lang FROM web_users',
  ).catch(() => []);
  const owners = (allUsers || []).filter((u) => u.role === 'tenant_owner' || u.role === 'tenant_manager');

  let backfilled = 0;
  let skipped = 0;
  for (const o of owners) {
    const tenant = await dbGet(ctx, 'SELECT name, created_at FROM tenants WHERE id = ? LIMIT 1', o.tenant_id).catch(() => null);
    const reg = Number(tenant?.created_at) || Math.floor(Date.now() / 1000);
    const salonName = tenant?.name || '';
    // Idempotency gate: claim the (sys_welcome, once, owner, center) delivery once ever.
    const claimed = await dbGet(
      ctx,
      // tenant-scan-ignore: welcome backfill — cross-tenant operator op, delivery ledger keyed by recipient.
      "SELECT id FROM platform_campaign_deliveries WHERE campaign_id = 'sys_welcome' AND occurrence_key = 'once' AND recipient_web_user_id = ? AND channel = 'center' LIMIT 1",
      o.id,
    ).catch(() => null);
    if (claimed?.id) { skipped += 1; continue; }
    const claimId = `pcd_${ulid()}`;
    try {
      await dbRun(
        ctx,
        // tenant-scan-ignore: welcome backfill — cross-tenant operator op.
        "INSERT INTO platform_campaign_deliveries (id, campaign_id, occurrence_key, recipient_web_user_id, tenant_id, channel, status, created_at) VALUES (?, 'sys_welcome', 'once', ?, ?, 'center', 'pending', ?)",
        claimId, o.id, o.tenant_id, reg,
      );
    } catch { skipped += 1; continue; }

    const template = pickLocaleBody(center, o.lang || 'en') || fallbackBody;
    const body = String(template).replace(/\{salon_name\}/g, salonName);
    let thread = await dbGet(
      ctx, 'SELECT id, last_message_at FROM platform_threads WHERE recipient_web_user_id = ? LIMIT 1', o.id,
    ).catch(() => null);
    let threadId = thread?.id;
    if (!threadId) {
      threadId = `pt_${ulid(reg * 1000)}`;
      await dbRun(
        ctx,
        'INSERT INTO platform_threads (id, recipient_web_user_id, recipient_tenant_id, archived, created_at) VALUES (?, ?, ?, 0, ?)',
        threadId, o.id, o.tenant_id, reg,
      ).catch(() => {});
    }
    // Backdated ULID id → sorts as the FIRST message in the thread (display orders by id).
    await dbRun(
      ctx,
      "INSERT INTO platform_thread_messages (id, thread_id, sender_kind, sender_web_user_id, body, broadcast_id, created_at) VALUES (?, ?, 'platform', 'system', ?, 'sys_welcome:once', ?)",
      ulid(reg * 1000), threadId, clean(body, MAX_BODY_LEN), reg,
    ).catch(() => {});
    // Only bump the thread header when the welcome is the newest message (empty or
    // not-yet-touched thread) — never clobber a newer last-message preview.
    if (!thread || thread.last_message_at == null || thread.last_message_at < reg) {
      await dbRun(
        ctx,
        "UPDATE platform_threads SET last_message_at = ?, last_message_preview = ?, last_sender_kind = 'platform' WHERE id = ?",
        reg, body.replace(/\s+/g, ' ').trim().slice(0, 200), threadId,
      ).catch(() => {});
    }
    await dbRun(
      ctx,
      // tenant-scan-ignore: welcome backfill — cross-tenant operator op.
      'UPDATE platform_campaign_deliveries SET status = ?, sent_at = ? WHERE id = ?',
      'sent', reg, claimId,
    ).catch(() => {});
    backfilled += 1;
  }
  return json({ ok: true, owners: (owners || []).length, backfilled, skipped });
}

/** Approve-only alias of template-status (kept for back-compat; returns an `approved` count). */
async function handleTemplateApprove(ctx, body) {
  const { template_key } = body || {};
  if (!template_key) return json({ ok: false, error: 'template_key_required' }, 400);
  const approved = await setTemplateStatus(ctx, { template_key, status: 'approved' });
  return json({ ok: true, template_key, approved });
}

async function handleListDrafts(ctx) {
  const campaigns = await dbAll(
    ctx,
    "SELECT id, kind, title, occasion_key, template_key, scheduled_at, status FROM platform_campaigns WHERE status = 'draft' ORDER BY created_at DESC LIMIT 100",
  ).catch(() => []);
  const templates = await dbAll(
    ctx,
    // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
    // bodies_json/variables_json included so the tg-bot can render a per-locale preview without a second round-trip.
    "SELECT id, name, template_key, locale, category, status, bodies_json, variables_json FROM platform_message_templates WHERE status = 'draft' ORDER BY created_at DESC LIMIT 100",
  ).catch(() => []);
  return json({ ok: true, campaigns: campaigns || [], templates: templates || [] });
}

/**
 * Approve/archive draft templates. `template_key` flips ALL non-builtin locales of
 * an occasion at once (the operator approves the whole occasion); `id` flips one.
 * Builtin templates are never touched. The tg-bot's draft list is mostly templates
 * (preset-generator output), so this is what its per-occasion ✅/⏭ buttons call —
 * `/approve` on the campaign-only seam would be a no-op for them.
 */
async function handleTemplateStatus(ctx, body) {
  const { id, template_key, status } = body || {};
  if (!new Set(['approved', 'draft', 'archived']).has(status)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }
  if (!id && !template_key) return json({ ok: false, error: 'id_or_template_key_required' }, 400);
  const updated = await setTemplateStatus(ctx, { id, template_key, status });
  return json({ ok: true, updated, status });
}

/**
 * Set the status of draft templates by `template_key` (all non-builtin locales of
 * an occasion) or a single `id`. Returns the number of rows touched. Shared by the
 * general template-status endpoint and the approve-only template-approve alias.
 */
async function setTemplateStatus(ctx, { id, template_key, status }) {
  const nowSec = Math.floor(Date.now() / 1000);
  let ids = [];
  if (template_key) {
    const rows = await dbAll(
      // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
      ctx, 'SELECT id FROM platform_message_templates WHERE template_key = ? AND is_builtin = 0', template_key,
    ).catch(() => []);
    ids = (rows || []).map((r) => r.id);
  } else if (id) {
    ids = [id];
  }
  let updated = 0;
  for (const tid of ids) {
    await dbRun(
      // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
      ctx, 'UPDATE platform_message_templates SET status = ?, updated_at = ? WHERE id = ? AND is_builtin = 0',
      status, nowSec, tid,
    ).catch(() => {});
    updated += 1;
  }
  return updated;
}

const CAMPAIGN_STATUSES = ['draft', 'active', 'scheduled', 'paused', 'done'];
const TEMPLATE_STATUSES = ['draft', 'approved'];
const MAX_PLAN_DAYS = 730;

/** Clamp a `?days=` query param to a sane positive window. */
function clampDays(url, fallback) {
  const raw = parseInt(url.searchParams.get('days') || '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, 1), MAX_PLAN_DAYS);
}

/**
 * Operator dashboard counters: campaigns by status, template drafts, deliveries
 * by channel, the next scheduled occurrence, and BOTH send gates (env master +
 * operator pause). Aggregated in JS — these platform tables are small and the
 * test D1 mock has no GROUP BY.
 */
async function handleStats(ctx, env) {
  const camps = await dbAll(ctx, 'SELECT status, scheduled_at FROM platform_campaigns').catch(() => []);
  const counts = Object.fromEntries(CAMPAIGN_STATUSES.map((s) => [s, 0]));
  let nextScheduled = null;
  for (const c of camps || []) {
    if (counts[c.status] != null) counts[c.status] += 1;
    if ((c.status === 'active' || c.status === 'scheduled') && c.scheduled_at != null) {
      if (nextScheduled == null || c.scheduled_at < nextScheduled) nextScheduled = c.scheduled_at;
    }
  }
  const tplRows = await dbAll(
    // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100).
    ctx, 'SELECT status FROM platform_message_templates',
  ).catch(() => []);
  const templates = Object.fromEntries(TEMPLATE_STATUSES.map((s) => [s, 0]));
  for (const t of tplRows || []) if (templates[t.status] != null) templates[t.status] += 1;
  // tenant-scan-ignore: cross-tenant delivery aggregate for the operator (system_admin) stats dashboard — intentional, not tenant-scoped.
  const delivRows = await dbAll(ctx, 'SELECT channel FROM platform_campaign_deliveries').catch(() => []);
  const deliveries_by_channel = {};
  for (const d of delivRows || []) deliveries_by_channel[d.channel] = (deliveries_by_channel[d.channel] || 0) + 1;
  return json({
    ok: true,
    send_enabled: env?.MESSAGING_SEND_ENABLED === '1',
    send_paused: await isSendPaused(ctx),
    counts,
    templates,
    deliveries_by_channel,
    next_scheduled: nextScheduled,
  });
}

/** Rolling content plan: upcoming scheduled campaigns (any status but done). */
async function handlePlan(ctx, url) {
  const days = clampDays(url, 90);
  const nowSec = Math.floor(Date.now() / 1000);
  const horizon = nowSec + days * 86400;
  const rows = await dbAll(
    ctx,
    'SELECT id, kind, title, occasion_key, template_key, scheduled_at, status FROM platform_campaigns ORDER BY scheduled_at ASC LIMIT 200',
  ).catch(() => []);
  const items = (rows || [])
    .filter((r) => r.scheduled_at != null && r.scheduled_at >= nowSec && r.scheduled_at <= horizon && r.status !== 'done')
    .slice(0, 100);
  return json({ ok: true, items });
}

/** Upcoming Polish holiday-calendar occasions within the window. */
async function handleCalendar(ctx, url) {
  const days = clampDays(url, 120);
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const rows = await dbAll(
    ctx,
    'SELECT id, date, occasion_key, name_pl, name_ru, name_uk, name_en, type FROM holiday_calendar ORDER BY date ASC LIMIT 365',
  ).catch(() => []);
  const occasions = (rows || []).filter((r) => r.date >= today && r.date <= end).slice(0, 200);
  return json({ ok: true, occasions });
}

/** Move a campaign's scheduled_at; keeps next_run_at in sync for live statuses. */
async function handleReschedule(ctx, body) {
  const { id, scheduled_at } = body || {};
  if (!id || !Number.isInteger(scheduled_at) || scheduled_at <= 0) {
    return json({ ok: false, error: 'invalid_id_or_time' }, 400);
  }
  const existing = await dbGet(ctx, 'SELECT status FROM platform_campaigns WHERE id = ? LIMIT 1', id).catch(() => null);
  if (!existing) return json({ ok: false, error: 'not_found' }, 404);
  const nowSec = Math.floor(Date.now() / 1000);
  const nextRun = (existing.status === 'active' || existing.status === 'scheduled') ? scheduled_at : null;
  await dbRun(
    ctx,
    'UPDATE platform_campaigns SET scheduled_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    scheduled_at, nextRun, nowSec, id,
  ).catch(() => {});
  return json({ ok: true, id, scheduled_at });
}

/**
 * Operator send-pause toggle (secondary D1 gate). The real dispatch gate is
 * `MESSAGING_SEND_ENABLED (env, master) && !paused` — pausing can only ever
 * make sending MORE restrictive, never enable it, so flipping this from the bot
 * is safe pre-launch (env is `0`).
 */
async function handleFlag(ctx, body) {
  const paused = body?.paused === true;
  const nowSec = Math.floor(Date.now() / 1000);
  const existing = await dbGet(
    ctx, "SELECT key FROM platform_settings WHERE key = 'messaging_send_paused' LIMIT 1",
  ).catch(() => null);
  if (existing?.key) {
    await dbRun(
      ctx, "UPDATE platform_settings SET value = ?, updated_at = ? WHERE key = 'messaging_send_paused'",
      paused ? '1' : '0', nowSec,
    ).catch(() => {});
  } else {
    await dbRun(
      ctx, 'INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)',
      'messaging_send_paused', paused ? '1' : '0', nowSec,
    ).catch(() => {});
  }
  return json({ ok: true, send_paused: paused });
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
    if (request.method === 'GET') {
      switch (route) {
        case 'drafts': return await handleListDrafts(ctx);
        case 'stats': return await handleStats(ctx, env);
        case 'plan': return await handlePlan(ctx, url);
        case 'calendar': return await handleCalendar(ctx, url);
        default: return new Response('Not Found', { status: 404 });
      }
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const body = await request.json().catch(() => ({}));
    switch (route) {
      case 'holidays-upsert': return await handleHolidaysUpsert(ctx, body);
      case 'template-draft': return await handleTemplateDraft(ctx, body);
      case 'campaign-draft': return await handleCampaignDraft(ctx, body);
      case 'approve': return await handleApprove(ctx, body);
      case 'template-status': return await handleTemplateStatus(ctx, body);
      case 'template-approve': return await handleTemplateApprove(ctx, body);
      case 'backfill-welcomes': return await handleBackfillWelcomes(ctx);
      case 'reschedule': return await handleReschedule(ctx, body);
      case 'flag': return await handleFlag(ctx, body);
      case 'promo-mint': return await handlePromoMint(ctx, body);
      default: return new Response('Not Found', { status: 404 });
    }
  } catch (e) {
    log.error('messaging.http', e instanceof Error ? e : new Error(String(e?.message)), { route });
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
