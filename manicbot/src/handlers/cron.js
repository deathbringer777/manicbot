/**
 * Tenant cron orchestrator.
 *
 * Originally a 490-line `handleCron` monolith; the audit (relax.md §1 P1)
 * flagged it as the most fragile single piece — five sequential phases per
 * tenant, no per-phase isolation, no idempotency window beyond DB existence
 * checks (analytics_events was racking up duplicate rows on every tick).
 *
 * P1-1 refactor: each phase is now an exported function with:
 *   - Its own try/catch boundary (`cron.phase.error` event on throw).
 *   - A per-phase idempotency guard backed by `tenant_config` rows keyed
 *     `cron:phase:{name}:last` storing the last-run epoch seconds.
 *   - A `windowSec` declaring how long the phase's "skip if already ran"
 *     window is. The 15-min cron tick means most phases skip 90%+ of runs.
 *
 * P1-10: a new `phaseRetention` prunes 6 append-only tables (audit_log,
 * error_log, analytics_events, permission_elevation_codes, stripe_events,
 * marketing_sends) on a daily window.
 *
 * `handleCron` is now a thin orchestrator. Each phase is testable in
 * isolation.
 */

import { CLEANUP_AFTER_MS, ADDRESS, MAPS_URL } from '../config.js';
import { log } from '../utils/logger.js';
import { dbAll, dbGet, dbRun } from '../utils/db.js';
import { extractAttachmentKeys } from '../services/attachmentKeys.js';
import { svcName, fill, t, p2 } from '../utils/helpers.js';
import { warsawNow, fmtDT } from '../utils/date.js';
import { send } from '../telegram.js';
import { getLang } from '../services/chat.js';
import { initServices, getConfig } from '../services/services.js';
import { checkBillingExpiry } from '../billing/lifecycle.js';
import { renewExpiringGoogleWatches, syncAppointmentCalendar } from '../services/google-calendar-oauth.js';
import { canUse } from '../billing/features.js';
import { isWithinMessageWindow } from './inbound.js';
import { sendTemplateMessage, canSendTemplate, trackTemplateUsage, buildReminderComponents } from '../channels/whatsapp-templates.js';
import { getChannelConfig } from '../channels/resolver.js';
import { markReviewRequested } from '../services/reviews.js';
import { notifyWebUser } from '../services/userNotify.js';
import { isTokenExpiring, refreshInstagramToken } from '../channels/token-manager.js';
import { cleanupExpired as cleanupRateLimits } from '../utils/rateLimit.js';
import { logEvent } from '../utils/events.js';
import { runCampaignSend as runMarketingCampaign } from '../services/marketing/sender.js';
import { fireAutomationForEvent } from '../services/marketing/automations.js';
import { phasePlatformCampaigns } from '../services/platformCampaigns.js';

/**
 * Plugin cron dispatchers — runtime map of slug → handler for plugins that
 * declare `capabilities.cron` in their manifest. The manifest side ALSO
 * needs an entry here; this map is the worker's authoritative source.
 *
 * Adding a new plugin with cron:
 *   1. Set `capabilities.cron` on the manifest.
 *   2. Export a `(ctx, installation, nowMs) => Promise<void>` handler from
 *      `plugins/<slug>/cron.js`.
 *   3. Add the import + slug entry here.
 *
 * Kept inline rather than in plugins/registry.ts because (a) registry.ts is
 * TS and the worker is JS, and (b) lazy growth — when there are 3+ entries
 * we extract to plugins/cron-dispatchers.js. YAGNI for plugin #1.
 */
// Currently empty: the `reminders` plugin (the first cron-backed plugin) was
// removed 2026-06-06 as a duplicate of the core notification bell + the
// `phaseReminders` appointment-reminder cron. The orchestrator below stays so
// the next cron-backed plugin is a one-line add.
const PLUGIN_CRON_DISPATCHERS = Object.freeze({});

// Per-phase idempotency window (seconds). The 15-min cron tick fires every
// 900 s; phases with windowSec > 900 will skip most ticks.
export const PHASE_WINDOWS = Object.freeze({
  reviews: 24 * 60 * 60,      // 24 h
  gcalSync: 10 * 60,          // 10 min
  postVisit: 60 * 60,         // 1 h
  // Post-visit follow-up sweep (24h after the visit). 10-min window so it
  // catches up within a tick or two; the followup_24h_sent_at flag is the
  // real idempotency, not this window.
  postVisitFollowup: 10 * 60, // 10 min
  promos: 24 * 60 * 60,       // 24 h
  cleanup: 24 * 60 * 60,      // 24 h
  retention: 24 * 60 * 60,    // 24 h (P1-10)
  attachmentGc: 24 * 60 * 60, // 24 h — orphaned messenger attachment sweep
  // PR-A marketing send dispatch — tight window because we want scheduled
  // campaigns to fire within one cron tick (~15 min) of their scheduled_at.
  marketingDispatch: 60,
  pluginCron: 10 * 60,        // 10 min
  // Platform operator campaigns (migration 0100): tight window so scheduled /
  // recurring sends and the monthly-report/subscription-reminder automations
  // fire within ~one cron tick of becoming due. Idempotency is the delivery
  // ledger, not this window.
  platformCampaigns: 60,
});

/**
 * Read the last-run epoch for a phase from tenant_config. Returns 0 if
 * unset or DB unavailable.
 */
