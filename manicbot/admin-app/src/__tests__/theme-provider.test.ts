import { describe, it, expect } from "vitest";

type Theme = "dark" | "light";

/**
 * Pure extraction of the theme resolution logic from ThemeProvider.tsx.
 * URL param takes priority over localStorage, which takes priority over default "light".
 */
function resolveTheme(urlSearch: string, stored: string | null): Theme {
  const urlParam = new URLSearchParams(urlSearch).get("theme");
  if (urlParam === "light" || urlParam === "dark") return urlParam;
  if (stored === "light" || stored === "dark") return stored;
  return "light";
}

describe("ThemeProvider — theme resolution priority", () => {
  it("defaults to light when nothing is set", () => {
    expect(resolveTheme("", null)).toBe("light");
  });

  it("reads light from localStorage", () => {
    expect(resolveTheme("", "light")).toBe("light");
  });

  it("reads dark from localStorage", () => {
    expect(resolveTheme("", "dark")).toBe("dark");
  });

  it("URL param ?theme=light overrides localStorage dark", () => {
    expect(resolveTheme("?theme=light", "dark")).toBe("light");
  });

  it("URL param ?theme=dark overrides localStorage light", () => {
    expect(resolveTheme("?theme=dark", "light")).toBe("dark");
  });

  it("URL param ?theme=light overrides empty localStorage", () => {
    expect(resolveTheme("?theme=light", null)).toBe("light");
  });

  it("ignores invalid URL param values", () => {
    expect(resolveTheme("?theme=blue", "light")).toBe("light");
    expect(resolveTheme("?theme=blue", null)).toBe("light");
    expect(resolveTheme("?theme=", "light")).toBe("light");
  });

  it("ignores invalid localStorage values", () => {
    expect(resolveTheme("", "invalid")).toBe("light");
    expect(resolveTheme("", "Dark")).toBe("light");
  });

  it("URL param wins even if localStorage is also set", () => {
    expect(resolveTheme("?theme=light&lang=ru", "dark")).toBe("light");
  });

  it("URL param with extra params does not interfere", () => {
    expect(resolveTheme("?lang=en&theme=dark", null)).toBe("dark");
    expect(resolveTheme("?lang=pl&theme=light", "dark")).toBe("light");
  });
});
