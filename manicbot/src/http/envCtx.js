/** @param {any} env */
export function envCtx(env) {
  return {
    db: env.DB || null,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    // Mirror the encryption keys onto the ctx so getBotToken (storage.js) can
    // transparently fall back to BOT_ENCRYPTION_KEY_OLD during a key rotation
    // without dark-screening prod. Both are read by decryptTokenWithFallback.
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    BOT_ENCRYPTION_KEY_OLD: env.BOT_ENCRYPTION_KEY_OLD || null,
    // Resend transactional email — set via `wrangler secret put RESEND_API_KEY / RESEND_FROM`
    resendApiKey: env.RESEND_API_KEY || null,
    resendFrom: env.RESEND_FROM || null,
    // Stripe REST API. Needed by handlers that resolve secondary objects
    // (e.g. GET /v1/charges/{id} from a dispute) — the webhook signature
    // secret is separate and lives in STRIPE_WEBHOOK_SECRET.
    stripeSecretKey: env.STRIPE_SECRET_KEY || null,
    // System & Seasonal Messaging real-send gate (default OFF). Gates the
    // reactive engine + the seasonal (occasion-linked) campaign dispatch; when
    // false those stage to the ledger ('skipped_flag') with zero external egress.
    // Existing welcome/monthly_report/announcement campaigns are NOT gated.
    messagingSendEnabled: env.MESSAGING_SEND_ENABLED === '1',
  };
}
