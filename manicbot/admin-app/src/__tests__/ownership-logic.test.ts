import { describe, expect, it } from "vitest";
import {
  checkTransferEligibility,
  generateTransferToken,
  hashToken,
  isTokenExpired,
  TRANSFER_TTL_SECONDS,
} from "~/server/api/ownership/ownershipLogic";

describe("ownership.checkTransferEligibility", () => {
  const baseTarget = {
    id: "user_target",
    tenantId: "t_demo",
    emailVerified: 1,
    role: "master",
  };
  const baseInputs = {
    targetUserId: "user_target",
    fromUserId: "user_owner",
    tenantId: "t_demo",
    target: baseTarget,
    billingStatus: "active",
  };

  it("happy path — verified master in same tenant, active billing", () => {
    const result = checkTransferEligibility(baseInputs);
    expect(result).toEqual({ ok: true });
  });

  it("accepts tenant_manager target", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      target: { ...baseTarget, role: "tenant_manager" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects self-transfer", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      targetUserId: "user_owner",
    });
    expect(result).toEqual({ ok: false, reason: "self_transfer" });
  });

  it("rejects target outside this tenant", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      target: { ...baseTarget, tenantId: "t_other" },
    });
    expect(result).toEqual({ ok: false, reason: "target_not_in_tenant" });
  });

  it("rejects target with no tenant", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      target: { ...baseTarget, tenantId: null },
    });
    expect(result).toEqual({ ok: false, reason: "target_not_in_tenant" });
  });

  it("rejects when target user is missing", () => {
    const result = checkTransferEligibility({ ...baseInputs, target: null });
    expect(result).toEqual({ ok: false, reason: "target_not_in_tenant" });
  });

  it("rejects target with unverified email", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      target: { ...baseTarget, emailVerified: 0 },
    });
    expect(result).toEqual({ ok: false, reason: "target_email_unverified" });
  });

  it("rejects target who is already tenant_owner", () => {
    const result = checkTransferEligibility({
      ...baseInputs,
      target: { ...baseTarget, role: "tenant_owner" },
    });
    expect(result).toEqual({ ok: false, reason: "already_owner" });
  });

  it("rejects on inactive billing", () => {
    const result = checkTransferEligibility({ ...baseInputs, billingStatus: "inactive" });
    expect(result).toEqual({ ok: false, reason: "no_active_subscription" });
  });

  it("rejects on expired billing", () => {
    const result = checkTransferEligibility({ ...baseInputs, billingStatus: "expired" });
    expect(result).toEqual({ ok: false, reason: "no_active_subscription" });
  });

  it("accepts trialing / active / grace", () => {
    for (const status of ["trialing", "active", "grace"]) {
      const result = checkTransferEligibility({ ...baseInputs, billingStatus: status });
      expect(result, `billing=${status}`).toEqual({ ok: true });
    }
  });

  it("treats missing billingStatus as trialing (acceptable)", () => {
    const result = checkTransferEligibility({ ...baseInputs, billingStatus: null });
    expect(result.ok).toBe(true);
  });

  it("billing check is case-insensitive", () => {
    const result = checkTransferEligibility({ ...baseInputs, billingStatus: "ACTIVE" });
    expect(result.ok).toBe(true);
  });
});

describe("ownership.generateTransferToken", () => {
  it("produces 32-char alphanumeric token", () => {
    const tok = generateTransferToken();
    expect(tok).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("collisions across 1000 tokens are vanishingly rare (uniqueness smoke)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateTransferToken());
    expect(set.size).toBe(1000);
  });
});

describe("ownership.hashToken", () => {
  it("returns a 64-char hex SHA-256 digest", async () => {
    const h = await hashToken("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for same input", async () => {
    const a = await hashToken("same");
    const b = await hashToken("same");
    expect(a).toEqual(b);
  });

  it("differs for different inputs", async () => {
    const a = await hashToken("alpha");
    const b = await hashToken("beta");
    expect(a).not.toEqual(b);
  });
});

describe("ownership.isTokenExpired", () => {
  it("returns false when now is before expires_at", () => {
    expect(isTokenExpired(100, 50)).toBe(false);
  });

  it("returns true at the exact second of expires_at", () => {
    expect(isTokenExpired(100, 100)).toBe(true);
  });

  it("returns true after expires_at", () => {
    expect(isTokenExpired(100, 200)).toBe(true);
  });
});

describe("ownership.TRANSFER_TTL_SECONDS", () => {
  it("is 24 hours", () => {
    expect(TRANSFER_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});
