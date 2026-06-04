/**
 * Admin/ops bot — context builder + webhook registration.
 *
 * The admin bot reuses the morning-report bot (NOTIFY_BOT_TOKEN), or a
 * dedicated ADMIN_BOT_TOKEN if set. It is deliberately TENANT-LESS: no row in
 * `tenants`/`bots`, so it never enters the per-tenant cron and never skews
 * stats. The webhook ingestion pipeline (secret check, dedup, send) is reused
 * unchanged — getCtx just needs to hand back this ctx for the admin botId.
 *
 * HIJACK GUARD: we NEVER fall back to the main client BOT_TOKEN, and webhook
 * registration refuses if the resolved botId belongs to a registered client
 * bot — so reusing the notify bot can never steal a salon's updates.
 */
import { baseCtx } from '../tenant/baseCtx.js';
import { api } from '../telegram.js';
import { getTenantIdByBotId } from '../tenant/storage.js';
import { log } from '../utils/logger.js';
import { ADMIN_BOT_COMMANDS } from './keyboards.js';

const MIN_SECRET_LEN = 16;

/** Resolve the admin bot token — dedicated first, else the notify bot. No
 *  fallback to the client BOT_TOKEN (would hijack a customer bot). */
export function adminBotToken(env) {
  if (env?.ADMIN_BOT_TOKEN) return env.ADMIN_BOT_TOKEN;
  // Opt-in: reuse the Worker's own BOT_TOKEN (the bot that already sends the
  // 7:20 report). Lets the owner dedicate the existing report bot to the admin
  // role without exposing/pasting its token — the Worker reads BOT_TOKEN itself.
  if (env?.ADMIN_USE_BOT_TOKEN === '1' && env?.BOT_TOKEN) return env.BOT_TOKEN;
  return env?.NOTIFY_BOT_TOKEN || null;
}

/**
 * Did the operator DELIBERATELY dedicate a specific bot to the admin role?
 * True for an explicit ADMIN_BOT_TOKEN or the ADMIN_USE_BOT_TOKEN opt-in.
 * False = the accidental NOTIFY_BOT_TOKEN fallback (keep the strict hijack guard).
 */
export function adminBotIsExplicit(env) {
  return !!(env?.ADMIN_BOT_TOKEN || env?.ADMIN_USE_BOT_TOKEN === '1');
}

/** The admin bot's numeric id (the part before ':' in the token), or null. */
export function adminBotId(env) {
  const token = adminBotToken(env);
  if (!token || typeof token !== 'string') return null;
  return token.split(':')[0] || null;
}

/**
 * Build the tenant-less admin bot ctx. Returns null when no admin/notify token
 * is configured (bot disabled).
 */
export function buildAdminBotCtx(env) {
  const token = adminBotToken(env);
  if (!token) return null;
  const botId = token.split(':')[0];
  return {
    ...baseCtx(env),
    isAdminBot: true,
    tenantId: null,
    tenant: null,
    bot: { botId, botToken: token, webhookSecret: env.ADMIN_WEBHOOK_SECRET || null },
    TG: `https://api.telegram.org/bot${token}`,
    prefix: `adm:${botId}:`,            // isolates KV chat/state from tenant bots
    channel: null,                      // → telegram.js treats ctx as Telegram (uses ctx.TG)
    WEBHOOK_SECRET: env.ADMIN_WEBHOOK_SECRET || null,
    botId,
    ADMIN_BOT_ALLOWED_IDS: env.ADMIN_BOT_ALLOWED_IDS || null,
  };
}

/**
 * Register the admin bot's webhook with Telegram and set its slash commands.
 * Refuses when the secret is too short, or when the botId belongs to a
 * registered client bot (hijack guard).
 * @param {any} env
 * @param {string} baseUrl e.g. https://manicbot.com
 */
export async function registerAdminBotWebhook(env, baseUrl) {
  const ctx = buildAdminBotCtx(env);
  if (!ctx) return { ok: false, error: 'admin_bot_token_missing' };
  const secret = env.ADMIN_WEBHOOK_SECRET || '';
  if (String(secret).length < MIN_SECRET_LEN) {
    return { ok: false, error: 'admin_webhook_secret_too_short' };
  }
  // Hijack guard: refuse a registered client bot ONLY when the admin bot was
  // resolved via the NOTIFY_BOT_TOKEN fallback (accidental). An explicit
  // ADMIN_BOT_TOKEN means the operator deliberately dedicated this bot — allow
  // it (its tenant Telegram flow stops by design).
  if (ctx.db) {
    const collision = await getTenantIdByBotId(ctx, ctx.botId);
    if (collision && !adminBotIsExplicit(env)) {
      log.error('adminbot.register', new Error('admin bot fell back to a registered client bot — refusing (set ADMIN_BOT_TOKEN to dedicate a bot)'), { botId: ctx.botId, tenantId: collision });
      return { ok: false, error: 'admin_bot_id_is_client_bot', tenantId: collision };
    }
    if (collision) {
      log.warn('adminbot.register', { message: 'repurposing a registered bot as admin bot (explicit ADMIN_BOT_TOKEN)', botId: ctx.botId, tenantId: collision });
    }
  }
  const whUrl = `${String(baseUrl).replace(/\/$/, '')}/webhook/${ctx.botId}`;
  const r = await api(ctx, 'setWebhook', {
    url: whUrl,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });
  try {
    await api(ctx, 'setMyCommands', { commands: ADMIN_BOT_COMMANDS });
  } catch (e) {
    log.error('adminbot.register', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'setMyCommands' });
  }
  return { ok: !!r?.ok, url: whUrl, description: r?.description || null };
}
