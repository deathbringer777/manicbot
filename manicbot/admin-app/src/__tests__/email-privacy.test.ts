/**
 * #N3 + #N4 — email privacy hardening.
 *
 * N3: login-alert email no longer embeds the raw client IP. Original design
 *     leaked rough geolocation + travel patterns to anyone with email inbox
 *     access.
 *
 * N4: role-decision email no longer forwards the admin's note in plaintext.
 *     The note may contain internal commentary ("flagged for security",
 *     "personal observation") that should not propagate to the user's mailbox
 *     or wherever they forward it. Users can read the note in their dashboard
 *     via authenticated tRPC.
 */
import { describe, it, expect } from "vitest";
import {
  loginAlertEmailHtml,
  roleRequestDecisionEmailHtml,
} from "~/server/email/templates";

describe("loginAlertEmailHtml (#N3) — IP scrubbed", () => {
  it("does NOT include the raw IP address in the rendered HTML", () => {
    const html = loginAlertEmailHtml("203.0.113.42", "2026-05-09 12:34", "en");
    expect(html).not.toContain("203.0.113.42");
  });

  it("does NOT include an IPv6 address even if passed", () => {
    const html = loginAlertEmailHtml("2001:db8::dead:beef", "2026-05-09 12:34", "en");
    expect(html).not.toContain("2001:db8::dead:beef");
  });

  it("still includes the timestamp (useful for the user)", () => {
    const html = loginAlertEmailHtml("203.0.113.42", "2026-05-09 12:34", "en");
    expect(html).toContain("2026-05-09 12:34");
  });

  it("still warns the user about a new login", () => {
    const html = loginAlertEmailHtml("203.0.113.42", "x", "en");
    // The warning paragraph and login-alert subject heading both still render.
    expect(html.length).toBeGreaterThan(200);
    // Must reference change-password guidance per copy.warning.
    expect(html.toLowerCase()).toMatch(/password/);
  });

  it("renders for all 4 supported languages without leaking the IP", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      const html = loginAlertEmailHtml("198.51.100.7", "now", lang);
      expect(html).not.toContain("198.51.100.7");
    }
  });
});

describe("roleRequestDecisionEmailHtml (#N4) — adminNote scrubbed", () => {
  const SECRET_NOTE = "BRAND_NEW_SECRET_VALUE_THAT_MUST_NOT_LEAK";

  it("does NOT include the raw admin note in the email body", () => {
    const html = roleRequestDecisionEmailHtml(
      "approved",
      "tenant_owner",
      "master",
      SECRET_NOTE,
      "https://example/dashboard",
      "en",
    );
    expect(html).not.toContain(SECRET_NOTE);
  });

  it("still tells the user that a note exists (so they know to check the dashboard)", () => {
    const html = roleRequestDecisionEmailHtml(
      "denied",
      "master",
      "tenant_owner",
      SECRET_NOTE,
      "https://example/dashboard",
      "en",
    );
    // "An admin left a note — view it in your dashboard."
    expect(html.toLowerCase()).toMatch(/(note|view)/);
  });

  it("renders cleanly when no admin note is present", () => {
    const html = roleRequestDecisionEmailHtml(
      "approved",
      "tenant_owner",
      "master",
      null,
      "https://example/dashboard",
      "en",
    );
    expect(html.length).toBeGreaterThan(100);
  });

  it("still includes the dashboard CTA link for the user to read the note", () => {
    const html = roleRequestDecisionEmailHtml(
      "approved",
      "tenant_owner",
      "master",
      SECRET_NOTE,
      "https://example/dashboard",
      "en",
    );
    expect(html).toContain("https://example/dashboard");
  });

  it("renders for all 4 supported languages without leaking the note", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      const html = roleRequestDecisionEmailHtml(
        "approved",
        "tenant_owner",
        "master",
        SECRET_NOTE,
        "https://example/dashboard",
        lang,
      );
      expect(html).not.toContain(SECRET_NOTE);
    }
  });
});
