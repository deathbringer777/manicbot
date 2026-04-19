/**
 * Tests for billingRouter.manualActivate `days` parameter (added 2026-04-19).
 *
 * The legacy `months` parameter remains supported. Exactly one of {months, days}
 * must be provided; supplying both or neither must reject.
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
import { createDbMock, makeAdminCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(billingRouter);

describe("manualActivate days parameter", () => {
  it("accepts days=365 and computes period_end = now + 365*86400", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { db, updateCalls } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.manualActivate({ tenantId: "t_1", plan: "max", days: 365 });

    expect(result.success).toBe(true);
    const expected = before + 365 * 86400;
    expect(result.periodEnd).toBeGreaterThanOrEqual(expected - 5);
    expect(result.periodEnd).toBeLessThanOrEqual(expected + 5);

    expect(updateCalls[0]!.values.billingStatus).toBe("active");
    expect(updateCalls[0]!.values.plan).toBe("max");
    expect(updateCalls[0]!.values.trialEndsAt).toBeNull();
    expect(updateCalls[0]!.values.graceEndsAt).toBeNull();
  });

  it("still accepts months for backwards compatibility", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    const result = await caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 6 });
    const expected = before + 6 * 30 * 86400;
    expect(result.periodEnd).toBeGreaterThanOrEqual(expected - 5);
    expect(result.periodEnd).toBeLessThanOrEqual(expected + 5);
  });

  it("rejects when neither months nor days is provided", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro" } as never),
    ).rejects.toThrow();
  });

  it("rejects when both months and days are provided", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", months: 1, days: 30 } as never),
    ).rejects.toThrow();
  });

  it("rejects days outside 1..3650", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", days: 0 }),
    ).rejects.toThrow();
    await expect(
      caller.manualActivate({ tenantId: "t_1", plan: "pro", days: 4000 }),
    ).rejects.toThrow();
  });
});
