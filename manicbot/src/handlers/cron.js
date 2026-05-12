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
import { isTokenExpiring, refreshInstagramToken } from '../channels/token-manager.js';
import { cleanupExpired as cleanupRateLimits } from '../utils/rateLimit.js';
import { logEvent } from '../utils/events.js';

// Per-phase idempotency window (seconds). The 15-min cron tick fires every
// 900 s; phases with windowSec > 900 will skip most ticks.
export const PHASE_WINDOWS = Object.freeze({
  reminders: 10 * 60,         // 10 min — must run almost every cron tick
  reviews: 24 * 60 * 60,      // 24 h
  gcalSync: 10 * 60,          // 10 min
  postVisit: 60 * 60,         // 1 h
  promos: 24 * 60 * 60,       // 24 h
  cleanup: 24 * 60 * 60,      // 24 h
  retention: 24 * 60 * 60,    // 24 h (P1-10)
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

/**
 * P1-1 idempotency guard. Returns true if the phase should run; false to skip.
 * Window is taken from PHASE_WINDOWS. Always-run phases pass `windowSec=0`.
 */
export async function shouldRunPhase(ctx, phase, nowSec) {
  const windowSec = PHASE_WINDOWS[phase];
  if (!windowSec || windowSec <= 0) return true;
  const last = await getPhaseLastRun(ctx, phase);
  return (nowSec - last) >= windowSec;
}

/**
 * Wrap a phase function with idempotency + per-phase try/catch + event log.
 * `fn` is invoked only if the phase's window has elapsed; on throw, the
 * orchestrator emits `cron.phase.error` and continues.
 */
async function runPhase(ctx, phase, fn) {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    if (!(await shouldRunPhase(ctx, phase, nowSec))) return { ran: false, skipped: 'window' };
    await fn();
    await setPhaseLastRun(ctx, phase, nowSec);
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
        const identities = await dbAll(ctx,
          "SELECT channel_type, channel_user_id FROM channel_identities WHERE tenant_id = ? AND internal_user_id = ? AND channel_type != 'telegram'",
          ctx.tenantId, row.chat_id,
        );
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
            }
            // Outside 24h and no quota — skip silently
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
export async function phaseRetention(ctx, tenantId, _now) {
  if (!ctx?.db) return;
  const prunes = [
    {
      table: 'audit_log',
      sql: "DELETE FROM audit_log WHERE created_at < strftime('%s','now','-180 days')",
    },
    {
      table: 'error_log',
      sql: "DELETE FROM error_log WHERE created_at < strftime('%s','now','-30 days')",
    },
    {
      table: 'analytics_events',
      sql: "DELETE FROM analytics_events WHERE created_at < strftime('%s','now','-365 days')",
    },
    {
      table: 'permission_elevation_codes',
      sql: "DELETE FROM permission_elevation_codes WHERE expires_at < strftime('%s','now','-7 days')",
    },
    {
      table: 'stripe_events',
      sql: "DELETE FROM stripe_events WHERE received_at < strftime('%s','now','-90 days')",
    },
    {
      table: 'marketing_sends',
      sql: "DELETE FROM marketing_sends WHERE status = 'delivered' AND sent_at < strftime('%s','now','-90 days')",
    },
  ];
  for (const { table, sql } of prunes) {
    try {
      const result = await dbRun(ctx, sql);
      // D1 returns meta.changes from .run(); some adapters wrap this. Try common shapes.
      const rows = Number(
        result?.meta?.changes ??
        result?.changes ??
        result?.rowsAffected ??
        0,
      );
      // logEvent destructures the data arg directly; `table` / `rows` end up
      // under event.data.* in the ring buffer.
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

    await checkBillingExpiry(ctx, now);

    if (!ctx?.db || !ctx?.tenantId) return;

    // Phase 0 (always-run): IG token health check
    try {
      const igConfig = await getChannelConfig(ctx, ctx.tenantId, 'instagram', ctx.BOT_ENCRYPTION_KEY || null);
      if (igConfig) {
        if (!igConfig.token) {
          log.error('handlers.cron', new Error('IG token missing or failed to decrypt — update via POST /admin/ig-token'), { tenantId: ctx.tenantId });
        } else if (isTokenExpiring(igConfig, 10)) {
          log.warn('handlers.cron', { message: 'IG token expiring soon, attempting refresh', tenantId: ctx.tenantId });
          const refreshResult = await refreshInstagramToken(ctx, igConfig.id, ctx.BOT_ENCRYPTION_KEY || null);
          if (refreshResult.ok) {
            log.info('handlers.cron', { message: 'IG token refreshed', tenantId: ctx.tenantId });
          } else {
            log.error('handlers.cron', new Error('IG token refresh failed — update manually via POST /admin/ig-token'), { tenantId: ctx.tenantId, error: refreshResult.error });
          }
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

    // Idempotent phases.
    await runPhase(ctx, 'reminders', () => phaseReminders(ctx, now, w));
    await runPhase(ctx, 'reviews', () => phaseReviews(ctx, now));
    await runPhase(ctx, 'gcalSync', () => phaseGcalSync(ctx, now));
    await runPhase(ctx, 'postVisit', () => phasePostVisit(ctx, now));
    await runPhase(ctx, 'promos', () => phasePromos(ctx, now));
    await runPhase(ctx, 'cleanup', () => phaseCleanup(ctx, now));
    await runPhase(ctx, 'retention', () => phaseRetention(ctx, ctx.tenantId, now));
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)));
  }
}

/**
 * Sprint 3 Section 8: post-visit confirmation flow.
 *
 * Stage 1 (T+2h): for each appointment that ended ~2h ago, confirmed status,
 * and no visit_confirmed_at yet — emit an analytics event for now. The master
 * prompt send happens via a Telegram message in a follow-up PR (requires
 * tg api + i18n review).
 *
 * Stage 2 (T+24h): for appointments still unconfirmed, auto-mark as 'done'
 * with visit_confirmed_by='auto'. We don't request a review in this case
 * because the master's silence is ambiguous.
 */
async function processPostVisitConfirmations(ctx, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const twoHoursAgo = nowSec - 2 * 3600;
  const oneDayAgo = nowSec - 24 * 3600;

  // Compute appointment end_at = ts + service duration. Filter on ts and
  // post-filter in JS — typical tenant has <500 open apts.
  //
  // LEFT JOIN masters so we can read `is_synthetic` per appointment. A NULL
  // join (master_id with no corresponding masters row) is treated as
  // non-synthetic so legacy rows behave as before — the existing
  // `master_id > 0` guard further protects against negative synthetic ids
  // used for manual-booking clients. Synthetic personal-master chat_ids
  // (range 10B+) MUST be skipped here — they have no real Telegram chat
  // and sendMessage would fail silently for the post-visit prompt.
  const candidates = await dbAll(ctx, `
    SELECT a.id, a.ts, a.date, a.time, a.svc_id, a.chat_id, a.master_id,
           COALESCE(m.is_synthetic, 0) AS master_is_synthetic
    FROM appointments a
    LEFT JOIN masters m
      ON m.tenant_id = a.tenant_id AND m.chat_id = a.master_id
    WHERE a.tenant_id = ?
      AND a.status = 'confirmed'
      AND a.cancelled = 0
      AND a.visit_confirmed_at IS NULL
      AND a.ts <= ?
    LIMIT 200
  `, ctx.tenantId, nowSec);

  if (!candidates.length) return;

  const svcDurMap = new Map((ctx.svc || []).map(s => [s.id, s.dur]));

  // Stage 2: T+24h → auto-done
  const toAutoDone = [];
  for (const a of candidates) {
    const dur = svcDurMap.get(a.svc_id) || 60;
    const endSec = a.ts + dur * 60;
    if (endSec <= oneDayAgo) toAutoDone.push(a.id);
  }
  if (toAutoDone.length) {
    const placeholders = toAutoDone.map(() => '?').join(',');
    await dbRun(ctx, `
      UPDATE appointments
      SET status = 'done', visit_confirmed_at = ?, visit_confirmed_by = 'auto'
      WHERE tenant_id = ? AND id IN (${placeholders})
    `, nowSec, ctx.tenantId, ...toAutoDone);
  }

  // Stage 1: T+2h → mark review_requested_at + emit analytics
  const toPrompt = [];
  for (const a of candidates) {
    if (toAutoDone.includes(a.id)) continue;
    const dur = svcDurMap.get(a.svc_id) || 60;
    const endSec = a.ts + dur * 60;
    if (endSec <= twoHoursAgo) toPrompt.push(a);
  }
  for (const a of toPrompt) {
    try {
      // Send Telegram prompt to master with Yes/No-show buttons.
      // master_id is a Telegram chat_id for human masters (positive ints).
      // Negative IDs = synthetic (manual-booking clients) → skip.
      // is_synthetic=1 = personal-master synthetic chat_id (no real
      // Telegram chat behind it) → skip to avoid sending to dead chats.
      if (a.master_id && a.master_id > 0 && !a.master_is_synthetic) {
        const client = await dbGet(ctx,
          'SELECT name, phone FROM users WHERE tenant_id = ? AND chat_id = ?',
          ctx.tenantId, a.chat_id,
        ).catch(() => null);
        const clientName = client?.name || 'клиент';
        const svc = (ctx.svc || []).find(s => s.id === a.svc_id);
        const svcLabel = svc ? (svc.names?.ru || svc.names?.en || svc.id) : a.svc_id;
        const text = `Был ли визит? ${clientName} — ${svcLabel} (${a.date} ${a.time})`;
        await send(ctx, a.master_id, text, {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Пришёл', callback_data: `visit_ok:${a.id}` },
              { text: '❌ Не пришёл', callback_data: `visit_noshow:${a.id}` },
            ]],
          },
        }).catch(() => {});
      }
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
    }
  } catch (e) {
    log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'birthday_promo' });
  }
}
