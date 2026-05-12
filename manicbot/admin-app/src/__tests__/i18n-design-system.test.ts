// @vitest-environment happy-dom
/**
 * Design-system guards for the i18n layer.
 *
 * These tests protect the user-facing UX from drifting back into mixed
 * languages, broken plurals, or label inconsistencies between the sidebar
 * and in-page headers. Add a new case here every time we discover a
 * regression class — the test name should describe the regression.
 */
import { describe, it, expect } from "vitest";
import {
  pluralCategory,
  pluralCount,
  formatRelativeTime,
  t,
  type Lang,
} from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";

describe("pluralCategory — Russian CLDR rules", () => {
  const RU: Lang = "ru";
  it("returns 'one' for 1, 21, 101", () => {
    expect(pluralCategory(1, RU)).toBe("one");
    expect(pluralCategory(21, RU)).toBe("one");
    expect(pluralCategory(101, RU)).toBe("one");
  });
  it("returns 'few' for 2, 3, 4, 22, 23", () => {
    expect(pluralCategory(2, RU)).toBe("few");
    expect(pluralCategory(3, RU)).toBe("few");
    expect(pluralCategory(4, RU)).toBe("few");
    expect(pluralCategory(22, RU)).toBe("few");
    expect(pluralCategory(23, RU)).toBe("few");
  });
  it("returns 'many' for 0, 5-20, 25, 100, 111", () => {
    expect(pluralCategory(0, RU)).toBe("many");
    expect(pluralCategory(5, RU)).toBe("many");
    expect(pluralCategory(11, RU)).toBe("many"); // ⚠ 11 is special — many, not one
    expect(pluralCategory(12, RU)).toBe("many"); // ⚠ 12 is special
    expect(pluralCategory(14, RU)).toBe("many"); // ⚠ 14 is special
    expect(pluralCategory(20, RU)).toBe("many");
    expect(pluralCategory(25, RU)).toBe("many");
    expect(pluralCategory(100, RU)).toBe("many");
    expect(pluralCategory(111, RU)).toBe("many");
  });
});

describe("pluralCategory — English (only one/many)", () => {
  it("collapses to one|many", () => {
    expect(pluralCategory(1, "en")).toBe("one");
    expect(pluralCategory(0, "en")).toBe("many");
    expect(pluralCategory(2, "en")).toBe("many");
    expect(pluralCategory(21, "en")).toBe("many");
  });
});

describe("pluralCount — real bug regressions from prod tour", () => {
  it("ru: '1 салон' not '1 салонов' (was: '24 салонов' on /tenants)", () => {
    expect(pluralCount(1, "count.salons", "ru")).toBe("1 салон");
    expect(pluralCount(2, "count.salons", "ru")).toBe("2 салона");
    expect(pluralCount(24, "count.salons", "ru")).toBe("24 салона");
    expect(pluralCount(5, "count.salons", "ru")).toBe("5 салонов");
  });
  it("ru: '193 пользователя' / 'X пользователей' (was: '193 пользователей' on /users)", () => {
    expect(pluralCount(1, "count.users", "ru")).toBe("1 пользователь");
    expect(pluralCount(2, "count.users", "ru")).toBe("2 пользователя");
    expect(pluralCount(193, "count.users", "ru")).toBe("193 пользователя");
    expect(pluralCount(5, "count.users", "ru")).toBe("5 пользователей");
  });
  it("ru: '1 агент поддержки' (was: '1 агентов поддержки' on /agents)", () => {
    expect(pluralCount(1, "count.agents", "ru")).toBe("1 агент поддержки");
    expect(pluralCount(3, "count.agents", "ru")).toBe("3 агента поддержки");
    expect(pluralCount(10, "count.agents", "ru")).toBe("10 агентов поддержки");
  });
  it("ru: bookings / masters / clients agree", () => {
    expect(pluralCount(1, "count.bookings", "ru")).toBe("1 запись");
    expect(pluralCount(3, "count.bookings", "ru")).toBe("3 записи");
    expect(pluralCount(5, "count.bookings", "ru")).toBe("5 записей");
    expect(pluralCount(1, "count.masters", "ru")).toBe("1 мастер");
    expect(pluralCount(2, "count.masters", "ru")).toBe("2 мастера");
    expect(pluralCount(7, "count.masters", "ru")).toBe("7 мастеров");
    expect(pluralCount(1, "count.clients", "ru")).toBe("1 клиент");
  });
  it("en: 1 vs many", () => {
    expect(pluralCount(1, "count.salons", "en")).toBe("1 salon");
    expect(pluralCount(2, "count.salons", "en")).toBe("2 salons");
  });
});

