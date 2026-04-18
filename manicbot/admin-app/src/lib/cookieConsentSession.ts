/**
 * Client-only session storage for the admin cookie banner. Persists for the
 * current tab session; cleared when the tab closes (or sessionStorage is cleared).
 */

export const COOKIE_CONSENT_SESSION_KEY = "mb-admin-cookie-consent-session-v1";

/** Bar becomes visible (opacity transition) after this delay, ms */
export const COOKIE_BANNER_APPEAR_DELAY_MS = 10_000;

export type CookieConsentRecord = {
  version: 1;
  decidedAt: number;
  acceptedAll: boolean;
};

export function readSessionCookieConsent(): CookieConsentRecord | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(COOKIE_CONSENT_SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CookieConsentRecord>;
    if (p.version !== 1 || typeof p.decidedAt !== "number") return null;
    return p as CookieConsentRecord;
  } catch {
    return null;
  }
}

export function writeSessionCookieConsent(acceptedAll: boolean): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(
      COOKIE_CONSENT_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt: Date.now(), acceptedAll }),
    );
  } catch {
    /* private mode / quota */
  }
}
