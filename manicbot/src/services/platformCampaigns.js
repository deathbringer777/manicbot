/**
 * platformCampaigns — operator (system_admin) scheduled / recurring / templated
 * messaging to tenant owners, dispatched per-tenant by the Worker cron.
 *
 * Two layers:
 *   1. PURE due-engine + helpers (this section) — no DB, clock injected via
 *      `now` ({year,month,day,hour,minute,epochSec} in platform tz). Unit-
 *      tested in test/platform-campaign-due.test.js.
 *   2. DISPATCH (phasePlatformCampaigns + channel delivery) — appended below;
 *      reads platform_campaigns, matches the current tenant's audience, and
 *      delivers to its owner(s) across the selected channels, idempotent via
 *      the platform_campaign_deliveries claim-by-INSERT ledger (migration 0100).
 *
 * Scope: platform_campaigns / platform_message_templates are platform-scoped
 * (no tenant_id). Only platform_campaign_deliveries is tenant-scoped, and every
 * read/write of it here is constrained by ctx.tenantId.
 */

import { TIMEZONE } from '../config.js';
import { warsawNow } from '../utils/date.js';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { ulid } from '../utils/ulid.js';
import { log } from '../utils/logger.js';
import { logEvent } from '../utils/events.js';
import { notifyWebUser } from './userNotify.js';
import { loadPrefsForWebUser, shouldDeliver } from './notificationPrefs.js';
import {
  buildMonthlyReport,
  renderMonthlyReportBodies,
  renderSubscriptionReminderBodies,
  renderAnnouncementBodies,
  formatRenewalDate,
} from './platformCampaignStats.js';
import { buildCampaignVars } from './platformCampaignVars.js';
import { deliverEmail } from './platformCampaignEmail.js';

const NOT_DUE = Object.freeze({ due: false, occurrenceKey: null });

// A 'once'/'now' announcement keeps matching the per-tenant scan until every
// tenant in its audience has had a daily tick to deliver. After this grace it
// is finalized to 'done'. The delivery ledger is the real idempotency guard;
// this just stops the scan from carrying finished one-shots forever.
const ONCE_FINALIZE_GRACE_SEC = 2 * 24 * 60 * 60;
const SCAN_LIMIT = 50;

