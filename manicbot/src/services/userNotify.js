/**
 * userNotify — multi-channel notification fanout for the platform.
 *
 * Always writes an in-app `user_notifications` row (consumed by the
 * header bell in admin-app/src/components/layout/NotificationBell.tsx)
 * unless the caller explicitly disables that channel. Optionally also
 * sends a Telegram DM when the target has a linked chat_id. Resolution
 * tries the `masters` table first (staff linked through the master path),
 * then falls back to `web_users.telegram_chat_id` for salon owners who
 * paired Telegram directly (migration 0082) and have no master row.
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
        // tenant-scan-ignore: subs loaded above by web_user_id (line ~162); update keyed by that subscription row's id (user-scoped).
        await dbRun(
          ctx,
          'UPDATE push_subscriptions SET last_used_at = unixepoch(), failure_count = 0 WHERE id = ?',
          s.id,
        ).catch(() => {});
      } else if (res.status === 404 || res.status === 410) {
        // tenant-scan-ignore: same web_user_id-scoped subs (dead-subscription cleanup); keyed by the subscription row's id (user-scoped).
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
 * Look up the target's linked Telegram chat_id.
 *
 * 1. Master path: a non-synthetic `masters` row for this web_user. Synthetic
 *    personal-master rows (`is_synthetic = 1` per migration 0052) are
 *    placeholders in the 10B+ range with no real Telegram presence and are
 *    skipped.
 * 2. Owner path: salon owners pair Telegram directly on their `web_users`
 *    row (migration 0082) and typically have NO master row. When the master
 *    path yields nothing usable, fall back to `web_users.telegram_chat_id`
 *    (tenant-scoped). Before this fallback, owner-only accounts silently got
 *    in-app only — they never received platform Telegram messages.
 *
 * Returns a positive, below-synthetic-floor chat_id, or null (in-app only).
 */
async function resolveTelegramChat(ctx, webUserId) {
  if (!ctx?.db || !ctx?.tenantId) return null;

  // 1) Master path (existing behavior).
  const masterRow = await dbGet(
    ctx,
    'SELECT chat_id, is_synthetic FROM masters WHERE tenant_id = ? AND web_user_id = ? LIMIT 1',
    ctx.tenantId,
    webUserId,
  );
  if (masterRow && masterRow.is_synthetic !== 1) {
    const cid = Number(masterRow.chat_id);
    if (Number.isFinite(cid) && cid > 0 && cid < SYNTHETIC_CHAT_FLOOR) return cid;
  }

  // 2) Owner pairing fallback (migration 0082) — tenant-scoped.
  const ownerRow = await dbGet(
    ctx,
    'SELECT telegram_chat_id FROM web_users WHERE id = ? AND tenant_id = ? LIMIT 1',
    webUserId,
    ctx.tenantId,
  );
  if (ownerRow) {
    const cid = Number(ownerRow.telegram_chat_id);
    if (Number.isFinite(cid) && cid > 0 && cid < SYNTHETIC_CHAT_FLOOR) return cid;
  }

  return null;
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

/**
 * Look up the `tenant_owner` web_user_id for `ctx.tenantId`. Returns null
 * if the tenant has no owner row (orphan tenant — should not happen in
 * practice, but we don't blow up if it does).
 *
 * Lazy helper used by cron + Stripe webhook + plugin webhook writers
 * that want to fire a single bell row at the tenant owner without
 * threading the lookup through every call site.
 *
 * @param {object} ctx — must carry `db` + `tenantId`.
 * @returns {Promise<string | null>}
 */
export async function getTenantOwnerWebUserId(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  try {
    const row = await dbGet(
      ctx,
      "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
      ctx.tenantId,
    );
    return row?.id ?? null;
  } catch (e) {
    log.warn('services.userNotify', {
      action: 'tenant_owner_lookup_failed',
      error: e?.message?.slice(0, 200),
    });
    return null;
  }
}

/**
 * Convenience: fire a bell row at the tenant owner. Best-effort — silent
 * no-op when the tenant has no owner row, or when notifyWebUser rejects.
 *
 * @param {object} ctx
 * @param {object} opts — same shape as notifyWebUser opts.
 * @returns {Promise<{ok: boolean}>}
 */
export async function notifyTenantOwner(ctx, opts) {
  const ownerId = await getTenantOwnerWebUserId(ctx);
  if (!ownerId) return { ok: false };
  try {
    const r = await notifyWebUser(ctx, ownerId, opts);
    return { ok: r?.ok ?? false };
  } catch (e) {
    log.warn('services.userNotify', {
      action: 'notify_tenant_owner_failed',
      error: e?.message?.slice(0, 200),
    });
    return { ok: false };
  }
}
