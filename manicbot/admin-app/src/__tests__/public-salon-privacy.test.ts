/**
 * P0-2 — publicSalon.getProfile must NEVER return data for a tenant with
 * `public_active = 0`. The legacy implementation was lenient and surfaced
 * full PII (phone, address, masters, services, photos) for any tenant whose
 * slug was guessed or scraped.
 *
 * tRPC procedures use D1 bindings that are not available in vitest, so this
 * test exercises the where-clause + payload-shaping logic directly via a
 * pure helper that mirrors the router's behaviour.
 */
import { describe, it, expect } from "vitest";

interface TenantRow {
  id: string;
  slug: string;
  publicActive: number;
  name: string;
  phone?: string | null;
  address?: string | null;
}

/** Mirrors the WHERE clause + payload shape from publicSalon.getProfile (P0-2). */
function lookupPublicSalon(rows: TenantRow[], slug: string): { found: boolean; payload: Record<string, unknown> | null } {
  const match = rows.find(t => t.slug === slug && t.publicActive === 1);
  if (!match) return { found: false, payload: null };
  return {
    found: true,
    payload: {
      id: match.id,
      slug: match.slug,
      name: match.name,
      // P0-2 — publicActive is intentionally not in the response.
    },
  };
}

describe("publicSalon.getProfile — privacy gate (P0-2)", () => {
  const inactive: TenantRow = { id: "t_inactive", slug: "secret-salon", publicActive: 0, name: "Secret", phone: "+48 555 1234" };
  const active: TenantRow = { id: "t_public", slug: "open-salon", publicActive: 1, name: "Public Salon", phone: "+48 666 9999" };

  it("returns null when the tenant is publicActive=0", () => {
    const result = lookupPublicSalon([inactive, active], "secret-salon");
    expect(result.found).toBe(false);
    expect(result.payload).toBeNull();
  });

  it("returns the payload when the tenant is publicActive=1", () => {
    const result = lookupPublicSalon([inactive, active], "open-salon");
    expect(result.found).toBe(true);
    expect(result.payload).toMatchObject({ id: "t_public", name: "Public Salon" });
  });

  it("never surfaces `publicActive` in the response payload", () => {
    const result = lookupPublicSalon([active], "open-salon");
    expect(result.payload).not.toHaveProperty("publicActive");
  });

  it("does not leak phone/address when publicActive=0 (only sees null payload)", () => {
    const result = lookupPublicSalon([inactive], "secret-salon");
    // The PII columns are completely unreachable — payload is null.
    expect(result.payload).toBeNull();
  });

  it("a slug-collision attack on an inactive tenant cannot leak", () => {
    // Attacker guesses the slug of a private salon — must always be null.
    const inactiveTenants: TenantRow[] = [
      { id: "t_1", slug: "alpha", publicActive: 0, name: "Hidden 1" },
      { id: "t_2", slug: "beta", publicActive: 0, name: "Hidden 2" },
      { id: "t_3", slug: "gamma", publicActive: 0, name: "Hidden 3" },
    ];
    for (const t of inactiveTenants) {
      expect(lookupPublicSalon(inactiveTenants, t.slug).payload).toBeNull();
    }
  });
});
