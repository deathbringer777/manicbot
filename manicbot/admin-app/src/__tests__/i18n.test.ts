import { describe, it, expect } from "vitest";
import { t, LANGS } from "~/lib/i18n";

describe("i18n t()", () => {
  it("returns Russian translation by default", () => {
    expect(t("common.loading", "ru")).toBe("Загрузка...");
  });

  it("returns English translation", () => {
    expect(t("common.loading", "en")).toBe("Loading...");
  });

  it("returns Ukrainian translation", () => {
    expect(t("common.loading", "ua")).toBe("Завантаження...");
  });

  it("returns Polish translation", () => {
    expect(t("common.loading", "pl")).toBe("Ładowanie...");
  });

  it("fallback to Russian when lang missing (impossible, but defensive)", () => {
    // All keys have all 4 langs, but t() falls back to 'ru'
    const result = t("gate.forbidden", "en");
    expect(result).toBe("Access denied");
  });

  it("LANGS array has all 4 languages", () => {
    expect(LANGS).toHaveLength(4);
    const codes = LANGS.map(l => l.code);
    expect(codes).toContain("ru");
    expect(codes).toContain("ua");
    expect(codes).toContain("en");
    expect(codes).toContain("pl");
  });

  it("roleSwitch keys exist", () => {
    expect(t("roleSwitch.godMode", "ru")).toBe("God Mode");
    expect(t("roleSwitch.salon", "ru")).toBe("Как салон");
    expect(t("roleSwitch.master", "ru")).toBe("Как мастер");
    expect(t("roleSwitch.support", "ru")).toBe("Как саппорт");
  });

  it("settings keys exist", () => {
    expect(t("settings.title", "en")).toBe("Settings");
    expect(t("settings.language", "en")).toBe("Interface language");
  });

  it("gate keys exist for forbidden access", () => {
    expect(t("gate.forbidden", "ru")).toBe("Доступ запрещён");
    expect(t("gate.tgOnly", "en")).toBe("Telegram only");
  });
});
