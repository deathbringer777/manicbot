/**
 * Platform event logger — writes to global KV ring buffer.
 * Fire-and-forget: never throws.
 *
 * Event schema:
 *   { id, ts, type, level, tenantId?, botId?, message, data? }
 * Levels: "info" | "warn" | "error"
 * Types: booking.created, booking.confirmed, booking.cancelled,
 *        webhook.telegram, webhook.meta, stripe.event,
 *        error.handler, auth.web_login, channel.ig_message
 */

const MAX_EVENTS = 500;
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const KEY = 'adminlog:recent';

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

    // Read current list
    let list = [];
    try {
      const raw = await kv.get(KEY);
      if (raw) list = JSON.parse(raw);
    } catch { /* ignore corrupt data */ }

    // Prepend + clamp to max
    list = [event, ...list].slice(0, MAX_EVENTS);

    // Write back with TTL
    await kv.put(KEY, JSON.stringify(list), { expirationTtl: TTL_SECONDS });
  } catch {
    // Never throw from event logging
  }
}
