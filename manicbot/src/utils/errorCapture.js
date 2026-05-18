/**
 * In-house error capture for the Worker. Writes to D1 `error_events` with
 * status-aware deduplication + regression detection + PII stripping.
 * Never throws.
 *
 * Schema: migrations 0056 + 0057 (`schema.sql` `error_events`). One row per
 * (fingerprint, tenant_id). Status lifecycle:
 *   open:     active issue, current default.
 *   resolved: marked fixed; a NEW fire flips back to `open` (regression).
 *   ignored:  muted forever; bump count but never auto-reopen.
 *   snoozed:  muted until `snooze_until`; reopens once that passes.
 *
 * Caller contract:
 *   await captureError(env, err, {
 *     tenantId, source, path, userId, phase, severity,
 *     url, method, requestId,    // optional request context
 *     sample,                    // optional small JSON sample, bounded
 *   });
 * All optional. The capture is always best-effort — if D1 is unavailable,
 * the call returns without raising.
 */

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 5000;
const MAX_TITLE_LEN = 200;
const MAX_SAMPLE_LEN = 4000;
const MAX_PATH_LEN = 500;
const MAX_URL_LEN = 1000;

// PII patterns. Order matters — more specific tokens first so generic
// long-hex matches don't shadow them.
const PII_PATTERNS = [
  { re: /\d{6,}:[A-Za-z0-9_-]{30,}/g, replace: '[REDACTED_TG_TOKEN]' },
  { re: /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: 'Bearer [REDACTED_BEARER]' },
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: '[REDACTED_API_KEY]' },
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

