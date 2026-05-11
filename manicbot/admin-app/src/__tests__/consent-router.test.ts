import { describe, it, expect } from "vitest";
import {
  CONSENT_CATEGORIES_SCHEMA,
  CONSENT_RECORD_INPUT_SCHEMA,
  buildConsentInsertRow,
  parseClientIp,
  truncateUserAgent,
} from "~/server/api/consent/consentLogic";

/**
 * The tRPC procedure itself wraps a thin layer over Drizzle insert. The pure
 * logic worth testing is: input validation (Zod), header parsing, payload
 * shaping. Those live in `consentLogic.ts` so they can be unit-tested without
 * a real D1 binding.
 */

describe("CONSENT_CATEGORIES_SCHEMA", () => {
  it("accepts a fully on payload", () => {
    expect(() =>
      CONSENT_CATEGORIES_SCHEMA.parse({
        necessary: true,
        analytics: true,
        marketing: true,
        ux: true,
      }),
    ).not.toThrow();
  });

  it("accepts only-necessary payload", () => {
    expect(() =>
      CONSENT_CATEGORIES_SCHEMA.parse({
        necessary: true,
        analytics: false,
        marketing: false,
        ux: false,
      }),
    ).not.toThrow();
  });

  it("rejects necessary=false (necessary cookies are non-negotiable)", () => {
    expect(() =>
      CONSENT_CATEGORIES_SCHEMA.parse({
        necessary: false,
        analytics: false,
        marketing: false,
        ux: false,
      }),
    ).toThrow();
  });

  it("rejects unknown categories", () => {
    expect(() =>
      CONSENT_CATEGORIES_SCHEMA.parse({
        necessary: true,
        analytics: false,
        marketing: false,
        ux: false,
        sneaky: true,
      } as unknown),
    ).toThrow();
  });
});

describe("CONSENT_RECORD_INPUT_SCHEMA", () => {
  const valid = {
    anonymousId: "11111111-2222-3333-4444-555555555555",
    categories: {
      necessary: true as const,
      analytics: false,
      marketing: false,
      ux: false,
    },
    policyVersion: "2026-05-10-v1",
    source: "banner" as const,
  };

  it("accepts a well-formed payload", () => {
    expect(() => CONSENT_RECORD_INPUT_SCHEMA.parse(valid)).not.toThrow();
  });

  it("rejects an anonymousId that is too short", () => {
    expect(() =>
      CONSENT_RECORD_INPUT_SCHEMA.parse({ ...valid, anonymousId: "x" }),
    ).toThrow();
  });

  it("rejects an anonymousId that is too long", () => {
    expect(() =>
      CONSENT_RECORD_INPUT_SCHEMA.parse({
        ...valid,
        anonymousId: "x".repeat(65),
      }),
    ).toThrow();
  });

  it("rejects a policyVersion longer than 48 chars", () => {
    expect(() =>
      CONSENT_RECORD_INPUT_SCHEMA.parse({
        ...valid,
        policyVersion: "v".repeat(49),
      }),
    ).toThrow();
  });

  it("rejects an unknown source value", () => {
    expect(() =>
      CONSENT_RECORD_INPUT_SCHEMA.parse({
        ...valid,
        source: "exfiltrate" as never,
      }),
    ).toThrow();
  });
});

describe("parseClientIp", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("prefers cf-connecting-ip", () => {
    expect(
      parseClientIp(
        headers({
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "10.0.0.1, 203.0.113.10",
        }),
      ),
    ).toBe("203.0.113.10");
  });

  it("falls back to x-forwarded-for first hop", () => {
    expect(
      parseClientIp(headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" })),
    ).toBe("203.0.113.10");
  });

  it("returns null when neither header is present", () => {
    expect(parseClientIp(headers({}))).toBeNull();
  });

  it("truncates absurdly long IP-like strings", () => {
    const long = "x".repeat(200);
    const got = parseClientIp(headers({ "cf-connecting-ip": long }));
    expect(got!.length).toBeLessThanOrEqual(64);
  });
});

describe("truncateUserAgent", () => {
  it("returns null for missing UA", () => {
    expect(truncateUserAgent(null)).toBeNull();
  });

  it("clamps UA at 500 chars", () => {
    const out = truncateUserAgent("a".repeat(2000));
    expect(out!.length).toBe(500);
  });

  it("preserves a normal UA verbatim", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64)";
    expect(truncateUserAgent(ua)).toBe(ua);
  });
});

describe("buildConsentInsertRow", () => {
  const baseInput = {
    anonymousId: "11111111-2222-3333-4444-555555555555",
    categories: {
      necessary: true as const,
      analytics: false,
      marketing: true,
      ux: false,
    },
    policyVersion: "2026-05-10-v1",
    source: "banner" as const,
  };

  it("serialises categories as JSON", () => {
    const row = buildConsentInsertRow(baseInput, {
      webUserId: null,
      ip: null,
      userAgent: null,
      nowSec: 1_700_000_000,
    });
    expect(JSON.parse(row.categories)).toEqual(baseInput.categories);
  });

  it("links to a webUserId when present", () => {
    const row = buildConsentInsertRow(baseInput, {
      webUserId: "wu_abc",
      ip: null,
      userAgent: null,
      nowSec: 1_700_000_000,
    });
    expect(row.webUserId).toBe("wu_abc");
  });

  it("never lets web_user_id be inferred from anonymousId by accident", () => {
    const row = buildConsentInsertRow(baseInput, {
      webUserId: null,
      ip: null,
      userAgent: null,
      nowSec: 1_700_000_000,
    });
    expect(row.webUserId).toBeNull();
  });

  it("always sets createdAt to the supplied nowSec", () => {
    const row = buildConsentInsertRow(baseInput, {
      webUserId: null,
      ip: null,
      userAgent: null,
      nowSec: 1_700_000_000,
    });
    expect(row.createdAt).toBe(1_700_000_000);
  });

  it("clamps stored ip to 64 chars", () => {
    const row = buildConsentInsertRow(baseInput, {
      webUserId: null,
      ip: "x".repeat(200),
      userAgent: null,
      nowSec: 1_700_000_000,
    });
    expect(row.ip!.length).toBe(64);
  });
});
