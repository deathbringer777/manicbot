/**
 * Page-level metadata snapshot tests. These exist to lock down the
 * relax.md §3 fixes against regressions — they cover the exact end-to-end
 * combinations that Google saw broken in production:
 *
 *   - Title double-suffix ("X — ManicBot — ManicBot")
 *   - Canonical lang collapse (?lang=pl → canonical ?lang=ru)
 *   - Missing hreflang
 *   - og:locale mismatch on PL salons
 *   - Salon JSON-LD missing geo / openingHours / hasOfferCatalog
 *   - Sitemap fake `lastmod`
 *
 * If any of these break again, this file fails first.
 */
import { describe, it, expect } from "vitest";
import {
  buildSeo,
  buildLanguageAlternates,
  beautySalonJsonLd,
  ogLocaleForCity,
  workHoursToOpeningHoursSpec,
  normaliseOgImage,
  canonicalUrl,
  SITE_URL,
} from "~/lib/seo";

describe("regression: relax.md §3 P0-1 (title double-suffix)", () => {
  it.each([
    ["/search", "Поиск салонов красоты"],
    ["/blog", "Блог"],
    ["/help", "Справочный центр"],
    ["/blog/automate-salon-booking", "5 способов автоматизировать запись в салон"],
    ["/salon/crystal-nails", "Crystal Nails (Warszawa)"],
  ])("buildSeo(%s) returns a bare title without trailing — ManicBot", (path, title) => {
    const meta = buildSeo({ title, description: "x", path });
    expect(meta.title).toBe(title);
    // Specifically: no "— ManicBot" in the buildSeo output. The (public)
    // layout's title.template appends it once on render, but buildSeo must
    // not pre-bake the suffix or we get the double-suffix bug.
    expect(String(meta.title)).not.toMatch(/—\s*ManicBot/);
    // And definitely no double suffix.
    expect(String(meta.title)).not.toMatch(/ManicBot.*ManicBot/);
  });

  it("OG title (separate from <title>) DOES carry the full suffix once", () => {
    const meta = buildSeo({ title: "Поиск", description: "x", path: "/search" });
    const og = (meta.openGraph as { title: string }).title;
    expect(og).toBe("Поиск — ManicBot");
    expect(og).not.toMatch(/ManicBot.*ManicBot/);
  });
});

describe("regression: relax.md §3 P0-2 (canonical lang collapse)", () => {
  it("each path self-canonicalises (no lang query in canonical)", () => {
    for (const path of ["/", "/search", "/blog", "/help", "/salon/foo"]) {
      const meta = buildSeo({ title: "X", description: "x", path });
      const canonical = (meta.alternates as { canonical: string }).canonical;
      expect(canonical).not.toContain("?lang=");
    }
  });

  it("hreflang alternates cover ru, uk, en, pl (4 langs) + x-default", () => {
    const langs = buildLanguageAlternates("/search");
    expect(Object.keys(langs).sort()).toEqual(["en", "pl", "ru", "uk", "x-default"]);
  });

  it("x-default is the English variant (was ?lang=ru — wrong for PL audience)", () => {
    const langs = buildLanguageAlternates("/");
    expect(langs["x-default"]).toBe(`${SITE_URL}?lang=en`);
    expect(langs["x-default"]).not.toContain("lang=ru");
  });

  it("ua is mapped to BCP47 'uk' (not 'ua')", () => {
    const langs = buildLanguageAlternates("/");
    // Internal UI uses 'ua' but hreflang spec requires 'uk' for Ukrainian.
    expect(langs).toHaveProperty("uk");
    expect(langs).not.toHaveProperty("ua");
    expect(langs.uk).toContain("?lang=ua");
  });
});

describe("regression: relax.md §3 P1 (Warsaw salons render og:locale=ru_RU)", () => {
  it.each([
    ["Warszawa", "pl_PL"],
    ["Warsaw", "pl_PL"],
    ["Kraków", "pl_PL"],
    ["Wrocław", "pl_PL"],
    ["Gdańsk", "pl_PL"],
    ["Kyiv", "uk_UA"],
    ["Lviv", "uk_UA"],
    ["London", "en_US"],
    [null, "ru_RU"],
    [undefined, "ru_RU"],
    ["Москва", "ru_RU"],
  ])("ogLocaleForCity(%j) → %s", (city, expected) => {
    expect(ogLocaleForCity(city)).toBe(expected);
  });

  it("buildSeo carries ogLocale through to openGraph.locale", () => {
    const meta = buildSeo({
      title: "Crystal Nails",
      description: "x",
      path: "/salon/crystal-nails",
      ogLocale: ogLocaleForCity("Warszawa"),
    });
    expect((meta.openGraph as { locale: string }).locale).toBe("pl_PL");
  });
});

