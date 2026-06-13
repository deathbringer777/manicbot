/**
 * Shared env → ctx adapter.
 *
 * Both `buildTenantCtx` (tenant/resolver.js) and `buildChannelCtx`
 * (channels/resolver.js) used to inline their own env-spread logic; the two
 * shapes drifted over time and produced subtle bugs (e.g. a Meta inbound that
 * triggered a Google Calendar sync saw a different ctx than a Telegram inbound).
 *
 * Owning this in one module guarantees every ctx — whether tenant-scoped or
 * channel-scoped — exposes the same env surface (Workers AI tokens, encryption
 * keys, Google OAuth credentials, base URLs). Per-flow callers add their own
 * tenant/bot/channel fields on top.
 *
 * Audit reference: relax.md §1 P1 "buildChannelCtx re-implements the env-spread
 * pattern from _baseCtx in tenant/resolver.js".
 */

/**
 * Build the shared base ctx fields from a Worker env object.
 *
 * @param {any} env - Worker env (bindings + secrets)
 * @returns {object} Base ctx with KV/D1/AI/encryption/Google/base-URL fields
 */
export function baseCtx(env) {
  return {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    db: env.DB || null,
    ADMIN_KEY: env.ADMIN_KEY,
    adminChatId: env.ADMIN_CHAT_ID || null,
    ADMIN_CHAT_ID: env.ADMIN_CHAT_ID || null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    BOT_ENCRYPTION_KEY_OLD: env.BOT_ENCRYPTION_KEY_OLD || null,
    GOOGLE_SERVICE_ACCOUNT_KEY: env.GOOGLE_SERVICE_ACCOUNT_KEY || null,
    GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID || null,
    GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET || null,
    GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI || null,
    GOOGLE_TOKEN_ENCRYPTION_KEY: env.GOOGLE_TOKEN_ENCRYPTION_KEY || null,
    APP_BASE_URL: env.APP_BASE_URL || null,
    baseUrl: null,
    ADMIN_APP_URL: env.ADMIN_APP_URL || null,
    // System & Seasonal Messaging real-send gate (default OFF). Must be on the
    // base ctx so it reaches BOTH the bot-tenant cron path (buildTenantCtx) and
    // the channel-only path (buildChannelCtx) — without it the seasonal dispatch
    // + reactive engine always stage ('skipped_flag') even when the var is "1".
    messagingSendEnabled: env.MESSAGING_SEND_ENABLED === '1',
    // Stripe REST secret (camelCase) so the cron promo-render path matches the
    // webhook ctx shape; baseCtx already spreads ...env, this just normalizes it.
    stripeSecretKey: env.STRIPE_SECRET_KEY || null,
  };
}
