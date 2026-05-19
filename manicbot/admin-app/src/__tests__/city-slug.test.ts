/**
 * SEO audit 2026-05-20 P1-1 — keep the admin-app `citySlug` in lockstep
 * with the Worker `citySlug` (manicbot/src/utils/seo.js) so the sitemap
 * URL and the Next.js route segment never drift.
 */
import { describe, it, expect } from "vitest";
import { citySlug, cityNameFromSlug, POPULAR_CITIES } from "~/lib/popularCities";

describe("citySlug", () => {
  it.each([
    ["Warszawa", "warszawa"],
    ["Gdańsk", "gdansk"],
    ["Wrocław", "wroclaw"],
    ["Kraków", "krakow"],
    ["Łódź", "lodz"],
    ["Poznań", "poznan"],
  ])("citySlug(%s) → %s", (input, expected) => {
    expect(citySlug(input)).toBe(expected);
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(citySlug(null)).toBe("");
    expect(citySlug(undefined)).toBe("");
    expect(citySlug("")).toBe("");
  });

  it("collapses whitespace and dashes", () => {
    expect(citySlug("  Hello World  ")).toBe("hello-world");
    expect(citySlug("Co--llapse")).toBe("co-llapse");
  });
});

describe("cityNameFromSlug", () => {
  it("round-trips every POPULAR_CITY", () => {
    for (const city of POPULAR_CITIES) {
      const slug = citySlug(city);
      expect(cityNameFromSlug(slug)).toBe(city);
    }
  });

  it("returns null for unknown slug", () => {
    expect(cityNameFromSlug("nope")).toBeNull();
    expect(cityNameFromSlug("")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(cityNameFromSlug("WARSZAWA")).toBe("Warszawa");
    expect(cityNameFromSlug("Warszawa")).toBe("Warszawa");
  });
});
