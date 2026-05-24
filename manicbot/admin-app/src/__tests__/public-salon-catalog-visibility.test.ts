/**
 * Visibility contract for the public salon catalog (`publicSalon.search`,
 * `publicSalon.searchMasters`, `publicSalon.autocomplete`).
 *
 * Replaces the earlier `public-salon-is-test-filter.test.ts` (SEO audit
 * 2026-05-20 P0-3) that hid `is_test=1` rows from the catalog entirely.
 * Decision change 2026-05-24: test salons are visible in the public catalog
 * but rendered with a `<TestBadge />` on the card so visitors see they are
 * demos. SEO protection moves to a single layer — `robots: noindex,nofollow`
 * on `/salon/[slug]` for `isTest=1` (see `app/(public)/salon/[slug]/page.tsx`)
 * + the Worker-side sitemap that continues to exclude `is_test=1`.
 *
 * Helper contract pinned here:
 *   - `slug` MUST be set (without one the URL `/salon/{slug}` is broken).
 *   - `publicActive = 1` (owner opted into the directory).
 *   - `isTest` is informational only — both `0` and `1` rows pass.
 */
import { describe, it, expect } from "vitest";
import { filterToPublicCatalog, isPublicTenantRow } from "~/server/api/publicSalon/publicSalonSearchLogic";

interface Row {
  id: string;
  slug: string | null;
  publicActive: number;
  isTest?: number;
  name?: string;
}

describe("publicSalon — catalog visibility", () => {
  const realActive: Row = { id: "t_real", slug: "studio-paznokci", publicActive: 1, isTest: 0, name: "Studio Paznokci" };
  const realActiveNoSlug: Row = { id: "t_real_noslug", slug: null, publicActive: 1, isTest: 0, name: "No Slug" };
  const realInactive: Row = { id: "t_inactive", slug: "private", publicActive: 0, isTest: 0, name: "Private" };
  const testActive: Row = { id: "t_test", slug: "test-salon-trial", publicActive: 1, isTest: 1, name: "Test Salon Trial" };
  const testInactive: Row = { id: "t_test_inactive", slug: "test-old", publicActive: 0, isTest: 1, name: "Old Test" };

  describe("isPublicTenantRow", () => {
    it("returns true for an active real tenant with a slug", () => {
      expect(isPublicTenantRow(realActive)).toBe(true);
    });

    it("returns false for an active real tenant WITHOUT a slug (cannot be linked)", () => {
      expect(isPublicTenantRow(realActiveNoSlug)).toBe(false);
    });

    it("returns false for an inactive real tenant (publicActive=0)", () => {
      expect(isPublicTenantRow(realInactive)).toBe(false);
    });

    it("returns true for an ACTIVE test tenant — badge handles disclosure on the card", () => {
      expect(isPublicTenantRow(testActive)).toBe(true);
    });

    it("returns false for an inactive test tenant (publicActive=0 still wins)", () => {
      expect(isPublicTenantRow(testInactive)).toBe(false);
    });

    it("does not require isTest field on the row (it is informational)", () => {
      const withoutTestField = { id: "t_x", slug: "x", publicActive: 1 } as Row;
      expect(isPublicTenantRow(withoutTestField)).toBe(true);
    });
  });

  describe("filterToPublicCatalog", () => {
    it("keeps test rows in a mixed list (visible with badge)", () => {
      const mixed = [realActive, testActive, realInactive, testInactive, realActiveNoSlug];
      const visible = filterToPublicCatalog(mixed);
      expect(visible.map((r) => r.id)).toEqual(["t_real", "t_test"]);
    });

    it("preserves input order", () => {
      const second: Row = { id: "t_second", slug: "second", publicActive: 1, isTest: 0, name: "Second" };
      const ordered = [testActive, realActive, second];
      const out = filterToPublicCatalog(ordered);
      expect(out.map((r) => r.id)).toEqual(["t_test", "t_real", "t_second"]);
    });

    it("does not mutate the input array", () => {
      const input = [realActive, testActive];
      const copyBefore = [...input];
      filterToPublicCatalog(input);
      expect(input).toEqual(copyBefore);
    });

    it("filters out rows missing a slug or with publicActive=0", () => {
      expect(filterToPublicCatalog([realActiveNoSlug, realInactive, testInactive])).toEqual([]);
    });
  });
});
