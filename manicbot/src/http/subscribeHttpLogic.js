/**
 * Pure validation + normalisation helpers for /api/subscribe.
 *
 * Extracted from the HTTP handler so the validators can be unit-tested
 * without binding D1 / KV / fetch. The handler in subscribeHttp.js wraps
 * these with a rate limiter, a D1 UPSERT, and a fire-and-forget call to
 * the admin-app internal welcome endpoint.
 *
 * Security model:
 *   * Emails are lowercased and trimmed at parse time so the UNIQUE index
 *     in newsletter_subscribers is meaningful (RFC 5321 case-insensitive
 *     local-part is a footgun — Resend/most providers fold case anyway).
 *   * Accepts EITHER `lang` (canonical) or `locale` (landing form key).
 *     Anything outside the 4-language whitelist is dropped to NULL.
 *   * Source is whitelisted; an arbitrary string would let a script-kiddie
 *     populate the column with garbage that later confuses analytics joins.
 */

export const ALLOWED_NEWSLETTER_LANGS = Object.freeze(['ru', 'ua', 'en', 'pl']);
export const ALLOWED_NEWSLETTER_SOURCES = Object.freeze([
  'landing',
  'landing_footer',
  'landing_modal',
  'demo_page',
  'admin_invite',
]);
export const SUBSCRIBE_RATE_LIMIT_MAX = 60;
export const SUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60_000;

// Tight enough to reject most garbage, lax enough to accept legit unicode
// local parts. Matches the practical regex used by Resend / Brevo at submit
// time — we'll defer the deep RFC-5322 check to the email provider.
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@.]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LEN = 254;
const ANON_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {unknown} payload
 * @returns {{ok:true, value:{email:string, lang:string|null, anonymousId:string|null, source:string}} | {ok:false, error:string}}
 */
export function parseSubscribePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }

  const rawEmail = payload.email;
  if (typeof rawEmail !== 'string' || rawEmail.length > MAX_EMAIL_LEN) {
    return { ok: false, error: 'email is required' };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'invalid email' };
  }

  // Landing posts `locale`; future callers may post `lang`. Accept both.
  const langCandidate =
    typeof payload.lang === 'string'
      ? payload.lang.toLowerCase()
      : typeof payload.locale === 'string'
        ? payload.locale.toLowerCase()
        : null;
  const lang =
    langCandidate && ALLOWED_NEWSLETTER_LANGS.includes(langCandidate)
      ? langCandidate
      : null;

  const anonymousId =
    typeof payload.anonymousId === 'string' && ANON_ID_PATTERN.test(payload.anonymousId)
      ? payload.anonymousId
      : null;

  const sourceCandidate =
    typeof payload.source === 'string' ? payload.source : 'landing';
  const source = ALLOWED_NEWSLETTER_SOURCES.includes(sourceCandidate)
    ? sourceCandidate
    : 'landing';

  return {
    ok: true,
    value: { email, lang, anonymousId, source },
  };
}

/**
 * Build the row that will be INSERT OR IGNORE-d into newsletter_subscribers.
 *
 * @param {{email:string, lang:string|null, anonymousId:string|null, source:string}} parsed
 * @param {{ip:string|null, userAgent:string|null, nowSec:number, unsubscribeToken:string}} ctx
 */
export function buildSubscriberInsertParams(parsed, ctx) {
  return {
    email: parsed.email,
    source: parsed.source,
    lang: parsed.lang,
    anonymousId: parsed.anonymousId,
    ip: ctx.ip || null,
    userAgent: (ctx.userAgent || '').slice(0, 500) || null,
    createdAt: ctx.nowSec,
    unsubscribeToken: ctx.unsubscribeToken || null,
  };
}

/**
 * Mint a 32-hex-character unsubscribe token (16 random bytes, 128-bit entropy).
 *
 * Matches the shape used by `marketing_contacts.unsubscribe_token` so the
 * Worker `/u/<token>` endpoint can serve both tables with the same handler.
 *
 * @returns {string} 32-character lowercase hex.
 */
export function generateUnsubscribeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
