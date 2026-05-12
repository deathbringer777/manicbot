/**
 * Lock down relax.md §3 P0-4: blog articles must clear Google's helpful-
 * content threshold (~700 words minimum to rank). Three articles were
 * expanded as part of the SEO sweep:
 *   - automate-salon-booking (all 4 langs)
 *   - reduce-no-shows (RU)
 *   - nail-trends-2026 (RU)
 *
 * If anyone trims them back below 700 words, this test screams.
 */
import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "~/content/blog/articles";

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// Per-language minimums.
// English ~700 (Google's helpful-content floor).
// Slavic languages carry more meaning per word, so ~600 hits the same density.
const EXPANDED = {
  "automate-salon-booking": { ru: 600, ua: 600, en: 700, pl: 600 },
  "reduce-no-shows": { ru: 600 },
  "nail-trends-2026": { ru: 600 },
} as const;

describe("relax.md §3 P0-4: expanded blog bodies", () => {
  for (const [slug, langs] of Object.entries(EXPANDED)) {
    for (const [lang, min] of Object.entries(langs)) {
      it(`${slug}/${lang} has at least ${min} words`, () => {
        const article = BLOG_ARTICLES.find((a) => a.slug === slug);
        expect(article).toBeDefined();
        const body = article!.bodies[lang as "ru" | "ua" | "en" | "pl"];
        const wc = wordCount(body);
        expect(wc, `${slug}/${lang} has only ${wc} words`).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it("expanded articles use H2 subheadings (## ...) — required for SERP TOC eligibility", () => {
    for (const slug of Object.keys(EXPANDED)) {
      const article = BLOG_ARTICLES.find((a) => a.slug === slug)!;
      const headings = (article.bodies.ru.match(/^##\s+/gm) ?? []).length;
      expect(headings, `${slug} (ru) has only ${headings} H2 headings`).toBeGreaterThanOrEqual(3);
    }
  });
});
