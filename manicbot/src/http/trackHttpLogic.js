/**
 * Pure validation + row-building helpers for /api/track.
 *
 * Extracted from the HTTP handler so the validators can be unit-tested without
 * binding D1 / KV / queues. The handler in trackHttp.js wraps these with rate
 * limiting and a fire-and-forget INSERT into analytics_events.
 *
 * Security model:
 *   * Allowlist of event names — anything else is rejected with 400.
 *   * Property payload is hard-capped at MAX_PROPERTY_BYTES.
 *   * `__proto__` and `constructor` keys are stripped before serialization.
 *   * Output is JSON-stringified and clamped at 1000 chars to fit the existing
 *     analytics_events.properties column convention.
 */

export const ALLOWED_TRACK_EVENTS = Object.freeze([
  'pageview',
  'cta_click',
  'form_submit',
  'scroll_depth',
  'outbound_click',
  'video_play',
  'video_complete',
  'search_performed',
  'salon_view',
  'master_view',
]);

export const MAX_PROPERTY_BYTES = 4_000;
export const TRACK_RATE_LIMIT_MAX = 60;
export const TRACK_RATE_LIMIT_WINDOW_MS = 60_000;
const ANON_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeProperties(props) {
  if (!isPlainObject(props)) return {};
  const out = Object.create(null);
  for (const k of Object.keys(props)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (typeof k !== 'string' || k.length === 0 || k.length > 64) continue;
    const v = props[k];
    const t = typeof v;
    if (t === 'string') {
      out[k] = v.slice(0, 1000);
    } else if (t === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (t === 'boolean') {
      out[k] = v;
    }
    // Drop nested objects / arrays / functions / undefined / null silently.
  }
  return out;
}

/**
 * @param {unknown} payload
 * @returns {{ok:true, value:{anonymousId:string, event:string, properties:object}} | {ok:false, error:string}}
 */
export function parseTrackPayload(payload) {
  if (!isPlainObject(payload)) return { ok: false, error: 'payload must be an object' };

  const anonymousId = payload.anonymousId;
  if (typeof anonymousId !== 'string' || !ANON_ID_PATTERN.test(anonymousId)) {
    return { ok: false, error: 'invalid anonymousId' };
  }

  const event = payload.event;
  if (typeof event !== 'string' || !ALLOWED_TRACK_EVENTS.includes(event)) {
    return { ok: false, error: 'unknown event' };
  }

  const rawProps = payload.properties ?? {};
  if (rawProps !== undefined && !isPlainObject(rawProps)) {
    return { ok: false, error: 'properties must be a flat object' };
  }

  // Byte-cap the input *before* sanitisation to make the limit stable.
  try {
    const wireSize = JSON.stringify(rawProps).length;
    if (wireSize > MAX_PROPERTY_BYTES) {
      return { ok: false, error: 'properties payload too large' };
    }
  } catch {
    return { ok: false, error: 'properties not serialisable' };
  }

  const properties = sanitizeProperties(rawProps);

  return {
    ok: true,
    value: { anonymousId, event, properties },
  };
}

/**
 * Build the row that will be inserted into analytics_events. The shape mirrors
 * recordEvent() in src/utils/analytics.js so the dashboard query layer can
 * read both sources uniformly.
 *
 * @param {{anonymousId:string, event:string, properties:object}} parsed
 * @param {{tenantId:string|null, nowSec:number}} ctx
 */
export function buildTrackInsertParams(parsed, ctx) {
  const serialized = JSON.stringify(parsed.properties || {}).slice(0, 1000);
  return {
    tenantId: ctx.tenantId ?? null,
    userId: parsed.anonymousId,
    event: parsed.event,
    properties: serialized,
    createdAt: ctx.nowSec,
  };
}
