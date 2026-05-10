/**
 * /api/track — landing/web event ingestion endpoint.
 *
 * Accepts a small JSON envelope: `{ anonymousId, event, properties }`.
 * Validates against an allowlist (see trackHttpLogic.js), rate-limits per IP,
 * and writes one row into `analytics_events`. Replies `204 No Content` so
 * nothing leaks back to the caller.
 *
 * Security model:
 *   * NEVER trust the client-side consent flag. Before INSERTing, the handler
 *     verifies that the most-recent `cookie_consent_log` row for this
 *     `anonymous_id` granted `analytics: true`. If not, drop silently.
 *   * Strict allowlist + Zod-style schema. Unknown event names are dropped.
 *   * Hard caps: 4 KB request body, 60 events/min/IP.
 *   * No echo: 204 on success, 204 on dropped, generic 400/429 on bad shape.
 *     A malicious caller cannot use this endpoint to probe stored data.
 *
 * NOTE: This endpoint is currently the only ingestion path for the landing.
 * Vendor pixels (Meta CAPI, Plausible) are NOT loaded yet — the env vars and
 * fan-out hook are stubbed in src/utils/analytics.js for a future phase.
 */
import {
  ALLOWED_TRACK_EVENTS,
  MAX_PROPERTY_BYTES,
  TRACK_RATE_LIMIT_MAX,
  TRACK_RATE_LIMIT_WINDOW_MS,
  buildTrackInsertParams,
  parseTrackPayload,
} from './trackHttpLogic.js';
import { dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const MAX_BODY_BYTES = 8_192;

/**
 * In-memory token bucket per IP. The Worker isolate is short-lived (seconds to
 * a few minutes), so this is best-effort + cheap; the D1-backed rate limit on
 * the admin-app side handles the durable case. Here we're protecting the
 * Worker from a single hot client during a single isolate lifetime.
 */
const ipBuckets = new Map();

function rateLimitOk(ip) {
  const now = Date.now();
  const cutoff = now - TRACK_RATE_LIMIT_WINDOW_MS;
  const bucket = ipBuckets.get(ip) || [];
  const fresh = bucket.filter((t) => t >= cutoff);
  if (fresh.length >= TRACK_RATE_LIMIT_MAX) {
    ipBuckets.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  ipBuckets.set(ip, fresh);
  return true;
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    'unknown'
  );
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return { ok: false, error: 'too_large' };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'too_large' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'bad_json' };
  }
}

/**
 * Verify the visitor has consented to the `analytics` category. Looks at the
 * most recent row in cookie_consent_log for this anonymous_id; if there is no
 * row, or the most recent grants analytics=false, drop the event.
 */
async function hasAnalyticsConsent(env, anonymousId) {
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT categories FROM cookie_consent_log
        WHERE anonymous_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
      .bind(anonymousId)
      .first();
    if (!row?.categories) return false;
    const cats = JSON.parse(row.categories);
    return cats?.analytics === true;
  } catch (e) {
    log.error('trackHttp.consentCheck', e instanceof Error ? e : new Error(String(e)));
    return false;
  }
}

/**
 * Public handler. Always returns Response. Always 204 on success, dropped, or
 * silently filtered — the caller never learns whether the event was stored.
 */
export async function handleTrackRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const ip = clientIp(request);
  if (!rateLimitOk(ip)) {
    // 429 is fine — the rate limit applies to the IP, not the user. The body
    // is generic so an attacker cannot probe stored state through it.
    return new Response('rate limited', { status: 429 });
  }

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return new Response('bad request', { status: 400 });
  }

  const parsed = parseTrackPayload(body.value);
  if (!parsed.ok) {
    // 204 instead of 400 here so a script-kiddie probing event names cannot
    // distinguish "rejected" from "accepted".
    return new Response(null, { status: 204 });
  }

  // Server-side consent gate. localStorage is a hint, not authority.
  if (!(await hasAnalyticsConsent(env, parsed.value.anonymousId))) {
    return new Response(null, { status: 204 });
  }

  try {
    const row = buildTrackInsertParams(parsed.value, {
      tenantId: null, // landing events are platform-level, not tenant-scoped
      nowSec: nowSec(),
    });
    // Mirror recordEvent() shape so dashboards reading analytics_events handle
    // both ingestion paths uniformly.
    await dbRun(
      { db: env.DB },
      `INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      row.tenantId,
      row.userId,
      row.event,
      row.properties,
      row.createdAt,
    );
  } catch (e) {
    // Non-fatal — analytics ingest must never break user UX.
    log.error('trackHttp.insert', e instanceof Error ? e : new Error(String(e)));
  }

  return new Response(null, { status: 204 });
}

export const __test = {
  rateLimitOk,
  ipBuckets,
  // Whitelist the test surface so we don't accidentally export internals.
  ALLOWED_TRACK_EVENTS,
  MAX_PROPERTY_BYTES,
};
