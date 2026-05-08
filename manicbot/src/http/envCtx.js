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
  };
}
