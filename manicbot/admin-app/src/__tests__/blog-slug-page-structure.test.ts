/**
 * Structural regression test for src/app/(public)/blog/[slug]/page.tsx.
 *
 * Background — PR #68 fixed an SEO regression where every blog article
 * rendered `og:locale=ru_RU` regardless of `?lang=`. The cause was a prior
 * commit (1552d32) that dropped `export const runtime = "edge"` so
 * `generateStaticParams` could pre-render articles at build time — but that
 * removed `searchParams` access in `generateMetadata`, breaking the locale
 * propagation.
 *
 * The fix re-enables the edge runtime, drops `generateStaticParams`, and
 * forwards `searchParams.lang` through `langToOgLocale` to `buildSeo`.
 *
 * This test pins those three structural invariants so the next person who
 * "optimizes" build performance by adding static params back gets a loud
 * failure instead of a silent SEO regression on the Polish market.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_PATH = join(
  process.cwd(),
  "src/app/(public)/blog/[slug]/page.tsx",
);

describe("blog/[slug]/page.tsx — locale propagation invariants", () => {
  const src = readFileSync(PAGE_PATH, "utf8");

  it("declares edge runtime (required for searchParams access)", () => {
    // The line MUST be at top-of-file so Next sees it during routing.
    // Accept single or double quotes, optional semicolon, with/without trailing
    // whitespace.
    expect(src).toMatch(/^\s*export\s+const\s+runtime\s*=\s*["']edge["']\s*;?/m);
  });

  it("does NOT declare generateStaticParams (would break searchParams in metadata)", () => {
    // generateStaticParams + edge runtime together would re-introduce the
    // bug: Next pre-renders at build time and searchParams is empty.
    expect(src).not.toMatch(/\bgenerateStaticParams\s*\(/);
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+generateStaticParams/);
  });

  it("threads searchParams.lang into generateMetadata", () => {
    // Props must accept searchParams as a Promise with a lang key.
    expect(src).toMatch(/searchParams\s*:\s*Promise<[^>]*lang/);
    // The metadata generator must await/destructure lang and forward it to
    // langToOgLocale. We assert the import + the call without pinning the
    // exact destructuring shape, so future refactors of the await pattern
    // don't tickle false positives.
    expect(src).toMatch(/from\s+["']~\/lib\/seo["']/);
    expect(src).toMatch(/langToOgLocale\s*\(/);
    expect(src).toMatch(/locale\s*:\s*langToOgLocale\s*\(/);
  });

  it("mirrors the help/rules/blog-listing pattern (sanity check on import surface)", () => {
    // If someone removes langToOgLocale from ~/lib/seo this test won't catch
    // it, but seo-locale.test.ts will. Here we just confirm the import line
    // is present so the call above can't be a lexical accident.
    expect(src).toMatch(/import\s+\{[^}]*langToOgLocale[^}]*\}\s+from\s+["']~\/lib\/seo["']/);
  });
});
