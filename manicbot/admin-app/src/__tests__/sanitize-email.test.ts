/**
 * Unit tests for the email-specific sanitizers added as part of
 * Blocker 4 (pre-launch remediation). These pin the contract that
 * user-controlled strings flowing into HTML email templates AND the
 * subject line cannot smuggle:
 *
 *   - HTML / script tags
 *   - CRLF header-injection payloads
 *   - leading RTL override (homograph attack)
 *   - zero-width invisible payloads
 *   - control bytes
 *
 * Also locks the zod-companion predicate `isSafeDisplayName` to the
 * fail-fast rules used at the `webUsers.register` boundary.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeEmailDisplayName,
  sanitizeEmailSubject,
  isSafeDisplayName,
} from "~/server/security/sanitize";

describe("sanitizeEmailDisplayName", () => {
  it("returns a clean string unchanged", () => {
    expect(sanitizeEmailDisplayName("Anna")).toBe("Anna");
    expect(sanitizeEmailDisplayName("Анна Иванова")).toBe("Анна Иванова");
    expect(sanitizeEmailDisplayName("Jean-Paul O'Connor")).toBe("Jean-Paul O&#x27;Connor");
  });

  it("treats null / undefined / non-string as empty", () => {
    expect(sanitizeEmailDisplayName(null)).toBe("");
    expect(sanitizeEmailDisplayName(undefined)).toBe("");
    // @ts-expect-error guarding runtime input
    expect(sanitizeEmailDisplayName(42)).toBe("");
  });

  it("strips HTML tags and escapes residual ampersands / quotes", () => {
    // Tags are removed (no `<` survives); inner text content can survive
    // as visible text but it's no longer executable — there is no JS in
    // an email body, only rendered HTML.
    const out1 = sanitizeEmailDisplayName("<script>alert(1)</script>Anna");
    expect(out1).not.toMatch(/<|>/);
    expect(out1.toLowerCase()).toContain("anna");
    const out2 = sanitizeEmailDisplayName("Anna<img onerror=alert(1)>");
    expect(out2).not.toMatch(/<|>/);
    expect(out2.toLowerCase()).toContain("anna");
    expect(sanitizeEmailDisplayName("A & B")).toBe("A &amp; B");
  });

  it("kills CRLF — the security-relevant property", () => {
    // The fundamental defence is that CRLF cannot survive in the output;
    // that's what SMTP / MIME header-injection attacks need. Substrings like
    // "Bcc:" that appear in the visible display name are harmless plain text
    // — Resend uses a JSON-bodied API, so SMTP-level header smuggling is
    // structurally blocked anyway.
    const malicious = "Anna\r\nBcc: attacker@evil.com\r\nSubject: pwned";
    const cleaned = sanitizeEmailDisplayName(malicious);
    expect(cleaned).not.toMatch(/\r|\n/);
    expect(cleaned.toLowerCase()).toContain("anna");
  });

  it("kills CRLF in the email Subject sanitizer too", () => {
    const malicious = "Confirm your email\r\nBcc: x@y.z";
    const cleaned = sanitizeEmailSubject(malicious);
    expect(cleaned).not.toMatch(/\r|\n/);
  });

  it("strips zero-width characters used for invisible phishing", () => {
    const zwj = "An​na"; // zero-width space
    expect(sanitizeEmailDisplayName(zwj)).toBe("Anna");
    const bom = "﻿Anna";
    expect(sanitizeEmailDisplayName(bom)).toBe("Anna");
  });

  it("refuses leading RTL override (homograph trick)", () => {
    // U+202E LEFT-TO-RIGHT OVERRIDE flips visible order:
    // "‮anna.exe" renders as "exe.anna". We strip leading override
    // codepoints so this trick can't work in display names.
    const attack = "‮exe.anna";
    expect(sanitizeEmailDisplayName(attack)).toBe("exe.anna");
  });

  it("strips control bytes", () => {
    // eslint-disable-next-line no-control-regex
    const messy = "An\x00n\x07a";
    expect(sanitizeEmailDisplayName(messy)).toBe("Anna");
  });

  it("collapses runs of whitespace + trims", () => {
    expect(sanitizeEmailDisplayName("  Anna   Ivanova  ")).toBe("Anna Ivanova");
  });

  it("caps length at 100 by default", () => {
    expect(sanitizeEmailDisplayName("a".repeat(500)).length).toBe(100);
  });

  it("honours a custom maxLen", () => {
    expect(sanitizeEmailDisplayName("Anna Ivanova", 5)).toBe("Anna ");
  });
});

describe("sanitizeEmailSubject", () => {
  it("collapses CRLF + tabs and caps at 200", () => {
    const messy = "Confirm your email\r\nBcc: x@y.z";
    const cleaned = sanitizeEmailSubject(messy);
    expect(cleaned).not.toMatch(/\r|\n/);
    expect(cleaned).toMatch(/Confirm your email Bcc:/);
  });
  it("returns empty for non-strings", () => {
    expect(sanitizeEmailSubject(null)).toBe("");
    expect(sanitizeEmailSubject(undefined)).toBe("");
  });
});

describe("isSafeDisplayName (zod-friendly predicate)", () => {
  it("accepts ordinary names across scripts", () => {
    expect(isSafeDisplayName("Anna")).toBe(true);
    expect(isSafeDisplayName("Анна")).toBe(true);
    expect(isSafeDisplayName("علي")).toBe(true);
    expect(isSafeDisplayName("Jean-Paul")).toBe(true);
    expect(isSafeDisplayName("O'Connor")).toBe(true);
  });

  it("rejects strings with HTML metacharacters", () => {
    expect(isSafeDisplayName("Anna<script>")).toBe(false);
    expect(isSafeDisplayName("a & b")).toBe(false);
    expect(isSafeDisplayName('"quoted"')).toBe(false);
  });

  it("rejects CRLF", () => {
    expect(isSafeDisplayName("Anna\r\nBcc:x")).toBe(false);
    expect(isSafeDisplayName("Anna\nfoo")).toBe(false);
  });

  it("rejects leading RTL/LRO/RLO override", () => {
    expect(isSafeDisplayName("‮exe.cod")).toBe(false);
    expect(isSafeDisplayName("‭pwn.exe")).toBe(false);
  });

  it("rejects zero-width chars", () => {
    expect(isSafeDisplayName("An​na")).toBe(false);
  });

  it("rejects control bytes", () => {
    expect(isSafeDisplayName("An\x00na")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeDisplayName("")).toBe(false);
  });
});
