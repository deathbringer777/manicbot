/**
 * Tests for the in-app subscription self-service procedures on salonRouter:
 *   changePlan (upgrade / downgrade / same), pauseSubscription, resumeSubscription,
 *   cancelPendingDowngrade. Stripe is mocked at the lib boundary; DB via createDbMock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_PRICE_START_MONTHLY: "price_start_m",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
    STRIPE_PRICE_MAX_MONTHLY: "price_max_m",
    STRIPE_PRICE_START_ANNUAL: "price_start_a",
    STRIPE_PRICE_PRO_ANNUAL: "price_pro_a",
    STRIPE_PRICE_MAX_ANNUAL: "price_max_a",
  },
}));

vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(),
  telegramSetWebhook: vi.fn(),
  telegramDeleteWebhook: vi.fn(),
}));

vi.mock("~/server/lib/uploadToken", () => ({
  signUploadToken: vi.fn().mockResolvedValue("tok.signed"),
}));

vi.mock("~/server/utils/notifyWorker", () => ({
  notifyWorker: vi.fn(async () => undefined),
}));

vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("~/server/lib/stripe", () => ({
  getOrCreateCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createEmbeddedCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  createOneTimePercentOffCoupon: vi.fn(),
  retrieveSubscription: vi.fn(),
  changeSubscriptionPlanImmediate: vi.fn(),
  scheduleDowngradeAtPeriodEnd: vi.fn(),
  releaseScheduledChange: vi.fn(),
  pauseSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  previewPlanChange: vi.fn(),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import {
  retrieveSubscription,
  changeSubscriptionPlanImmediate,
  scheduleDowngradeAtPeriodEnd,
  releaseScheduledChange,
  pauseSubscription as stripePauseSubscription,
  resumeSubscription as stripeResumeSubscription,
} from "~/server/lib/stripe";
import { createDbMock, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const TENANT = "t_demo";
const SUB_ID = "sub_demo_123";
const createCaller = createCallerFactory(salonRouter);

function ownerCaller(db: any) {
  return createCaller(makeTenantOwnerCtx(db, TENANT) as never);
}
function monthlySub(overrides: Record<string, unknown> = {}): any {
  return {
    id: SUB_ID,
    status: "active",
    schedule: null,
    items: { data: [{ id: "si_1", price: { recurring: { interval: "month" } } }] },
    ...overrides,
  };
}
function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT,
    plan: "pro",
    billingStatus: "active",
    stripeSubscriptionId: SUB_ID,
    pendingScheduleId: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("salon.changePlan", () => {
  it("UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.changePlan({ tenantId: TENANT, plan: "max" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects when the tenant has no Stripe subscription", async () => {
    const { db } = createDbMock([[tenantRow({ stripeSubscriptionId: null })]]);
    await expect(ownerCaller(db).changePlan({ tenantId: TENANT, plan: "max" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "no_active_subscription" });
  });

  it("UPGRADE (pro→max): bills the difference now and sets plan immediately", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ plan: "pro" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(monthlySub());
    vi.mocked(changeSubscriptionPlanImmediate).mockResolvedValueOnce({ id: SUB_ID, status: "active" });

    const res = await ownerCaller(db).changePlan({ tenantId: TENANT, plan: "max" });

    expect(res).toEqual({ kind: "upgraded", plan: "max" });
    expect(changeSubscriptionPlanImmediate).toHaveBeenCalledWith("sk_test_xxx", SUB_ID, "si_1", "price_max_m");
    expect(scheduleDowngradeAtPeriodEnd).not.toHaveBeenCalled();
    // plan set to target now; pending state cleared.
    expect(updateCalls.at(-1)!.values).toMatchObject({ plan: "max", pendingPlan: null, pendingScheduleId: null });
  });

  it("DOWNGRADE (pro→start): schedules at period end, keeps plan, stores pending", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ plan: "pro" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(monthlySub());
    vi.mocked(scheduleDowngradeAtPeriodEnd).mockResolvedValueOnce({ scheduleId: "sch_1", effectiveAt: 2000 });

    const res = await ownerCaller(db).changePlan({ tenantId: TENANT, plan: "start" });

    expect(res).toEqual({ kind: "downgrade_scheduled", plan: "start", effectiveAt: 2000 });
    expect(scheduleDowngradeAtPeriodEnd).toHaveBeenCalledWith("sk_test_xxx", SUB_ID, "price_start_m");
    expect(changeSubscriptionPlanImmediate).not.toHaveBeenCalled();
    // plan NOT changed; pending downgrade recorded.
    const v = updateCalls.at(-1)!.values;
    expect(v).toMatchObject({
      pendingPlan: "start", pendingPriceId: "price_start_m", pendingPlanEffectiveAt: 2000, pendingScheduleId: "sch_1",
    });
    expect(v.plan).toBeUndefined();
  });

  it("DOWNGRADE uses the annual price for a yearly subscription", async () => {
    const { db } = createDbMock([[tenantRow({ plan: "max" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(
      monthlySub({ items: { data: [{ id: "si_1", price: { recurring: { interval: "year" } } }] } }),
    );
    vi.mocked(scheduleDowngradeAtPeriodEnd).mockResolvedValueOnce({ scheduleId: "sch_2", effectiveAt: 999 });

    await ownerCaller(db).changePlan({ tenantId: TENANT, plan: "pro" });
    expect(scheduleDowngradeAtPeriodEnd).toHaveBeenCalledWith("sk_test_xxx", SUB_ID, "price_pro_a");
  });

  it("releases an existing pending downgrade schedule before applying a new change", async () => {
    const { db } = createDbMock([[tenantRow({ plan: "pro", pendingScheduleId: "sch_old" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(monthlySub());
    vi.mocked(releaseScheduledChange).mockResolvedValueOnce({ id: "sch_old", status: "released" });
    vi.mocked(changeSubscriptionPlanImmediate).mockResolvedValueOnce({ id: SUB_ID, status: "active" });

    await ownerCaller(db).changePlan({ tenantId: TENANT, plan: "max" });
    expect(releaseScheduledChange).toHaveBeenCalledWith("sk_test_xxx", "sch_old");
  });

  it("same plan is a no-op that clears pending state (cancel a pending downgrade)", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ plan: "pro", pendingScheduleId: "sch_x" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(monthlySub());
    vi.mocked(releaseScheduledChange).mockResolvedValueOnce({ id: "sch_x", status: "released" });

    const res = await ownerCaller(db).changePlan({ tenantId: TENANT, plan: "pro" });
    expect(res).toEqual({ kind: "noop", plan: "pro" });
    expect(releaseScheduledChange).toHaveBeenCalledWith("sk_test_xxx", "sch_x");
    expect(updateCalls.at(-1)!.values).toMatchObject({ pendingScheduleId: null, pendingPlan: null });
    expect(changeSubscriptionPlanImmediate).not.toHaveBeenCalled();
  });
});

describe("salon.pauseSubscription / resumeSubscription", () => {
  it("pause: only when active → sets billing_status=paused + indefinite", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ billingStatus: "active" })]]);
    vi.mocked(stripePauseSubscription).mockResolvedValueOnce({ id: SUB_ID, status: "active" });

    const res = await ownerCaller(db).pauseSubscription({ tenantId: TENANT });
    expect(res).toEqual({ ok: true, resumesAt: null });
    expect(stripePauseSubscription).toHaveBeenCalledWith("sk_test_xxx", SUB_ID, null);
    expect(updateCalls.at(-1)!.values).toMatchObject({ billingStatus: "paused", pauseResumesAt: null });
  });

  it("pause: passes a resume timestamp when resumeInMonths given", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ billingStatus: "active" })]]);
    vi.mocked(stripePauseSubscription).mockResolvedValueOnce({ id: SUB_ID, status: "active" });

    const res = await ownerCaller(db).pauseSubscription({ tenantId: TENANT, resumeInMonths: 2 });
    expect(res.resumesAt).toBeTypeOf("number");
    const passedResumesAt = vi.mocked(stripePauseSubscription).mock.calls[0]![2];
    expect(passedResumesAt).toBe(res.resumesAt);
    expect(updateCalls.at(-1)!.values.pauseResumesAt).toBe(res.resumesAt);
  });

  it("pause: rejects when not active", async () => {
    const { db } = createDbMock([[tenantRow({ billingStatus: "trialing" })]]);
    await expect(ownerCaller(db).pauseSubscription({ tenantId: TENANT }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "only_active_can_pause" });
    expect(stripePauseSubscription).not.toHaveBeenCalled();
  });

  it("resume: clears pause and returns to active", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ billingStatus: "paused" })]]);
    vi.mocked(stripeResumeSubscription).mockResolvedValueOnce({ id: SUB_ID, status: "active" });

    const res = await ownerCaller(db).resumeSubscription({ tenantId: TENANT });
    expect(res).toEqual({ ok: true });
    expect(stripeResumeSubscription).toHaveBeenCalledWith("sk_test_xxx", SUB_ID);
    expect(updateCalls.at(-1)!.values).toMatchObject({ billingStatus: "active", pauseResumesAt: null });
  });
});

describe("salon.cancelPendingDowngrade", () => {
  it("releases the schedule and clears pending state", async () => {
    const { db, updateCalls } = createDbMock([[tenantRow({ pendingScheduleId: "sch_1" })]]);
    vi.mocked(releaseScheduledChange).mockResolvedValueOnce({ id: "sch_1", status: "released" });

    const res = await ownerCaller(db).cancelPendingDowngrade({ tenantId: TENANT });
    expect(res).toEqual({ ok: true });
    expect(releaseScheduledChange).toHaveBeenCalledWith("sk_test_xxx", "sch_1");
    expect(updateCalls.at(-1)!.values).toMatchObject({ pendingScheduleId: null, pendingPlan: null });
  });

  it("rejects when there's no pending downgrade", async () => {
    const { db } = createDbMock([[tenantRow({ pendingScheduleId: null })]]);
    await expect(ownerCaller(db).cancelPendingDowngrade({ tenantId: TENANT }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "no_pending_downgrade" });
    expect(releaseScheduledChange).not.toHaveBeenCalled();
  });
});
