/**
 * Cookie consent storage (v2 — categorized).
 *
 * The localStorage record is a *cache* of the user's decision; the server
 * audit row in `cookie_consent_log` is the source of truth. Any tracking
 * activation must check the server-side row, not just this cache, so a
 * visitor cannot enable analytics by editing localStorage in DevTools.
 *
 * Backward compatibility: legacy v1 records (`{version:1, decidedAt, acceptedAll}`)
 * are auto-migrated on read so the banner does not re-pop for users who
 * already chose under the old single-bucket model.
 */

export const COOKIE_BANNER_APPEAR_DELAY_MS = 10_000;

/**
 * Bump POLICY_VERSION when the consent text or scope changes — e.g. when a
 * new vendor is added to the marketing category. A bump invalidates all
 * existing localStorage records (read returns null) so users see the banner
 * again. Server-side log entries from the prior version stay as audit history.
 */
export const POLICY_VERSION = "2026-05-10-v1";

const EXPIRY_MS = 12 * 30 * 24 * 60 * 60 * 1000;

export const COOKIE_CONSENT_LOCAL_KEY = "mb-admin-cookie-consent-v1";
export const COOKIE_CONSENT_LEGACY_SESSION_KEY =
  "mb-admin-cookie-consent-session-v1";
export const COOKIE_BANNER_SHOWN_SESSION_KEY =
  "mb-admin-cookie-banner-shown-v1";
export const ANONYMOUS_ID_KEY = "mb-anon-id-v1";

const ANON_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

export type ConsentCategories = {
  necessary: true; // always true — required for the site to function
  analytics: boolean;
  marketing: boolean;
  ux: boolean;
};

export type CookieConsentRecord = {
  version: 2;
  decidedAt: number;
  policyVersion: string;
  categories: ConsentCategories;
};

export function buildCategoriesAcceptAll(): ConsentCategories {
  return { necessary: true, analytics: true, marketing: true, ux: true };
}

export function buildCategoriesRejectAll(): ConsentCategories {
  return { necessary: true, analytics: false, marketing: false, ux: false };
}

export function markCookieBannerShown(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(COOKIE_BANNER_SHOWN_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function wasCookieBannerShownThisSession(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(COOKIE_BANNER_SHOWN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function fanOutAcceptedAll(acceptedAll: boolean): ConsentCategories {
  return {
    necessary: true,
    analytics: acceptedAll,
    marketing: acceptedAll,
    ux: acceptedAll,
  };
}

function migrateLegacyV1Record(p: unknown): CookieConsentRecord | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.decidedAt !== "number") return null;
  if (typeof obj.acceptedAll !== "boolean") return null;
  return {
    version: 2,
    decidedAt: obj.decidedAt,
    policyVersion: "legacy-v1",
    categories: fanOutAcceptedAll(obj.acceptedAll),
  };
}

function isV2Record(p: unknown): p is CookieConsentRecord {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  if (obj.version !== 2) return false;
  if (typeof obj.decidedAt !== "number") return false;
  if (typeof obj.policyVersion !== "string") return false;
  const cats = obj.categories as Record<string, unknown> | undefined;
  if (!cats || typeof cats !== "object") return false;
  if (cats.necessary !== true) return false;
  return (
    typeof cats.analytics === "boolean" &&
    typeof cats.marketing === "boolean" &&
    typeof cats.ux === "boolean"
  );
}

function parseValidRecord(
  raw: string | null,
  enforceExpiry: boolean,
): CookieConsentRecord | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    let rec: CookieConsentRecord | null = null;
    if (isV2Record(p)) {
      rec = p;
    } else {
      rec = migrateLegacyV1Record(p);
    }
    if (!rec) return null;
    if (enforceExpiry && Date.now() - rec.decidedAt > EXPIRY_MS) return null;
    return rec;
  } catch {
    return null;
  }
}

function migrateFromLegacySession(): CookieConsentRecord | null {
  try {
    if (
      typeof localStorage === "undefined" ||
      typeof sessionStorage === "undefined"
    )
      return null;
    if (localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY)) return null;
    const raw = sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY);
    const rec = parseValidRecord(raw, true);
    if (rec) {
      try {
        localStorage.setItem(COOKIE_CONSENT_LOCAL_KEY, JSON.stringify(rec));
      } catch {
        /* ignore quota */
      }
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

/**
 * Persist the user's decision. The returned record is exactly what was stored.
 * Caller MUST also POST to the server `/consent.record` mutation; this function
 * does not network. We force `necessary: true` defensively even if a malicious
 * caller bypasses the type system.
 */
export function writeCookieConsent(
  categories: ConsentCategories,
): CookieConsentRecord {
  const safeCategories: ConsentCategories = {
    necessary: true,
    analytics: !!categories.analytics,
    marketing: !!categories.marketing,
    ux: !!categories.ux,
  };
  const record: CookieConsentRecord = {
    version: 2,
    decidedAt: Date.now(),
    policyVersion: POLICY_VERSION,
    categories: safeCategories,
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(COOKIE_CONSENT_LOCAL_KEY, JSON.stringify(record));
    }
  } catch {
    /* private mode / quota */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(COOKIE_CONSENT_LEGACY_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
  return record;
}

function fallbackRandomId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return `anon-${t}-${r}`;
}

function generateAnonymousId(): string {
  try {
    const c = typeof crypto !== "undefined" ? crypto : undefined;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return fallbackRandomId();
}

/**
 * A random UUID stored in localStorage so we can correlate a visitor's events
 * across pageviews without a tracking cookie. NOT a secret — the server treats
 * it as a self-reported correlation handle, never as authentication.
 */
export function getOrCreateAnonymousId(): string {
  try {
    if (typeof localStorage === "undefined") return generateAnonymousId();
    const stored = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (stored && ANON_ID_PATTERN.test(stored)) return stored;
    const fresh = generateAnonymousId();
    try {
      localStorage.setItem(ANONYMOUS_ID_KEY, fresh);
    } catch {
      /* quota */
    }
    return fresh;
  } catch {
    return generateAnonymousId();
  }
}