async function getPhaseLastRun(ctx, phase) {
  if (!ctx?.db || !ctx?.tenantId) return 0;
  try {
    const row = await dbGet(
      ctx,
      'SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?',
      ctx.tenantId, `cron:phase:${phase}:last`,
    );
    const n = Number(row?.value ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist the last-run epoch for a phase.
 */
async function setPhaseLastRun(ctx, phase, epochSec) {
  if (!ctx?.db || !ctx?.tenantId) return;
  try {
    await dbRun(
      ctx,
      'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)',
      ctx.tenantId, `cron:phase:${phase}:last`, String(Math.floor(epochSec)),
    );
  } catch (e) {
    log.warn('handlers.cron', { action: 'phase_lastrun_write_failed', phase, error: e?.message });
  }
}

const IG_RESUBSCRIBE_WINDOW_SEC = 24 * 60 * 60;
const IG_RESUBSCRIBE_FIELDS = 'messages,messaging_postbacks,message_reads';

/**
 * Re-subscribe the Facebook Page linked to this tenant's IG channel to the
 * Messenger Platform webhook fields. Idempotent: only fires once per
 * IG_RESUBSCRIBE_WINDOW_SEC per tenant (key: `cron:ig:last_resubscribe`).
 *
 * Why exists: even when the App↔Page link is configured correctly, Meta
 * silently de-subscribes the Page from webhook fields after some inactivity
 * / re-auth events. Re-issuing `POST /{page_id}/subscribed_apps` once a day
 * keeps the bot reachable.
 */
export async function maybeResubscribeIgWebhook(ctx, igConfig, nowMs) {
  if (!ctx?.db || !ctx?.tenantId) return { ok: false, skipped: 'no-ctx' };
  if (!igConfig?.token || !igConfig?.page_id) return { ok: false, skipped: 'no-token-or-page' };

  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  const last = await getPhaseLastRun(ctx, 'ig_resubscribe');
  if ((nowSec - last) < IG_RESUBSCRIBE_WINDOW_SEC) {
    return { ok: true, skipped: 'window' };
  }

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(igConfig.page_id)}/subscribed_apps?subscribed_fields=${encodeURIComponent(IG_RESUBSCRIBE_FIELDS)}&access_token=${encodeURIComponent(igConfig.token)}`;
  try {
    const r = await fetch(url, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    const ok = !!(r.ok && (data.success === true || data.success === undefined));
    if (ok) {
      await setPhaseLastRun(ctx, 'ig_resubscribe', nowSec);
      log.info('handlers.cron', { action: 'ig_resubscribe_ok', tenantId: ctx.tenantId, pageId: igConfig.page_id });
      void logEvent(ctx, 'cron.ig_resubscribe', { level: 'info', tenantId: ctx.tenantId, message: 'IG webhook re-subscribed' });
      return { ok: true };
    }
    log.error('handlers.cron', new Error(`IG resubscribe failed: ${data?.error?.message ?? `HTTP ${r.status}`}`), { tenantId: ctx.tenantId, pageId: igConfig.page_id });
    try {
      const { captureError } = await import('../utils/errorCapture.js');
      const { CHANNEL_ERROR_TYPE } = await import('../channels/error-types.js');
      await captureError(ctx,
        new Error(`IG resubscribe failed: ${data?.error?.message ?? `HTTP ${r.status}`}`),
        {
          source: 'cron.ig_resubscribe',
          tenantId: ctx.tenantId,
          severity: 'error',
          path: 'cron.phase.ig_resubscribe',
          errorType: CHANNEL_ERROR_TYPE.IG_RESUBSCRIBE_FAILED,
          channelType: 'instagram',
          pageId: String(igConfig.page_id || ''),
          status: String(r.status),
        });
    } catch { /* errorCapture must never break the request flow */ }
    return { ok: false, status: r.status, error: data?.error };
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'ig_resubscribe', tenantId: ctx.tenantId });
    return { ok: false, error: String(e?.message ?? e) };
  }
}

const CHANNEL_HEALTH_WINDOW_SEC = 6 * 60 * 60;

/**
 * Channel health probe. For each IG channel for this tenant, calls Graph
 * `/me` with the decrypted Page token. A 401/expired response surfaces as
 * a `fatal` row in the God Mode `error_events` dashboard so a token going
 * dead never goes unnoticed again (root cause of the Mar→May 2026 IG
 * outage that took 6 weeks to detect).
 *
 * Runs at most every 6h per tenant via `cron:phase:channel_health:last`.
 */
export async function phaseChannelHealth(ctx, nowMs) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  const last = await getPhaseLastRun(ctx, 'channel_health');
  if ((nowSec - last) < CHANNEL_HEALTH_WINDOW_SEC) return;

  const igConfig = await getChannelConfig(
    ctx, ctx.tenantId, 'instagram',
    ctx.BOT_ENCRYPTION_KEY || null,
    ctx.BOT_ENCRYPTION_KEY_OLD || null,
  );
  if (!igConfig) {
    await setPhaseLastRun(ctx, 'channel_health', nowSec);
    return;
  }

  const { captureError } = await import('../utils/errorCapture.js');
  const { CHANNEL_ERROR_TYPE } = await import('../channels/error-types.js');
  const { notifyTenantOwner } = await import('../services/userNotify.js');

  // PR-B (Notification Center 2.0) — bell-row fan-out for channel state.
  // The error_events write below lights up the /errors dashboard for ops;
  // the bell row in front of the salon owner is what gets THEM to take
  // action without a sysadmin tap. Idempotent via the partial UNIQUE on
  // (web_user_id, source_slug, source_id, kind) — same probe firing every
  // 6h while the channel stays broken collapses to one row per state.
  // `sourceId` includes the date so a recurring weekly outage gets its own
  // row each day rather than reusing the cobwebbed first one.
  const todayBucket = new Date(nowSec * 1000).toISOString().slice(0, 10);
  async function bellChannelBroken(slug, body) {
    try {
      await notifyTenantOwner(ctx, {
        kind: 'channel.broken',
        title: 'Instagram-канал не работает',
        body,
        link: '/dashboard?tab=channels',
        sourceSlug: 'channel',
        sourceId: `instagram:${slug}:${todayBucket}`,
        inapp: true,
        telegram: false,
      });
    } catch (e) {
      log.warn('handlers.cron', { action: 'channel_broken_bell_failed', error: e?.message });
    }
  }
  async function bellChannelDegraded(slug, body) {
    try {
      await notifyTenantOwner(ctx, {
        kind: 'channel.degraded',
        title: 'Instagram-канал требует внимания',
        body,
        link: '/dashboard?tab=channels',
        sourceSlug: 'channel',
        sourceId: `instagram:${slug}:${todayBucket}`,
        inapp: true,
        telegram: false,
      });
    } catch (e) {
      log.warn('handlers.cron', { action: 'channel_degraded_bell_failed', error: e?.message });
    }
  }

  if (!igConfig.token) {
    await captureError(ctx, new Error('IG token decrypt failed — bot is dead until recovery'), {
      source: 'cron.channel_health',
      tenantId: ctx.tenantId,
      severity: 'fatal',
      path: 'cron.phase.channel_health',
      errorType: CHANNEL_ERROR_TYPE.IG_TOKEN_DECRYPT,
      channelType: 'instagram',
      pageId: String(igConfig.page_id || ''),
    });
    await bellChannelBroken(
      'token_decrypt',
      'Токен Instagram не расшифровывается. Переподключи канал в настройках салона.',
    );
    await setPhaseLastRun(ctx, 'channel_health', nowSec);
    return;
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(igConfig.token)}`,
    );
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      await captureError(ctx, new Error(`IG token rejected by Graph: ${data?.error?.message ?? `HTTP ${r.status}`}`), {
        source: 'cron.channel_health',
        tenantId: ctx.tenantId,
        severity: 'fatal',
        path: 'cron.phase.channel_health',
        errorType: CHANNEL_ERROR_TYPE.IG_TOKEN_REJECTED,
        channelType: 'instagram',
        pageId: String(igConfig.page_id || ''),
        graphCode: String(data?.error?.code ?? ''),
        graphSubcode: String(data?.error?.error_subcode ?? ''),
      });
      await bellChannelBroken(
        'token_rejected',
        `Meta отвергает токен (${data?.error?.message ?? `HTTP ${r.status}`}). Открой Каналы → Instagram → Переподключить.`,
      );
    } else {
      // Verify Page subscribed_apps is healthy; if missing, capture warning.
      const sR = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(igConfig.page_id)}/subscribed_apps?access_token=${encodeURIComponent(igConfig.token)}`,
      );
      const sData = await sR.json().catch(() => ({}));
      const ourSub = (sData?.data || []).find(s => String(s.id) === String(ctx.META_APP_ID || ''));
      const expectedFields = ['messages', 'messaging_postbacks', 'message_reads'];
      const missing = expectedFields.filter(f => !(ourSub?.subscribed_fields || []).includes(f));
      if (!ourSub || missing.length) {
        await captureError(ctx,
          new Error(`Page subscribed_apps missing fields: ${missing.join(',') || 'app not subscribed'}`),
          {
            source: 'cron.channel_health',
            tenantId: ctx.tenantId,
            severity: 'error',
            path: 'cron.phase.channel_health',
            errorType: CHANNEL_ERROR_TYPE.IG_SUBSCRIPTION_LOST,
            channelType: 'instagram',
            pageId: String(igConfig.page_id || ''),
            missingFields: missing.join(','),
          },
        );
        await bellChannelDegraded(
          'subscription_lost',
          `Meta не получает события (${missing.join(', ') || 'нет подписки'}). Сообщения от клиентов могут не доходить — переподпиши канал.`,
        );
      }
    }
  } catch (e) {
    // Graph is down or fetch timed out. Don't bump last-run so we retry on next tick.
    log.warn('handlers.cron', { action: 'channel_health_probe_error', error: e?.message });
    return;
  }
  await setPhaseLastRun(ctx, 'channel_health', nowSec);
}

/**
 * P1-1 idempotency probe. Returns true if the phase has not run within its
 * window. Read-only — does NOT claim the slot. Kept for backward compat with
 * existing tests and any external callers; the real gate is `tryClaimPhase`
 * called inside `runPhase`.
 */
export async function shouldRunPhase(ctx, phase, nowSec) {
  const windowSec = PHASE_WINDOWS[phase];
  if (!windowSec || windowSec <= 0) return true;
  const last = await getPhaseLastRun(ctx, phase);
  return (nowSec - last) >= windowSec;
}

/**
 * P0-2 (2026-05-24 audit) — atomic claim of a phase window in a SINGLE D1
 * round-trip. Replaces the read-then-write pattern (shouldRunPhase →
 * setPhaseLastRun) that had a TOCTOU race: two concurrent cron ticks could
 * both pass the read-side check and both run the phase, double-firing
 * non-idempotent side-effects (duplicate reminders, duplicate promo codes,
 * doubled `review_requested_at` updates, duplicated marketing-campaign
 * sends).
 *
 * Mechanics:
 *   INSERT new row with current epoch → succeeds (changes=1, claim won).
 *   ON CONFLICT row exists → DO UPDATE only when `value < threshold`
 *   (= the stored last-run is older than now - windowSec). If the WHERE
 *   doesn't match (someone claimed inside the window), changes=0.
 *
 * Returns true iff this caller won the claim and should run the work.
 */
async function tryClaimPhase(ctx, phase, nowSec, windowSec) {
  if (!ctx?.db || !ctx?.tenantId) return true; // local/test fallback
  const threshold = nowSec - windowSec;
  try {
    const result = await dbRun(
      ctx,
      `INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE
         SET value = excluded.value
         WHERE CAST(tenant_config.value AS INTEGER) < ?`,
      ctx.tenantId,
      `cron:phase:${phase}:last`,
      String(nowSec),
      threshold,
    );
    return (result?.meta?.changes ?? 0) > 0;
  } catch (e) {
    log.warn('handlers.cron', { action: 'phase_claim_failed', phase, error: e?.message });
    return false; // fail closed — better to skip a tick than double-fire
  }
}

/**
 * Sweep orphaned messenger attachments: R2 objects referenced ONLY by
 * soft-deleted messages (past a 7d grace). Destructive on R2, so it is
 * DRY-RUN by default — set ATTACHMENT_GC_DELETE='1' to actually delete.
 *
 * Keys are content-addressed (shared across messages with the same image), so
 * each candidate is ref-counted against LIVE messages before deletion. The
 * LIKE ref-count only ever OVER-counts (errs toward keeping) — it never
 * falsely orphans a still-referenced key.
 */
export async function phaseAttachmentGc(ctx, tenantId, nowMs) {
  if (!ctx?.db || !tenantId) return;
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  const GRACE_SEC = 7 * 24 * 60 * 60;
  // How many would-delete keys to surface in the structured log (key + age +
  // best-effort byte size). Bounded so a large sweep can't bloat logs or fan
  // out unbounded R2 HEADs in the dry-run size estimate.
  const SAMPLE_LIMIT = 10;
  const cutoff = nowSec - GRACE_SEC;
  const deleteEnabled = String(ctx?.ATTACHMENT_GC_DELETE ?? '') === '1';

  const rows = await dbAll(
    ctx,
    `SELECT id, attachments_json, deleted_at FROM thread_messages WHERE tenant_id = ? AND deleted_at IS NOT NULL AND deleted_at < ? AND attachments_json IS NOT NULL LIMIT 100`,
    tenantId, cutoff,
  ).catch(() => []);
  if (!rows.length) return;

  // Candidate keys + the oldest soft-delete epoch seen per key (for the age in
  // the observability log). A key can recur across soft-deleted messages; the
  // oldest delete is when it first became reclaim-eligible.
  const candidates = new Set();
  const oldestDeletedAt = new Map();
  for (const r of rows) {
    const da = Number(r.deleted_at) || nowSec;
    for (const k of extractAttachmentKeys(r.attachments_json)) {
      candidates.add(k);
      const prev = oldestDeletedAt.get(k);
      if (prev === undefined || da < prev) oldestDeletedAt.set(k, da);
    }
  }
  if (!candidates.size) return;

  let deleted = 0;
  let kept = 0;
  const orphans = []; // { key, ageSec } — keys with no live reference (would-delete in dry-run)
  for (const key of candidates) {
    const cnt = await dbGet(
      ctx,
      `SELECT COUNT(*) AS c FROM thread_messages WHERE tenant_id = ? AND deleted_at IS NULL AND attachments_json LIKE ?`,
      tenantId, `%${key}%`,
    ).catch(() => ({ c: 1 })); // on error, assume still referenced (safe)
    if (Number(cnt?.c ?? 1) > 0) { kept++; continue; }
    orphans.push({ key, ageSec: nowSec - (oldestDeletedAt.get(key) ?? nowSec) });
    if (deleteEnabled && typeof ctx.ASSETS?.delete === 'function') {
      try {
        await ctx.ASSETS.delete(key);
        deleted++;
      } catch (e) {
        log.warn('handlers.cron', { action: 'attachment_gc_delete_failed', key, error: e?.message });
      }
    } else {
      deleted++; // dry-run: count as would-delete
    }
  }

  // Structured sample for the runbook reader: first few orphan keys with age,
  // plus a best-effort reclaimable-bytes estimate (bounded R2 HEADs, only when
  // the binding exposes head()). Content-addressed keys are not PII.
  const sample = orphans.slice(0, SAMPLE_LIMIT);
  let sampledBytes = null;
  if (typeof ctx.ASSETS?.head === 'function') {
    sampledBytes = 0;
    for (const { key } of sample) {
      try {
        const meta = await ctx.ASSETS.head(key);
        if (meta && Number.isFinite(meta.size)) sampledBytes += meta.size;
      } catch {
        /* size is best-effort — ignore a failed HEAD */
      }
    }
  }

  void logEvent(ctx, deleteEnabled ? 'cron.attachment_gc' : 'cron.attachment_gc.dryrun', {
    level: 'info',
    tenantId,
    message: deleteEnabled
      ? `Attachment GC: deleted ${deleted} orphan object(s), kept ${kept} referenced`
      : `[dry-run] Attachment GC: ${deleted} orphan object(s) would be deleted, ${kept} still referenced`,
    deleted,
    kept,
    totalCandidates: candidates.size,
    orphanCount: orphans.length,
    sampleKeys: sample.map((o) => o.key),
    samples: sample, // [{ key, ageSec }]
    sampledBytes, // best-effort sum over <= SAMPLE_LIMIT keys; null if head() unavailable
    sampledBytesPartial: sampledBytes !== null && orphans.length > sample.length,
  });
}

/**
 * Wrap a phase function with idempotency + per-phase try/catch + event log.
 * The phase window is claimed atomically BEFORE running the work — if a
 * concurrent tick already claimed it, this call returns
 * `{ ran: false, skipped: 'window' }`. Phases without a window (referral_expiry)
 * always run.
 */
async function runPhase(ctx, phase, fn) {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = PHASE_WINDOWS[phase] ?? 0;
  try {
    if (windowSec > 0) {
      if (!(await tryClaimPhase(ctx, phase, nowSec, windowSec))) {
        return { ran: false, skipped: 'window' };
      }
    }
    await fn();
    return { ran: true };
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { phase });
    void logEvent(ctx, 'cron.phase.error', {
      level: 'error',
      tenantId: ctx?.tenantId,
      message: `cron phase ${phase} failed: ${e?.message ?? 'unknown'}`,
      phase,
      error: e?.message?.slice(0, 200),
    });
    return { ran: false, error: e?.message };
  }
}

// ─── Phase 1: reminders ─────────────────────────────────────────────────
export async function phaseReminders(ctx, now, w) {
  const reminderDates = [];
  for (const off of [0, 1]) {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + off));
    reminderDates.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
  }

  const apts = await dbAll(ctx,
    "SELECT * FROM appointments WHERE tenant_id = ? AND date IN (?, ?) AND cancelled = 0 AND status = 'confirmed'",
    ctx.tenantId, reminderDates[0], reminderDates[1],
  );
  // Pre-load languages for all unique chat IDs to avoid N+1 KV reads
  const chatIds = [...new Set(apts.map(a => a.chat_id))];
  const langMap = new Map();
  await Promise.all(chatIds.map(async cid => {
    langMap.set(cid, (await getLang(ctx, cid)) || 'ru');
  }));

  // Pre-load non-telegram channel identities for all unique chat IDs in one
  // (chunked) query to avoid an N+1 per-appointment DB round-trip inside the
  // loop below. Keys are normalized to String because appointments.chat_id and
  // channel_identities.internal_user_id can differ in SQLite type affinity.
  const identityMap = new Map();
  if (ctx.db && ctx.tenantId && chatIds.length) {
    const CHUNK = 100; // stay well under the SQLite bound-parameter limit
    for (let i = 0; i < chatIds.length; i += CHUNK) {
      const slice = chatIds.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '?').join(', ');
      const idRows = await dbAll(ctx,
        `SELECT internal_user_id, channel_type, channel_user_id
           FROM channel_identities
          WHERE tenant_id = ? AND channel_type != 'telegram'
            AND internal_user_id IN (${placeholders})`,
        ctx.tenantId, ...slice,
      );
      for (const r of idRows) {
        const key = String(r.internal_user_id);
        const list = identityMap.get(key) || [];
        list.push({ channel_type: r.channel_type, channel_user_id: r.channel_user_id });
        identityMap.set(key, list);
      }
    }
  }

  for (const row of apts) {
    try {
      const diffH = (row.ts - now) / 3600000;
      if (diffH < -1 || diffH > 25) continue;
      const do24 = !row.rem_h24 && diffH <= 25 && diffH > 23;
      const do2 = !row.rem_h2 && diffH <= 2.5 && diffH > 1.5;
      if (do24 || do2) {
        const updates = {};
        if (do24) updates.rem_h24 = 1;
        if (do2) updates.rem_h2 = 1;
        const setCols = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
        const vals = Object.values(updates);
        await dbRun(ctx, `UPDATE appointments SET ${setCols} WHERE id = ? AND tenant_id = ?`, ...vals, row.id, ctx.tenantId);
      }
      const lg = langMap.get(row.chat_id) || 'ru';
      const tenantAddr = ctx.tenant?.salon?.address || ADDRESS;
      const tenantMaps = ctx.tenant?.salon?.mapsUrl || MAPS_URL;
      const vars = { svc: svcName(ctx, lg, row.svc_id), dt: fmtDT(lg, row.date, row.time), addr: tenantAddr, maps: tenantMaps };

      // Check if client has a non-Telegram channel identity
      let sent = false;
      if (ctx.db && ctx.tenantId) {
        const identities = identityMap.get(String(row.chat_id)) || [];
        for (const identity of identities) {
          if (identity.channel_type === 'whatsapp' && canUse(ctx, 'whatsapp')) {
            const withinWindow = await isWithinMessageWindow(ctx, 'whatsapp', identity.channel_user_id);
            if (withinWindow) {
              // Free-form message within 24h window
              const reminderText = fill(t(lg, do24 ? 'rem_24' : 'rem_2'), vars);
              const channelConfig = await getChannelConfig(ctx, ctx.tenantId, 'whatsapp', ctx.BOT_ENCRYPTION_KEY || null);
              if (channelConfig?.token && channelConfig?.config?.phone_number_id) {
                try {
                  const { WhatsAppAdapter } = await import('../channels/whatsapp.js');
                  const adapter = new WhatsAppAdapter({ tenantId: ctx.tenantId, channelConfig });
                  await adapter.send(identity.channel_user_id, { text: reminderText });
                  sent = true;
                } catch (e) {
                  log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'wa_freeform_reminder' });
                }
              }
            } else if (await canSendTemplate(ctx)) {
              // Outside 24h — use template
              const channelConfig = await getChannelConfig(ctx, ctx.tenantId, 'whatsapp', ctx.BOT_ENCRYPTION_KEY || null);
              if (channelConfig?.token && channelConfig?.config?.phone_number_id) {
                try {
                  const templateName = do24 ? 'appointment_reminder_24h' : 'appointment_reminder_2h';
                  await sendTemplateMessage(
                    channelConfig.config.phone_number_id,
                    channelConfig.token,
                    identity.channel_user_id,
                    templateName,
                    'en_US',
                    buildReminderComponents(vars),
                  );
                  await trackTemplateUsage(ctx, templateName, 0);
                  sent = true;
                } catch (e) {
                  log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'wa_template_reminder' });
                }
              }
            } else {
              // Outside 24h AND the plan's monthly template quota is
              // exhausted. Pre-fix this branch was silent and the client
              // simply got no reminder — the owner had no signal to top
              // up the plan or call the client manually. Emit a
              // structured event so the dashboard and ops can surface it.
              void logEvent(ctx, 'wa.template.quota_exhausted', {
                level: 'warn',
                tenantId: ctx.tenantId,
                message: 'WA reminder skipped: outside 24h window and no template quota left on this plan',
                data: {
                  appointmentId: row.id,
                  reminderKind: do24 ? '24h' : '2h',
                  channel: 'whatsapp',
                },
              });
            }
          } else if (identity.channel_type === 'instagram' && canUse(ctx, 'instagram')) {
            const withinWindow = await isWithinMessageWindow(ctx, 'instagram', identity.channel_user_id);
            if (withinWindow) {
              // IG: only send within 24h window (no templates)
              const reminderText = fill(t(lg, do24 ? 'rem_24' : 'rem_2'), vars);
              const channelConfig = await getChannelConfig(ctx, ctx.tenantId, 'instagram', ctx.BOT_ENCRYPTION_KEY || null);
              if (channelConfig?.token && channelConfig?.config?.page_id) {
                try {
                  const { InstagramAdapter } = await import('../channels/instagram.js');
                  const adapter = new InstagramAdapter({ tenantId: ctx.tenantId, channelConfig });
                  await adapter.send(identity.channel_user_id, { text: reminderText });
                  sent = true;
                } catch (e) {
                  log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'ig_reminder' });
                }
              }
            }
            // Outside 24h on IG — skip (no template system)
          }
          if (sent) break;
        }
      }

      // Fallback to Telegram if not sent via other channel
      if (!sent) {
        if (do24) await send(ctx, row.chat_id, fill(t(lg, 'rem_24'), vars));
        if (do2) await send(ctx, row.chat_id, fill(t(lg, 'rem_2'), vars));
      }
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'reminder', aptId: row.id });
    }
  }
}

// ─── Phase 2: post-appointment review requests ──────────────────────────
export async function phaseReviews(ctx, now) {
  const reviewsEnabled = await getConfig(ctx, 'reviews_enabled');
  if (!reviewsEnabled) return;
  const nowSec = Math.floor(now / 1000);
  const oneDayAgoSec = nowSec - 24 * 3600;
  // Find confirmed appointments that ended within the last 24h and haven't been requested yet
  const doneApts = await dbAll(ctx,
    `SELECT a.id, a.chat_id, a.svc_id, a.master_id, a.ts, s.duration
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.svc_id = a.svc_id
     WHERE a.tenant_id = ? AND a.status = 'confirmed' AND a.cancelled = 0
       AND a.review_requested = 0
       AND (a.ts / 1000 + COALESCE(s.duration, 60) * 60) < ?
       AND (a.ts / 1000 + COALESCE(s.duration, 60) * 60) > ?
     LIMIT 20`,
    ctx.tenantId, nowSec, oneDayAgoSec,
  );
  for (const apt of doneApts) {
    try {
      const lg = (await getLang(ctx, apt.chat_id)) || 'ru';
      const stars = ['1', '2', '3', '4', '5'].map(n => ({
        text: '⭐'.repeat(Number(n)),
        callback_data: `rev:${apt.id}:${n}`,
      }));
      await send(ctx, apt.chat_id, t(lg, 'review_request'), {
        reply_markup: { inline_keyboard: [stars] },
      });
      await markReviewRequested(ctx, apt.id);
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'review_request', aptId: apt.id });
    }
  }
}

// ─── Phase: post-visit follow-up (24h after the visit) ──────────────────
/**
 * Marketing trigger fired by the 24h-after-visit sweep. Distinct from the
 * immediate `appointment.done` dispatch (appointmentAutomations.js) so the
 * delayed follow-up and the at-done message stay independently configurable
 * and never collide on the same automation row.
 */
export const POST_VISIT_FOLLOWUP_TRIGGER = 'post_visit_24h';
/** Send the follow-up once the visit ended at least this long ago. */
export const POST_VISIT_FOLLOWUP_DELAY_SEC = 24 * 60 * 60;
/**
 * Don't follow up on visits older than DELAY + LOOKBACK. The
 * `followup_24h_sent_at` flag already prevents re-sends; this floor just
 * stops a first deploy (or a long worker outage) from blasting weeks-old
 * visits in a single tick.
 */
export const POST_VISIT_FOLLOWUP_LOOKBACK_SEC = 48 * 60 * 60;

/**
 * Pure decision helper: is an appointment whose visit ended at `endSec`
 * (unix seconds) due for the 24h-after follow-up at `nowSec`?
 *
 * Due when the visit ended >=24h ago but still within the look-back floor.
 * Exported so the window can be locked in by unit tests without a DB.
 */
export function isPostVisitFollowupDue(endSec, nowSec, lookbackSec = POST_VISIT_FOLLOWUP_LOOKBACK_SEC) {
  if (!Number.isFinite(endSec)) return false;
  const dueAt = nowSec - POST_VISIT_FOLLOWUP_DELAY_SEC;
  const floor = dueAt - lookbackSec;
  return endSec <= dueAt && endSec > floor;
}

/**
 * Fire the post-visit follow-up ~24h after a visit, on both channels:
 *   - email/SMS via the marketing pipeline (any enabled `post_visit_24h`
 *     automation; consent-gated inside fireAutomationForEvent)
 *   - Telegram star review ask (opt-in via `post_visit_followup_tg_enabled`),
 *     reusing the existing `rev:` rating keyboard
 *
 * Idempotency: claim-by-conditional-UPDATE on
 * `appointments.followup_24h_sent_at` so overlapping cron ticks / queue
 * redeliveries can never double-send. The claim runs BEFORE the sends, so a
 * crash mid-phase drops at most one follow-up rather than risking a
 * duplicate.
 *
 * Mirrors processPostVisitConfirmations: a coarse SQL pre-filter (simple
 * status flags + `ts <= now`) plus a JS time-window decision via
 * isPostVisitFollowupDue, so the SQL stays simple enough for the test
 * mock-db parser.
 */
export async function phasePostVisitFollowup(ctx, now) {
  const nowSec = Math.floor(now / 1000);

  // Cheap early-out: do nothing unless the owner enabled the Telegram ask
  // OR configured an enabled post_visit_24h email/SMS automation (a
  // platform-default tenant_id=NULL row counts too).
  const tgEnabled = !!(await getConfig(ctx, 'post_visit_followup_tg_enabled'));
  const hasEmailAuto = !!(await dbGet(ctx,
    'SELECT 1 AS x FROM marketing_automations WHERE trigger_type = ? AND enabled = 1 AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1',
    POST_VISIT_FOLLOWUP_TRIGGER, ctx.tenantId,
  ));
  if (!tgEnabled && !hasEmailAuto) return;

  // Coarse scan: completed, non-cancelled, non-no-show visits not yet
  // followed up, that have already started. WHERE is single-line and free of
  // IN(...) so the test mock-db parser can exercise it; the precise 24h
  // window is decided in JS below.
  const rows = await dbAll(ctx,
    'SELECT id, ts, duration, svc_id, chat_id FROM appointments WHERE tenant_id = ? AND status = ? AND cancelled = 0 AND no_show = 0 AND followup_24h_sent_at IS NULL AND ts <= ? ORDER BY ts ASC LIMIT 50',
    ctx.tenantId, 'done', now,
  );
  if (!rows.length) return;

  const svcDurMap = new Map((ctx.svc || []).map(s => [s.id, s.dur]));

  for (const r of rows) {
    try {
      // Per-appointment duration override (migration 0106) wins over the
      // service's nominal duration.
      const durMin = r.duration ?? svcDurMap.get(r.svc_id) ?? 60;
      const endSec = Math.floor(r.ts / 1000) + durMin * 60;
      if (!isPostVisitFollowupDue(endSec, nowSec)) continue;

      // Claim the row — only the winner of the conditional UPDATE sends.
      const claim = await dbRun(ctx,
        'UPDATE appointments SET followup_24h_sent_at = ? WHERE id = ? AND tenant_id = ? AND followup_24h_sent_at IS NULL',
        nowSec, r.id, ctx.tenantId,
      );
      const claimed = (claim?.meta?.changes ?? claim?.changes ?? 0) > 0;
      if (!claimed) continue;

      // Email/SMS — fires any enabled post_visit_24h automation for this
      // client (no-op if they have no consented marketing_contacts row).
      if (hasEmailAuto) {
        await fireAutomationForEvent(ctx, POST_VISIT_FOLLOWUP_TRIGGER, { chatId: r.chat_id });
      }

      // Telegram review ask (opt-in) — same star keyboard as phaseReviews so
      // ratings flow into the existing `rev:` callback handler.
      if (tgEnabled && r.chat_id != null) {
        const lg = (await getLang(ctx, r.chat_id).catch(() => null)) || 'ru';
        const stars = ['1', '2', '3', '4', '5'].map(n => ({
          text: '⭐'.repeat(Number(n)),
          callback_data: `rev:${r.id}:${n}`,
        }));
        await send(ctx, r.chat_id, t(lg, 'review_request'), {
          reply_markup: { inline_keyboard: [stars] },
        });
      }
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'post_visit_followup', aptId: r.id });
    }
  }
}

// ─── Phase 3: Google Calendar retry sync ────────────────────────────────
export async function phaseGcalSync(ctx, now) {
  const MAX_SYNC_PER_CRON = 10;
  if (!canUse(ctx, 'calendar')) return;
  const futureTs = now - 60 * 60 * 1000; // allow 1h window for recently-past apts
  const unsynced = await dbAll(ctx,
    `SELECT * FROM appointments
     WHERE tenant_id = ? AND status = 'confirmed' AND cancelled = 0
       AND google_event_id IS NULL AND ts > ?
       AND (sync_retries IS NULL OR sync_retries < 5)
       AND (sync_retry_after IS NULL OR sync_retry_after < ?)
     ORDER BY created_at ASC LIMIT ?`,
    ctx.tenantId, futureTs, now, MAX_SYNC_PER_CRON,
  );
  for (const row of unsynced) {
    try {
      const apt = {
        id: row.id, tenantId: row.tenant_id, chatId: row.chat_id,
        svcId: row.svc_id, date: row.date, time: row.time, ts: row.ts,
        status: row.status, masterId: row.master_id || row.confirmed_by || null,
        confirmedBy: row.confirmed_by || null, userName: row.user_name,
        userPhone: row.user_phone, userTg: row.user_tg,
        googleEventId: row.google_event_id, googleCalendarId: row.google_calendar_id,
        googleIntegrationId: row.google_integration_id,
      };
      const result = await syncAppointmentCalendar(ctx, apt);
      if (result?.ok) {
        log.info('handlers.cron', { message: 'gcal re-synced apt', aptId: apt.id, date: apt.date, time: apt.time });
        await dbRun(ctx,
          'UPDATE appointments SET sync_retries = 0, sync_retry_after = NULL, sync_last_error = NULL WHERE id = ? AND tenant_id = ?',
          apt.id, ctx.tenantId);
      } else if (result?.skipped) {
        // calendar not connected — skip silently
      } else {
        const retries = (row.sync_retries || 0) + 1;
        const backoffMs = Math.min(15 * 60 * 1000 * Math.pow(2, retries), 24 * 60 * 60 * 1000);
        await dbRun(ctx,
          'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
          retries, now + backoffMs, (result?.error || 'sync failed').slice(0, 200), apt.id, ctx.tenantId);
        if (retries >= 5) {
          log.error('handlers.cron', new Error(`gcal sync permanently failed for apt after ${retries} retries`), { aptId: apt.id });
        } else {
          log.warn('handlers.cron', { message: 'gcal cron sync failed', aptId: apt.id, retry: retries, error: result?.error });
        }
      }
    } catch (e) {
      const retries = (row.sync_retries || 0) + 1;
      const backoffMs = Math.min(15 * 60 * 1000 * Math.pow(2, retries), 24 * 60 * 60 * 1000);
      await dbRun(ctx,
        'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
        retries, now + backoffMs, (e.message || 'unknown error').slice(0, 200), row.id, ctx.tenantId).catch(() => {});
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'gcal_sync', aptId: row.id, retry: retries });
    }
  }
}

// ─── Phase 4: post-visit confirmation flow ──────────────────────────────
export async function phasePostVisit(ctx, now) {
  return processPostVisitConfirmations(ctx, now);
}

// ─── Phase 5: auto-promo (birthday + returning client) ──────────────────
export async function phasePromos(ctx, now) {
  return processBirthdayAndReturningPromos(ctx, now);
}

// ─── Phase 6: cleanup (legacy phases 3+4+5 combined) ────────────────────
export async function phaseCleanup(ctx, now) {
  // expired/cancelled appointments
  await dbRun(ctx,
    'DELETE FROM appointments WHERE tenant_id = ? AND (cancelled = 1 OR ts < ?)',
    ctx.tenantId, now - CLEANUP_AFTER_MS,
  );
  // stale message windows (>30 days inactive)
  const staleThresholdSec = Math.floor((now - 30 * 24 * 3600 * 1000) / 1000);
  await dbRun(ctx,
    'DELETE FROM message_windows WHERE tenant_id = ? AND last_user_message_at < ?',
    ctx.tenantId, staleThresholdSec,
  );
  // rate_limit cleanup (Sprint 2)
  const rlCutoff = Math.floor(now / 1000) - 86400;
  await dbRun(ctx, 'DELETE FROM rate_limits WHERE window_start < ?', rlCutoff);
}

// ─── Phase 7 (P1-10): retention pruning ─────────────────────────────────
/**
 * Prune append-only tables per retention SLA. Each DELETE in its own
 * try/catch so a failure on one table doesn't block the others. Emits
 * `cron.retention.pruned` events with `{table, rows}` after each successful
 * prune.
 *
 * Retention windows (relax.md §1 P1-10):
 *   audit_log                     — 180 days
 *   error_log                     — 30 days
 *   analytics_events              — 365 days
 *   permission_elevation_codes    — 7 days past expires_at
 *   stripe_events                 — 90 days (received_at)
 *   marketing_sends               — 90 days (delivered + sent_at)
 *
 * The `tenantId` argument is informational — these tables are append-only
 * platform-wide caches, not tenant-scoped, so pruning runs globally once
 * per tenant invocation that wins the 24h idempotency window race.
 */
/**
 * Rows-per-table ceiling. If a single retention pass would touch more than
 * this many rows we treat it as a sign of trouble (clock skew, migration
 * accident, ingest gone wild) and skip that one table. The other tables
 * continue normally.
 */
export const RETENTION_MAX_ROWS = 50_000;

/**
 * Retention pass declarations. Each entry exposes the same WHERE clause for
 * COUNT / SELECT / DELETE so the archive and the DELETE see exactly the
 * same row set. The clauses are static (no user input) so inlining them
 * into the SQL string is safe.
 */
const RETENTION_PRUNES = Object.freeze([
  { table: 'audit_log',                  where: "created_at < strftime('%s','now','-180 days')" },
  // error_log was 30d — too tight for "check the logs once a month and
  // spot a pattern" ops loop. 90d matches stripe_events / marketing_sends
  // retention and gives a quarter of history without blowing storage.
  { table: 'error_log',                  where: "created_at < strftime('%s','now','-90 days')" },
  { table: 'analytics_events',           where: "created_at < strftime('%s','now','-365 days')" },
  { table: 'permission_elevation_codes', where: "expires_at < strftime('%s','now','-7 days')" },
  { table: 'stripe_events',              where: "received_at < strftime('%s','now','-90 days')" },
  { table: 'marketing_sends',            where: "status = 'delivered' AND sent_at < strftime('%s','now','-90 days')" },
]);

/**
 * Gzip an array of objects as NDJSON via the Web CompressionStream API
 * (available in Cloudflare Workers and modern Node). Returns an ArrayBuffer
 * suitable for R2Bucket.put.
 */
async function gzipNdjson(rows) {
  const ndjson = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const source = new Blob([ndjson]).stream();
  const compressed = source.pipeThrough(new CompressionStream('gzip'));
  return await new Response(compressed).arrayBuffer();
}

/** ISO-8601 archive key: archive/{table}/YYYY-MM-DDTHHmmssZ.jsonl.gz */
export function archiveKey(table, date = new Date()) {
  const iso = date.toISOString();          // 2026-05-12T09:36:01.234Z
  const day = iso.slice(0, 10);            // 2026-05-12
  const time = iso.slice(11, 19).replace(/:/g, ''); // 093601
  return `archive/${table}/${day}T${time}Z.jsonl.gz`;
}

/**
 * Archive the rows that are about to be deleted to R2 as gzipped NDJSON.
 * Returns { ok, key, error }. Failure is non-fatal — the caller logs it
 * and continues with the DELETE so a transient R2 outage never blocks
 * data expiry.
 */
async function archiveRowsToR2(ctx, table, rows) {
  if (!ctx?.ARCHIVE || typeof ctx.ARCHIVE.put !== 'function') {
    return { ok: false, error: 'no_archive_binding' };
  }
  if (!rows.length) return { ok: true, key: null, skipped: 'empty' };
  try {
    const body = await gzipNdjson(rows);
    const key = archiveKey(table);
    await ctx.ARCHIVE.put(key, body, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { table, rows: String(rows.length) },
    });
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Prune append-only tables per retention SLA.
 *
 * For each table the pass:
 *   1. SELECT COUNT(*) to size the prune.
 *   2. If ctx.RETENTION_DRY_RUN === "1" emit cron.retention.dryrun and skip.
 *   3. If count > RETENTION_MAX_ROWS emit cron.retention.skipped and skip
 *      (operator investigates — clock skew or a runaway ingest is the
 *      typical cause).
 *   4. Otherwise: archive to R2 (gzipped NDJSON), then DELETE. Archive
 *      failure is non-blocking — we log cron.retention.archive_failed and
 *      still run DELETE, because compliance retention must not be held
 *      hostage to a stuck R2 binding.
 *
 * Each table is independent — one failure does not block the others. The
 * `tenantId` argument is informational; these tables are platform-wide.
 */
export async function phaseRetention(ctx, tenantId, _now) {
  if (!ctx?.db) return;
  const dryRun = String(ctx?.RETENTION_DRY_RUN ?? '') === '1';

  for (const { table, where } of RETENTION_PRUNES) {
    try {
      const countRow = await dbGet(ctx, `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`);
      const count = Number(countRow?.c ?? 0);

      if (dryRun) {
        void logEvent(ctx, 'cron.retention.dryrun', {
          level: 'info',
          tenantId,
          message: `[dry-run] Would prune ${count} rows from ${table}`,
          table,
          rows: count,
        });
        continue;
      }

      if (count > RETENTION_MAX_ROWS) {
        log.warn('handlers.cron', {
          action: 'retention_skip_overflow', table, rows: count, cap: RETENTION_MAX_ROWS,
        });
        void logEvent(ctx, 'cron.retention.skipped', {
          level: 'warn',
          tenantId,
          message: `Skipped ${table}: ${count} rows > cap ${RETENTION_MAX_ROWS}`,
          table,
          rows: count,
          cap: RETENTION_MAX_ROWS,
        });
        continue;
      }

      if (count > 0) {
        const rows = await dbAll(ctx, `SELECT * FROM ${table} WHERE ${where}`);
        const archive = await archiveRowsToR2(ctx, table, rows);
        if (archive.ok && archive.key) {
          void logEvent(ctx, 'cron.retention.archived', {
            level: 'info',
            tenantId,
            message: `Archived ${rows.length} rows of ${table} to ${archive.key}`,
            table,
            rows: rows.length,
            key: archive.key,
          });
        } else if (!archive.ok) {
          log.warn('handlers.cron', {
            action: 'retention_archive_failed', table, error: archive.error,
          });
          void logEvent(ctx, 'cron.retention.archive_failed', {
            level: 'warn',
            tenantId,
            message: `Archive of ${table} failed (${archive.error}); proceeding with DELETE`,
            table,
            error: String(archive.error).slice(0, 200),
          });
        }
      }

      const result = await dbRun(ctx, `DELETE FROM ${table} WHERE ${where}`);
      const rows = Number(
        result?.meta?.changes ??
        result?.changes ??
        result?.rowsAffected ??
        0,
      );
      void logEvent(ctx, 'cron.retention.pruned', {
        level: 'info',
        tenantId,
        message: `Pruned ${rows} rows from ${table}`,
        table,
        rows,
      });
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'retention_prune', table });
      void logEvent(ctx, 'cron.phase.error', {
        level: 'error',
        tenantId,
        message: `retention prune ${table} failed: ${e?.message ?? 'unknown'}`,
        phase: 'retention',
        table,
        error: e?.message?.slice(0, 200),
      });
    }
  }
}

// ─── PR-A: Marketing campaign dispatch ───────────────────────────────────
/**
 * Pick up `marketing_campaigns` that are due and fan them out via the
 * worker-side sender. Two queues:
 *
 *   1. status='scheduled' AND scheduled_at <= nowSec   (planned sends)
 *   2. status='sending' AND started_at < nowSec - 30m  (crashed-mid-fanout)
 *
 * Both run through `runCampaignSend` which is idempotent at the
 * (campaign, contact) level — re-running it on a partially-sent campaign
 * will only insert send rows for contacts that don't yet have one.
 * Limit of 10 campaigns per cron tick to keep CPU bounded.
 */
export async function phaseMarketingDispatch(ctx, nowMs) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const MAX_PER_TICK = 10;
  const STUCK_SEC = 30 * 60;

  const nowS = Math.floor((nowMs ?? Date.now()) / 1000);
  const stuckCutoff = nowS - STUCK_SEC;

  let due = [];
  try {
    due = await dbAll(ctx,
      `SELECT id FROM marketing_campaigns
       WHERE tenant_id = ?
         AND (
           (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?)
           OR (status = 'sending' AND coalesce(started_at, 0) < ?)
         )
       ORDER BY scheduled_at ASC NULLS LAST, updated_at ASC
       LIMIT ?`,
      ctx.tenantId, nowS, stuckCutoff, MAX_PER_TICK);
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)),
      { action: 'marketing_dispatch_query' });
    return;
  }

  if (due.length === 0) return;

  for (const row of due) {
    try {
      const r = await runMarketingCampaign(ctx, ctx.tenantId, row.id);
      void logEvent(ctx, 'cron.marketing_dispatch.sent', {
        level: r.ok ? 'info' : 'warn',
        tenantId: ctx.tenantId,
        message: `marketing dispatch ${row.id}: ${r.status} sent=${r.sent} failed=${r.failed} deferred=${r.deferred}`,
        campaignId: row.id,
        sent: r.sent,
        failed: r.failed,
        deferred: r.deferred,
        finalStatus: r.status,
        error: r.error,
      });
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)),
        { action: 'marketing_dispatch', campaignId: row.id });
      void logEvent(ctx, 'cron.phase.error', {
        level: 'error',
        tenantId: ctx.tenantId,
        message: `marketing dispatch ${row.id} threw: ${e?.message ?? 'unknown'}`,
        phase: 'marketingDispatch',
        campaignId: row.id,
        error: e?.message?.slice(0, 200),
      });
    }
  }
}

// ─── Phase 8: plugin cron dispatch ──────────────────────────────────────
/**
 * Drive cron-backed plugins for this tenant. For every enabled
 * `plugin_installations` row whose slug is in `PLUGIN_CRON_DISPATCHERS`,
 * invoke the handler with full per-tenant `ctx`. Each plugin runs inside
 * its own try/catch so a misbehaving plugin cannot break sibling plugins
 * or the rest of the cron orchestrator.
 *
 * Tenant-scoped only — platform-scope (tenant_id IS NULL) installs are
 * skipped here. If a future plugin needs global-once cron we will add a
 * separate global orchestrator; tenant-fan-out is correct for reminders
 * + checklists + everything currently on the roadmap.
 */
export async function phasePluginCron(ctx, nowMs, dispatchers = PLUGIN_CRON_DISPATCHERS) {
  if (!ctx?.db || !ctx?.tenantId) return;
  let installs;
  try {
    installs = await dbAll(
      ctx,
      `SELECT id, tenant_id, plugin_slug, enabled, billing_state, settings_json
         FROM plugin_installations
        WHERE tenant_id = ? AND enabled = 1`,
      ctx.tenantId,
    );
  } catch (e) {
    log.warn('handlers.cron', {
      action: 'plugin_cron_query_failed',
      tenantId: ctx.tenantId,
      error: e?.message,
    });
    return;
  }
  for (const install of installs) {
    const dispatcher = dispatchers[install.plugin_slug];
    if (!dispatcher) continue;
    // Treat past_due / canceled paid addons as disabled at runtime even when
    // the enabled=1 flag still says yes — matches assertPluginEnabled gating
    // on the read side.
    if (install.billing_state === 'canceled' || install.billing_state === 'past_due') {
      continue;
    }
    try {
      await dispatcher(ctx, install, nowMs);
    } catch (e) {
      log.error(
        'handlers.cron',
        e instanceof Error ? e : new Error(String(e?.message)),
        {
          action: 'plugin_cron_failed',
          slug: install.plugin_slug,
          installationId: install.id,
        },
      );
      void logEvent(ctx, 'cron.plugin.error', {
        level: 'error',
        tenantId: ctx.tenantId,
        message: `plugin cron ${install.plugin_slug} failed: ${e?.message ?? 'unknown'}`,
        data: { slug: install.plugin_slug, installationId: install.id },
      });
    }
  }
}

/**
 * Thin orchestrator. Each phase runs inside `runPhase` which:
 *   - Checks the idempotency window (skip if last-run was inside the window).
 *   - Catches throws, emits `cron.phase.error`, and continues to next phase.
 *   - Persists the last-run epoch on success.
 */
export async function handleCron(ctx) {
  try {
    await initServices(ctx);
    const now = Date.now();
    const w = warsawNow();

    // `now` is Date.now() MILLISECONDS — every phase below consumes it as ms.
    // checkBillingExpiry, however, compares against trial_ends_at / grace_ends_at
    // which are stored in UNIX SECONDS. Passing ms made `now > trialEndsAt`
    // always true, flipping every trialing/grace tenant to `inactive` on the
    // first cron tick (zero-length trials + grace). Convert to seconds here.
    await checkBillingExpiry(ctx, Math.floor(now / 1000));

    if (!ctx?.db || !ctx?.tenantId) return;

    // Phase 0 (always-run): IG token health check + daily webhook resubscribe
    try {
      const igConfig = await getChannelConfig(ctx, ctx.tenantId, 'instagram', ctx.BOT_ENCRYPTION_KEY || null);
      if (igConfig) {
        if (!igConfig.token) {
          log.error('handlers.cron', new Error('IG token missing or failed to decrypt — update via POST /admin/ig-token'), { tenantId: ctx.tenantId });
        } else if (isTokenExpiring(igConfig, 10)) {
          log.warn('handlers.cron', { message: 'IG token expiring soon, attempting refresh', tenantId: ctx.tenantId });
          const refreshResult = await refreshInstagramToken(ctx, ctx.tenantId, igConfig.id, ctx.BOT_ENCRYPTION_KEY || null);
          if (refreshResult.ok) {
            log.info('handlers.cron', { message: 'IG token refreshed', tenantId: ctx.tenantId });
          } else {
            log.error('handlers.cron', new Error('IG token refresh failed — update manually via POST /admin/ig-token'), { tenantId: ctx.tenantId, error: refreshResult.error });
          }
        }
        // Re-prime Meta Page → App webhook subscription. Diagnosed 2026-05-14:
        // subscription silently lapsed for @manicbot_com IG, worker tail saw
        // zero POSTs for hours. Running this daily keeps the link warm.
        if (igConfig.token && igConfig.page_id) {
          await maybeResubscribeIgWebhook(ctx, igConfig, now);
        }
      }
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'ig_token_health_check' });
    }

    try {
      await renewExpiringGoogleWatches(ctx);
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'gcal_watch_renew' });
    }

    // #L4 — deterministic rate-limit table cleanup. Old design ran a 10%
    // probabilistic sweep on every checkAndIncrement call; under sustained
    // load that lagged behind ingest and let the table grow unbounded. The
    // cron firing already iterates per-tenant; we only need it to fire once
    // per Worker schedule.
    try {
      const removed = await cleanupRateLimits(ctx, 86400);
      if (removed > 0) {
        log.info('handlers.cron', { action: 'rate_limit_cleanup', removed });
      }
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'rate_limit_cleanup' });
    }

    // Always-run health probe (its own idempotency window inside).
    try {
      await phaseChannelHealth(ctx, now);
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'channel_health' });
    }

    // Idempotent phases.
    await runPhase(ctx, 'reminders', () => phaseReminders(ctx, now, w));
    await runPhase(ctx, 'reviews', () => phaseReviews(ctx, now));
    await runPhase(ctx, 'gcalSync', () => phaseGcalSync(ctx, now));
    await runPhase(ctx, 'postVisit', () => phasePostVisit(ctx, now));
    // Post-visit follow-up: ~24h after the visit, fire the «После визита»
    // marketing template (email/SMS) + an opt-in Telegram review ask.
    await runPhase(ctx, 'postVisitFollowup', () => phasePostVisitFollowup(ctx, now));
    await runPhase(ctx, 'promos', () => phasePromos(ctx, now));
    await runPhase(ctx, 'cleanup', () => phaseCleanup(ctx, now));
    await runPhase(ctx, 'retention', () => phaseRetention(ctx, ctx.tenantId, now));
    await runPhase(ctx, 'attachmentGc', () => phaseAttachmentGc(ctx, ctx.tenantId, now));
    // PR-A: marketing campaign dispatch. Picks up status='scheduled' rows
    // whose scheduled_at <= now, plus rebooks any campaign stuck in
    // status='sending' for >30min (crashed mid-fan-out).
    await runPhase(ctx, 'marketingDispatch', () => phaseMarketingDispatch(ctx, now));
    // Platform operator campaigns (migration 0100): deliver due announcements /
    // monthly reports / subscription reminders to THIS tenant's owner(s) across
    // the selected channels. Idempotent via platform_campaign_deliveries.
    await runPhase(ctx, 'platformCampaigns', () => phasePlatformCampaigns(ctx, now));
    // Referral reward 12-month expiry sweep. Idempotent — `runPhase` enforces
    // a 24h gap via `cron:phase:referral_expiry:last`, and individual reward
    // reversals carry an Idempotency-Key to Stripe.
    await runPhase(ctx, 'referral_expiry', async () => {
      const { phaseReferralExpiry } = await import('../billing/referralWebhooks.js');
      return phaseReferralExpiry(ctx);
    });
    // Plugin cron dispatch — runs every installed cron-backed plugin
    // (currently: reminders). Each plugin handler is isolated by its
    // own try/catch so a misbehaving plugin cannot break siblings.
    await runPhase(ctx, 'pluginCron', () => phasePluginCron(ctx, now));
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)));
  }
}

/**
 * Hard cap on Stage-1 prompt retries. After this many seconds post-end
 * we give up and auto-done regardless of Stage-1 status. Without the cap
 * a master who blocked the bot (or has a broken Telegram client) would
 * pin appointments forever and `processPostVisitConfirmations` would
 * keep retrying the prompt on every cron tick.
 */
export const POST_VISIT_HARD_CAP_SEC = 3 * 24 * 3600; // 72h post-end

/**
 * Pure decision helper: should this appointment be auto-marked 'done'
 * at the T+24h sweep?
 *
 * Exported so the boolean can be locked in by unit tests without the
 * full cron round-trip.
 *
 * @param {{
 *   master_id: number|null,
 *   master_is_synthetic: number|boolean,
 *   review_requested_at: number|null,
 * }} apt
 * @param {number} endSec - appointment_ts + duration*60 (unix seconds)
 * @param {number} oneDayAgoSec - nowSec - 24h
 * @param {number} hardCapAgoSec - nowSec - POST_VISIT_HARD_CAP_SEC
 * @returns {boolean}
 */
export function shouldAutoDonePostVisit(apt, endSec, oneDayAgoSec, hardCapAgoSec) {
  // Still inside the T+24h window — too early to auto-done.
  if (endSec > oneDayAgoSec) return false;
  // Past the hard cap — give up and auto-done regardless of Stage-1 state.
  if (endSec <= hardCapAgoSec) return true;
  // Master cannot receive a Telegram prompt (synthetic personal-master,
  // negative id placeholder for manual bookings, or null). Stage 1 was
  // intentionally skipped — there's nothing to wait for.
  const hasRealMaster = !!(apt.master_id && apt.master_id > 0 && !apt.master_is_synthetic);
  if (!hasRealMaster) return true;
  // Real master AND Stage 1 prompt confirmed sent (review_requested_at
  // populated). Master had ≥22h to tap a button; auto-done now.
  // Empty review_requested_at = Stage 1 has not been delivered yet (the
  // send failed transiently or the master hasn't been pickup-able). Defer
  // — Stage 1 retries every cron tick until the hard cap.
  return apt.review_requested_at != null;
}

/**
 * Sprint 3 Section 8: post-visit confirmation flow.
 *
 * Stage 1 (T+2h): for each appointment that ended ≥2h ago, send the
 * master a "did the visit happen?" prompt. Only set review_requested_at
 * + emit analytics when the send actually succeeds — a transient TG
 * failure must be retryable on the next cron tick.
 *
 * Stage 2 (T+24h): for appointments still unconfirmed, auto-mark as
 * 'done' with visit_confirmed_by='auto'. Gated by `shouldAutoDonePostVisit`
 * so we never auto-done an appointment whose Stage-1 prompt has not been
 * delivered (the master would silently lose visits to a TG outage). After
 * POST_VISIT_HARD_CAP_SEC post-end we give up and auto-done regardless.
 */
async function processPostVisitConfirmations(ctx, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const twoHoursAgo = nowSec - 2 * 3600;
  const oneDayAgo = nowSec - 24 * 3600;
  const hardCapAgo = nowSec - POST_VISIT_HARD_CAP_SEC;

  // Compute appointment end_at = ts + service duration. Filter on ts and
  // post-filter in JS — typical tenant has <500 open apts.
  //
  // LEFT-join the masters table so we can read `is_synthetic` per appointment. A NULL
  // join (master_id with no corresponding masters row) is treated as
  // non-synthetic so legacy rows behave as before — the existing
  // `master_id > 0` guard further protects against negative synthetic ids
  // used for manual-booking clients. Synthetic personal-master chat_ids
  // (range 10B+) MUST be skipped here — they have no real Telegram chat
  // and sendMessage would fail silently for the post-visit prompt.
  const candidates = await dbAll(ctx, `
    SELECT a.id, a.ts, a.date, a.time, a.svc_id, a.chat_id, a.master_id,
           a.review_requested_at,
           COALESCE(m.is_synthetic, 0) AS master_is_synthetic
    FROM appointments a
    LEFT JOIN masters m
      ON m.tenant_id = a.tenant_id AND m.chat_id = a.master_id
    WHERE a.tenant_id = ?
      AND a.status = 'confirmed'
      AND a.cancelled = 0
      AND a.visit_confirmed_at IS NULL
      -- a.ts is epoch MILLISECONDS (Warsaw->UTC); compare against nowMs. BUG-03:
      -- binding nowSec here matched nothing, silently disabling post-visit.
      AND a.ts <= ?
    LIMIT 200
  `, ctx.tenantId, nowMs);

  if (!candidates.length) return;

  const svcDurMap = new Map((ctx.svc || []).map(s => [s.id, s.dur]));

  // Stage 2: T+24h → auto-done, with the Stage-1-completion gate.
  const toAutoDone = [];
  for (const a of candidates) {
    const dur = svcDurMap.get(a.svc_id) || 60;
    const endSec = Math.floor(a.ts / 1000) + dur * 60; // a.ts ms -> seconds (BUG-03)
    if (shouldAutoDonePostVisit(a, endSec, oneDayAgo, hardCapAgo)) {
      toAutoDone.push(a.id);
    }
  }
  if (toAutoDone.length) {
    const placeholders = toAutoDone.map(() => '?').join(',');
    await dbRun(ctx, `
      UPDATE appointments
      SET status = 'done', visit_confirmed_at = ?, visit_confirmed_by = 'auto'
      WHERE tenant_id = ? AND id IN (${placeholders})
    `, nowSec, ctx.tenantId, ...toAutoDone);
  }

  // Stage 1: T+2h → prompt master, set review_requested_at on success.
  const toPrompt = [];
  for (const a of candidates) {
    if (toAutoDone.includes(a.id)) continue;
    // Already prompted on a previous cron tick — skip (the analytics event
    // only fires once, see below).
    if (a.review_requested_at != null) continue;
    const dur = svcDurMap.get(a.svc_id) || 60;
    const endSec = Math.floor(a.ts / 1000) + dur * 60; // a.ts ms -> seconds (BUG-03)
    if (endSec <= twoHoursAgo) toPrompt.push(a);
  }
  for (const a of toPrompt) {
    try {
      const hasRealMaster = !!(a.master_id && a.master_id > 0 && !a.master_is_synthetic);
      // promptOk semantics: true when the prompt was delivered OR when no
      // prompt was needed (synthetic/no master). We only persist
      // review_requested_at + analytics when promptOk — a transient TG
      // failure must remain retryable on the next cron tick.
      let promptOk = !hasRealMaster;
      if (hasRealMaster) {
        const client = await dbGet(ctx,
          'SELECT name, phone FROM users WHERE tenant_id = ? AND chat_id = ?',
          ctx.tenantId, a.chat_id,
        ).catch(() => null);
        const clientName = client?.name || 'клиент';
        const svc = (ctx.svc || []).find(s => s.id === a.svc_id);
        const svcLabel = svc ? (svc.names?.ru || svc.names?.en || svc.id) : a.svc_id;
        const text = `Был ли визит? ${clientName} — ${svcLabel} (${a.date} ${a.time})`;
        try {
          const sendRes = await send(ctx, a.master_id, text, {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Пришёл', callback_data: `visit_ok:${a.id}` },
                { text: '❌ Не пришёл', callback_data: `visit_noshow:${a.id}` },
              ]],
            },
          });
          promptOk = !!(sendRes && sendRes.ok !== false);
          if (!promptOk) {
            log.warn('handlers.cron', { action: 'post_visit_prompt_send_failed', aptId: a.id, masterId: a.master_id, description: sendRes?.description });
          }
        } catch (e) {
          log.warn('handlers.cron', { action: 'post_visit_prompt_send_threw', aptId: a.id, masterId: a.master_id, error: e?.message?.slice(0, 200) });
          promptOk = false;
        }
      }
      if (!promptOk) continue; // retry on next cron tick
      await dbRun(ctx,
        'UPDATE appointments SET review_requested_at = ? WHERE id = ? AND tenant_id = ?',
        nowSec, a.id, ctx.tenantId,
      );
      await dbRun(ctx, `
        INSERT INTO analytics_events (tenant_id, event, properties, created_at)
        VALUES (?, 'post_visit.prompt_sent', ?, ?)
      `, ctx.tenantId, JSON.stringify({ appointmentId: a.id, masterId: a.master_id }), nowSec);
    } catch { /* best-effort */ }
  }
}

/**
 * Sprint 4: auto-generate promo codes for:
 *   - birthday clients (today matches users.dob, once per year)
 *   - returning clients (last visit > 60 days ago, no promo issued in 90 days)
 *
 * P1-1: the returning-candidate INSERT used to be unconditional, dumping a
 * duplicate row every 15 min for 30 days per tenant per eligible client.
 * Now uses INSERT OR IGNORE against the partial UNIQUE index added in
 * migration 0055 (tenant_id, user_id, event, day) so dupes are silent.
 */
async function processBirthdayAndReturningPromos(ctx, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const today = new Date(nowMs).toISOString().slice(5, 10); // MM-DD

  // Returning-client promo: last visit 60-90 days ago, no existing returning
  // promo within 90 days. Emit analytics event — actual promo code creation
  // is delegated to the promoCodes.create tRPC procedure via a follow-up
  // worker job to keep the cron function idempotent and fast.
  try {
    const returning = await dbAll(ctx, `
      SELECT DISTINCT chat_id FROM appointments
      WHERE tenant_id = ?
        AND status = 'done'
        AND ts BETWEEN ? AND ?
      LIMIT 50
    `, ctx.tenantId, nowSec - 90 * 86400, nowSec - 60 * 86400);
    for (const r of returning) {
      // INSERT OR IGNORE + user_id set so the partial UNIQUE index in
      // migration 0055 dedups (tenant_id, user_id, event, day).
      await dbRun(ctx, `
        INSERT OR IGNORE INTO analytics_events (tenant_id, user_id, event, properties, created_at)
        VALUES (?, ?, 'promo.returning_candidate', ?, ?)
      `, ctx.tenantId, String(r.chat_id), JSON.stringify({ chatId: r.chat_id }), nowSec).catch(() => {});
    }
  } catch { /* best-effort */ }

  // Birthday promo: users whose dob MM-DD == today, no birthday promo
  // issued yet this year. Code is auto-generated as BDAY-{yyyy}-{chatId[-6:]}.
  try {
    const thisYear = new Date(nowMs).getUTCFullYear();
    const birthdayRows = await dbAll(ctx, `
      SELECT chat_id, name FROM users
      WHERE tenant_id = ? AND dob IS NOT NULL AND substr(dob, 6, 5) = ?
      LIMIT 50
    `, ctx.tenantId, today);

    for (const u of birthdayRows) {
      const code = `BDAY-${thisYear}-${String(u.chat_id).slice(-6)}`;
      // Skip if already issued
      const existing = await dbGet(ctx,
        'SELECT id FROM promo_codes WHERE tenant_id = ? AND code = ?',
        ctx.tenantId, code,
      ).catch(() => null);
      if (existing) continue;

      const validUntil = nowSec + 30 * 86400; // 30 days to redeem
      await dbRun(ctx, `
        INSERT OR IGNORE INTO promo_codes
          (tenant_id, code, kind, discount_type, discount_value,
           max_uses, max_uses_per_client, valid_from, valid_until,
           client_id, created_by, created_at)
        VALUES (?, ?, 'birthday', 'percent', 20, 1, 1, ?, ?, ?, 'system', ?)
      `, ctx.tenantId, code, nowSec, validUntil, String(u.chat_id), nowSec).catch(() => {});

      await dbRun(ctx, `
        INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at)
        VALUES (?, ?, 'promo.birthday_issued', ?, ?)
      `, ctx.tenantId, String(u.chat_id),
         JSON.stringify({ code, validUntil, name: u.name }), nowSec).catch(() => {});

      // Send the promo code to the client
      if (u.chat_id > 0) {
        await send(ctx, u.chat_id,
          `🎉 С днём рождения${u.name ? `, ${u.name}` : ''}!\n\nДарим промокод на -20%: <b>${code}</b>\nДействует 30 дней.`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      }

      // PR2 of notification center upgrade: drop an in-app row for the
      // tenant owner so they see "today is X's birthday" in their bell.
      // Idempotency: sourceId = `bday:${chatId}:${year}` so re-runs of the
      // cron in the same day collapse. Best-effort — bell-write failure
      // never breaks the promo flow.
      try {
        const ownerRows = await dbAll(
          ctx,
          "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
          ctx.tenantId,
        );
        const ownerWebUserId = ownerRows?.[0]?.id;
        if (ownerWebUserId) {
          const displayName = u.name ? String(u.name).trim() : 'клиента';
          await notifyWebUser(ctx, ownerWebUserId, {
            kind: 'birthday.client',
            title: `🎂 День рождения ${displayName}`,
            body: `Сегодня. Выдан промокод -20% ${code}.`,
            link: `/?tab=clients&q=${encodeURIComponent(displayName)}`,
            sourceSlug: 'birthday',
            sourceId: `bday:${u.chat_id}:${thisYear}`,
            inapp: true,
            telegram: false,
          }).catch((e) =>
            log.warn('handlers.cron', { action: 'birthday_notify_owner', error: e?.message?.slice(0, 200) }),
          );
        }
      } catch (e) {
        log.warn('handlers.cron', { action: 'birthday_notify_owner', error: e?.message?.slice(0, 200) });
      }
    }
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'birthday_promo' });
  }
}