// ─── Pure helpers ─────────────────────────────────────────────────────────

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Day of week for a calendar date (0=Sun..6=Sat), computed in UTC. */
export function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Previous calendar month, handling the Jan→Dec year rollover. */
export function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** ISO-8601 week key 'YYYY-Www' for the given date. */
export function isoWeekKey(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Shift to the Thursday of the current ISO week (Mon=0..Sun=6).
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${pad2(week)}`;
}

/** True when the wall-clock now is at or past hour:minute. */
export function atOrAfter(nowParts, hour, minute) {
  if (nowParts.hour > hour) return true;
  if (nowParts.hour < hour) return false;
  return nowParts.minute >= minute;
}

/**
 * Map the D1 `tenants.billing_status` values to the admin-app audience enum.
 * D1 uses grace_period/inactive; the authoring UI uses grace/expired.
 */
export function normalizeBillingStatus(s) {
  if (s === 'grace_period') return 'grace';
  if (s === 'inactive') return 'expired';
  return s ?? 'trialing';
}

/**
 * The renewal/expiry epoch a subscription reminder anchors to, or null when no
 * reminder applies. Trial-end is intentionally NOT anchored here — Stripe's
 * `customer.subscription.trial_will_end` owns that message (avoids double-send).
 */
export function pickRenewalAnchor(tenant) {
  const status = normalizeBillingStatus(tenant.billing_status);
  if (status === 'active') return tenant.current_period_end ?? null;
  if (status === 'grace') return tenant.grace_ends_at ?? null;
  return null;
}

function parseJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

/** Calendar date {year,month,day} of an epoch (sec) in the platform timezone. */
function epochToTzYmd(epochSec) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epochSec * 1000))) p[type] = value;
  return { year: parseInt(p.year), month: parseInt(p.month), day: parseInt(p.day) };
}

/** Whole-day difference (b - a) between two {year,month,day} dates. */
function daysBetweenYmd(a, b) {
  const ua = Date.UTC(a.year, a.month - 1, a.day);
  const ub = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((ub - ua) / 86400000);
}

/**
 * Does the current tenant fall inside the campaign's audience filter?
 * Null/invalid filter ⇒ everyone (the singleton automations have no filter).
 */
export function audienceMatchesTenant(filterJson, tenant) {
  const f = parseJson(filterJson);
  if (!f || !f.scope || f.scope === 'all') return true;
  if (f.scope === 'by_plan') {
    return Array.isArray(f.plans) && f.plans.includes(tenant.plan ?? 'start');
  }
  if (f.scope === 'by_billing_status') {
    return Array.isArray(f.statuses) && f.statuses.includes(normalizeBillingStatus(tenant.billing_status));
  }
  return false;
}

// ─── Due engine ─────────────────────────────────────────────────────────────

function dueMonthlyReport(campaign, now) {
  const r = parseJson(campaign.recurrence_json) || {};
  const hour = r.hour ?? 7;
  const minute = r.minute ?? 0;
  if (now.day !== 1) return NOT_DUE;
  if (!atOrAfter(now, hour, minute)) return NOT_DUE;
  const prev = previousMonth(now.year, now.month);
  return { due: true, occurrenceKey: `${prev.year}-${pad2(prev.month)}` };
}

function dueAnnouncement(campaign, now) {
  if (campaign.schedule_kind === 'now') {
    return { due: true, occurrenceKey: 'once' };
  }
  if (campaign.schedule_kind === 'once') {
    if (campaign.scheduled_at != null && now.epochSec >= campaign.scheduled_at) {
      return { due: true, occurrenceKey: 'once' };
    }
    return NOT_DUE;
  }
  if (campaign.schedule_kind === 'recurring') {
    const r = parseJson(campaign.recurrence_json) || {};
    const hour = r.hour ?? 9;
    const minute = r.minute ?? 0;
    if (!atOrAfter(now, hour, minute)) return NOT_DUE;
    if (r.freq === 'daily') {
      return { due: true, occurrenceKey: `${now.year}-${pad2(now.month)}-${pad2(now.day)}` };
    }
    if (r.freq === 'weekly') {
      if (weekdayOf(now.year, now.month, now.day) !== r.weekday) return NOT_DUE;
      return { due: true, occurrenceKey: isoWeekKey(now.year, now.month, now.day) };
    }
    if (r.freq === 'monthly') {
      if (now.day !== r.day) return NOT_DUE;
      return { due: true, occurrenceKey: `${now.year}-${pad2(now.month)}` };
    }
  }
  return NOT_DUE;
}

function dueSubscriptionReminder(campaign, tenant, now) {
  const r = parseJson(campaign.recurrence_json) || {};
  const hour = r.hour ?? 9;
  const minute = r.minute ?? 0;
  const daysBefore = r.daysBefore ?? 3;
  if (!atOrAfter(now, hour, minute)) return NOT_DUE;
  const anchor = pickRenewalAnchor(tenant);
  if (anchor == null) return NOT_DUE;
  const daysUntil = daysBetweenYmd(
    { year: now.year, month: now.month, day: now.day },
    epochToTzYmd(anchor),
  );
  if (daysUntil !== daysBefore) return NOT_DUE;
  return { due: true, occurrenceKey: String(anchor) };
}

/**
 * Is `campaign` due for `tenant` at `now`? Returns { due, occurrenceKey }.
 * Pure — no DB, no ambient clock. `now` carries both the platform-tz wall
 * clock and the epoch seconds so once/recurring/anchor math share one input.
 *
 * @param {object} campaign  platform_campaigns row (kind, schedule_kind, recurrence_json, scheduled_at)
 * @param {object} tenant    tenants row (plan, billing_status, current_period_end, grace_ends_at, …)
 * @param {{year:number,month:number,day:number,hour:number,minute:number,epochSec:number}} now
 * @returns {{due:boolean, occurrenceKey:string|null}}
 */
export function isCampaignDueForTenant(campaign, tenant, now) {
  switch (campaign.kind) {
    case 'monthly_report': return dueMonthlyReport(campaign, now);
    case 'subscription_reminder': return dueSubscriptionReminder(campaign, tenant, now);
    case 'announcement': return dueAnnouncement(campaign, now);
    default: return NOT_DUE;
  }
}

// ─── Dispatch (impure: DB reads/writes + channel delivery) ──────────────────

const CHANNEL_VALUES = ['center', 'bell', 'telegram', 'email'];

function parseChannels(channelsJson) {
  try {
    const arr = JSON.parse(channelsJson);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => CHANNEL_VALUES.includes(c));
  } catch {
    return [];
  }
}

function makePreview(body) {
  const oneLine = String(body || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) : oneLine;
}

/** Notification kind (→ prefs category) per campaign type. */
function bellKind(campaign) {
  if (campaign.kind === 'monthly_report') return 'platform.monthly_report';
  if (campaign.kind === 'subscription_reminder') return 'billing.renewal';
  return 'platform.campaign';
}

/** Subscription reminders are transactional — email is NOT opt-out-able. */
function isTransactional(campaign) {
  return campaign.kind === 'subscription_reminder';
}

async function loadTenantRow(ctx) {
  // Single-line column list + WHERE on purpose: the test D1 mock's regex SQL
  // parser does not match newlines inside a SELECT column list. Real D1 is
  // indifferent to formatting.
  return dbGet(
    ctx,
    'SELECT id, name, plan, billing_status, trial_ends_at, grace_ends_at, current_period_end, cancel_at_period_end, is_test FROM tenants WHERE id = ?',
    ctx.tenantId,
  ).catch(() => null);
}

async function resolveTenantRecipients(ctx) {
  const rows = await dbAll(
    ctx,
    "SELECT id, lang, email, email_verified, name FROM web_users WHERE tenant_id = ? AND role IN ('tenant_owner', 'tenant_manager') AND email NOT LIKE '%manicbot.local'",
    ctx.tenantId,
  ).catch(() => []);
  return rows || [];
}

/**
 * Claim a (campaign, occurrence, recipient, channel) delivery. Returns the new
 * row id on success, or null when already claimed — idempotent across cron
 * ticks and the per-tenant fan-out. The SELECT fast-path covers the common
 * case (and the test mock); the UNIQUE index (migration 0100) is the race
 * backstop in production.
 */
async function tryClaimDelivery(ctx, campaignId, occurrenceKey, webUserId, channel, tenantId, nowSec) {
  const existing = await dbGet(
    ctx,
    `SELECT id FROM platform_campaign_deliveries
      WHERE campaign_id = ? AND occurrence_key = ? AND recipient_web_user_id = ? AND channel = ? AND tenant_id = ? LIMIT 1`,
    campaignId, occurrenceKey, webUserId, channel, tenantId,
  ).catch(() => null);
  if (existing?.id) return null;

  const id = `pcd_${ulid()}`;
  try {
    await dbRun(
      ctx,
      `INSERT INTO platform_campaign_deliveries
         (id, campaign_id, occurrence_key, recipient_web_user_id, tenant_id, channel, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id, campaignId, occurrenceKey, webUserId, tenantId, channel, nowSec,
    );
    return id;
  } catch {
    return null; // lost the UNIQUE race
  }
}

