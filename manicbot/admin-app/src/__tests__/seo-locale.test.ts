import { describe, it, expect } from "vitest";
import { buildSeo, langToOgLocale } from "~/lib/seo";

describe("langToOgLocale", () => {
  it("maps known lang codes to og locale codes", () => {
    expect(langToOgLocale("en")).toBe("en_US");
    expect(langToOgLocale("pl")).toBe("pl_PL");
    expect(langToOgLocale("ua")).toBe("uk_UA");
    expect(langToOgLocale("uk")).toBe("uk_UA");
    expect(langToOgLocale("ru")).toBe("ru_RU");
  });

  it("is case-insensitive", () => {
    expect(langToOgLocale("EN")).toBe("en_US");
    expect(langToOgLocale("PL")).toBe("pl_PL");
  });

  it("falls back to ru_RU for unknown or missing lang", () => {
    expect(langToOgLocale(undefined)).toBe("ru_RU");
    expect(langToOgLocale(null)).toBe("ru_RU");
    expect(langToOgLocale("")).toBe("ru_RU");
    expect(langToOgLocale("de")).toBe("ru_RU");
    expect(langToOgLocale("xx-YY")).toBe("ru_RU");
  });

  it("accepts arrays (Next.js searchParams shape) and uses first entry", () => {
    expect(langToOgLocale(["en", "pl"])).toBe("en_US");
  });
});

describe("buildSeo locale", () => {
  it("defaults og:locale to ru_RU when locale not provided", () => {
    const meta = buildSeo({ title: "Test", description: "d", path: "/test" });
    expect(meta.openGraph).toBeDefined();
    expect((meta.openGraph as { locale?: string }).locale).toBe("ru_RU");
  });

  it("applies the provided locale to og:locale", () => {
    const meta = buildSeo({
      title: "Test",
      description: "d",
      path: "/test",
      locale: "pl_PL",
    });
    expect((meta.openGraph as { locale?: string }).locale).toBe("pl_PL");
  });

  it("works end-to-end with langToOgLocale", () => {
    const meta = buildSeo({
      title: "Test",
      description: "d",
      path: "/test",
      locale: langToOgLocale("en"),
    });
    expect((meta.openGraph as { locale?: string }).locale).toBe("en_US");
  });
});