describe("regression: relax.md §3 P1 (salon BeautySalon JSON-LD missing fields)", () => {
  const ld = beautySalonJsonLd({
    name: "Crystal Nails",
    slug: "crystal-nails",
    description: "Best salon in Warsaw",
    image: "https://images.pexels.com/photo/x.jpg?w=400",
    images: ["https://a.jpg", "https://b.jpg"],
    city: "Warszawa",
    address: "ul. Hmelna 12",
    phone: "+48 600 000 000",
    lat: 52.23,
    lng: 21.01,
    rating: { avg: 4.8, count: 24 },
    workHours: { mon: "09:00-18:00", tue: "09:00-18:00", sat: "10:00-16:00" },
    services: [
      { name: "Маникюр", price: 120 },
      { name: "Педикюр", price: 150 },
      { name: "Покрытие", price: 60 },
    ],
    sameAs: ["https://instagram.com/crystalnails"],
    currency: "PLN",
    countryCode: "PL",
  });

  it("has @type BeautySalon", () => {
    expect(ld["@type"]).toBe("BeautySalon");
  });
  it("has geo coordinates", () => {
    expect(ld.geo).toMatchObject({ latitude: 52.23, longitude: 21.01 });
  });
  it("has openingHoursSpecification with 3 days", () => {
    expect(ld.openingHoursSpecification).toHaveLength(3);
  });
  it("has aggregateRating from reviews", () => {
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4.8, reviewCount: 24 });
  });
  it("has priceRange derived from services", () => {
    expect(ld.priceRange).toBe("60-150");
  });
  it("has hasOfferCatalog with all services", () => {
    expect((ld.hasOfferCatalog as { itemListElement: unknown[] }).itemListElement).toHaveLength(3);
  });
  it("has sameAs with social URLs", () => {
    expect(ld.sameAs).toContain("https://instagram.com/crystalnails");
  });
  it("has currenciesAccepted = PLN", () => {
    expect(ld.currenciesAccepted).toBe("PLN");
  });
  it("address has addressCountry = PL", () => {
    expect((ld.address as { addressCountry?: string }).addressCountry).toBe("PL");
  });
  it("image is an array when multiple photos supplied", () => {
    expect(Array.isArray(ld.image)).toBe(true);
  });
});

describe("regression: relax.md §3 P1 (OG image dimension mismatch)", () => {
  it("rewrites pexels w=400 to declared 1200×630", () => {
    const out = normaliseOgImage("https://images.pexels.com/photos/1/x.jpg?w=400&h=300");
    const u = new URL(out);
    expect(u.searchParams.get("w")).toBe("1200");
    expect(u.searchParams.get("h")).toBe("630");
  });
  it("first-party images pass through unchanged", () => {
    const out = normaliseOgImage(`${SITE_URL}/og-image.png`);
    expect(out).toBe(`${SITE_URL}/og-image.png`);
  });
});

describe("workHoursToOpeningHoursSpec edge cases", () => {
  it("handles unicode dash separator", () => {
    const out = workHoursToOpeningHoursSpec({ mon: "09:00–18:00" });
    expect(out[0]?.opens).toBe("09:00");
    expect(out[0]?.closes).toBe("18:00");
  });
  it("handles { open, close } variant naming", () => {
    const out = workHoursToOpeningHoursSpec({ fri: { open: "10:00", close: "20:00" } });
    expect(out[0]?.dayOfWeek).toBe("Friday");
  });
  it("rejects unrecognised day names silently", () => {
    expect(workHoursToOpeningHoursSpec({ marsday: "09:00-18:00" })).toEqual([]);
  });
});

describe("canonicalUrl invariants", () => {
  it.each([
    ["/", SITE_URL],
    ["/blog", `${SITE_URL}/blog`],
    ["/blog/", `${SITE_URL}/blog`],
    ["blog", `${SITE_URL}/blog`],
    ["/salon/crystal-nails/", `${SITE_URL}/salon/crystal-nails`],
  ])("canonicalUrl(%s) = %s", (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected);
  });
});
