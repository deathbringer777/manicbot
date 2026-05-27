/**
 * Template-render tests for the newsletter DOI confirm-click email
 * (migration 0092).
 *
 *   1. Renders for all 4 supported languages without throwing.
 *   2. Embeds the localised heading + body string.
 *   3. Embeds the confirm URL as the CTA anchor.
 *   4. Subject is defined and non-empty per language.
 *   5. Carries the "this link expires in 7 days" + "ignore if you didn't
 *      subscribe" muted text.
 */
import { describe, it, expect } from "vitest";
import {
  subscriptionConfirmEmailHtml,
  getEmailCopy,
} from "~/server/email/templates";

const LANGS = ["ru", "ua", "en", "pl"] as const;
const CONFIRM_URL = "https://manicbot.com/confirm-subscription?token=abc123";

describe("subscriptionConfirmEmailHtml", () => {
  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = subscriptionConfirmEmailHtml(CONFIRM_URL, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("includes the localised heading and body", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionConfirm;
      const html = subscriptionConfirmEmailHtml(CONFIRM_URL, lang);
      expect(html).toContain(c.heading);
      // body may contain HTML entities post-escape; slice the first 20 chars
      const sliced = c.body.slice(0, 20);
      expect(html).toContain(sliced);
    }
  });

  it("embeds the confirm URL exactly once as the CTA href", () => {
    for (const lang of LANGS) {
      const html = subscriptionConfirmEmailHtml(CONFIRM_URL, lang);
      // ctaButton emits href="<url>" — exactly one occurrence expected.
      const matches = html.match(/href="https:\/\/manicbot\.com\/confirm-subscription\?token=abc123"/g);
      expect(matches?.length).toBe(1);
    }
  });

  it("subject is defined per language and non-empty", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionConfirm;
      expect(typeof c.subject).toBe("string");
      expect(c.subject.length).toBeGreaterThan(0);
    }
  });

  it("includes the 7-day expiry and the ignore disclaimer", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionConfirm;
      const html = subscriptionConfirmEmailHtml(CONFIRM_URL, lang);
      expect(html).toContain(c.expires.slice(0, 10));
      expect(html).toContain(c.ignore.slice(0, 20));
    }
  });
});
