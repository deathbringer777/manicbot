import { describe, it, expect } from "vitest";

/**
 * Promo code validation logic tests.
 * Mirrors the server-side validate() rules in routers/promoCodes.ts so
 * the UI can pre-flight without extra RTT.
 */

interface PromoRow {
  id: number;
  tenantId: string;
  code: string;
  discountType: "percent" | "fixed_pln";
  discountValue: number;
  maxUses: number | null;
  maxUsesPerClient: number;
  validFrom: number;
  validUntil: number | null;
  clientId: string | null;
  serviceIds: string | null;
}

type Reason = "not_found" | "not_started" | "expired" | "client_mismatch" | "below_min_order" | "max_uses_reached" | null;

function validate(
  row: PromoRow | null,
  now: number,
  clientId?: string,
  usesCount = 0,
  minOrderPln: number | null = null,
  orderPln?: number,
): { valid: boolean; reason: Reason } {
  if (!row) return { valid: false, reason: "not_found" };
  if (row.validFrom > now) return { valid: false, reason: "not_started" };
  if (row.validUntil && row.validUntil < now) return { valid: false, reason: "expired" };
  if (row.clientId && clientId && row.clientId !== clientId) return { valid: false, reason: "client_mismatch" };
  if (minOrderPln != null && orderPln != null && orderPln < minOrderPln) return { valid: false, reason: "below_min_order" };
  if (row.maxUses != null && usesCount >= row.maxUses) return { valid: false, reason: "max_uses_reached" };
  return { valid: true, reason: null };
}

const basePromo: PromoRow = {
  id: 1, tenantId: "t_1", code: "TEST",
  discountType: "percent", discountValue: 20,
  maxUses: null, maxUsesPerClient: 1,
  validFrom: 1_000, validUntil: null,
  clientId: null, serviceIds: null,
};

describe("promoCodes.validate logic", () => {
  const now = 2_000;

  it("returns not_found when row is null", () => {
    expect(validate(null, now)).toEqual({ valid: false, reason: "not_found" });
  });

  it("returns valid for a live promo", () => {
    expect(validate(basePromo, now)).toEqual({ valid: true, reason: null });
  });

  it("returns not_started for future validFrom", () => {
    expect(validate({ ...basePromo, validFrom: 3_000 }, now)).toMatchObject({ valid: false, reason: "not_started" });
  });

  it("returns expired for past validUntil", () => {
    expect(validate({ ...basePromo, validUntil: 1_500 }, now)).toMatchObject({ valid: false, reason: "expired" });
  });

  it("returns client_mismatch when clientId doesn't match", () => {
    expect(validate({ ...basePromo, clientId: "c_1" }, now, "c_2")).toMatchObject({ valid: false, reason: "client_mismatch" });
  });

  it("accepts matching clientId", () => {
    expect(validate({ ...basePromo, clientId: "c_1" }, now, "c_1")).toEqual({ valid: true, reason: null });
  });

  it("returns below_min_order when order < minOrderPln", () => {
    expect(validate(basePromo, now, undefined, 0, 100, 50)).toMatchObject({ valid: false, reason: "below_min_order" });
  });

  it("returns max_uses_reached when usesCount >= maxUses", () => {
    expect(validate({ ...basePromo, maxUses: 3 }, now, undefined, 3)).toMatchObject({ valid: false, reason: "max_uses_reached" });
  });

  it("max_uses=null means unlimited", () => {
    expect(validate({ ...basePromo, maxUses: null }, now, undefined, 999_999)).toEqual({ valid: true, reason: null });
  });

  it("validUntil=null means no expiry", () => {
    expect(validate({ ...basePromo, validUntil: null }, 9_999_999_999)).toEqual({ valid: true, reason: null });
  });
});