describe("formatRelativeTime — no English bleed in Russian UI", () => {
  const NOW = 1_715_000_000_000; // fixed ms
  it("ru: 'только что' under 1 min (was: 'just now')", () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 30, "ru", NOW)).toBe("только что");
  });
  it("ru: '{n} мин назад' under 1 hour (was: '21m ago')", () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 21 * 60, "ru", NOW)).toBe("21 мин назад");
  });
  it("ru: '{n} ч назад' under 1 day", () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 3 * 3600, "ru", NOW)).toBe("3 ч назад");
  });
  it("ru: '{n} д назад' under 1 week", () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 3 * 86400, "ru", NOW)).toBe("3 д назад");
  });
  it("en: 'just now', '{n}m ago' (sanity)", () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 30, "en", NOW)).toBe("just now");
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 5 * 60, "en", NOW)).toBe("5m ago");
  });
});

describe("Nav-label parity — sidebar must match in-page titles", () => {
  // tNav() is the canonical source for sidebar labels. In-page <PageHeader>
  // titles MUST resolve to the same string for the same destination, or the
  // user is confused (e.g. sidebar "Биллинг" + page title "Тариф" was a real bug).
  it("ru: Billing tab — sidebar tNav and salon.billing match", () => {
    expect(tNav("Billing", "ru")).toBe("Биллинг");
    expect(t("salon.billing", "ru")).toBe("Биллинг");
    expect(t("nav.billing", "ru")).toBe("Биллинг");
    expect(t("gmBilling.title", "ru")).toBe("Биллинг");
  });
  it("ru: Tenants — Салоны (NOT 'Тенанты')", () => {
    expect(tNav("Tenants", "ru")).toBe("Салоны");
    expect(t("gmTenants.title", "ru")).toBe("Салоны");
    // Anti-test: legacy "Тенанты" must not show anywhere user-visible.
    expect(t("gmTenants.title", "ru")).not.toBe("Тенанты");
  });
  it("ru: salon.billing must NOT be 'Тариф' (label-mismatch regression from prod tour)", () => {
    expect(t("salon.billing", "ru")).not.toBe("Тариф");
  });
});

describe("i18n leak guard — no untranslated English in ru locale (key sample)", () => {
  // Spot-check critical user-facing keys that previously shipped with raw
  // English in the ru column. Add cases as new leaks are found.
  const RU_KEYS_THAT_MUST_NOT_BE_ENGLISH = [
    "nav.billing",
    "gmBilling.title",
    "gmTenants.title",
    "gmUsers.tenant",
    "gmAppts.tenant",
    "salon.billing",
    "time.justNow",
    "marketing.provider.enabled",
    "marketing.provider.dormant",
    "marketing.comingSoon",
    "conv.filter.open",
    "conv.filter.closed",
  ] as const;
  for (const key of RU_KEYS_THAT_MUST_NOT_BE_ENGLISH) {
    it(`'${key}' (ru) is not bare English`, () => {
      const value = t(key, "ru");
      // Must contain at least one Cyrillic character (а-я / А-Я).
      expect(/[Ѐ-ӿ]/.test(value)).toBe(true);
    });
  }
});
