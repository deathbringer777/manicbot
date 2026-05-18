/**
 * userNotify — multi-channel notification fanout for the platform.
 *
 * Always writes an in-app row into `user_notifications` (consumed by the
 * header bell in admin-app/src/components/layout/NotificationBell.tsx)
 * unless the caller explicitly disables that channel. Optionally also
 * sends a Telegram DM when the target has a linked chat_id (resolved
 * via the `masters` table — web_users currently link to Telegram only
 * through the master path; salon-owner-only accounts get in-app only).
 *
 * Idempotent on the in-app side: when both `sourceSlug` and `sourceId`
 * are passed, the partial UNIQUE index `uq_user_notifications_source`
 * (migration 0063) prevents duplicate bell entries on cron retry.
 *
 * Generic by design — the reminders plugin is the first caller, but
 * future subsystems (checklists, marketing automations, billing alerts)
 * use the exact same surface. Each new notification kind is just a new
 * `kind` string and a per-kind handler in the UI.
 */

import { dbAll, dbGet, dbRun } from '../utils/db.js';
import { send as telegramSend } from '../telegram.js';
import { log } from '../utils/logger.js';
import { sendWebPush } from './webpush.js';
import { loadPrefsForWebUser, shouldDeliver } from './notificationPrefs.js';

const SYNTHETIC_CHAT_FLOOR = 10_000_000_000; // synthetic personal-master ids

/**
 * @param {object} ctx               — tenant ctx (db, tenantId, bot…)
 * @param {string} webUserId         — target web_users.id
 * @param {object} opts
 * @param {string} opts.kind         — e.g. 'reminder.fired'
 * @param {string} opts.title
 * @param {string|null} [opts.body]
 * @param {string|null} [opts.link]
 * @param {string|null} [opts.sourceSlug]
 * @param {string|null} [opts.sourceId]
 * @param {boolean} [opts.inapp=true]
 * @param {boolean} [opts.telegram=false]
 * @param {boolean} [opts.push=true]  — Web Push fan-out (PR3). No-op when
 *                                       VAPID is unconfigured or the user
 *                                       has no push_subscriptions rows.
 * @param {string|null} [opts.telegramText] — if omitted, derived from title+body
 * @returns {Promise<{ok: boolean, inappOk: boolean, telegramOk: boolean, pushOk: number, error?: string}>}
 */
export async function notifyWebUser(ctx, webUserId, opts) {
  if (!ctx?.db || !webUserId) {
    return { ok: false, inappOk: false, telegramOk: false, pushOk: 0, error: 'no_ctx_or_target' };
  }
  const {
    kind,
    title,
    body = null,
    link = null,
    sourceSlug = null,
    sourceId = null,
    inapp = true,
    telegram = false,
    push = true,
    telegramText = null,
  } = opts || {};

  if (!kind || !title) {
    return { ok: false, inappOk: false, telegramOk: false, pushOk: 0, error: 'missing_kind_or_title' };
  }

  // Honour the recipient's saved notification_prefs. Self-tests
  // (`support.test`) always deliver so the settings UI can confirm the
  // pipeline even when the support category is opted out.
  let prefs = null;
  if (kind !== 'support.test') {
    prefs = await loadPrefsForWebUser(ctx.db, webUserId);
  }

  let inappOk = false;
  const inappAllowed = !prefs || shouldDeliver(kind, prefs, 'inapp');
  if (inapp && inappAllowed) {
    try {
      const id = newNotificationId();
      const result = await dbRun(
        ctx,
        'INSERT OR IGNORE INTO user_notifications (id, tenant_id, web_user_id, kind, title, body, link, source_slug, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        ctx.tenantId ?? null,
        webUserId,
        kind,
        truncate(title, 200),
        body ? truncate(body, 1000) : null,
        link,
        sourceSlug,
        sourceId,
      );
      inappOk = (result?.meta?.changes ?? result?.changes ?? 0) > 0;
    } catch (e) {
      log.warn('services.userNotify', {
        action: 'inapp_insert_failed',
        error: e?.message?.slice(0, 200),
      });
    }
  }

  let telegramOk = false;
  if (telegram) {
    const chatId = await resolveTelegramChat(ctx, webUserId);
    if (chatId && ctx.bot) {
      try {
        const text = telegramText ?? formatDefaultTelegram(title, body);
        const res = await telegramSend(ctx, chatId, text);
        telegramOk = !!(res && res.ok !== false);
      } catch (e) {
        log.warn('services.userNotify', {
          action: 'telegram_send_failed',
          error: e?.message?.slice(0, 200),
        });
      }
    }
  }

  let pushOk = 0;
  const pushAllowed = !prefs || shouldDeliver(kind, prefs, 'push');
  if (push && pushAllowed) {
    pushOk = await fanOutWebPush(ctx, webUserId, {
      title,
      body,
      link,
      kind,
      sourceId,
    }).catch((e) => {
      log.warn('services.userNotify', {
        action: 'push_fanout_failed',
        error: e?.message?.slice(0, 200),
      });
      return 0;
    });
  }

  return { ok: inappOk || telegramOk || pushOk > 0, inappOk, telegramOk, pushOk };
}

