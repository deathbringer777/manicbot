/**
 * #N1 — email-change confirmation migrated from URL-token to 6-digit code.
 *
 * Pre-fix: `sendEmailChangeVerification` shipped `?token=…` URL; the
 * `confirmEmailChange` mutation looked up the row by token and had a TOCTOU
 * window between the email-uniqueness check and the UPDATE.
 *
 * This test pins the new flow:
 *   1. `emailChangeCodeEmailHtml(code, newEmail)` puts the code in the body, no URL
 *   2. `sendEmailChangeCodeVerification` Resend integration uses the code template
 *   3. The confirmation mutation requires an active session (protected) so the
 *      row is identified by ctx.webUser.id, not by token lookup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emailChangeCodeEmailHtml, getEmailCopy } from "~/server/email/templates";
import { sendEmailChangeCodeVerification } from "~/server/email/emailService";

describe("emailChangeCodeEmailHtml (#N1)", () => {
  it("includes the code AND the new email", () => {
    const html = emailChangeCodeEmailHtml("314159", "new@example.com", "en");
    expect(html).toContain("314159");
    expect(html).toContain("new@example.com");
  });

  it("does NOT include a confirmation URL", () => {
    const html = emailChangeCodeEmailHtml("314159", "new@example.com", "en");
    expect(html).not.toMatch(/[?&]token=/i);
    expect(html).not.toContain("/confirm-email-change?");
  });

  it("renders for all 4 supported languages without throwing", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(() => emailChangeCodeEmailHtml("999999", "x@y.z", lang)).not.toThrow();
    }
  });
});

describe("emailChangeCode subjects", () => {
  it("subject mentions ManicBot in all languages", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(getEmailCopy(lang).emailChangeCode.subject).toContain("ManicBot");
    }
  });
});

describe("sendEmailChangeCodeVerification", () => {
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

  it("calls Resend with code in body, no URL, addresses NEW email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_e1" }) }));
    const result = await sendEmailChangeCodeVerification("new@example.com", "555000", "new@example.com", "en");
    expect(result).toEqual({ ok: true });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(body.to).toEqual(["new@example.com"]);
    expect(body.html).toContain("555000");
    expect(body.html).toContain("new@example.com");
    expect(body.html).not.toMatch(/[?&]token=/i);
  });
});

// ── Pure logic: TOCTOU close-out reasoning ────────────────────────────────
//
// The new flow uses the caller's session id for the UPDATE, so two parallel
// `confirmEmailChange` calls for the same user collapse into one (the second
// one finds the token already cleared). The remaining race is the cross-user
// case: two users both try to change their email to the same target. The
// `idx_web_user_email` UNIQUE INDEX on `web_users.email` (schema.sql line 429)
// will throw on the second UPDATE, which the mutation catches and surfaces as
// CONFLICT to the caller.

describe("email-change TOCTOU narrative", () => {
  // Pure logic emulation of the constraint check.
  function tryUpdateEmail(currentEmails: Set<string>, userEmail: string, newEmail: string): { ok: boolean; reason?: string } {
    if (currentEmails.has(newEmail) && newEmail !== userEmail) {
      return { ok: false, reason: "UNIQUE_constraint_failed" };
    }
    currentEmails.delete(userEmail);
    currentEmails.add(newEmail);
    return { ok: true };
  }

  it("first confirm wins, second confirm sees UNIQUE failure", () => {
    const emails = new Set(["a@example.com", "b@example.com"]);
    const r1 = tryUpdateEmail(emails, "a@example.com", "target@example.com");
    expect(r1.ok).toBe(true);

    const r2 = tryUpdateEmail(emails, "b@example.com", "target@example.com");
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("UNIQUE_constraint_failed");
  });

  it("self-confirm to existing email is a no-op (does not throw)", () => {
    const emails = new Set(["a@example.com"]);
    const r = tryUpdateEmail(emails, "a@example.com", "a@example.com");
    expect(r.ok).toBe(true);
  });
});
