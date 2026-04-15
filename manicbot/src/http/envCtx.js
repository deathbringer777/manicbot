/** @param {any} env */
export function envCtx(env) {
  return {
    db: env.DB || null,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    // Resend transactional email — set via `wrangler secret put RESEND_API_KEY / RESEND_FROM`
    resendApiKey: env.RESEND_API_KEY || null,
    resendFrom: env.RESEND_FROM || null,
  };
}
