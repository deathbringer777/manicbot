/**
 * Word-count + structure guard for the blog corpus.
 *
 * Background — Google's helpful-content threshold for blog detail pages is
 * ~700 words in English (Slavic languages carry more meaning per word, so
 * ~600 hits the same density). Below that, even well-targeted posts fail to
 * rank against competitors who write long-form.
 *
 * After the May-2026 SEO sweep we rewrote every article in all four
 * languages so they all clear the bar. This test pins the minimum so the
 * next person who "tightens" the copy gets a loud failure instead of a
 * silent SEO regression.
 *
 * Per-language minimums:
 *   English  ≥ 700 words
 *   Slavic / Polish ≥ 600 words
 */
import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES, type BlogArticle } from "~/content/blog/articles";
import type { Lang } from "~/lib/i18n";

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const MIN_WORDS: Record<Lang, number> = { en: 700, ru: 600, ua: 600, pl: 600 };

describe("blog content length (helpful-content threshold)", () => {
  for (const article of BLOG_ARTICLES) {
    for (const lang of ["ru", "ua", "en", "pl"] as Lang[]) {
      it(`${article.slug}/${lang} has at least ${MIN_WORDS[lang]} words`, () => {
        const wc = wordCount(article.bodies[lang]);
        expect(wc, `${article.slug}/${lang} has only ${wc} words`).toBeGreaterThanOrEqual(
          MIN_WORDS[lang],
        );
      });
    }
  }
});

describe("blog content structure (SERP-ready)", () => {
  for (const article of BLOG_ARTICLES) {
    it(`${article.slug} has ≥ 3 H2 headings in every language`, () => {
      for (const lang of ["ru", "ua", "en", "pl"] as Lang[]) {
        const headings = (article.bodies[lang].match(/^##\s+/gm) ?? []).length;
        expect(
          headings,
          `${article.slug} (${lang}) has only ${headings} H2 headings`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("blog cover images", () => {
  for (const article of BLOG_ARTICLES) {
    it(`${article.slug} has a hero image with localized alt text`, () => {
      expect(article.coverImage.url, `${article.slug}: coverImage.url missing`).toBeTruthy();
      // Cover URL must be a real https URL we'll render in <Image />.
      expect(article.coverImage.url).toMatch(/^https:\/\//);
      for (const lang of ["ru", "ua", "en", "pl"] as Lang[]) {
        expect(
          article.coverImage.alt[lang],
          `${article.slug}: missing alt text for ${lang}`,
        ).toBeTruthy();
      }
    });
  }
});

describe("blog corpus invariants", () => {
  it("contains the original 10 articles plus the 2026-06 long-form batch", () => {
    const slugs = BLOG_ARTICLES.map((a: BlogArticle) => a.slug).sort();
    expect(slugs).toEqual(
      [
        // Original May-2026 seed
        "ai-receptionist-247",
        "automate-salon-booking",
        "channels-compared-2026",
        "dynamic-pricing-salon",
        "first-client-in-10-minutes",
        "google-calendar-sync",
        "nail-clients-survey-2026",
        "nail-trends-2026",
        "reduce-no-shows",
        "whatsapp-instagram-channels",
        // 2026-06 long-form, image-rich batch (10 new)
        "ai-beauty-trends-2026",
        "booking-conversion",
        "client-retention-loyalty",
        "instagram-bookings-2026",
        "local-seo-nail-salon",
        "nail-salon-pricing-guide",
        "salon-reviews-reputation",
        "scale-solo-to-team",
        "seasonal-marketing-calendar",
        "tiktok-for-nail-salons",
        // 2026-06 GEO pass — honest all-vendor buyer's guide (editorial home
        // for the comparison content; the dedicated /comparisons/manicbot-vs-
        // booksy page stays 404 per #492).
        "salon-booking-software-poland-2026",
      ].sort(),
    );
  });

  it("uses unique slugs (no accidental duplicates)", () => {
    const slugs = BLOG_ARTICLES.map((a: BlogArticle) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every article has dates in YYYY-MM-DD form", () => {
    for (const a of BLOG_ARTICLES) {
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (a.updated) expect(a.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("`updated` is never earlier than `date`", () => {
    for (const a of BLOG_ARTICLES) {
      if (!a.updated) continue;
      expect(a.updated >= a.date, `${a.slug}: updated (${a.updated}) < date (${a.date})`).toBe(
        true,
      );
    }
  });
});
