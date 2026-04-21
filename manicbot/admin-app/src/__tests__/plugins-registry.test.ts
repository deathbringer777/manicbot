import { describe, it, expect } from "vitest";
import {
  PLUGINS,
  getPlugin,
  listPlugins,
  listManifests,
  findDuplicateSlugs,
} from "@plugins/registry";
import { validateAllManifests } from "~/server/plugins/manifestSchema";

describe("plugin registry", () => {
  it("exposes PLUGINS as a frozen object", () => {
    expect(Object.isFrozen(PLUGINS)).toBe(true);
  });

  it("includes the google-calendar plugin", () => {
    expect(PLUGINS["google-calendar"]).toBeDefined();
    expect(PLUGINS["google-calendar"]!.manifest.slug).toBe("google-calendar");
  });

  it("getPlugin returns a known plugin by slug", () => {
    const p = getPlugin("google-calendar");
    expect(p).not.toBeNull();
    expect(p?.manifest.vendor).toBe("manicbot");
  });

  it("getPlugin returns null for unknown slug", () => {
    expect(getPlugin("nonexistent-plugin-xyz")).toBeNull();
  });

  it("listPlugins returns at least 1 entry and no nulls", () => {
    const all = listPlugins();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.every((p) => p !== null && typeof p.manifest === "object")).toBe(true);
  });

  it("listManifests returns parallel array of manifests", () => {
    const manifests = listManifests();
    expect(manifests.length).toBe(listPlugins().length);
    expect(manifests[0]).toHaveProperty("slug");
  });

  it("validateAllManifests returns ok:true and the correct count", () => {
    const r = validateAllManifests();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.count).toBe(listPlugins().length);
  });

  it("findDuplicateSlugs returns empty array", () => {
    expect(findDuplicateSlugs()).toEqual([]);
  });

  it("every manifest has all 4 languages in name/tagline/description", () => {
    for (const m of listManifests()) {
      for (const field of ["name", "tagline", "description"] as const) {
        expect(m[field].ru).toBeTruthy();
        expect(m[field].ua).toBeTruthy();
        expect(m[field].en).toBeTruthy();
        expect(m[field].pl).toBeTruthy();
      }
    }
  });

  it("every manifest has non-empty keywords for all 4 languages", () => {
    for (const m of listManifests()) {
      expect(m.keywords.ru.length).toBeGreaterThan(0);
      expect(m.keywords.ua.length).toBeGreaterThan(0);
      expect(m.keywords.en.length).toBeGreaterThan(0);
      expect(m.keywords.pl.length).toBeGreaterThan(0);
    }
  });
});