// FNV-1a 32-bit hex. Deterministic, no crypto dep, runs in Workers.
function fingerprintHash(parts) {
  const input = parts.filter((p) => p != null).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

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

// Severity ranking — used when a regressed/repeated error has a worse
// severity than what we previously recorded.
const SEVERITY_RANK = { info: 0, warning: 1, error: 2, fatal: 3 };
function maxSeverity(a, b) {
  return (SEVERITY_RANK[b] ?? 2) > (SEVERITY_RANK[a] ?? 2) ? b : a;
}

/**
 * Capture an error to D1 `error_events`. Best-effort; never throws.
 *
 * @param {{ DB?: any, ENVIRONMENT?: string, RELEASE?: string, VERSION?: string }} env
 * @param {unknown} error    Anything throwable
 * @param {object} [context]
 * @param {string} [context.tenantId]
 * @param {string} [context.source]   Caller location, e.g. "worker.fetch"
 * @param {string} [context.path]     Request URL pathname or cron phase
 * @param {string|number} [context.userId]
 * @param {string} [context.phase]    Cron phase name; "startup" → fatal
 * @param {'fatal'|'error'|'warning'|'info'} [context.severity]
 * @param {string} [context.url]      Full request URL, if available
 * @param {string} [context.method]   HTTP method
 * @param {string} [context.requestId] Cloudflare ray id or correlation id
 * @param {*}      [context.sample]   Small JSON-serializable sample payload
 */
export async function captureError(env, error, context = {}) {
  try {
    const db = env?.DB;
    if (!db || typeof db.prepare !== 'function') return;

    const { name, message, stack } = normalizeError(error);
    const safeMessage = bound(stripPII(message), MAX_MESSAGE_LEN);
    const safeStack = bound(stripPII(stack), MAX_STACK_LEN);
    const severity = detectSeverity(error, context);
    const path = context.path ? bound(String(context.path), MAX_PATH_LEN) : null;
    const tenantId = context.tenantId ? String(context.tenantId) : null;
    const userId = context.userId != null ? String(context.userId) : null;
    const sourceRaw = context.source ? String(context.source).slice(0, 100) : null;
    const sourceBucket = bucketSource(sourceRaw);
    const fingerprint = fingerprintHash([name, safeMessage.slice(0, 200), path || '']);

    // 0057 additions ---------------------------------------------------
    const environment = String(env?.ENVIRONMENT || 'production').slice(0, 32);
    const release = env?.RELEASE || env?.VERSION
      ? String(env.RELEASE || env.VERSION).slice(0, 64)
      : null;
    // PR 3 (2026-05-18): callers may pass a SEMANTIC `errorType` (e.g.
    // 'channel.ig.token_dead') so downstream consumers (IGHealthCard,
    // monitoring dashboards) can match by stable slug instead of the raw
    // Error class name. Fall back to the class name for callers that don't
    // supply one. Slugs follow the convention `<domain>.<sub>.<kind>` and
    // are kept short (<= 64 chars to fit the DB column).
    const errorType = context.errorType
      ? String(context.errorType).slice(0, 64)
      : name;
    const title = bound(safeMessage, MAX_TITLE_LEN);
    const url = context.url ? bound(stripPII(String(context.url)), MAX_URL_LEN) : null;
    const method = context.method ? String(context.method).slice(0, 16) : null;
    const requestId = context.requestId ? String(context.requestId).slice(0, 128) : null;
    let sampleJson = null;
    if (context.sample !== undefined) {
      try {
        sampleJson = bound(stripPII(JSON.stringify(context.sample)), MAX_SAMPLE_LEN);
      } catch {
        sampleJson = null;
      }
    }

    // Strip well-known reserved context keys before serializing the rest
    // into the legacy `context` JSON blob (kept for backward compat).
    const reservedKeys = new Set([
      'severity', 'tenantId', 'source', 'path', 'userId', 'phase',
      'url', 'method', 'requestId', 'sample',
    ]);
    const ctxJson = JSON.stringify({
      error_name: name,
      source_raw: sourceRaw,
      phase: context.phase ?? null,
      ...Object.fromEntries(
        Object.entries(context).filter(
          ([k, v]) =>
            !reservedKeys.has(k) &&
            (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
        ),
      ),
    });

    const nowSec = Math.floor(Date.now() / 1000);

    // Status-aware lookup: find ANY existing row for (fingerprint, tenant),
    // regardless of age. The 0056 1h time-window is gone — status defines
    // whether the issue is live, muted, or eligible for reopening.
    let existing = null;
    try {
      existing = await db
        .prepare(
          `SELECT id, status, count, snooze_until, severity
             FROM error_events
            WHERE fingerprint = ?
              AND (tenant_id IS ? OR tenant_id = ?)
            ORDER BY last_seen DESC
            LIMIT 1`,
        )
        .bind(fingerprint, tenantId, tenantId)
        .first();
    } catch {
      existing = null;
    }

    if (existing && existing.id != null) {
      const prevStatus = existing.status || 'open';
      const prevSeverity = existing.severity || 'error';
      const mergedSeverity = maxSeverity(prevSeverity, severity);

      // Decide next status and whether this is a regression flip.
      let nextStatus = prevStatus;
      let clearResolution = false;
      let clearSnooze = false;

      if (prevStatus === 'resolved') {
        // Regression: a closed bug is back.
        nextStatus = 'open';
        clearResolution = true;
      } else if (prevStatus === 'snoozed') {
        const snoozeUntil = existing.snooze_until || 0;
        if (snoozeUntil > 0 && snoozeUntil <= nowSec) {
          // Snooze expired — reopen.
          nextStatus = 'open';
          clearSnooze = true;
        }
        // else: still muted; bump count + last_seen only.
      }
      // 'ignored' and active 'snoozed' fall through: silently bump.

      await db
        .prepare(
          `UPDATE error_events
              SET count = count + 1,
                  last_seen = ?,
                  severity = ?,
                  status = ?,
                  resolved_at = CASE WHEN ? THEN NULL ELSE resolved_at END,
                  resolved_by = CASE WHEN ? THEN NULL ELSE resolved_by END,
                  snooze_until = CASE WHEN ? THEN NULL ELSE snooze_until END,
                  message = ?,
                  stack = COALESCE(?, stack),
                  title = ?,
                  error_type = ?,
                  url = COALESCE(?, url),
                  method = COALESCE(?, method),
                  request_id = COALESCE(?, request_id),
                  sample_json = COALESCE(?, sample_json),
                  release = COALESCE(?, release),
                  environment = ?
            WHERE id = ?`,
        )
        .bind(
          nowSec,
          mergedSeverity,
          nextStatus,
          clearResolution ? 1 : 0,
          clearResolution ? 1 : 0,
          clearSnooze ? 1 : 0,
          safeMessage,
          safeStack || null,
          title,
          errorType,
          url,
          method,
          requestId,
          sampleJson,
          release,
          environment,
          existing.id,
        )
        .run();
      return;
    }

    // No existing row → fresh INSERT.
    await db
      .prepare(
        `INSERT INTO error_events
          (fingerprint, source, severity, message, stack, path, tenant_id,
           user_id, context, count, first_seen, last_seen, created_at,
           status, environment, release, error_type, url, method,
           request_id, sample_json, users_affected, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?,
                 'open', ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
        environment,
        release,
        errorType,
        url,
        method,
        requestId,
        sampleJson,
        title,
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
  maxSeverity,
};
