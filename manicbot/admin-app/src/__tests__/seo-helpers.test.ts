import { describe, it, expect } from "vitest";
import {
  buildSeo,
  buildLanguageAlternates,
  canonicalUrl,
  normaliseOgImage,
  ogLocaleForCity,
  workHoursToOpeningHoursSpec,
  beautySalonJsonLd,
  SITE_NAME,
  SITE_URL,
} from "~/lib/seo";

describe("buildSeo title (relax.md §3 P0-1)", () => {
  it("returns the BARE title so the layout title.template appends the suffix only once", () => {
    const meta = buildSeo({
      title: "Поиск салонов красоты",
      description: "x",
      path: "/search",
    });
    // The bug was buildSeo returning "X — ManicBot", which the layout
    // template then turned into "X — ManicBot — ManicBot".
    expect(meta.title).toBe("Поиск салонов красоты");
    expect(meta.title).not.toMatch(/ManicBot/);
  });

  it("attaches per-language hreflang alternates", () => {
    const meta = buildSeo({
      title: "Поиск",
      description: "x",
      path: "/search",
    });
    const langs = (meta.alternates as { languages: Record<string, string> }).languages;
    expect(langs.ru).toBe(`${SITE_URL}/search?lang=ru`);
    expect(langs.uk).toBe(`${SITE_URL}/search?lang=ua`); // ua → uk in BCP47
    expect(langs.en).toBe(`${SITE_URL}/search?lang=en`);
    expect(langs.pl).toBe(`${SITE_URL}/search?lang=pl`);
    expect(langs["x-default"]).toBe(`${SITE_URL}/search?lang=en`);
  });

  it("self-canonicalises each path (no lang collapse)", () => {
    const meta = buildSeo({ title: "T", description: "x", path: "/blog/foo" });
    expect((meta.alternates as { canonical: string }).canonical).toBe(`${SITE_URL}/blog/foo`);
  });
});

describe("buildLanguageAlternates", () => {
  it("emits x-default pointing at the English variant (not Russian)", () => {
    const alts = buildLanguageAlternates("/help");
    expect(alts["x-default"]).toBe(`${SITE_URL}/help?lang=en`);
  });
});

describe("canonicalUrl", () => {
  it("collapses root", () => {
    expect(canonicalUrl("/")).toBe(SITE_URL);
  });
  it("strips trailing slash", () => {
    expect(canonicalUrl("/blog/")).toBe(`${SITE_URL}/blog`);
  });
});

describe("normaliseOgImage (relax.md §3 P1 — OG dimension mismatch)", () => {
  it("rewrites pexels w=400 to 1200×630", () => {
    const out = normaliseOgImage("https://images.pexels.com/photos/1/x.jpg?w=400&h=300");
    expect(out).toContain("w=1200");
    expect(out).toContain("h=630");
  });
  it("rewrites unsplash images to 1200×630", () => {
    const out = normaliseOgImage("https://images.unsplash.com/photo-abc?w=400");
    expect(out).toContain("w=1200");
    expect(out).toContain("h=630");
  });
  it("leaves unknown hosts alone", () => {
    const out = normaliseOgImage("https://cdn.example.com/foo.png");
    expect(out).toBe("https://cdn.example.com/foo.png");
  });
});

describe("ogLocaleForCity (relax.md §3 P1 — RU og:locale on Warsaw salons)", () => {
  it("maps Warsaw to pl_PL", () => {
    expect(ogLocaleForCity("Warszawa")).toBe("pl_PL");
    expect(ogLocaleForCity("Warsaw")).toBe("pl_PL");
    expect(ogLocaleForCity("Kraków")).toBe("pl_PL");
  });
  it("maps Kyiv to uk_UA", () => {
    expect(ogLocaleForCity("Kyiv")).toBe("uk_UA");
    expect(ogLocaleForCity("Lviv")).toBe("uk_UA");
  });
  it("falls back to ru_RU for unknown cities", () => {
    expect(ogLocaleForCity("Some Random Town")).toBe("ru_RU");
    expect(ogLocaleForCity(null)).toBe("ru_RU");
  });
});

describe("workHoursToOpeningHoursSpec", () => {
  it("parses 'mon: 09:00-18:00' strings", () => {
    const out = workHoursToOpeningHoursSpec({ mon: "09:00-18:00", tue: "10:00-19:00" });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Monday",
      opens: "09:00",
      closes: "18:00",
    });
  });
  it("parses { from, to } objects", () => {
    const out = workHoursToOpeningHoursSpec({ wed: { from: "09:00", to: "18:00" } });
    expect(out[0]?.dayOfWeek).toBe("Wednesday");
  });
  it("returns [] for malformed input", () => {
    expect(workHoursToOpeningHoursSpec(null)).toEqual([]);
    expect(workHoursToOpeningHoursSpec("garbage")).toEqual([]);
    expect(workHoursToOpeningHoursSpec({ mon: "no time here" })).toEqual([]);
  });
});

describe("beautySalonJsonLd enrichment (relax.md §3 P1)", () => {
  it("emits geo, openingHoursSpecification, aggregateRating, hasOfferCatalog, sameAs", () => {
    const ld = beautySalonJsonLd({
      name: "Crystal Nails",
      slug: "crystal-nails",
      city: "Warszawa",
      lat: 52.2,
      lng: 21.0,
      rating: { avg: 4.8, count: 24 },
      workHours: { mon: "09:00-18:00" },
      services: [{ name: "Manicure", price: 120 }, { name: "Pedicure", price: 150 }],
      sameAs: ["https://instagram.com/crystalnails"],
      currency: "PLN",
      countryCode: "PL",
    });
    expect(ld.geo).toEqual({ "@type": "GeoCoordinates", latitude: 52.2, longitude: 21.0 });
    expect(ld.openingHoursSpecification).toHaveLength(1);
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4.8, reviewCount: 24 });
    expect(ld.hasOfferCatalog).toBeDefined();
    expect(ld.priceRange).toBe("120-150");
    expect(ld.currenciesAccepted).toBe("PLN");
    expect(ld.sameAs).toEqual(["https://instagram.com/crystalnails"]);
    expect((ld.address as { addressCountry?: string }).addressCountry).toBe("PL");
  });
});
