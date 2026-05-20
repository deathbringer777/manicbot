/**
 * SEO audit 2026-05-20 P0-3 — publicSalon.search / searchMasters / autocomplete
 * must NEVER return rows with `is_test = 1`. Test-seeded tenants from
 * `npm run seed:test-accounts` (TEST_ACCOUNTS.md) and any legacy demo /
 * preview rows leaked into the public catalog and Google indexed them as
 * if they were real salons — see audit "P0-3" finding.
 *
 * tRPC procedures use D1 bindings unavailable in vitest. This file mirrors
 * the WHERE-clause + post-fetch filter logic in a pure helper and locks
 * the behaviour against regressions. The router uses the SAME helper
 * (defence-in-depth alongside the SQL-level `WHERE is_test = 0`).
 *
 * Pinned by:
 *   - this file (logic)
 *   - publicSalon-router.test.ts (router shape)
 *   - manicbot/test/seo.test.js (sitemap excludes is_test=1)
 */
import { describe, it, expect } from "vitest";
import { filterOutTestTenants, isPublicTenantRow } from "~/server/api/publicSalon/publicSalonSearchLogic";

interface Row {
  id: string;
  slug: string | null;
  publicActive: number;
  isTest: number;
  name?: string;
}

describe("publicSalon — is_test filter (P0-3 audit)", () => {
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

    it("returns false for an inactive real tenant", () => {
      expect(isPublicTenantRow(realInactive)).toBe(false);
    });

    it("returns false for an active test tenant (is_test = 1)", () => {
      expect(isPublicTenantRow(testActive)).toBe(false);
    });

    it("returns false for an inactive test tenant", () => {
      expect(isPublicTenantRow(testInactive)).toBe(false);
    });

    it("treats any truthy isTest value as test (defensive coercion)", () => {
      // D1 may return `is_test` as boolean true/false in some drivers; the
      // filter must reject anything not strictly 0.
      const truthy = { ...realActive, isTest: 2 as unknown as number };
      expect(isPublicTenantRow(truthy)).toBe(false);
    });
  });

  describe("filterOutTestTenants", () => {
    it("removes all test rows from a mixed list", () => {
      const mixed = [realActive, testActive, realInactive, testInactive, realActiveNoSlug];
      const visible = filterOutTestTenants(mixed);
      expect(visible.map((r) => r.id)).toEqual(["t_real"]);
    });

    it("returns an empty array when every row is a test tenant", () => {
      const allTest = [testActive, testInactive];
      expect(filterOutTestTenants(allTest)).toEqual([]);
    });

    it("preserves input order for visible rows", () => {
      const second: Row = { id: "t_second", slug: "second", publicActive: 1, isTest: 0, name: "Second" };
      const ordered = [realActive, testActive, second];
      const out = filterOutTestTenants(ordered);
      expect(out.map((r) => r.id)).toEqual(["t_real", "t_second"]);
    });

    it("does not mutate the input array", () => {
      const input = [realActive, testActive];
      const copyBefore = [...input];
      filterOutTestTenants(input);
      expect(input).toEqual(copyBefore);
    });
  });

  describe("SEO catalog leak (P0-3 regression pin)", () => {
    // The audit dumped /search and found these slugs leaking even though
    // they were correctly stamped is_test=1 in D1. The SQL-level WHERE
    // was missing the filter; this test asserts the helper would have
    // caught the leak even if the WHERE drift happens again.
    const leakedSlugs = [
      "test-maister-max-c156",
      "test-maister-pro-92db",
      "test-maister-start-1c00",
      "test-maister-trial-477c",
      "test-salon-max-5db3",
      "test-salon-pro-0e02",
      "test-salon-start-1945",
      "test-salon-trial-0c19",
      "manicbot-demo",
      "preview-landing",
    ];

    it("filters every leaked slug observed in the audit", () => {
      const rows: Row[] = leakedSlugs.map((slug, i) => ({
        id: `t_leak_${i}`,
        slug,
        publicActive: 1,
        isTest: 1,
      }));
      expect(filterOutTestTenants(rows)).toEqual([]);
    });
  });
});
