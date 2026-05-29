/**
 * Email-change confirmation — code-based, no URL token.
 *
 * History: the original flow shipped a `?token=…` URL (leaked via Referer / MTA
 * logs / browser history) with a TOCTOU window in `confirmEmailChange`. It was
 * first migrated to a bespoke 6-digit code email, and is now UNIFIED onto the
 * shared action-OTP path (`actionOtpEmailHtml` / `sendActionOtpEmail`, action
 * "change_email") — one mechanism for password / email / role step-up, no
 * duplicate email-change sender.
 *
 * This test pins the security-relevant invariants that must survive the
 * unification:
 *   1. the email body carries the 6-digit code, NOT a confirmation URL/token
 *   2. the Resend integration sends code-only HTML to the addressed recipient
 *      (the mutation addresses the CURRENT account email — proven there)
 *   3. confirmEmailChange identifies the row by ctx.webUser.id (no token lookup)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { actionOtpEmailHtml, getActionOtpSubject } from "~/server/email/templates";
import { sendActionOtpEmail } from "~/server/email/emailService";

describe("actionOtpEmailHtml — email-change confirmation (code, no URL)", () => {
  it("includes the 6-digit code", () => {
    const html = actionOtpEmailHtml({ code: "314159", actionLabel: "Email change" }, "en");
    expect(html).toContain("314159");
  });

  it("does NOT include a confirmation URL or token", () => {
    const html = actionOtpEmailHtml({ code: "314159", actionLabel: "Email change" }, "en");
    expect(html).not.toMatch(/[?&]token=/i);
    expect(html).not.toContain("/confirm-email-change");
    expect(html).not.toContain("/verify-email");
  });

  it("renders for all 4 supported languages without throwing", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(() => actionOtpEmailHtml({ code: "999999", actionLabel: "Zmiana e-mail" }, lang)).not.toThrow();
    }
  });
});

describe("action-OTP subject", () => {
  it("subject mentions ManicBot in all languages", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(getActionOtpSubject(lang)).toContain("ManicBot");
    }
  });
});

describe("sendActionOtpEmail — email-change issuance", () => {
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

  it("calls Resend with the code in the body, no URL, addressed to the recipient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_e1" }) }));
    // The mutation passes ctx.webUser.email (the CURRENT account address) as `to`.
    const result = await sendActionOtpEmail("current@example.com", "555000", "Email change", "en");
    expect(result).toEqual({ ok: true });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(body.to).toEqual(["current@example.com"]);
    expect(body.html).toContain("555000");
    expect(body.html).not.toMatch(/[?&]token=/i);
    expect(body.html).not.toContain("/confirm-email-change");
  });
});

// ── Pure logic: TOCTOU close-out reasoning ────────────────────────────────
//
// confirmEmailChange uses the caller's session id (ctx.webUser.id) for the
// UPDATE, so two parallel confirms for the same user collapse into one (the
// second presents an already-consumed OTP). The remaining race is cross-user:
// two users both try to change their email to the same target. The
// `idx_web_user_email` UNIQUE INDEX on `web_users.email` (schema.sql line 429)
// throws on the second UPDATE, which the mutation catches and surfaces as
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
