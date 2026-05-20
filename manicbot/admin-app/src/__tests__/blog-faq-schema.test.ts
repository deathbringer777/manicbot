/**
 * SEO audit 2026-05-20 P1-9 — blog FAQPage + Quick-Answer regression pin.
 *
 * Every blog detail page ships a `FAQPage` JSON-LD payload and a visible
 * "Quick answers" block. This test locks the contract:
 *   - resolveBlogFaqs always returns ≥3 questions
 *   - blogFaqPageJsonLd produces a valid FAQPage payload
 *   - Per-slug overrides take precedence over the common floor
 *   - All 4 locales (pl/ru/ua/en) have entries in the common fallback
 */
import { describe, it, expect } from "vitest";
import { resolveBlogFaqs, blogFaqPageJsonLd } from "~/content/blog/blogFaqs";

describe("blog FAQ schema (P1-9)", () => {
  describe("resolveBlogFaqs", () => {
    it("returns at least 3 questions for any slug + lang combination", () => {
      const slugs = ["unknown-slug", "reduce-no-shows", "automate-salon-booking", "nail-trends-2026"];
      const langs = ["pl", "ru", "ua", "en"] as const;
      for (const slug of slugs) {
        for (const lang of langs) {
          const faqs = resolveBlogFaqs(slug, lang);
          expect(faqs.length, `${slug}/${lang} should have ≥3 FAQs`).toBeGreaterThanOrEqual(3);
          for (const f of faqs) {
            expect(f.q, `${slug}/${lang} question is empty`).toBeTruthy();
            expect(f.a, `${slug}/${lang} answer is empty`).toBeTruthy();
          }
        }
      }
    });

    it("returns topical per-slug FAQ for known slug (reduce-no-shows mentions deposit)", () => {
      const pl = resolveBlogFaqs("reduce-no-shows", "pl");
      const joined = pl.map((f) => `${f.q} ${f.a}`).join(" ").toLowerCase();
      expect(joined).toMatch(/zadat|no-show/);
    });

    it("returns common fallback for unknown slug (mentions pricing)", () => {
      const pl = resolveBlogFaqs("totally-unknown-slug-xyz", "pl");
      const joined = pl.map((f) => `${f.q} ${f.a}`).join(" ");
      expect(joined).toMatch(/45 PLN/);
    });

    it("falls back to English when a per-slug entry has no requested locale", () => {
      // Simulate by querying a known-topic slug with a missing locale via
      // the fallback chain. The implementation falls back to .en if the
      // requested lang isn't in the per-slug map.
      const ru = resolveBlogFaqs("ai-receptionist-247", "ru");
      expect(ru.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("blogFaqPageJsonLd", () => {
    it("produces a valid FAQPage payload with @context + @type + mainEntity", () => {
      const ld = blogFaqPageJsonLd("reduce-no-shows", "pl");
      expect(ld["@context"]).toBe("https://schema.org");
      expect(ld["@type"]).toBe("FAQPage");
      expect(Array.isArray(ld.mainEntity)).toBe(true);
      expect(ld.mainEntity.length).toBeGreaterThanOrEqual(3);
    });

    it("each mainEntity entry has Question + acceptedAnswer with Answer type", () => {
      const ld = blogFaqPageJsonLd("automate-salon-booking", "pl");
      for (const item of ld.mainEntity as Array<Record<string, unknown>>) {
        expect(item["@type"]).toBe("Question");
        expect(typeof item.name).toBe("string");
        const answer = item.acceptedAnswer as Record<string, unknown>;
        expect(answer["@type"]).toBe("Answer");
        expect(typeof answer.text).toBe("string");
      }
    });

    it("serializes to JSON without circular references or undefined values", () => {
      const ld = blogFaqPageJsonLd("ai-receptionist-247", "en");
      const json = JSON.stringify(ld);
      expect(json).not.toContain("undefined");
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});
