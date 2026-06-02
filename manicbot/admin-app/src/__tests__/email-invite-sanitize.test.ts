/**
 * #MAIL-1 — the newer master-invite email templates interpolate the
 * tenant-controlled salon name. The salon name is stored unsanitized at
 * registration, so a malicious owner can set it to HTML/script and have it
 * land in every invited master's external inbox (script blocked by inbox
 * sanitizers, but phishing links / fake buttons / brand spoof still render).
 * The older `masterInviteEmailHtml` already sanitizes via
 * `sanitizeEmailDisplayName`; the invite-copy helpers did not.
 */
import { describe, it, expect } from "vitest";
import { masterInviteExistingUserHtml, masterInviteNewUserHtml } from "~/server/email/templates";

const XSS = "<script>alert(document.cookie)</script>";

describe("#MAIL-1 — master-invite templates sanitize the salon name", () => {
  it("masterInviteExistingUserHtml does not emit a raw <script> from the salon name", () => {
    const html = masterInviteExistingUserHtml({ salonName: XSS, acceptUrl: "https://app/accept" }, "en");
    expect(html).not.toContain("<script>alert");
  });

  it("masterInviteNewUserHtml does not emit a raw <script> from the salon name", () => {
    const html = masterInviteNewUserHtml({ salonName: XSS, registerUrl: "https://app/register" }, "en");
    expect(html).not.toContain("<script>alert");
  });

  it("still renders a normal salon name", () => {
    const html = masterInviteExistingUserHtml({ salonName: "Nail Studio Karina", acceptUrl: "https://app/accept" }, "en");
    expect(html).toContain("Nail Studio Karina");
  });
});
