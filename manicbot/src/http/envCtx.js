/** @param {any} env */
export function envCtx(env) {
  return { db: env.DB || null, kv: env.MANICBOT, globalKv: env.MANICBOT };
}
