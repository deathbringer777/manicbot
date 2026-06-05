/**
 * metrics router — God-Mode dashboard KPIs.
 *
 * Pins the corrected contract:
 *  - getDashboardStats is system_admin only;
 *  - it returns the separated platform buckets (ourCustomers / paying /
 *    comped / activeTrials) sourced from getPlatformMetrics, plus non-test
 *    operational counts — never the old all-tenants `count(*)`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { metricsRouter } from "~/server/api/routers/metrics";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const callerFor = createCallerFactory(metricsRouter);
const FAR_FUTURE = 9_999_999_999;

describe("metrics router — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getDashboardStats rejects unauthenticated callers", async () => {
    const { db } = createDbMock([]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(caller.getDashboardStats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("getDashboardStats rejects tenant_owner", async () => {
    const { db } = createDbMock([]);
    const caller = callerFor(makeTenantOwnerCtx(db, "t1") as never);
    await expect(caller.getDashboardStats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getDashboardStats rejects master", async () => {
    const { db } = createDbMock([]);
    const caller = callerFor(makeMasterCtx(db, "t1") as never);
    await expect(caller.getDashboardStats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getDashboardStats rejects support agents", async () => {
    const { db } = createDbMock([]);
    const caller = callerFor(makeSupportCtx(db, "technical_support") as never);
    await expect(caller.getDashboardStats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("metrics router — getDashboardStats math", () => {
  beforeEach(() => vi.clearAllMocks());

  it("separates buckets and excludes test/expired/comped from MRR", async () => {
    // Select order: platform join, totalTenants, totalApts, todayApts,
    //               recentTenants, recentApts.
    const { db } = createDbMock([
      [
        { plan: "pro", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", isTest: 0 }, // paying +60
        { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // comped
        { plan: "start", billingStatus: "trialing", trialEndsAt: FAR_FUTURE, stripeSubscriptionId: null, isTest: 0 }, // trial
        { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_T", isTest: 1 }, // test → none
      ],
      [{ count: 3 }], // totalTenants (non-test)
      [{ count: 120 }], // totalAppointments (non-test)
      [{ count: 4 }], // todayAppointments (non-test)
      [], // recentTenants
      [], // recentApts
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.getDashboardStats();

    expect(res.ourCustomers).toBe(3); // 4 rows minus the 1 test row
    expect(res.paying).toBe(1);
    expect(res.comped).toBe(1);
    expect(res.activeTrials).toBe(1);
    expect(res.mrr).toBe(60);
    expect(res.arr).toBe(60 * 12);
    expect(res.totalTenants).toBe(3);
    expect(res.totalAppointments).toBe(120);
    expect(res.todayAppointments).toBe(4);

    // Legacy aliases mirror the corrected fields.
    expect(res.totalUsers).toBe(res.ourCustomers);
    expect(res.activeSubscriptions).toBe(res.paying);
    expect(res.trialingCount).toBe(res.activeTrials);
  });

  it("returns honest zeros when every tenant is test (current prod reality)", async () => {
    const { db } = createDbMock([
      [], // platform join — all test tenants filtered at SQL level
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
      [],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.getDashboardStats();
    expect(res.ourCustomers).toBe(0);
    expect(res.paying).toBe(0);
    expect(res.mrr).toBe(0);
    expect(res.totalTenants).toBe(0);
  });
});
