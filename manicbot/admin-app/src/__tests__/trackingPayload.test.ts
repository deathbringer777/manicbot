import { describe, it, expect } from "vitest";
import {
  encodeStartPayload,
  encodeStartPayloadFit,
  decodeStartPayload,
} from "~/lib/trackingPayload";

// This codec is the mirror of manicbot/src/services/origins.js. The two MUST stay
// symmetric — a token minted here is decoded by the Worker's /start handler.

describe("trackingPayload — encode/decode round-trip", () => {
  it("round-trips ASCII source + campaign", () => {
    const token = encodeStartPayload({ source: "qr", campaign: "april" });
    expect(decodeStartPayload(token)).toEqual({ source: "qr", campaign: "april" });
  });

  it("produces URL-safe tokens (no + / =)", () => {
    const token = encodeStartPayload({ source: "@@@", campaign: "???" });
    expect(token).not.toMatch(/[+/=]/);
  });

  it("throws on empty input", () => {
    expect(() => encodeStartPayload({})).toThrow(/empty/);
  });

  it("throws (strict) when the token would exceed maxLen", () => {
    expect(() =>
      encodeStartPayload(
        {
          source: "very_long_source_name_1",
          campaign: "very_long_campaign_name_2",
          medium: "very_long_medium_name_3",
          content: "very_long_content_name_4",
        },
        64,
      ),
    ).toThrow(/exceeds maxLen/);
  });
});

describe("trackingPayload — UTF-8 / Cyrillic (regression: btoa crashed)", () => {
  it("no longer throws on a Cyrillic campaign and round-trips", () => {
    const token = encodeStartPayload({ source: "qr", campaign: "Весна" });
    expect(decodeStartPayload(token)).toEqual({ source: "qr", campaign: "Весна" });
  });

  it("round-trips mixed Cyrillic + ASCII + spaces", () => {
    const token = encodeStartPayload({ source: "instagram", campaign: "Весна 2026" });
    expect(decodeStartPayload(token)).toEqual({
      source: "instagram",
      campaign: "Весна 2026",
    });
  });

  it("decodes a legacy ASCII-only token minted the old way (backward compat)", () => {
    const legacy = btoa(JSON.stringify({ s: "qr", c: "april" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeStartPayload(legacy)).toEqual({ source: "qr", campaign: "april" });
  });
});

describe("trackingPayload — encodeStartPayloadFit (graceful degradation)", () => {
  it("returns the full token untruncated when it fits", () => {
    const r = encodeStartPayloadFit({ source: "qr", campaign: "spring" });
    expect(r.truncated).toBe(false);
    expect(r.dropped).toEqual([]);
    expect(decodeStartPayload(r.token)).toEqual({ source: "qr", campaign: "spring" });
  });

  it("drops content (then medium) to fit Cyrillic, keeping source, never throws", () => {
    const r = encodeStartPayloadFit({
      source: "website",
      medium: "вава",
      campaign: "вав",
      content: "вавав",
    });
    expect(r.token.length).toBeLessThanOrEqual(64);
    expect(r.truncated).toBe(true);
    expect(r.dropped).toContain("content");
    const decoded = decodeStartPayload(r.token);
    expect(decoded?.source).toBe("website");
    expect(decoded?.content).toBeUndefined();
  });

  it("falls back to a fitting source-only token for an extreme payload", () => {
    const r = encodeStartPayloadFit({
      source: "instagram",
      campaign: "Очень_длинное_название_кампании_которое_не_влезает",
      medium: "органический_трафик_из_историй",
      content: "баннер_в_шапке_профиля_2026",
    });
    expect(r.token.length).toBeLessThanOrEqual(64);
    expect(decodeStartPayload(r.token)?.source).toBe("instagram");
  });

  it("throws only when there is no source at all", () => {
    expect(() => encodeStartPayloadFit({})).toThrow(/empty/);
  });
});
