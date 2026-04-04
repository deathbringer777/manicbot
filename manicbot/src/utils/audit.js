/**
 * Persistent audit log — writes to D1 `audit_log` table.
 * Unlike logEvent() (KV ring buffer, 7-day TTL), audit entries are permanent.
 *
 * @param {object} ctx - Worker context with ctx.db
 * @param {string} action - Action identifier (e.g. 'admin.provision', 'web.login')
 * @param {object} [opts]
 * @param {string} [opts.tenantId]
 * @param {string} [opts.actor] - Who performed the action (chatId, email, etc.)
 * @param {string} [opts.detail] - Free-form detail (JSON stringified if object)
 * @param {string} [opts.ip]
 */
export async function audit(ctx, action, opts = {}) {
  if (!ctx?.db) return;
  try {
    const detail = opts.detail && typeof opts.detail === 'object'
      ? JSON.stringify(opts.detail)
      : opts.detail || null;
    await ctx.db.prepare(
      'INSERT INTO audit_log (tenant_id, actor, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      opts.tenantId || ctx.tenantId || null,
      opts.actor || null,
      action,
      detail,
      opts.ip || null,
      Math.floor(Date.now() / 1000),
    ).run();
  } catch (e) {
    console.error('[audit] write failed:', e.message);
  }
}
