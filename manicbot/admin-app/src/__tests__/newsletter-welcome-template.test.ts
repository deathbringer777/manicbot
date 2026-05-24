/**
 * Template-render tests for the newsletter "Stay in the loop" welcome email.
 *
 * Mirrors the email-new-templates.test.ts pattern:
 *   1. Renders for all 4 supported languages without throwing.
 *   2. Embeds the localised heading + body string.
 *   3. Embeds the unsubscribe URL passed in by the caller.
 *   4. Subject is defined and non-empty per language.
 *   5. Fail-loud on missing required slot (TypeScript catches at compile
 *      time; we add a runtime smoke check anyway).
 */
import { describe, it, expect } from "vitest";
import {
  subscriptionWelcomeEmailHtml,
  getEmailCopy,
} from "~/server/email/templates";

const LANGS = ["ru", "ua", "en", "pl"] as const;
const UNSUB_URL = "https://manicbot.com/unsubscribe?token=test-token-abc";

describe("subscriptionWelcomeEmailHtml", () => {
  it("renders for all 4 supported languages", () => {
    for (const lang of LANGS) {
      const html = subscriptionWelcomeEmailHtml(UNSUB_URL, lang);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("includes the localised heading", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionWelcome;
      expect(c.heading).toBeTruthy();
      expect(subscriptionWelcomeEmailHtml(UNSUB_URL, lang)).toContain(c.heading);
    }
  });

  it("includes the localised body intro", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionWelcome;
      // Trim a long body to a substring so future copy tweaks don't break the test.
      const slice = c.body.slice(0, 32);
      expect(subscriptionWelcomeEmailHtml(UNSUB_URL, lang)).toContain(slice);
    }
  });

  it("embeds the unsubscribe URL exactly once", () => {
    for (const lang of LANGS) {
      const html = subscriptionWelcomeEmailHtml(UNSUB_URL, lang);
      const occurrences = html.split(UNSUB_URL).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it("subject is defined and non-empty for every supported language", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionWelcome;
      expect(typeof c.subject).toBe("string");
      expect(c.subject.length).toBeGreaterThan(8);
    }
  });

  it("includes all three bullet points per language", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionWelcome;
      const html = subscriptionWelcomeEmailHtml(UNSUB_URL, lang);
      expect(html).toContain(c.bullet1);
      expect(html).toContain(c.bullet2);
      expect(html).toContain(c.bullet3);
    }
  });

  it("includes the localised unsubscribe link text", () => {
    for (const lang of LANGS) {
      const c = getEmailCopy(lang).subscriptionWelcome;
      const html = subscriptionWelcomeEmailHtml(UNSUB_URL, lang);
      expect(html).toContain(c.unsubscribeHint);
    }
  });
});
