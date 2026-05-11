/**
 * #P1-5 (relax.md §5) — Four new email templates: payment_failed,
 * plan_upgrade, master_invite, support_reply. Each one must:
 *   1. Render without throwing for ALL four supported languages (ru/ua/en/pl).
 *   2. Include the localised subject heading somewhere in the body.
 *   3. Embed the CTA URL passed in by the caller.
 *   4. Sanitise / cap untrusted strings (support_reply preview).
 *   5. Provide a non-empty plain-text alternative for clients that prefer it.
 */
import { describe, it, expect } from "vitest";
import {
  paymentFailedEmailHtml,
  paymentFailedEmailText,
  planUpgradeEmailHtml,
  planUpgradeEmailText,
  masterInviteEmailHtml,
  masterInviteEmailText,
  supportReplyEmailHtml,
  supportReplyEmailText,
  getEmailCopy,
} from "~/server/email/templates";

const LANGS = ["ru", "ua", "en", "pl"] as const;

describe("paymentFailedEmailHtml (#P1-5)", () => {
  const opts = {
    amountFormatted: "60,00 zł",
    planLabel: "Pro",
    updatePaymentUrl: "https://example.com/dashboard/billing",
  };

  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = paymentFailedEmailHtml(opts, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("includes the localised heading", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).paymentFailed;
      expect(paymentFailedEmailHtml(opts, lang)).toContain(c.heading);
    }
  });

  it("embeds the update-payment CTA URL", () => {
    expect(paymentFailedEmailHtml(opts, "en")).toContain(opts.updatePaymentUrl);
  });

  it("displays amount and plan in the body", () => {
    const html = paymentFailedEmailHtml(opts, "en");
    expect(html).toContain("60,00 zł");
    expect(html).toContain("Pro");
  });

  it("text variant is non-empty and includes URL + amount", () => {
    const text = paymentFailedEmailText(opts, "en");
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain(opts.updatePaymentUrl);
    expect(text).toContain(opts.amountFormatted);
  });
});

describe("planUpgradeEmailHtml (#P1-5)", () => {
  const opts = {
    oldPlanLabel: "Start",
    newPlanLabel: "Pro",
    dashboardUrl: "https://example.com/dashboard",
  };

  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = planUpgradeEmailHtml(opts, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("includes both old and new plan labels in the body", () => {
    for (const lang of LANGS) {
      const html = planUpgradeEmailHtml(opts, lang);
      expect(html).toContain(opts.oldPlanLabel);
      expect(html).toContain(opts.newPlanLabel);
    }
  });

  it("embeds the dashboard CTA URL", () => {
    expect(planUpgradeEmailHtml(opts, "pl")).toContain(opts.dashboardUrl);
  });

  it("text variant includes both plan labels and URL", () => {
    const text = planUpgradeEmailText(opts, "ua");
    expect(text).toContain("Start");
    expect(text).toContain("Pro");
    expect(text).toContain(opts.dashboardUrl);
  });
});

describe("masterInviteEmailHtml (#P1-5)", () => {
  const opts = {
    salonName: "Crystal Nails Warszawa",
    roleLabel: "Master",
    dashboardUrl: "https://example.com/dashboard",
  };

  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = masterInviteEmailHtml(opts, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("includes salon name and role in the body", () => {
    const html = masterInviteEmailHtml(opts, "ru");
    expect(html).toContain(opts.salonName);
    expect(html).toContain(opts.roleLabel);
  });

  it("embeds the dashboard CTA URL", () => {
    expect(masterInviteEmailHtml(opts, "en")).toContain(opts.dashboardUrl);
  });

  it("does NOT include a password field anywhere (no credential leakage)", () => {
    // Credentials never travel in this template — the inviting owner shares
    // the auto-generated password through a trusted channel of their choice.
    for (const lang of LANGS) {
      const html = masterInviteEmailHtml(opts, lang);
      expect(html.toLowerCase()).not.toMatch(/password/);
      expect(html).not.toMatch(/hasło/i);
      expect(html).not.toMatch(/пароль/i);
    }
  });

  it("text variant includes salon, role, and URL", () => {
    const text = masterInviteEmailText(opts, "pl");
    expect(text).toContain(opts.salonName);
    expect(text).toContain(opts.roleLabel);
    expect(text).toContain(opts.dashboardUrl);
  });
});

describe("supportReplyEmailHtml (#P1-5)", () => {
  const opts = {
    ticketId: "pt_abc123",
    previewText: "Hi, thanks for reaching out. We've reset the integration on our side.",
    ticketUrl: "https://example.com/support/tickets/pt_abc123",
  };

  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = supportReplyEmailHtml(opts, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("embeds the ticket URL and id", () => {
    const html = supportReplyEmailHtml(opts, "en");
    expect(html).toContain(opts.ticketUrl);
    expect(html).toContain(opts.ticketId);
  });

  it("strips HTML tags from the preview before rendering", () => {
    const malicious = {
      ...opts,
      previewText: 'Reply <script>alert("xss")</script> text <b>bold</b>',
    };
    const html = supportReplyEmailHtml(malicious, "en");
    // The literal <script> sequence from the preview must not survive.
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain("<b>bold</b>");
    // Stripped form still surfaces (text content only — no tags).
    expect(html).toMatch(/Reply\s+alert.*text\s+bold/);
  });

  it("caps the preview at 240 characters", () => {
    const long = "abc".repeat(200); // 600 chars
    const html = supportReplyEmailHtml({ ...opts, previewText: long }, "en");
    // The preview block contains at most 240 chars of "a/b/c" (then no more).
    const previewMatch = html.match(/abc(?:abc)+/g);
    if (previewMatch) {
      for (const m of previewMatch) {
        expect(m.length).toBeLessThanOrEqual(240);
      }
    }
  });

  it("renders cleanly when previewText is empty", () => {
    const html = supportReplyEmailHtml({ ...opts, previewText: "" }, "en");
    expect(html.length).toBeGreaterThan(200);
  });

  it("text variant includes ticket id and URL", () => {
    const text = supportReplyEmailText(opts, "ru");
    expect(text).toContain(opts.ticketId);
    expect(text).toContain(opts.ticketUrl);
  });

  it("text variant strips tags from the preview", () => {
    const text = supportReplyEmailText(
      { ...opts, previewText: "Reply <b>bold</b> end" },
      "en",
    );
    expect(text).not.toContain("<b>bold</b>");
    expect(text).toContain("bold");
  });
});

describe("getEmailCopy — new keys present for all 4 langs (#P1-5)", () => {
  it("each lang exposes paymentFailed/planUpgrade/masterInvite/supportReply", () => {
    for (const lang of LANGS) {
      const copy = getEmailCopy(lang);
      expect(copy.paymentFailed).toBeDefined();
      expect(copy.paymentFailed.subject).toBeTruthy();
      expect(copy.planUpgrade).toBeDefined();
      expect(copy.planUpgrade.subject).toBeTruthy();
      expect(copy.masterInvite).toBeDefined();
      expect(copy.masterInvite.subject).toBeTruthy();
      expect(copy.supportReply).toBeDefined();
      expect(copy.supportReply.subject).toBeTruthy();
    }
  });
});