async function markDelivery(ctx, id, status, error, nowSec) {
  await dbRun(
    ctx,
    'UPDATE platform_campaign_deliveries SET status = ?, error = ?, sent_at = ? WHERE id = ?',
    status, error ? String(error).slice(0, 200) : null, status === 'sent' ? nowSec : null, id,
  ).catch(() => {});
}

/** Idempotent audit row for the zero-recipient case (stops re-eval churn). */
async function claimAudit(ctx, campaignId, occurrenceKey, tenantId, nowSec) {
  const existing = await dbGet(
    ctx,
    `SELECT id FROM platform_campaign_deliveries
      WHERE campaign_id = ? AND occurrence_key = ? AND recipient_web_user_id = '_none' AND channel = '_audit' AND tenant_id = ? LIMIT 1`,
    campaignId, occurrenceKey, tenantId,
  ).catch(() => null);
  if (existing?.id) return;
  await dbRun(
    ctx,
    `INSERT INTO platform_campaign_deliveries
       (id, campaign_id, occurrence_key, recipient_web_user_id, tenant_id, channel, status, error, created_at)
     VALUES (?, ?, ?, '_none', ?, '_audit', 'skipped', 'no_recipient', ?)`,
    `pcd_${ulid()}`, campaignId, occurrenceKey, tenantId, nowSec,
  ).catch(() => {});
}

