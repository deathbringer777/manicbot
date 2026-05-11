import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_ID_KEY,
  COOKIE_BANNER_APPEAR_DELAY_MS,
  COOKIE_BANNER_SHOWN_SESSION_KEY,
  COOKIE_CONSENT_LEGACY_SESSION_KEY,
  COOKIE_CONSENT_LOCAL_KEY,
  POLICY_VERSION,
  buildCategoriesAcceptAll,
  buildCategoriesRejectAll,
  getOrCreateAnonymousId,
  markCookieBannerShown,
  readCookieConsent,
  wasCookieBannerShownThisSession,
  writeCookieConsent,
} from "~/lib/cookieConsentStorage";

function createMemoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
    get length() {
      return m.size;
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
  } as Storage;
}

describe("cookieConsentStorage v2 — categorized consent", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("uses 10s appear delay", () => {
    expect(COOKIE_BANNER_APPEAR_DELAY_MS).toBe(10_000);
  });

  it("exposes a policy version string", () => {
    expect(typeof POLICY_VERSION).toBe("string");
    expect(POLICY_VERSION.length).toBeGreaterThan(0);
  });

  it("readCookieConsent returns null on empty storage", () => {
    expect(readCookieConsent()).toBeNull();
  });

  it("readCookieConsent returns null for invalid JSON", () => {
    localStorage.setItem(COOKIE_CONSENT_LOCAL_KEY, "not-json");
    expect(readCookieConsent()).toBeNull();
  });

  it("buildCategoriesAcceptAll has every non-necessary category set to true", () => {
    const c = buildCategoriesAcceptAll();
    expect(c).toEqual({
      necessary: true,
      analytics: true,
      marketing: true,
      ux: true,
    });
  });

  it("buildCategoriesRejectAll keeps only necessary true", () => {
    const c = buildCategoriesRejectAll();
    expect(c).toEqual({
      necessary: true,
      analytics: false,
      marketing: false,
      ux: false,
    });
  });

  it("writeCookieConsent persists v2 record with policy version + categories", () => {
    const before = Date.now();
    const written = writeCookieConsent(buildCategoriesAcceptAll());
    const after = Date.now();

    expect(written.version).toBe(2);
    expect(written.policyVersion).toBe(POLICY_VERSION);
    expect(written.categories).toEqual({
      necessary: true,
      analytics: true,
      marketing: true,
      ux: true,
    });
    expect(written.decidedAt).toBeGreaterThanOrEqual(before);
    expect(written.decidedAt).toBeLessThanOrEqual(after);

    const raw = localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(2);
    expect(parsed.categories.analytics).toBe(true);
  });

  it("writeCookieConsent forces necessary=true even if caller passes false", () => {
    // necessary cookies must always be on; the type system says necessary: true
    // but a malicious cast (or an old caller) might supply false. Defence in depth.
    const written = writeCookieConsent({
      necessary: false as unknown as true,
      analytics: false,
      marketing: false,
      ux: false,
    });
    expect(written.categories.necessary).toBe(true);
  });

  it("readCookieConsent returns the v2 record after a write", () => {
    writeCookieConsent({
      necessary: true,
      analytics: true,
      marketing: false,
      ux: false,
    });
    const r = readCookieConsent();
    expect(r?.version).toBe(2);
    expect(r?.categories.analytics).toBe(true);
    expect(r?.categories.marketing).toBe(false);
  });

  it("readCookieConsent returns null when v2 record is past 12-month expiry", () => {
    const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({
        version: 2,
        decidedAt: old,
        policyVersion: POLICY_VERSION,
        categories: {
          necessary: true,
          analytics: true,
          marketing: true,
          ux: true,
        },
      }),
    );
    expect(readCookieConsent()).toBeNull();
  });

  it("clears the legacy session key on write", () => {
    sessionStorage.setItem(
      COOKIE_CONSENT_LEGACY_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt: Date.now(), acceptedAll: false }),
    );
    writeCookieConsent(buildCategoriesRejectAll());
    expect(sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY)).toBeNull();
  });
});

describe("cookieConsentStorage — legacy v1 backward compatibility", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("auto-migrates a fresh v1 acceptedAll=true record to v2 with all categories on", () => {
    const decidedAt = Date.now() - 60_000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: true }),
    );
    const r = readCookieConsent();
    expect(r).not.toBeNull();
    expect(r!.version).toBe(2);
    expect(r!.decidedAt).toBe(decidedAt);
    expect(r!.policyVersion).toBe("legacy-v1");
    expect(r!.categories).toEqual({
      necessary: true,
      analytics: true,
      marketing: true,
      ux: true,
    });
  });

  it("auto-migrates v1 acceptedAll=false record to v2 with only necessary on", () => {
    const decidedAt = Date.now() - 60_000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: false }),
    );
    const r = readCookieConsent();
    expect(r!.version).toBe(2);
    expect(r!.categories.necessary).toBe(true);
    expect(r!.categories.analytics).toBe(false);
    expect(r!.categories.marketing).toBe(false);
    expect(r!.categories.ux).toBe(false);
  });

  it("rejects expired v1 records during migration", () => {
    const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt: old, acceptedAll: true }),
    );
    expect(readCookieConsent()).toBeNull();
  });

  it("migrates valid legacy session-stored v1 record into local v2 record", () => {
    const decidedAt = Date.now() - 1_000;
    sessionStorage.setItem(
      COOKIE_CONSENT_LEGACY_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: false }),
    );
    const r = readCookieConsent();
    expect(r!.version).toBe(2);
    expect(r!.categories.analytics).toBe(false);
    expect(localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY)).toBeTruthy();
    expect(sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY)).toBeNull();
  });
});

describe("cookieConsentStorage — anonymous id", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-3333-4444-555555555555",
    });
  });

  it("getOrCreateAnonymousId returns a stable id across calls", () => {
    const a = getOrCreateAnonymousId();
    const b = getOrCreateAnonymousId();
    expect(a).toBe(b);
    expect(a).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("getOrCreateAnonymousId persists to localStorage", () => {
    getOrCreateAnonymousId();
    expect(localStorage.getItem(ANONYMOUS_ID_KEY)).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("getOrCreateAnonymousId rejects a malformed stored value and regenerates", () => {
    localStorage.setItem(ANONYMOUS_ID_KEY, "<script>");
    const id = getOrCreateAnonymousId();
    expect(id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("getOrCreateAnonymousId falls back when crypto.randomUUID is absent", () => {
    vi.stubGlobal("crypto", {});
    const id = getOrCreateAnonymousId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
  });
});

describe("cookie banner session-shown flag", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("wasCookieBannerShownThisSession returns false by default", () => {
    expect(wasCookieBannerShownThisSession()).toBe(false);
  });

  it("markCookieBannerShown flips the session-shown flag", () => {
    markCookieBannerShown();
    expect(wasCookieBannerShownThisSession()).toBe(true);
    expect(sessionStorage.getItem(COOKIE_BANNER_SHOWN_SESSION_KEY)).toBe("1");
  });

  it("session-shown flag is independent of persisted consent", () => {
    writeCookieConsent(buildCategoriesAcceptAll());
    expect(wasCookieBannerShownThisSession()).toBe(false);
    markCookieBannerShown();
    expect(wasCookieBannerShownThisSession()).toBe(true);
  });
});

describe("cookieConsentStorage — no localStorage (SSR)", () => {
  it("read returns null and write does not throw without localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    expect(readCookieConsent()).toBeNull();
    expect(() => writeCookieConsent(buildCategoriesRejectAll())).not.toThrow();
  });
});
