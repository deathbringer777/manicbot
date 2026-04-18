import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_BANNER_APPEAR_DELAY_MS,
  COOKIE_CONSENT_SESSION_KEY,
  readSessionCookieConsent,
  writeSessionCookieConsent,
} from "~/lib/cookieConsentSession";

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

describe("cookieConsentSession", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  it("uses 10s appear delay to match product requirement", () => {
    expect(COOKIE_BANNER_APPEAR_DELAY_MS).toBe(10_000);
  });

  it("readSessionCookieConsent returns null when store is empty", () => {
    expect(readSessionCookieConsent()).toBeNull();
  });

  it("readSessionCookieConsent returns null for invalid JSON", () => {
    sessionStorage.setItem(COOKIE_CONSENT_SESSION_KEY, "not-json");
    expect(readSessionCookieConsent()).toBeNull();
  });

  it("readSessionCookieConsent returns null for wrong version", () => {
    sessionStorage.setItem(
      COOKIE_CONSENT_SESSION_KEY,
      JSON.stringify({ version: 2, decidedAt: 1, acceptedAll: true }),
    );
    expect(readSessionCookieConsent()).toBeNull();
  });

  it("readSessionCookieConsent returns null when decidedAt is not a number", () => {
    sessionStorage.setItem(
      COOKIE_CONSENT_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt: "x", acceptedAll: true }),
    );
    expect(readSessionCookieConsent()).toBeNull();
  });

  it("readSessionCookieConsent returns the record when valid", () => {
    const decidedAt = 1_700_000_000_000;
    sessionStorage.setItem(
      COOKIE_CONSENT_SESSION_KEY,
      JSON.stringify({ version: 1, decidedAt, acceptedAll: false }),
    );
    expect(readSessionCookieConsent()).toEqual({
      version: 1,
      decidedAt,
      acceptedAll: false,
    });
  });

  it("writeSessionCookieConsent stores JSON with current timestamp and correct shape", () => {
    const before = Date.now();
    writeSessionCookieConsent(true);
    const after = Date.now();
    const raw = sessionStorage.getItem(COOKIE_CONSENT_SESSION_KEY);
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
  });

  it("readSessionCookieConsent after write returns acceptedAll from write", () => {
    writeSessionCookieConsent(false);
    expect(readSessionCookieConsent()?.acceptedAll).toBe(false);
  });
});

describe("cookieConsentSession — sessionStorage undefined (SSR / tests)", () => {
  it("readSessionCookieConsent returns null when sessionStorage is missing", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(readSessionCookieConsent()).toBeNull();
  });

  it("writeSessionCookieConsent is a no-op when sessionStorage is missing", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => writeSessionCookieConsent(true)).not.toThrow();
  });
});
