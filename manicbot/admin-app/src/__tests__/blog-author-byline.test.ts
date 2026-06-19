import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { articleJsonLd, EDITORIAL_AUTHOR, SITE_NAME, SITE_URL } from "~/lib/seo";

/**
 * 2026-06 GEO pass — blog articles now carry a named editorial author (brand
 * Organization) both in the Article schema and as a visible byline, plus a
 * machine-readable updated date. GEO research shows author credibility +
 * freshness measurably lift the chance of being cited by AI answer engines.
 */
describe("blog author byline", () => {
  describe("EDITORIAL_AUTHOR", () => {
    it("has a non-empty localized name for every supported lang", () => {
      for (const lang of ["ru", "ua", "en", "pl"] as const) {
        expect(typeof EDITORIAL_AUTHOR[lang]).toBe("string");
        expect(EDITORIAL_AUTHOR[lang].length).toBeGreaterThan(0);
        expect(EDITORIAL_AUTHOR[lang]).toContain("ManicBot");
      }
      // Localized, not identical across languages.
      expect(EDITORIAL_AUTHOR.pl).not.toBe(EDITORIAL_AUTHOR.ru);
    });
  });

  describe("articleJsonLd author", () => {
    const base = { title: "T", description: "D", slug: "x", datePublished: "2026-06-01" };

    it("emits an Organization author with name + url when given a brand author", () => {
      const ld = articleJsonLd({
        ...base,
        dateModified: "2026-06-10",
        author: { name: EDITORIAL_AUTHOR.pl, type: "Organization", url: `${SITE_URL}/about` },
      });
      expect(ld.author).toEqual({
        "@type": "Organization",
        name: "Redakcja ManicBot",
        url: `${SITE_URL}/about`,
      });
      expect(ld.dateModified).toBe("2026-06-10");
    });

    it("defaults dateModified to datePublished when omitted", () => {
      const ld = articleJsonLd({ ...base, author: { name: "x" } });
      expect(ld.dateModified).toBe("2026-06-01");
    });

    it("defaults to the ManicBot organization when no author given (back-compat)", () => {
      const ld = articleJsonLd(base);
      expect(ld.author).toEqual([{ "@type": "Organization", name: SITE_NAME }]);
    });

    it("still maps legacy authors[] to Person nodes (back-compat)", () => {
      const ld = articleJsonLd({ ...base, authors: ["Jane Doe"] });
      expect(ld.author).toEqual([{ "@type": "Person", name: "Jane Doe" }]);
    });
  });

  describe("rendering wiring (structural)", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

    it("page.tsx threads the editorial author into articleJsonLd", () => {
      const src = read("src/app/(public)/blog/[slug]/page.tsx");
      expect(src).toMatch(/EDITORIAL_AUTHOR/);
      expect(src).toMatch(/author\s*:/);
    });

    it("ArticleClient renders a visible byline + an updated <time>", () => {
      const src = read("src/app/(public)/blog/[slug]/ArticleClient.tsx");
      expect(src).toMatch(/EDITORIAL_AUTHOR\[lang\]/);
      expect(src).toMatch(/UPDATED_LABEL/);
      expect(src).toMatch(/<time dateTime=/);
    });
  });
});
