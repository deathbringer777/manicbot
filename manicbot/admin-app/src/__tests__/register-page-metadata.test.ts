/**
 * Locks down the localized OG/Twitter metadata that ships from
 * /register?lang=<x>&ref=<y>.
 *
 * Two layers:
 *   1. Structural: read page.tsx as source, prove the right helpers are
 *      wired in (mirrors the blog/[slug] pattern in
 *      `blog-slug-page-structure.test.ts`). This catches accidental drops
 *      of `searchParams.lang` plumbing, the copy module, or the
 *      `langToOgLocale()` call.
 *   2. Functional: exercise the same helpers the page uses (registerPageCopy,
 *      coerceRegisterLang, buildSeo, langToOgLocale) end-to-end to prove
 *      every locale produces a Metadata object with the right og:locale and
 *      that `?ref=…` swaps to the warmer `descriptionWithRef` copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSeo, langToOgLocale } from "~/lib/seo";
import { registerPageCopy, coerceRegisterLang } from "~/app/(auth)/register/registerPageCopy";

const PAGE_PATH = join(process.cwd(), "src/app/(auth)/register/page.tsx");

describe("(auth)/register/page.tsx — structural invariants", () => {
  const src = readFileSync(PAGE_PATH, "utf8");

  it("declares edge runtime so generateMetadata sees searchParams", () => {
    expect(src).toMatch(/^\s*export\s+const\s+runtime\s*=\s*["']edge["']\s*;?/m);
  });

  it("exports generateMetadata that accepts both lang and ref query params", () => {
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata/);
    expect(src).toMatch(/searchParams\s*:\s*Promise<[^>]*\blang\b/);
    expect(src).toMatch(/searchParams\s*:\s*Promise<[^>]*\bref\b/);
  });

  it("forwards lang into langToOgLocale and uses our seo helper", () => {
    expect(src).toMatch(/from\s+["']~\/lib\/seo["']/);
    expect(src).toMatch(/langToOgLocale\s*\(/);
    expect(src).toMatch(/ogLocale\s*:\s*langToOgLocale\s*\(/);
  });

  it("imports the localised copy module + coerceRegisterLang", () => {
    expect(src).toMatch(/from\s+["']\.\/registerPageCopy["']/);
    expect(src).toMatch(/registerPageCopy/);
    expect(src).toMatch(/coerceRegisterLang/);
  });

  it("wraps the client form (RegisterPageClient) — keeps the form a client component", () => {
    expect(src).toMatch(/from\s+["']\.\/RegisterPageClient["']/);
    expect(src).toMatch(/<RegisterPageClient/);
  });

  it("does NOT import the tRPC caller or db client (would force runtime DB lookups on every preview fetch — see plan: rate-limit risk)", () => {
    expect(src).not.toMatch(/createCaller|createTRPCContext|\.db\b/);
  });

  it("normalises the ref query value the same way the client form does (case-insensitive, alnum + dash, capped at 16)", () => {
    // We're not pinning the exact regex — just confirming the page does some
    // normalisation before the metadata branch flips. Catches a careless
    // `searchParams.ref` direct interpolation that could land junk in OG.
    expect(src).toMatch(/replace\(.*A-Za-z0-9.*\)/);
    expect(src).toMatch(/slice\(\s*0\s*,\s*16\s*\)/);
  });
});

describe("registerPageCopy — coerceRegisterLang", () => {
  it.each(["ru", "ua", "en", "pl"] as const)("accepts %s as-is", (lang) => {
    expect(coerceRegisterLang(lang)).toBe(lang);
  });

  it("is case-insensitive", () => {
    expect(coerceRegisterLang("RU")).toBe("ru");
    expect(coerceRegisterLang("En")).toBe("en");
  });

  it("falls back to ru for missing values", () => {
    expect(coerceRegisterLang(undefined)).toBe("ru");
    expect(coerceRegisterLang(null)).toBe("ru");
    expect(coerceRegisterLang("")).toBe("ru");
  });

  it("falls back to ru for unsupported values", () => {
    expect(coerceRegisterLang("de")).toBe("ru");
    expect(coerceRegisterLang("zh-hant")).toBe("ru");
    expect(coerceRegisterLang("../../../etc/passwd")).toBe("ru");
  });

  it("picks the first entry when Next forwards an array (?lang=ru&lang=en)", () => {
    expect(coerceRegisterLang(["ua", "en"])).toBe("ua");
  });
});

describe("registerPageCopy — content shape", () => {
  it.each(["ru", "ua", "en", "pl"] as const)("%s has all four metadata fields populated", (lang) => {
    const c = registerPageCopy[lang];
    expect(c.title).toBeTruthy();
    expect(c.description).toBeTruthy();
    expect(c.descriptionWithRef).toBeTruthy();
    expect(c.keywords.length).toBeGreaterThanOrEqual(4);
    // OG description hard cap is ~200 chars before Facebook/Twitter truncate.
    // We allow slack for Cyrillic — those run longer — but the warning
    // threshold catches accidental paragraph-length copy.
    expect(c.description.length).toBeLessThanOrEqual(260);
    expect(c.descriptionWithRef.length).toBeLessThanOrEqual(260);
  });

  it("every description mentions ManicBot for brand recognition in previews", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(registerPageCopy[lang].description.toLowerCase()).toContain("manicbot");
      expect(registerPageCopy[lang].descriptionWithRef.toLowerCase()).toContain("manicbot");
    }
  });

  it("descriptionWithRef differs from base description (so ?ref= actually changes the preview)", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(registerPageCopy[lang].descriptionWithRef).not.toBe(registerPageCopy[lang].description);
    }
  });
});

/**
 * End-to-end functional check: mimic the page.tsx pipeline without
 * importing the page itself (which would pull in the next-auth client tree).
 *
 * If page.tsx ever drifts away from this pipeline (e.g. someone swaps
 * `buildSeo` for an inline Metadata literal), this test still passes — the
 * structural test above catches that.
 */
