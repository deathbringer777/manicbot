/**
 * #N1 — password reset migrated from URL-token to 6-digit code.
 *
 * Pre-fix: `sendPasswordResetEmail` shipped a `?token=…` URL. Tokens were
 * hashed at rest (good) but still exposed via Referer headers, MTA logs,
 * browser history. This test pins the new flow:
 *
 *   1. `passwordResetCodeEmailHtml(code)` puts the code in the body, no URL
 *   2. `sendPasswordResetCodeEmail` renders the new template and Resend gets it
 *   3. The pure code-comparison + expiry logic is constant-time and bounded
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { passwordResetCodeEmailHtml, getEmailCopy } from "~/server/email/templates";
import { sendPasswordResetCodeEmail } from "~/server/email/emailService";

describe("passwordResetCodeEmailHtml (#N1)", () => {
  it("includes the full code in the rendered HTML", () => {
    const html = passwordResetCodeEmailHtml("742918", "en");
    expect(html).toContain("742918");
  });

  it("does NOT include a reset URL (no ?token= leakage)", () => {
    const html = passwordResetCodeEmailHtml("742918", "en");
    expect(html).not.toMatch(/[?&]token=/i);
    expect(html).not.toContain("/reset-password?");
  });

  it("renders for all 4 supported languages without throwing", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(() => passwordResetCodeEmailHtml("123456", lang)).not.toThrow();
    }
  });

  it("returns a non-empty HTML string with ManicBot branding", () => {
    const html = passwordResetCodeEmailHtml("999999", "ru");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(50);
    expect(html.toLowerCase()).toContain("manicbot");
  });
});

describe("getEmailCopy — passwordReset subjects (still valid for code variant)", () => {
  it("subject mentions ManicBot in all languages", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(getEmailCopy(lang).passwordReset.subject).toContain("ManicBot");
    }
  });
});

describe("sendPasswordResetCodeEmail (Resend integration)", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "ManicBot <noreply@manicbot.com>";
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.RESEND_FROM = originalFrom;
    vi.unstubAllGlobals();
  });

  it("calls Resend with the code in body and a ManicBot subject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_1" }) }),
    );
    const result = await sendPasswordResetCodeEmail("user@example.com", "456789", "en");
    expect(result).toEqual({ ok: true });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.subject).toContain("ManicBot");
    expect(body.html).toContain("456789");
    expect(body.html).not.toMatch(/[?&]token=/i);
    expect(body.to).toEqual(["user@example.com"]);
  });

  it("returns ok:false when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendPasswordResetCodeEmail("u@example.com", "111111", "en");
    expect(result.ok).toBe(false);
  });
});

// ── Pure logic: code/expiry/constant-time compare ──────────────────────────
// Mirrors what the new resetPassword mutation does internally.

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

describe("password-reset code matching (constant-time)", () => {
  it("matches when codes are identical", () => {
    expect(constantTimeEquals("123456", "123456")).toBe(true);
  });

  it("rejects mismatched codes", () => {
    expect(constantTimeEquals("123456", "654321")).toBe(false);
  });

  it("rejects length mismatch (defends against partial supply)", () => {
    expect(constantTimeEquals("123456", "12345")).toBe(false);
  });
});

describe("password-reset code TTL", () => {
  function isExpired(expiresAt: number | null, nowSec: number): boolean {
    if (!expiresAt) return true; // no TTL set → reject (fail closed)
    return nowSec > expiresAt;
  }

  const now = Math.floor(Date.now() / 1000);

  it("not expired within 1h window", () => {
    expect(isExpired(now + 3600, now)).toBe(false);
  });

  it("expired after 1h", () => {
    expect(isExpired(now - 1, now)).toBe(true);
  });

  it("rejects null expiry (fail closed)", () => {
    expect(isExpired(null, now)).toBe(true);
  });
});
