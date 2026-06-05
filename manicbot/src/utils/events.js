/**
 * Platform event logger — writes to global KV ring buffer.
 * Fire-and-forget: never throws.
 *
 * Event schema:
 *   { id, ts, type, level, tenantId?, botId?, message, data? }
 * Levels: "info" | "warn" | "error"
 * Example types (non-exhaustive — `type` is a free-form string):
 *        booking.created, booking.confirmed, webhook.bot_unresolved,
 *        webhook.meta, stripe.event, error.handler, auth.web_login,
 *        channel.ig_message, cron.tenant.skipped, cron.phase.error,
 *        cron.retention.pruned
 */

const MAX_EVENTS = 500;
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
// Global key for system-level events (no tenantId). Kept for backward-compat reads.
const KEY = 'adminlog:recent';
// Per-tenant key prefix. Tenant events land here instead of the global key to
// avoid RMW last-writer-wins collisions under cron fan-out (fix #5).
const TENANT_KEY_PREFIX = 'adminlog:tenant:';

// P0-1 — per-(tenantId, reason) rate-limit window for cron.tenant.skipped
// so a single tenant with a deleted bot row doesn't flood the activity feed
// every 15 min. 1h TTL means one event per tenant per reason per hour.
const CRON_SKIP_TTL_SECONDS = 3600;
const CRON_SKIP_KEY_PREFIX = 'cronskip:';

/**
 * Log a platform event to the global KV ring buffer (max 500, 7-day TTL).
 *
 * @param {any} ctx - must have ctx.globalKv (= env.MANICBOT KV namespace)
 * @param {string} type - event type, e.g. "booking.confirmed"
 * @param {object} [data] - optional: { level?, message?, tenantId?, botId?, ...rest }
 */
export async function logEvent(ctx, type, data = {}) {
  try {
    const kv = ctx?.globalKv;
    if (!kv) return;

    const { level = 'info', message = type, tenantId, botId, userId, traceId, severity, ...rest } = data;

    const event = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      type,
      // `severity` is the preferred new field name; `level` kept for back-compat.
      level: severity || level,
      message,
      ...(tenantId ? { tenantId } : {}),
      ...(botId ? { botId } : {}),
      ...(userId ? { userId: String(userId) } : {}),
      // traceId lets downstream log aggregators (Logpush → BigQuery/ClickHouse)
      // correlate multiple log lines across one request.
      ...(traceId ? { traceId } : {}),
      ...(Object.keys(rest).length ? { data: rest } : {}),
    };

    // Also emit to console as structured JSON so Cloudflare Logpush can export
    // it. Callers that set `severity: 'error'` end up in error channels.
    try {
      const line = JSON.stringify({
        timestamp: new Date(event.ts).toISOString(),
        level: event.level,
        type,
        tenantId: tenantId || null,
        botId: botId || null,
        userId: userId ? String(userId) : null,
        traceId: traceId || null,
        message,
        ...(Object.keys(rest).length ? { data: rest } : {}),
      });
      if (event.level === 'error') console.error(line);
      else if (event.level === 'warn') console.warn(line);
      else console.log(line);
    } catch { /* ignore */ }

    // Use a per-tenant key when tenantId is present to avoid RMW collisions
    // under concurrent cron fan-out (fix #5). System-level events (no tenantId)
    // still land in the global KEY for backward-compatible admin reads.
    const targetKey = tenantId ? `${TENANT_KEY_PREFIX}${tenantId}` : KEY;

    // Read current list
    let list = [];
    try {
      const raw = await kv.get(targetKey);
      if (raw) list = JSON.parse(raw);
    } catch { /* ignore corrupt data */ }

    // Prepend + clamp to max
    list = [event, ...list].slice(0, MAX_EVENTS);

    // Write back with TTL
    await kv.put(targetKey, JSON.stringify(list), { expirationTtl: TTL_SECONDS });
  } catch {
    // Never throw from event logging
  }
}

/**
 * P0-1 — Emit a `cron.tenant.skipped` event, rate-limited per (tenantId, reason).
 *
 * The Queue consumer in `worker.js` silently ack()s when a tenant has no bot
 * rows or the bot can't be resolved. A tenant with an active subscription but
 * a token-decrypt failure (the exact P0 scenario fixed in commit b76d3f5)
 * would never see reminders / GCal sync / reviews — with zero signal anywhere.
 *
 * This helper logs the skip but caps to one event per tenant per reason per
 * hour so a single broken tenant doesn't drown the activity feed.
 *
 * @param {{ globalKv?: KVNamespace }} ctx
 * @param {string} tenantId
 * @param {"no_bots"|"bot_unresolved"} reason
 */
export async function emitCronSkipRateLimited(ctx, tenantId, reason) {
  try {
    const kv = ctx?.globalKv;
    if (!kv || !tenantId || !reason) return;
    const key = `${CRON_SKIP_KEY_PREFIX}${tenantId}:${reason}`;
    // Rate-limit check: if a marker is set, the previous emit was within TTL.
    const existing = await kv.get(key).catch(() => null);
    if (existing) return;
    // Set the marker first so concurrent invocations dedup.
    await kv.put(key, '1', { expirationTtl: CRON_SKIP_TTL_SECONDS }).catch(() => {});
    await logEvent(ctx, 'cron.tenant.skipped', {
      level: 'warn',
      tenantId,
      message: `Cron skipped for tenant ${tenantId}: ${reason}`,
      reason,
    });
  } catch {
    // Never throw from event logging
  }
}
