/**
 * Newsletter double-opt-in + unsubscribe token primitives.
 *
 * Two distinct token kinds live in `newsletter_subscribers`:
 *
 *   * `confirm_token` — single-use, 7-day TTL. Minted at first POST
 *     /api/subscribe, embedded in the confirmation email. Clicking the
 *     link consumes the token (clears the column) and stamps
 *     `confirmed_at` + mints an `unsubscribe_token` + triggers the real
 *     welcome email.
 *
 *   * `unsubscribe_token` — long-lived (no expiry), single-purpose,
 *     embedded in every outgoing newsletter so the reader can opt out
 *     in one click. Stamping `unsubscribed_at` is idempotent — we
 *     deliberately do NOT clear the token after use, so a re-visit
 *     just renders the confirmation page again.
 *
 * Both tokens are 32 lowercase hex chars (128 bits of entropy from
 * `crypto.getRandomValues`). The partial UNIQUE indexes in migration
 * 0090 make the (token, NULL) collision a non-issue.
 */

/** 7 days, in seconds. Plenty for the average inbox to surface the email. */
export const CONFIRM_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

const TOKEN_BYTES = 16; // → 32 lowercase hex chars
const TOKEN_SHAPE_RE = /^[a-f0-9]{32,64}$/;

/**
 * Mint a 32-char lowercase-hex token using the runtime CSPRNG. Works on
 * Cloudflare Workers (globalThis.crypto.getRandomValues) and Node 18+
 * (which also exposes the global `crypto`).
 *
 * @returns {string}
 */
export function generateNewsletterToken() {
  const buf = new Uint8Array(TOKEN_BYTES);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Tight shape predicate for any newsletter token (confirm OR unsubscribe).
 * Caller uses this BEFORE hitting D1 so a malformed token never even
 * triggers a query — avoids accidental scans and keeps timing constant.
 *
 * @param {unknown} t
 * @returns {boolean}
 */
export function isValidTokenShape(t) {
  return typeof t === 'string' && TOKEN_SHAPE_RE.test(t);
}

/**
 * @param {number | null | undefined} expiresAtSec
 * @param {number} nowSec
 * @returns {boolean} true when the confirm token has expired (or expiresAt is missing)
 */
export function isConfirmTokenExpired(expiresAtSec, nowSec) {
  if (expiresAtSec === null || expiresAtSec === undefined) return true;
  return expiresAtSec <= nowSec;
}
