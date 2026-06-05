/**
 * Tests for billingRouter: getOverview, updatePlan, updateStatus, manualActivate.
 *
 * Covers:
 *  - MRR calculation (PLN, active only)
 *  - Plan breakdown counts
 *  - Status bucket counts (active / trialing / grace / inactive)
 *  - updatePlan mutation — correct tenant targeted
 *  - updateStatus mutation — correct status applied
 *  - manualActivate — periodEnd in seconds, clears trial/grace
 *  - Auth guards (UNAUTHORIZED / FORBIDDEN for non-admins)
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { billingRouter } from "~/server/api/routers/billing";
import {
  createDbMock,
  makeAdminCtx,
  makeUnauthCtx,
  makeForbiddenWebCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(billingRouter);

const now = Math.floor(Date.now() / 1000);

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: "t_test",
    name: "Test Salon",
    plan: "pro",
    billingStatus: "active",
    billingEmail: "owner@salon.com",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    trialEndsAt: null,
    currentPeriodEnd: now + 30 * 86400,
    cancelAtPeriodEnd: 0,
    createdAt: now - 30 * 86400,
    ...overrides,
  };
}

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe("billingRouter auth guards", () => {
  it("getOverview throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.getOverview()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("getOverview throws FORBIDDEN for tenant_owner", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeForbiddenWebCtx(db) as never);
    await expect(caller.getOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updatePlan throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.updatePlan({ tenantId: "t_1", plan: "pro" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("manualActivate throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── getOverview — MRR and metrics ───────────────────────────────────────────

describe("getOverview", () => {
  it("calculates MRR from active tenants only (PLN prices)", async () => {
    const tenants = [
      makeTenant({ id: "t1", plan: "start", billingStatus: "active" }),
      makeTenant({ id: "t2", plan: "pro", billingStatus: "active" }),
      makeTenant({ id: "t3", plan: "max", billingStatus: "active" }),
      makeTenant({ id: "t4", plan: "pro", billingStatus: "trialing" }), // excluded from MRR
      makeTenant({ id: "t5", plan: "pro", billingStatus: "inactive" }), // excluded from MRR
    ];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();

    // MRR = 45 (start) + 60 (pro) + 90 (max) = 195 PLN
    expect(result.metrics.mrr).toBe(195);
  });

  it("MRR = 0 when no active tenants", async () => {
    const tenants = [
      makeTenant({ id: "t1", plan: "pro", billingStatus: "trialing" }),
      makeTenant({ id: "t2", plan: "max", billingStatus: "inactive" }),
    ];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();
    expect(result.metrics.mrr).toBe(0);
  });

  it("counts buckets correctly", async () => {
    const tenants = [
      makeTenant({ id: "t1", billingStatus: "active" }),
      makeTenant({ id: "t2", billingStatus: "active" }),
      // trialing only counts while not expired → give it a future trial end.
      makeTenant({ id: "t3", billingStatus: "trialing", trialEndsAt: now + 7 * 86400 }),
      makeTenant({ id: "t4", billingStatus: "grace_period" }),
      makeTenant({ id: "t5", billingStatus: "inactive" }),
      makeTenant({ id: "t6", billingStatus: null }), // null = inactive bucket
    ];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();

    expect(result.metrics.activeSubscribers).toBe(2);
    expect(result.metrics.trialing).toBe(1);
    expect(result.metrics.grace).toBe(1);
    expect(result.metrics.inactive).toBe(2); // "inactive" + null
    expect(result.metrics.totalTenants).toBe(6);
  });

  it("builds plan breakdown for active tenants", async () => {
    const tenants = [
      makeTenant({ id: "t1", plan: "start", billingStatus: "active" }),
      makeTenant({ id: "t2", plan: "pro", billingStatus: "active" }),
      makeTenant({ id: "t3", plan: "pro", billingStatus: "active" }),
      makeTenant({ id: "t4", plan: "max", billingStatus: "active" }),
      makeTenant({ id: "t5", plan: "pro", billingStatus: "trialing" }), // excluded
    ];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();

    expect(result.metrics.planBreakdown).toMatchObject({ start: 1, pro: 2, max: 1 });
    expect(result.metrics.planBreakdown["pro"]).toBe(2); // excludes trialing
  });

  it("returns tenant list with monthlyRevenue = 0 for non-active", async () => {
    const tenants = [
      makeTenant({ id: "t1", plan: "pro", billingStatus: "trialing" }),
      makeTenant({ id: "t2", plan: "pro", billingStatus: "active" }),
    ];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();

    const trialing = result.tenants.find((t) => t.id === "t1")!;
    const active = result.tenants.find((t) => t.id === "t2")!;
    expect(trialing.monthlyRevenue).toBe(0);
    expect(active.monthlyRevenue).toBe(60); // pro = 60 PLN
  });

  it("fallback to 'start' plan when plan is null", async () => {
    const tenants = [makeTenant({ id: "t1", plan: null, billingStatus: "active" })];
    const { db } = createDbMock([tenants]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();
    expect(result.metrics.mrr).toBe(45); // start = 45 PLN
    expect(result.tenants[0]!.plan).toBe("start");
  });

  it("returns empty metrics for no tenants", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.getOverview();
    expect(result.metrics.mrr).toBe(0);
    expect(result.metrics.totalTenants).toBe(0);
    expect(result.tenants).toHaveLength(0);
  });
});

// ─── updatePlan ───────────────────────────────────────────────────────────────

describe("updatePlan", () => {
  it("calls db.update with correct plan and updatedAt", async () => {
    const { db, updateCalls } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.updatePlan({ tenantId: "t_salon_1", plan: "max" });

    expect(result).toMatchObject({ success: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values.plan).toBe("max");
    expect(typeof updateCalls[0]!.values.updatedAt).toBe("number");
    // updatedAt must be a recent Unix seconds timestamp
    expect(updateCalls[0]!.values.updatedAt).toBeGreaterThan(1_700_000_000);
    expect(updateCalls[0]!.values.updatedAt).toBeLessThan(2_000_000_000);
  });

  it("allows all three plans", async () => {
    for (const plan of ["start", "pro", "max"] as const) {
      const { db } = createDbMock();
      const caller = createCaller(makeAdminCtx(db) as never);
      const result = await caller.updatePlan({ tenantId: "t_x", plan });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid plan", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.updatePlan({ tenantId: "t_x", plan: "enterprise" as never })
    ).rejects.toThrow();
  });
});

// ─── updateStatus ─────────────────────────────────────────────────────────────

describe("updateStatus", () => {
  it("updates billingStatus and updatedAt", async () => {
    const { db, updateCalls } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.updateStatus({ tenantId: "t_1", billingStatus: "inactive" });

    expect(result).toMatchObject({ success: true });
    expect(updateCalls[0]!.values.billingStatus).toBe("inactive");
    expect(typeof updateCalls[0]!.values.updatedAt).toBe("number");
  });

  it("allows all valid billing statuses", async () => {
    for (const status of ["active", "trialing", "grace_period", "inactive"] as const) {
      const { db } = createDbMock();
      const caller = createCaller(makeAdminCtx(db) as never);
      const result = await caller.updateStatus({ tenantId: "t_x", billingStatus: status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid billing status", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.updateStatus({ tenantId: "t_x", billingStatus: "pending" as never })
    ).rejects.toThrow();
  });
});

// ─── manualActivate ───────────────────────────────────────────────────────────

describe("manualActivate", () => {
  it("sets active status, correct plan, and periodEnd in seconds", async () => {
    const beforeCall = Math.floor(Date.now() / 1000);
    const { db, updateCalls } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 3 });

    expect(result.success).toBe(true);
    expect(typeof result.periodEnd).toBe("number");

    // periodEnd must be ~3 months from now (in seconds, not ms)
    const expectedPeriodEnd = beforeCall + 3 * 30 * 24 * 3600;
    expect(result.periodEnd).toBeGreaterThanOrEqual(expectedPeriodEnd - 5);
    expect(result.periodEnd).toBeLessThanOrEqual(expectedPeriodEnd + 5);

    // Must be in seconds (< 2B), not ms (> 2T)
    expect(result.periodEnd).toBeLessThan(2_000_000_000);
    expect(result.periodEnd).toBeGreaterThan(1_700_000_000);

    const vals = updateCalls[0]!.values;
    expect(vals.billingStatus).toBe("active");
    expect(vals.plan).toBe("pro");
    expect(vals.trialEndsAt).toBeNull();
    expect(vals.graceEndsAt).toBeNull();
    expect(vals.cancelAtPeriodEnd).toBe(0);
  });

  it("1 month activation has correct period", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.manualActivate({ tenantId: "t_1", plan: "start", months: 1 });
    const oneMonthSec = 30 * 24 * 3600;
    const expectedPeriodEnd = Math.floor(Date.now() / 1000) + oneMonthSec;
    expect(result.periodEnd).toBeGreaterThanOrEqual(expectedPeriodEnd - 5);
    expect(result.periodEnd).toBeLessThanOrEqual(expectedPeriodEnd + 5);
  });

  it("12 months activation has correct period", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.manualActivate({ tenantId: "t_1", plan: "max", months: 12 });
    const twelveMonthsSec = 12 * 30 * 24 * 3600;
    const expectedPeriodEnd = Math.floor(Date.now() / 1000) + twelveMonthsSec;
    expect(result.periodEnd).toBeGreaterThanOrEqual(expectedPeriodEnd - 5);
    expect(result.periodEnd).toBeLessThanOrEqual(expectedPeriodEnd + 5);
  });

  it("rejects months < 1", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 0 })
    ).rejects.toThrow();
  });

  it("rejects months > 24", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 25 })
    ).rejects.toThrow();
  });
});