async function ensurePlatformThread(ctx, recipientWebUserId, tenantId, nowSec) {
  const existing = await dbGet(
    ctx, 'SELECT id FROM platform_threads WHERE recipient_web_user_id = ? LIMIT 1', recipientWebUserId,
  ).catch(() => null);
  if (existing?.id) return existing.id;
  const id = `pt_${ulid()}`;
  try {
    await dbRun(
      ctx,
      `INSERT INTO platform_threads (id, recipient_web_user_id, recipient_tenant_id, archived, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      id, recipientWebUserId, tenantId, nowSec,
    );
    return id;
  } catch {
    const raced = await dbGet(
      ctx, 'SELECT id FROM platform_threads WHERE recipient_web_user_id = ? LIMIT 1', recipientWebUserId,
    ).catch(() => null);
    return raced?.id ?? null;
  }
}

// ── Per-channel delivery (each returns { ok, skipped?, error? }) ──

async function deliverCenter(ctx, recipient, campaign, bodies, occurrenceKey, nowSec) {
  const threadId = await ensurePlatformThread(ctx, recipient.id, ctx.tenantId, nowSec);
  if (!threadId) return { ok: false, error: 'thread_unavailable' };
  const sender = campaign.created_by || 'system';
  const body = bodies.center || bodies.title || '';
  await dbRun(
    ctx,
    `INSERT INTO platform_thread_messages (id, thread_id, sender_kind, sender_web_user_id, body, broadcast_id, created_at)
     VALUES (?, ?, 'platform', ?, ?, ?, ?)`,
    ulid(), threadId, sender, body, `${campaign.id}:${occurrenceKey}`, nowSec,
  );
  await dbRun(
    ctx,
    `UPDATE platform_threads SET last_message_at = ?, last_message_preview = ?, last_sender_kind = 'platform', platform_last_read_at = ? WHERE id = ?`,
    nowSec, makePreview(body), nowSec, threadId,
  );
  return { ok: true };
}

async function deliverBell(ctx, recipient, campaign, bodies, occurrenceKey) {
  const r = await notifyWebUser(ctx, recipient.id, {
    kind: bellKind(campaign),
    title: bodies.title || campaign.title || 'ManicBot',
    body: bodies.bellBody || bodies.center || '',
    link: '/messages?platform=1',
    sourceSlug: 'platform_campaign',
    sourceId: `${campaign.id}:${occurrenceKey}`,
    inapp: true, telegram: false, push: true,
  });
  return r.inappOk ? { ok: true } : { ok: false, skipped: true, error: 'bell_skipped' };
}

async function deliverTelegram(ctx, recipient, campaign, bodies, occurrenceKey) {
  const r = await notifyWebUser(ctx, recipient.id, {
    kind: bellKind(campaign),
    title: bodies.title || campaign.title || 'ManicBot',
    telegramText: bodies.telegram || bodies.center || '',
    sourceSlug: 'platform_campaign',
    sourceId: `${campaign.id}:${occurrenceKey}:tg`,
    inapp: false, telegram: true, push: false,
  });
  return r.telegramOk ? { ok: true } : { ok: false, skipped: true, error: 'telegram_unavailable' };
}

async function emailAllowed(ctx, webUserId, campaign) {
  if (isTransactional(campaign)) return true;
  const prefs = await loadPrefsForWebUser(ctx.db, webUserId).catch(() => null);
  if (!prefs) return true;
  return shouldDeliver(bellKind(campaign), prefs, 'email');
}

async function deliverEmailChannel(ctx, recipient, campaign, bodies) {
  if (!recipient.email || recipient.email_verified !== 1) {
    return { ok: false, skipped: true, error: 'no_verified_email' };
  }
  if (!(await emailAllowed(ctx, recipient.id, campaign))) {
    return { ok: false, skipped: true, error: 'email_opted_out' };
  }
  const res = await deliverEmail(ctx, { to: recipient.email, subject: bodies.emailSubject, html: bodies.emailHtml });
  if (res.ok) return { ok: true };
  return { ok: false, skipped: res.error === 'resend_unconfigured', error: res.error };
}

async function deliverChannel(ctx, channel, recipient, campaign, bodies, occurrenceKey, nowSec) {
  switch (channel) {
    case 'center': return deliverCenter(ctx, recipient, campaign, bodies, occurrenceKey, nowSec);
    case 'bell': return deliverBell(ctx, recipient, campaign, bodies, occurrenceKey);
    case 'telegram': return deliverTelegram(ctx, recipient, campaign, bodies, occurrenceKey);
    case 'email': return deliverEmailChannel(ctx, recipient, campaign, bodies);
    default: return { ok: false, error: 'unknown_channel' };
  }
}

/** Build per-channel bodies for a (campaign, recipient, occurrence). */
async function buildBodies(ctx, campaign, tenant, recipient, occurrenceKey) {
  const locale = recipient.lang || 'ru';
  if (campaign.kind === 'monthly_report') {
    const stats = await buildMonthlyReport(ctx, occurrenceKey);
    return renderMonthlyReportBodies(stats, locale, ctx);
  }
  if (campaign.kind === 'subscription_reminder') {
    const anchor = pickRenewalAnchor(tenant);
    if (anchor == null) return null;
    return renderSubscriptionReminderBodies(
      { renewalDateLabel: formatRenewalDate(anchor, locale), cancelAtPeriodEnd: tenant.cancel_at_period_end === 1 },
      locale, ctx,
    );
  }
  const vars = buildCampaignVars(tenant, recipient);
  return renderAnnouncementBodies(campaign, locale, ctx, vars);
}

async function maybeFinalizeOnce(ctx, campaign, nowSec) {
  if (campaign.kind !== 'announcement') return;
  if (campaign.schedule_kind !== 'now' && campaign.schedule_kind !== 'once') return;
  const anchor = campaign.schedule_kind === 'once'
    ? (campaign.scheduled_at || campaign.created_at)
    : campaign.created_at;
  if (anchor && (nowSec - anchor) > ONCE_FINALIZE_GRACE_SEC) {
    await dbRun(
      ctx,
      "UPDATE platform_campaigns SET status = 'done', next_run_at = NULL, last_run_at = ?, updated_at = ? WHERE id = ? AND status != 'done'",
      nowSec, nowSec, campaign.id,
    ).catch(() => {});
  }
}

/**
 * Per-tenant cron phase: deliver every due platform campaign to THIS tenant's
 * owner(s)/manager(s) across the campaign's channels. Idempotent via the
 * delivery ledger; each campaign is isolated in its own try/catch so one bad
 * campaign never blocks its siblings.
 *
 * @param {object} ctx   tenant-scoped cron ctx (db, tenantId, bot/TG, env)
 * @param {number} nowMs current time in ms
 */
export async function phasePlatformCampaigns(ctx, nowMs) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);

  const tenant = await loadTenantRow(ctx);
  if (!tenant) return;
  if (tenant.is_test === 1) return; // never deliver platform campaigns to test tenants

  let scanned;
  try {
    // next_run_at filter is the SQL scan optimization; status is filtered in JS
    // (the test D1 mock mis-parses a trailing `IN (...)` clause). Both correct
    // in real D1; the delivery ledger — not this scan — is the idempotency
    // boundary, so a slightly broad scan is harmless.
    scanned = await dbAll(
      ctx,
      'SELECT * FROM platform_campaigns WHERE next_run_at IS NULL OR next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?',
      nowSec, SCAN_LIMIT,
    );
  } catch (e) {
    log.warn('platform.campaign', { action: 'scan_failed', error: e?.message });
    return;
  }
  const campaigns = (scanned || []).filter((c) => c.status === 'active' || c.status === 'scheduled');
  if (campaigns.length === 0) return;

  const now = { ...warsawNow(), epochSec: nowSec };
  const recipients = await resolveTenantRecipients(ctx);

  for (const c of campaigns) {
    try {
      if (!audienceMatchesTenant(c.audience_filter_json, tenant)) continue;
      const { due, occurrenceKey } = isCampaignDueForTenant(c, tenant, now);
      if (!due) continue;

      if (recipients.length === 0) {
        await claimAudit(ctx, c.id, occurrenceKey, ctx.tenantId, nowSec);
        await maybeFinalizeOnce(ctx, c, nowSec);
        continue;
      }

      const channels = parseChannels(c.channels_json);
      let delivered = false;
      for (const r of recipients) {
        const bodies = await buildBodies(ctx, c, tenant, r, occurrenceKey);
        if (!bodies) continue;
        for (const ch of channels) {
          const claimId = await tryClaimDelivery(ctx, c.id, occurrenceKey, r.id, ch, ctx.tenantId, nowSec);
          if (!claimId) continue;
          delivered = true;
          let result;
          try {
            result = await deliverChannel(ctx, ch, r, c, bodies, occurrenceKey, nowSec);
          } catch (e) {
            result = { ok: false, error: e?.message };
          }
          const status = result.ok ? 'sent' : (result.skipped ? 'skipped' : 'failed');
          await markDelivery(ctx, claimId, status, result.error, nowSec);
        }
      }

      if (delivered) {
        await dbRun(
          ctx,
          'UPDATE platform_campaigns SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at < ?)',
          nowSec, c.id, nowSec,
        ).catch(() => {});
      }
      await maybeFinalizeOnce(ctx, c, nowSec);
    } catch (e) {
      log.error('platform.campaign', e instanceof Error ? e : new Error(String(e?.message)), { campaignId: c?.id });
      void logEvent(ctx, 'cron.platform_campaign.error', {
        level: 'error', tenantId: ctx.tenantId,
        message: `platform campaign ${c?.id} failed: ${e?.message ?? 'unknown'}`,
        campaignId: c?.id, error: e?.message?.slice(0, 200),
      });
    }
  }
}