function fakeMetadata(rawLang: string | string[] | null | undefined, rawRef?: string | null) {
  const lang = coerceRegisterLang(rawLang);
  const copy = registerPageCopy[lang];
  const refCode = rawRef ? rawRef.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 16) : "";
  const hasRef = /^[A-Z0-9-]{6,16}$/.test(refCode);
  return buildSeo({
    title: copy.title,
    description: hasRef ? copy.descriptionWithRef : copy.description,
    path: "/register",
    imageAlt: copy.title,
    ogLocale: langToOgLocale(lang),
    keywords: copy.keywords,
  });
}

describe("/register generateMetadata — end-to-end shape", () => {
  it.each([
    ["ru", "ru_RU"],
    ["ua", "uk_UA"],
    ["en", "en_US"],
    ["pl", "pl_PL"],
  ])("?lang=%s → openGraph.locale = %s", (lang, expected) => {
    const meta = fakeMetadata(lang);
    expect((meta.openGraph as { locale: string }).locale).toBe(expected);
  });

  it("missing lang defaults to ru_RU (current dominant audience)", () => {
    expect((fakeMetadata(undefined).openGraph as { locale: string }).locale).toBe("ru_RU");
  });

  it("title is in the locale-appropriate language (sanity check on copy hookup)", () => {
    expect(fakeMetadata("ru").title).toMatch(/онлайн-запись/);
    expect(fakeMetadata("ua").title).toMatch(/онлайн-запис/);
    expect(fakeMetadata("en").title).toMatch(/online booking/);
    expect(fakeMetadata("pl").title).toMatch(/rezerwacje online/);
  });

  it("?ref= present switches description to the warmer 'friend invited' variant", () => {
    const without = fakeMetadata("ru");
    const withRef = fakeMetadata("ru", "MANI-A9DRA");
    expect(without.description).not.toBe(withRef.description);
    expect(withRef.description).toMatch(/Друг приглашает|реферальной/i);
  });

  it("malformed ?ref= falls back to the base description (no junk leaks into preview)", () => {
    // Way too short to be a real code — must NOT flip to the ref variant.
    const garbage = fakeMetadata("ru", "x");
    expect(garbage.description).toBe(registerPageCopy.ru.description);
  });

  it("canonical URL stays /register without query (avoids duplicate-content indexing)", () => {
    const meta = fakeMetadata("pl", "MANI-A9DRA");
    const canonical = (meta.alternates as { canonical: string }).canonical;
    expect(canonical).toBe("https://manicbot.com/register");
    expect(canonical).not.toContain("?");
  });

  it("emits hreflang alternates for all 4 languages + x-default", () => {
    const meta = fakeMetadata("en");
    const langs = (meta.alternates as { languages: Record<string, string> }).languages;
    // BCP 47: 'uk' for Ukrainian, not 'ua' (internal UI code).
    expect(Object.keys(langs).sort()).toEqual(["en", "pl", "ru", "uk", "x-default"]);
  });
});
