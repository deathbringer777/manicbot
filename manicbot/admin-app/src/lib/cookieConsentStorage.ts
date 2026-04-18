/**
 * Cookie banner choice. Uses localStorage with a 12-month TTL so the bar does not
 * reappear every few minutes — sessionStorage was too volatile in mobile and
 * in-app browsers (iOS, Telegram WebView, etc.).
 */

export const COOKIE_BANNER_APPEAR_DELAY_MS = 10_000;

const EXPIRY_MS = 12 * 30 * 24 * 60 * 60 * 1000;

export const COOKIE_CONSENT_LOCAL_KEY = "mb-admin-cookie-consent-v1";

/** Earlier implementation; migrated into `COOKIE_CONSENT_LOCAL_KEY` on read */
export const COOKIE_CONSENT_LEGACY_SESSION_KEY =
  "mb-admin-cookie-consent-session-v1";

export type CookieConsentRecord = {
  version: 1;
  decidedAt: number;
  acceptedAll: boolean;
};

function parseValidRecord(
  raw: string | null,
  enforceExpiry: boolean,
): CookieConsentRecord | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<CookieConsentRecord>;
    if (p.version !== 1 || typeof p.decidedAt !== "number") return null;
    if (enforceExpiry && Date.now() - p.decidedAt > EXPIRY_MS) return null;
    return p as CookieConsentRecord;
  } catch {
    return null;
  }
}

function migrateFromLegacySession(): CookieConsentRecord | null {
  try {
    if (typeof localStorage === "undefined" || typeof sessionStorage === "undefined")
      return null;
    if (localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY)) return null;
    const raw = sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY);
    const rec = parseValidRecord(raw, true);
    if (rec) {
      localStorage.setItem(COOKIE_CONSENT_LOCAL_KEY, raw!);
    }
    try {
      sessionStorage.removeItem(COOKIE_CONSENT_LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return rec;
  } catch {
    return null;
  }
}

export function readCookieConsent(): CookieConsentRecord | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const fromLocal = parseValidRecord(
      localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY),
      true,
    );
    if (fromLocal) return fromLocal;
    return migrateFromLegacySession();
  } catch {
    return null;
  }
}

export function writeCookieConsent(acceptedAll: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt: Date.now(), acceptedAll }),
    );
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(COOKIE_CONSENT_LEGACY_SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* private mode / quota */
  }
}
