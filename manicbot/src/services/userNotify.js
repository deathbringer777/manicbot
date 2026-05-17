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

import { dbGet, dbRun } from '../utils/db.js';
import { send as telegramSend } from '../telegram.js';
import { log } from '../utils/logger.js';

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
 * @param {string|null} [opts.telegramText] — if omitted, derived from title+body
 * @returns {Promise<{ok: boolean, inappOk: boolean, telegramOk: boolean, error?: string}>}
 */
export async function notifyWebUser(ctx, webUserId, opts) {
  if (!ctx?.db || !webUserId) {
    return { ok: false, inappOk: false, telegramOk: false, error: 'no_ctx_or_target' };
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
    telegramText = null,
  } = opts || {};

  if (!kind || !title) {
    return { ok: false, inappOk: false, telegramOk: false, error: 'missing_kind_or_title' };
  }

  let inappOk = false;
  if (inapp) {
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

  return { ok: inappOk || telegramOk, inappOk, telegramOk };
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
