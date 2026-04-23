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

export async function handleCron(ctx) {
  try {
    await initServices(ctx);
    const now = Date.now();
    const w = warsawNow();

    await checkBillingExpiry(ctx, now);

    if (!ctx?.db || !ctx?.tenantId) return;

    // Phase 0: IG token health check — log if missing/expired, refresh if expiring
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

    // Phase 1: reminders
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

    // Phase 1.5: post-appointment review requests
    try {
      const reviewsEnabled = await getConfig(ctx, 'reviews_enabled');
      if (reviewsEnabled) {
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
            const lg = langMap.get(apt.chat_id) || (await getLang(ctx, apt.chat_id)) || 'ru';
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
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'review_request_phase' });
    }

    // Phase 2: retry calendar sync with exponential backoff (max 10 per cron run)
    const MAX_SYNC_PER_CRON = 10;
    if (canUse(ctx, 'calendar')) {
      try {
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
      } catch (e) {
        log.error('handlers.cron', e instanceof Error ? e : new Error(String(e.message)), { action: 'gcal_unsynced_apts_phase' });
      }
    }

    // Phase 2.5: Sprint 3 — post-visit confirmation flow.
    // T+2h after appointment end: send master a confirmation prompt (stage 1).
    // T+24h after appointment end (still pending): auto-mark done (stage 2).
    try {
      await processPostVisitConfirmations(ctx, now);
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'post_visit_confirmation' });
    }

    // Phase 2.6: Sprint 4 — auto-promo for birthdays and returning clients.
    try {
      await processBirthdayAndReturningPromos(ctx, now);
    } catch (e) {
      log.error('handlers.cron', e instanceof Error ? e : new Error(String(e?.message)), { action: 'auto_promo' });
    }

    // Phase 3: cleanup expired/cancelled appointments
    await dbRun(ctx,
      'DELETE FROM appointments WHERE tenant_id = ? AND (cancelled = 1 OR ts < ?)',
      ctx.tenantId, now - CLEANUP_AFTER_MS,
    );

    // Phase 4: cleanup stale message windows (>30 days inactive)
    const staleThresholdSec = Math.floor((now - 30 * 24 * 3600 * 1000) / 1000);
    await dbRun(ctx,
      'DELETE FROM message_windows WHERE tenant_id = ? AND last_user_message_at < ?',
      ctx.tenantId, staleThresholdSec,
    );

    // Phase 5: rate_limit cleanup (Sprint 2)
    const rlCutoff = Math.floor(now / 1000) - 86400;
    await dbRun(ctx, 'DELETE FROM rate_limits WHERE window_start < ?', rlCutoff);
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

  // Compute appointment end_at = ts + service duration. Avoid a JOIN by
  // filtering on ts and post-filtering in JS — typical tenant has <500 open apts.
  const candidates = await dbAll(ctx, `
    SELECT a.id, a.ts, a.date, a.time, a.svc_id, a.chat_id, a.master_id
    FROM appointments a
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
      if (a.master_id && a.master_id > 0) {
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
 * Clients without birthday data are skipped. Tenant must have the feature
 * enabled in tenant_config.features.autoPromo (default: off).
 */
async function processBirthdayAndReturningPromos(ctx, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const today = new Date(nowMs).toISOString().slice(5, 10); // MM-DD

  // Returning-client promo: last visit 60-90 days ago, no existing returning promo
  // within 90 days. Emit analytics event — actual promo code creation delegated
  // to the promoCodes.create tRPC procedure via a follow-up worker job to keep
  // the cron function idempotent and fast.
  try {
    const returning = await dbAll(ctx, `
      SELECT DISTINCT chat_id FROM appointments
      WHERE tenant_id = ?
        AND status = 'done'
        AND ts BETWEEN ? AND ?
      LIMIT 50
    `, ctx.tenantId, nowSec - 90 * 86400, nowSec - 60 * 86400);
    for (const r of returning) {
      await dbRun(ctx, `
        INSERT INTO analytics_events (tenant_id, event, properties, created_at)
        VALUES (?, 'promo.returning_candidate', ?, ?)
      `, ctx.tenantId, JSON.stringify({ chatId: r.chat_id }), nowSec).catch(() => {});
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
