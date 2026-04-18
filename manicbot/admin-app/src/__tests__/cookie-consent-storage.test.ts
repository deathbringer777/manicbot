import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_BANNER_APPEAR_DELAY_MS,
  COOKIE_BANNER_SHOWN_SESSION_KEY,
  COOKIE_CONSENT_LEGACY_SESSION_KEY,
  COOKIE_CONSENT_LOCAL_KEY,
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

describe("cookieConsentStorage (localStorage + legacy session migration)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("uses 10s appear delay to match product requirement", () => {
    expect(COOKIE_BANNER_APPEAR_DELAY_MS).toBe(10_000);
  });

  it("readCookieConsent returns null when local is empty and session is empty", () => {
    expect(readCookieConsent()).toBeNull();
  });

  it("readCookieConsent returns null for invalid JSON in local", () => {
    localStorage.setItem(COOKIE_CONSENT_LOCAL_KEY, "not-json");
    expect(readCookieConsent()).toBeNull();
  });

  it("readCookieConsent returns null when record is past 12 month expiry", () => {
    const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt: old, acceptedAll: true }),
    );
    expect(readCookieConsent()).toBeNull();
  });

  it("readCookieConsent returns the record when local is valid and fresh", () => {
    const decidedAt = Date.now() - 60_000;
    localStorage.setItem(
      COOKIE_CONSENT_LOCAL_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: false }),
    );
    expect(readCookieConsent()).toEqual({
      version: 1,
      decidedAt,
      acceptedAll: false,
    });
  });

  it("writeCookieConsent stores to local and clears legacy session key", () => {
    sessionStorage.setItem(
      COOKIE_CONSENT_LEGACY_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt: Date.now(), acceptedAll: false }),
    );
    const before = Date.now();
    writeCookieConsent(true);
    const after = Date.now();
    const raw = localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY);
    expect(raw).toBeTruthy();
    const p = JSON.parse(raw!) as {
      version: number;
      decidedAt: number;
      acceptedAll: boolean;
    };
    expect(p.version).toBe(1);
    expect(p.acceptedAll).toBe(true);
    expect(p.decidedAt).toBeGreaterThanOrEqual(before);
    expect(p.decidedAt).toBeLessThanOrEqual(after);
    expect(sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY)).toBeNull();
  });

  it("migrates valid legacy session into local and removes session key", () => {
    const decidedAt = Date.now() - 1_000;
    sessionStorage.setItem(
      COOKIE_CONSENT_LEGACY_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: false }),
    );
    const rec = readCookieConsent();
    expect(rec).toEqual({ version: 1, decidedAt, acceptedAll: false });
    expect(localStorage.getItem(COOKIE_CONSENT_LOCAL_KEY)).toBeTruthy();
    expect(sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY)).toBeNull();
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

  it("mark+wasShown is decoupled from the legacy session consent key", () => {
    markCookieBannerShown();
    expect(sessionStorage.getItem(COOKIE_CONSENT_LEGACY_SESSION_KEY)).toBeNull();
  });

  it("session-shown flag is independent of persisted consent", () => {
    writeCookieConsent(true);
    // A future session can still track its own "shown" state separately.
    expect(wasCookieBannerShownThisSession()).toBe(false);
    markCookieBannerShown();
    expect(wasCookieBannerShownThisSession()).toBe(true);
  });
});

describe("cookieConsentStorage — no localStorage (SSR)", () => {
  it("read returns null and write is a no-op", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    expect(readCookieConsent()).toBeNull();
    expect(() => writeCookieConsent(true)).not.toThrow();
  });
});