/**
 * Fan-out a notification to every push_subscriptions row of the recipient.
 *
 * - Reads VAPID config from the Worker env (passed via ctx).
 * - Skips silently when VAPID isn't configured (early-launch state — the
 *   bell still works without browser push).
 * - On 404 / 410 from the push service the row is gone; bump
 *   failure_count and let a future cleanup cron drop it.
 *
 * Returns the count of successful pushes.
 */
async function fanOutWebPush(ctx, webUserId, payload) {
  const env = ctx?.env ?? ctx;
  const publicKey = env?.VAPID_PUBLIC_KEY;
  const privateKey = env?.VAPID_PRIVATE_KEY;
  const subject = env?.VAPID_SUBJECT || 'mailto:noreply@manicbot.com';
  if (!publicKey || !privateKey) return 0;

  const subs = await dbAll(
    ctx,
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE web_user_id = ? LIMIT 20',
    webUserId,
  ).catch(() => []);
  if (!subs?.length) return 0;

  const tag = payload.sourceId ?? `${payload.kind}:${Date.now()}`;
  const wirePayload = {
    title: payload.title,
    body: payload.body ?? undefined,
    link: payload.link ?? undefined,
    tag,
    kind: payload.kind,
  };

  let ok = 0;
  for (const s of subs) {
    try {
      const res = await sendWebPush(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        wirePayload,
        { publicKey, privateKey, subject },
        { urgency: 'normal', topic: payload.kind.slice(0, 32) },
      );
      if (res.ok) {
        ok++;
        await dbRun(
          ctx,
          'UPDATE push_subscriptions SET last_used_at = unixepoch(), failure_count = 0 WHERE id = ?',
          s.id,
        ).catch(() => {});
      } else if (res.status === 404 || res.status === 410) {
        await dbRun(
          ctx,
          'UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?',
          s.id,
        ).catch(() => {});
      }
    } catch (e) {
      log.warn('services.userNotify', {
        action: 'push_send_failed',
        error: e?.message?.slice(0, 200),
      });
    }
  }
  return ok;
}

/**
 * Look up the target's linked Telegram chat_id via the masters table.
 *
 * Skips synthetic personal-master rows (`is_synthetic = 1` per migration
 * 0052) — those chat_ids are placeholders in the 10B+ range with no real
 * Telegram presence. A web_user that isn't linked to any non-synthetic
 * master row returns null (in-app only).
 */
async function resolveTelegramChat(ctx, webUserId) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(
    ctx,
    'SELECT chat_id, is_synthetic FROM masters WHERE tenant_id = ? AND web_user_id = ? LIMIT 1',
    ctx.tenantId,
    webUserId,
  );
  if (!row) return null;
  if (row.is_synthetic === 1) return null;
  const cid = Number(row.chat_id);
  if (!Number.isFinite(cid) || cid <= 0 || cid >= SYNTHETIC_CHAT_FLOOR) return null;
  return cid;
}

function formatDefaultTelegram(title, body) {
  if (!body) return `🔔 ${title}`;
  return `🔔 ${title}\n\n${body}`;
}

function truncate(s, max) {
  return typeof s === 'string' && s.length > max ? s.slice(0, max) : s;
}

function newNotificationId() {
  const ts = Date.now().toString(36);
  const rand =
    globalThis.crypto?.randomUUID?.()?.replace(/-/g, '').slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `n_${ts}_${rand}`;
}
