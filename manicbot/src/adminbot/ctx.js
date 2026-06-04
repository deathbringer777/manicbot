/**
 * Admin/ops bot — context builder + webhook registration.
 *
 * The admin bot reuses the morning-report bot (NOTIFY_BOT_TOKEN), or a
 * dedicated ADMIN_BOT_TOKEN if set. It is deliberately TENANT-LESS: no row in
 * `tenants`/`bots`, so it never enters the per-tenant cron and never skews
 * stats. The webhook ingestion pipeline (secret check, dedup, send) is reused
 * unchanged — getCtx just needs to hand back this ctx for the admin botId.
 *
 * HIJACK GUARD: we never fall back to the main client BOT_TOKEN by accident.
 * Reuse of an existing bot is only via a DELIBERATE opt-in (ADMIN_BOT_TOKEN, or
 * ADMIN_USE_BOT_TOKEN=1 to reuse BOT_TOKEN); the accidental NOTIFY_BOT_TOKEN
 * fallback is still refused if it resolves to a registered client bot.
 */
import { baseCtx } from '../tenant/baseCtx.js';
import { api } from '../telegram.js';
import { getTenantIdByBotId } from '../tenant/storage.js';
import { log } from '../utils/logger.js';
import { kvGet, kvPut } from '../utils/kv.js';
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

/**
 * Cron-safe one-time self-registration. When the admin bot is configured
 * (ADMIN_WEBHOOK_SECRET + a token source), register its webhook automatically
 * so the operator doesn't have to call /admin/register-admin-bot-webhook by
 * hand. Idempotent via a KV flag keyed on (botId, expectedUrl): registers once,
 * then no-ops on every subsequent tick.
 *
 * A KV flag (not a getWebhookInfo url-check) is used deliberately: when reusing
 * a bot that already had a webhook on the same /webhook/{botId} path, the url
 * already matches but the secret_token is wrong — so we must (re)register to set
 * ADMIN_WEBHOOK_SECRET, and getWebhookInfo cannot confirm the secret.
 *
 * @param {any} env
 * @param {string} baseUrl
 * @returns {Promise<{ok?:boolean, registered?:boolean, skipped?:string, url?:string, error?:string}>}
 */
export async function ensureAdminBotWebhook(env, baseUrl) {
  const ctx = buildAdminBotCtx(env);
  if (!ctx) return { skipped: 'no_admin_bot_token' };
  if (String(env.ADMIN_WEBHOOK_SECRET || '').length < MIN_SECRET_LEN) {
    return { skipped: 'no_secret' };
  }
  const expectedUrl = `${String(baseUrl).replace(/\/$/, '')}/webhook/${ctx.botId}`;
  const desired = `${ctx.botId}|${expectedUrl}`;
  let done = null;
  try { done = await kvGet(ctx, 'webhook:autoreg'); } catch { /* treat as not-done */ }
  if (done === desired) return { skipped: 'already_registered' };
  const r = await registerAdminBotWebhook(env, baseUrl);
  if (r?.ok) {
    try { await kvPut(ctx, 'webhook:autoreg', desired); } catch { /* best-effort; retried next tick */ }
    return { ok: true, registered: true, url: r.url };
  }
  return { ok: false, error: r?.error || 'register_failed' };
}
