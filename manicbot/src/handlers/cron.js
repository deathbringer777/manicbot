import { CLEANUP_AFTER_MS, ADDRESS, MAPS_URL } from '../config.js';
import { dbAll, dbRun } from '../utils/db.js';
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
          console.error('[cron][ig] tenant', ctx.tenantId, '— token missing or failed to decrypt. Bot cannot send IG messages. Update via POST /admin/ig-token');
        } else if (isTokenExpiring(igConfig, 10)) {
          console.warn('[cron][ig] token expiring soon for tenant', ctx.tenantId, '— attempting refresh');
          const refreshResult = await refreshInstagramToken(ctx, igConfig.id, ctx.BOT_ENCRYPTION_KEY || null);
          if (refreshResult.ok) {
            console.log('[cron][ig] token refreshed for tenant', ctx.tenantId);
          } else {
            console.error('[cron][ig] token refresh failed for tenant', ctx.tenantId, ':', refreshResult.error, '— update manually via POST /admin/ig-token');
          }
        }
      }
    } catch (e) {
      console.error('[cron][ig] token health check error:', e.message);
    }

    try {
      await renewExpiringGoogleWatches(ctx);
    } catch (e) {
      console.error('[gcal] cron watch renew failed:', e.message);
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
                    console.error('[cron] WA free-form reminder failed:', e.message);
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
                    console.error('[cron] WA template reminder failed:', e.message);
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
                    console.error('[cron] IG reminder failed:', e.message);
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
        console.error(`Cron reminder error for apt ${row.id}:`, e.message);
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
            console.error(`[cron] review request error for apt ${apt.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('[cron] review request phase failed:', e.message);
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
              console.log(`[gcal] cron re-synced apt ${apt.id} (${apt.date} ${apt.time})`);
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
                console.error(`[gcal] sync permanently failed for apt ${apt.id} after ${retries} retries`);
              } else {
                console.warn(`[gcal] cron sync failed for apt ${apt.id} (retry ${retries}):`, result?.error);
              }
            }
          } catch (e) {
            const retries = (row.sync_retries || 0) + 1;
            const backoffMs = Math.min(15 * 60 * 1000 * Math.pow(2, retries), 24 * 60 * 60 * 1000);
            await dbRun(ctx,
              'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
              retries, now + backoffMs, (e.message || 'unknown error').slice(0, 200), row.id, ctx.tenantId).catch(() => {});
            console.error(`[gcal] cron sync error for apt ${row.id} (retry ${retries}):`, e.message);
          }
        }
      } catch (e) {
        console.error('[gcal] cron unsynced-apts phase failed:', e.message);
      }
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
  } catch (e) {
    console.error('Cron error:', e.message);
  }
}
