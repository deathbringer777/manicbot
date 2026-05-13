/**
 * In-house error capture for the Worker. Writes to D1 `error_events` with
 * 1h deduplication and PII stripping. Never throws.
 *
 * Schema (migration 0056_error_events, mirrored in Drizzle `errorEvents`):
 *   id, fingerprint, source, severity, message, stack, path, tenant_id,
 *   user_id, context (JSON TEXT), count, first_seen, last_seen,
 *   resolved_at, created_at
 *
 * Caller contract:
 *   await captureError(env, err, { tenantId, source, path, userId, phase, severity })
 * `source` is a free-form caller location (e.g. "worker.fetch",
 * "cron.phase.reminders") — it gets bucketed to the router's enum
 * (worker|admin-app|cron|edge|unknown) and the raw value is preserved in
 * `context.source_raw`. All context fields are optional. The capture is
 * always best-effort — if D1 is unavailable, the call returns without
 * raising.
 */

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 5000;
const DEDUP_WINDOW_SEC = 3600;

// PII patterns. Order matters — more specific tokens first so generic
// long-hex matches don't shadow them.
const PII_PATTERNS = [
  // Telegram bot token: digits:35+ urlsafe chars. Avoid \b — Telegram URLs
  // embed it as `/botNNN:...` where the preceding char is also a word char,
  // so a word boundary never fires there.
  { re: /\d{6,}:[A-Za-z0-9_-]{30,}/g, replace: '[REDACTED_TG_TOKEN]' },
  // Bearer / OAuth tokens after "Bearer "
  { re: /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: 'Bearer [REDACTED_BEARER]' },
  // Stripe keys (sk_live_*, sk_test_*, rk_live_*, rk_test_*)
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: '[REDACTED_API_KEY]' },
  // Resend API key (re_*)
  { re: /\bre_[A-Za-z0-9]{16,}\b/g, replace: '[REDACTED_API_KEY]' },
];

function stripPII(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { re, replace } of PII_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

function bound(text, max) {
  if (!text || typeof text !== 'string') return text || '';
  return text.length <= max ? text : text.slice(0, max);
}

// FNV-1a 32-bit, hex-encoded. Deterministic, no crypto dep, runs in Workers.
function fingerprintHash(parts) {
  const input = parts.filter((p) => p != null).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Map a caller-supplied source string ("worker.fetch", "cron.phase.x") to
// the router's enum bucket. Keeps the raw value in context for the UI.
function bucketSource(source) {
  if (!source) return 'unknown';
  const s = String(source).toLowerCase();
  if (s.startsWith('cron')) return 'cron';
  if (s.startsWith('worker')) return 'worker';
  if (s.startsWith('admin') || s.startsWith('trpc')) return 'admin-app';
  if (s.startsWith('edge')) return 'edge';
  return 'unknown';
}

function detectSeverity(err, context) {
  if (context?.severity) return String(context.severity);
  if (context?.phase === 'startup') return 'fatal';
  const message = String(err?.message || err || '');
  if (message.startsWith('[SECURITY]')) return 'fatal';
  const name = String(err?.name || '');
  const lower = message.toLowerCase();
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'NetworkError' ||
    lower.includes('fetch failed') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('network error')
  ) {
    return 'warning';
  }
  return 'error';
}

function normalizeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: err.message || String(err),
      stack: err.stack || '',
    };
  }
  if (err && typeof err === 'object') {
    return {
      name: String(err.name || 'Error'),
      message: String(err.message || JSON.stringify(err)),
      stack: String(err.stack || ''),
    };
  }
  return { name: 'Error', message: String(err ?? 'unknown'), stack: '' };
}

/**
 * Capture an error to D1 `error_events`. Best-effort; never throws.
 *
 * @param {{ DB?: any }} env  Worker env binding (needs env.DB)
 * @param {unknown} error    Anything throwable
 * @param {object} [context]
 * @param {string} [context.tenantId]
 * @param {string} [context.source]   Caller location, e.g. "worker.fetch", "cron.phase.reminders"
 * @param {string} [context.path]     Request URL pathname
 * @param {string|number} [context.userId]
 * @param {string} [context.phase]    Cron phase name; "startup" flips severity to fatal
 * @param {'fatal'|'error'|'warning'|'info'} [context.severity]
 */
export async function captureError(env, error, context = {}) {
  try {
    const db = env?.DB;
    if (!db || typeof db.prepare !== 'function') return;

    const { name, message, stack } = normalizeError(error);
    const safeMessage = bound(stripPII(message), MAX_MESSAGE_LEN);
    const safeStack = bound(stripPII(stack), MAX_STACK_LEN);
    const severity = detectSeverity(error, context);
    const path = context.path ? String(context.path).slice(0, 500) : null;
    const tenantId = context.tenantId ? String(context.tenantId) : null;
    const userId = context.userId != null ? String(context.userId) : null;
    const sourceRaw = context.source ? String(context.source).slice(0, 100) : null;
    const sourceBucket = bucketSource(sourceRaw);
    const fingerprint = fingerprintHash([name, safeMessage.slice(0, 200), path || '']);

    // Strip well-known sensitive context keys before serializing.
    const ctxJson = JSON.stringify({
      error_name: name,
      source_raw: sourceRaw,
      phase: context.phase ?? null,
      // Future-proof: callers may pass extra fields; allow only primitives.
      ...Object.fromEntries(
        Object.entries(context).filter(
          ([k, v]) =>
            !['severity', 'tenantId', 'source', 'path', 'userId', 'phase'].includes(k) &&
            (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
        ),
      ),
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - DEDUP_WINDOW_SEC;

    // 1h dedup lookup on fingerprint + nullable tenant_id.
    let existing = null;
    try {
      existing = await db
        .prepare(
          `SELECT id, count FROM error_events
           WHERE fingerprint = ?
             AND (tenant_id IS ? OR tenant_id = ?)
             AND last_seen > ?
             AND resolved_at IS NULL
           LIMIT 1`,
        )
        .bind(fingerprint, tenantId, tenantId, cutoff)
        .first();
    } catch {
      existing = null;
    }

    if (existing && existing.id) {
      await db
        .prepare(
          `UPDATE error_events
           SET count = count + 1, last_seen = ?
           WHERE id = ?`,
        )
        .bind(nowSec, existing.id)
        .run();
      return;
    }

    await db
      .prepare(
        `INSERT INTO error_events
          (fingerprint, source, severity, message, stack, path, tenant_id,
           user_id, context, count, first_seen, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        fingerprint,
        sourceBucket,
        severity,
        safeMessage,
        safeStack,
        path,
        tenantId,
        userId,
        ctxJson,
        nowSec,
        nowSec,
        nowSec,
      )
      .run();
  } catch {
    // Last-resort: monitoring must never break the request flow.
    try {
      console.error('[errorCapture] capture failed', error?.message || error);
    } catch {
      /* ignore */
    }
  }
}

// Exposed for unit testing only.
export const _internals = {
  stripPII,
  bound,
  detectSeverity,
  normalizeError,
  fingerprintHash,
  bucketSource,
};
