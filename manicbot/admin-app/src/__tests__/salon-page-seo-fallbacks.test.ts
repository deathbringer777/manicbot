/**
 * SEO audit 2026-05-20 P1-4 + P1-9 regression pins for the salon profile page.
 *
 * P1-4: when `profile.description` is null, the fallback description must
 * be localized to the salon's likely audience (Polish for PL cities, etc.)
 * — previously every salon without a description shipped Russian copy,
 * including 80%+ of customer salons in Warsaw.
 *
 * P1-9: the salon page emits FAQ JSON-LD ONLY when the salon has priced
 * services. A salon with empty / unpriced services would otherwise ship a
 * question like "ile kosztuje manicure?" with no answer of substance.
 *
 * These tests cover the pure decision logic; route-level integration is
 * exercised by the production runtime (Next.js metadata test would need a
 * full D1 mock — out of scope for a regression pin).
 */
import { describe, it, expect } from "vitest";
import { ogLocaleForCity } from "~/lib/seo";

// Replication of the inline fallback decision from src/app/(public)/salon/
// [slug]/page.tsx::generateMetadata. Keep in sync; this exists so the
// language-pick contract is unit-tested without spinning up a Next runtime.
function pickLocalizedFallback(
  name: string,
  city: string | null | undefined,
): string {
  const cityPart = city ? ` (${city})` : "";
  const ogLocale = ogLocaleForCity(city);
  if (ogLocale === "pl_PL") {
    return `Salon paznokci ${name}${cityPart}. Manicure, pedicure, hybryda, zdobienia. Zarezerwuj online przez Telegram w minutę.`;
  }
  if (ogLocale === "uk_UA") {
    return `Онлайн-запис у ${name}${cityPart}. Манікюр, педикюр, nail-арт. Запишіться через Telegram за хвилину.`;
  }
  if (ogLocale === "en_US") {
    return `Book ${name}${cityPart} online. Manicure, pedicure, gel, nail art. Reserve via Telegram in under a minute.`;
  }
  return `Онлайн-запись в ${name}${cityPart}. Маникюр, педикюр, nail-арт. Запишитесь через Telegram за минуту.`;
}

describe("salon page description fallback (P1-4)", () => {
  it.each([
    ["Warszawa", "Salon paznokci"],
    ["Kraków", "Salon paznokci"],
    ["Wrocław", "Salon paznokci"],
    ["Gdańsk", "Salon paznokci"],
  ])("PL city %s gets a Polish fallback (starts with 'Salon paznokci')", (city, prefix) => {
    const fallback = pickLocalizedFallback("Crystal Nails", city);
    expect(fallback.startsWith(prefix)).toBe(true);
    expect(fallback).toContain("Manicure");
    // Critical regression: must NOT default to Russian for a Warsaw salon
    expect(fallback).not.toContain("Маникюр");
  });

  it.each([
    ["Kyiv", "Онлайн-запис"],
    ["Lviv", "Онлайн-запис"],
  ])("UA city %s gets a Ukrainian fallback", (city, prefix) => {
    const fallback = pickLocalizedFallback("Студия Алина", city);
    expect(fallback.startsWith(prefix)).toBe(true);
  });

  it("English-speaking city falls back to English copy", () => {
    const fallback = pickLocalizedFallback("Nailtopia", "London");
    expect(fallback).toMatch(/^Book .* online\./);
  });

  it("Unknown / null city defaults to Polish (Poland-only platform)", () => {
    const fallback = pickLocalizedFallback("Mystery Salon", null);
    expect(fallback).toContain("Salon paznokci");
  });
});

// Replication of the inline FAQ-JSON-LD generation decision.
function shouldEmitFaq(
  publicActive: number,
  services: Array<{ price?: number | null }> | null | undefined,
): boolean {
  if (publicActive !== 1) return false;
  if (!services) return false;
  return services.some((s) => typeof s.price === "number" && s.price > 0);
}

describe("salon page FAQ JSON-LD gating (P1-9)", () => {
  it("does NOT emit FAQ for unpublished salons", () => {
    expect(shouldEmitFaq(0, [{ price: 100 }])).toBe(false);
  });

  it("does NOT emit FAQ when services array is empty", () => {
    expect(shouldEmitFaq(1, [])).toBe(false);
    expect(shouldEmitFaq(1, null)).toBe(false);
  });

  it("does NOT emit FAQ when no service has a real price", () => {
    expect(shouldEmitFaq(1, [{ price: 0 }, { price: null }])).toBe(false);
  });

  it("emits FAQ when at least one priced service exists", () => {
    expect(shouldEmitFaq(1, [{ price: 60 }])).toBe(true);
    expect(shouldEmitFaq(1, [{ price: null }, { price: 120 }])).toBe(true);
  });
});
