/**
 * Meta Conversions API (CAPI) — server-side conversion events.
 *
 * Sends high-value conversions (registration, purchase) straight from the Worker
 * to the Meta dataset, complementing the browser Meta Pixel on the landing. The
 * server signal survives ad-blockers / cookie loss and carries first-party data
 * (hashed email) for matching. Browser + server events dedup on Meta's side via a
 * shared `event_id`.
 *
 * Feature-flagged: a no-op unless BOTH META_CAPI_PIXEL_ID (var) and META_CAPI_TOKEN
 * (secret) are configured (wired in src/config.js buildCtx → ctx.metaCapi*). Every
 * call is best-effort and NEVER throws into the caller — a CAPI failure must not
 * break a billing webhook.
 *
 * Reuses the shared Graph client (src/channels/graph-api.js, v21.0, retry+backoff).
 */

import { graphPost } from '../channels/graph-api.js';
import { log } from '../utils/logger.js';
import { nowSec } from '../utils/time.js';

/** Meta normalization: email → trimmed + lowercased before hashing. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Meta normalization: phone → digits only (country code kept, no '+'/spaces). */
export function normalizePhone(phone) {
  return String(phone || '').replace(/\D+/g, '');
}

/** SHA-256 hex of a string (Meta requires hashed PII). Web Crypto — no deps. */
export async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build Meta `user_data` — hashes PII, passes match keys (fbp/fbc/ip/ua) raw. */
export async function buildUserData({ email, phone, clientIp, userAgent, fbp, fbc } = {}) {
  const ud = {};
  const em = normalizeEmail(email);
  if (em) ud.em = [await sha256Hex(em)];
  const ph = normalizePhone(phone);
  if (ph) ud.ph = [await sha256Hex(ph)];
  if (clientIp) ud.client_ip_address = clientIp;
  if (userAgent) ud.client_user_agent = userAgent;
  if (fbp) ud.fbp = fbp; // Meta cookie — already opaque, sent un-hashed
  if (fbc) ud.fbc = fbc;
  return ud;
}

/**
 * Send a single conversion event to the Meta CAPI.
 *
 * @param {object} ctx - request context (must carry metaCapiPixelId + metaCapiToken)
 * @param {object} params
 * @param {string} params.eventName       - Meta standard event (e.g. 'Purchase', 'CompleteRegistration')
 * @param {string} [params.eventId]       - stable id for browser↔server dedup (e.g. 'inv_<stripeInvoiceId>')
 * @param {number} [params.eventTime]     - unix seconds (default: now)
 * @param {string} [params.email]         - plaintext, hashed before send
 * @param {string} [params.phone]         - plaintext, hashed before send
 * @param {number} [params.value]         - conversion value
 * @param {string} [params.currency]      - ISO currency (upper-cased)
 * @param {string} [params.eventSourceUrl]
 * @param {string} [params.actionSource]  - default 'website'
 * @param {string} [params.clientIp]
 * @param {string} [params.userAgent]
 * @param {string} [params.fbp]
 * @param {string} [params.fbc]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, data?: any, status?: number, error?: string }>}
 */
export async function sendCapiEvent(ctx, params = {}) {
  const pixelId = ctx?.metaCapiPixelId;
  const token = ctx?.metaCapiToken;
  if (!pixelId || !token) return { ok: false, skipped: true, reason: 'capi_not_configured' };

  const {
    eventName,
    eventId,
    eventTime,
    email,
    phone,
    value,
    currency,
    eventSourceUrl,
    actionSource = 'website',
    clientIp,
    userAgent,
    fbp,
    fbc,
  } = params;

  if (!eventName) return { ok: false, error: 'missing_event_name' };

  try {
    const event = {
      event_name: eventName,
      event_time: eventTime || nowSec(),
      action_source: actionSource,
      user_data: await buildUserData({ email, phone, clientIp, userAgent, fbp, fbc }),
    };
    if (eventId) event.event_id = eventId;
    if (eventSourceUrl) event.event_source_url = eventSourceUrl;

    const customData = {};
    if (value != null && !Number.isNaN(Number(value))) customData.value = Number(value);
    if (currency) customData.currency = String(currency).toUpperCase();
    if (Object.keys(customData).length) event.custom_data = customData;

    const payload = { data: [event] };
    if (ctx.metaCapiTestCode) payload.test_event_code = ctx.metaCapiTestCode;

    const res = await graphPost(`/${pixelId}/events`, token, payload, { label: 'meta.capi', host: 'facebook' });
    if (!res.ok) {
      // Log without PII — only the event name + Meta's error envelope.
      log.warn('marketing.capi', { message: 'capi_send_failed', event: eventName, status: res.status, error: res.error });
    }
    return res;
  } catch (e) {
    log.error('marketing.capi', e instanceof Error ? e : new Error(String(e?.message)));
    return { ok: false, error: e?.message };
  }
}
