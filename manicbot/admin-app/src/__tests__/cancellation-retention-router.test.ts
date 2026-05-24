/**
 * Tests for billingRouter retention procs (migration 0086):
 *   - requestCancellation   — eligibility probe
 *   - acceptRetentionOffer  — apply coupon, write audit row, do NOT cancel
 *   - confirmCancellation   — write churn row, flip Stripe cancel_at_period_end
 *
 * 24 cases — covers auth gating, eligibility branches (cooldown, already-
 * cancelling, missing sub, wrong status), idempotent coupon (mocked at the
 * lib boundary), reason validation, photo URL host whitelist, happy paths,
 * and Stripe failure → DB row not orphaned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    STRIPE_SECRET_KEY: "sk_test_xxx",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

vi.mock("~/server/lib/stripe", () => ({
  retrieveSubscription: vi.fn(),
  ensureCoupon: vi.fn(),
  applyCouponToSubscription: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
}));

vi.mock("~/server/email/emailService", () => ({
  sendSubscriptionCancelledEmail: vi.fn(async () => ({ ok: true })),
}));

vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: vi.fn(() => "127.0.0.1"),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { billingRouter } from "~/server/api/routers/billing";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  retrieveSubscription,
  ensureCoupon,
  applyCouponToSubscription,
  cancelSubscriptionAtPeriodEnd,
} from "~/server/lib/stripe";
import { sendSubscriptionCancelledEmail } from "~/server/email/emailService";
import {
  createDbMock,
  makeUnauthCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(billingRouter);

const TENANT = "t_demo";
const SUB_ID = "sub_demo_123";
const NOW = Math.floor(Date.now() / 1000);

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT,
    plan: "pro",
    billingStatus: "active",
    billingEmail: "owner@salon.com",
    stripeSubscriptionId: SUB_ID,
    cancelAtPeriodEnd: 0,
    ...overrides,
  };
}

function ownerCaller(db: any) {
  return createCaller(makeTenantOwnerCtx(db, TENANT) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Auth gating ──────────────────────────────────────────────────────────────

describe("billingRouter retention — auth gating", () => {
  it("requestCancellation throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("acceptRetentionOffer throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.acceptRetentionOffer({ tenantId: TENANT, offerType: "monthly_50_3m" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("confirmCancellation throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        reasonTags: ["too_expensive"],
        retentionOfferShown: false,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("master role is rejected by tenantOwnerProcedure (FORBIDDEN)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeMasterCtx(db, TENANT) as never);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── requestCancellation — eligibility ───────────────────────────────────────

describe("requestCancellation — eligibility branches", () => {
  it("404 when tenant not found", async () => {
    const { db } = createDbMock([[]]);
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when no stripe_subscription_id on tenant", async () => {
    const { db } = createDbMock([[tenantRow({ stripeSubscriptionId: null })]]);
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "no_active_subscription" });
  });

  it("rejects when already cancelling (cancelAtPeriodEnd=1)", async () => {
    const { db } = createDbMock([[tenantRow({ cancelAtPeriodEnd: 1 })]]);
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "already_cancelling" });
  });

  it("rejects when Stripe says the subscription is missing", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce(null);
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "stripe_subscription_missing" });
  });

  it("rejects when Stripe already has cancel_at_period_end=true (out-of-band cancel)", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: true,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "already_cancelling" });
  });

  it("rejects when subscription status is past_due", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "past_due",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    const caller = ownerCaller(db);
    await expect(
      caller.requestCancellation({ tenantId: TENANT }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "subscription_not_cancelable:past_due",
    });
  });

  it("returns eligibleForOffer=true with monthly_50_3m for monthly sub", async () => {
    // 1st select: tenants row; 2nd select: cooldown probe → empty (eligible)
    const { db } = createDbMock([[tenantRow()], []]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    const caller = ownerCaller(db);
    const res = await caller.requestCancellation({ tenantId: TENANT });
    expect(res.eligibleForOffer).toBe(true);
    expect(res.offerType).toBe("monthly_50_3m");
    expect(res.currentInterval).toBe("month");
    expect(res.currentPlan).toBe("pro");
    expect(res.stripeSubId).toBe(SUB_ID);
  });

  it("returns annual_25_1y offer for yearly sub", async () => {
    const { db } = createDbMock([[tenantRow()], []]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "year" } } }] },
    });
    const caller = ownerCaller(db);
    const res = await caller.requestCancellation({ tenantId: TENANT });
    expect(res.eligibleForOffer).toBe(true);
    expect(res.offerType).toBe("annual_25_1y");
    expect(res.currentInterval).toBe("year");
  });

  it("returns eligibleForOffer=false when tenant already accepted offer in last 12mo (cooldown)", async () => {
    // cooldown probe returns one row → in cooldown
    const { db } = createDbMock([
      [tenantRow()],
      [{ id: 99 }],
    ]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    const caller = ownerCaller(db);
    const res = await caller.requestCancellation({ tenantId: TENANT });
    expect(res.eligibleForOffer).toBe(false);
    expect(res.offerType).toBeNull();
  });

  it("falls back to legacy items.plan.interval when items.price.recurring is absent", async () => {
    const { db } = createDbMock([[tenantRow()], []]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ plan: { interval: "year" } }] },
    });
    const caller = ownerCaller(db);
    const res = await caller.requestCancellation({ tenantId: TENANT });
    expect(res.currentInterval).toBe("year");
    expect(res.offerType).toBe("annual_25_1y");
  });
});

// ─── acceptRetentionOffer ────────────────────────────────────────────────────

describe("acceptRetentionOffer — happy path + edges", () => {
  it("rejects when no stripe sub on tenant", async () => {
    const { db } = createDbMock([[tenantRow({ stripeSubscriptionId: null })]]);
    const caller = ownerCaller(db);
    await expect(
      caller.acceptRetentionOffer({ tenantId: TENANT, offerType: "monthly_50_3m" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "no_active_subscription" });
  });

  it("mints idempotent coupon then applies it to subscription (monthly path)", async () => {
    const { db, insertCalls } = createDbMock([[tenantRow()]]);
    vi.mocked(ensureCoupon).mockResolvedValueOnce({
      id: "RETENTION_MONTHLY_50_3M",
      percent_off: 50,
      duration: "repeating",
      duration_in_months: 3,
    });
    vi.mocked(applyCouponToSubscription).mockResolvedValueOnce({ id: SUB_ID });

    const caller = ownerCaller(db);
    const res = await caller.acceptRetentionOffer({
      tenantId: TENANT,
      offerType: "monthly_50_3m",
    });

    expect(res).toEqual({
      applied: true,
      couponCode: "RETENTION_MONTHLY_50_3M",
      percentOff: 50,
    });

    expect(ensureCoupon).toHaveBeenCalledWith(
      "sk_test_xxx",
      "RETENTION_MONTHLY_50_3M",
      50,
      { duration: "repeating", months: 3 },
    );
    expect(applyCouponToSubscription).toHaveBeenCalledWith(
      "sk_test_xxx",
      SUB_ID,
      "RETENTION_MONTHLY_50_3M",
    );

    // Cancellation row was written with retention_offer_accepted=1
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0]!.values).toMatchObject({
      tenantId: TENANT,
      retentionOfferShown: 1,
      retentionOfferAccepted: 1,
      retentionCouponCode: "RETENTION_MONTHLY_50_3M",
      intervalAtCancel: "month",
    });
    // The Stripe subscription was NOT cancelled
    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
  });

  it("annual coupon uses duration=once, not repeating", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    vi.mocked(ensureCoupon).mockResolvedValueOnce({
      id: "RETENTION_ANNUAL_25_1Y",
      percent_off: 25,
      duration: "once",
    });
    vi.mocked(applyCouponToSubscription).mockResolvedValueOnce({ id: SUB_ID });

    const caller = ownerCaller(db);
    await caller.acceptRetentionOffer({
      tenantId: TENANT,
      offerType: "annual_25_1y",
    });

    expect(ensureCoupon).toHaveBeenCalledWith(
      "sk_test_xxx",
      "RETENTION_ANNUAL_25_1Y",
      25,
      { duration: "once", months: undefined },
    );
  });

  it("calling acceptRetentionOffer twice in a row results in two ensureCoupon calls (both idempotent)", async () => {
    const { db } = createDbMock([[tenantRow()], [tenantRow()]]);
    vi.mocked(ensureCoupon).mockResolvedValue({
      id: "RETENTION_MONTHLY_50_3M",
      percent_off: 50,
      duration: "repeating",
      duration_in_months: 3,
    });
    vi.mocked(applyCouponToSubscription).mockResolvedValue({ id: SUB_ID });

    const caller = ownerCaller(db);
    await caller.acceptRetentionOffer({ tenantId: TENANT, offerType: "monthly_50_3m" });
    await caller.acceptRetentionOffer({ tenantId: TENANT, offerType: "monthly_50_3m" });

    // ensureCoupon is the contract — the Stripe-side GET-first-then-POST logic
    // is what makes the second call cheap. Caller hits it twice; Stripe sees
    // one POST + one GET (proven in test/stripe-coupon-idempotency.test.js).
    expect(ensureCoupon).toHaveBeenCalledTimes(2);
  });
});

// ─── confirmCancellation ─────────────────────────────────────────────────────

describe("confirmCancellation — validation + happy path", () => {
  it("zod rejects empty reasonTags array", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        reasonTags: [] as never,
        retentionOfferShown: false,
      }),
    ).rejects.toThrow(/at_least_one_reason_required|too_small|empty/i);
  });

  it("zod rejects unknown reason enum value", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        // @ts-expect-error — testing runtime rejection
        reasonTags: ["fake_reason"],
        retentionOfferShown: false,
      }),
    ).rejects.toThrow();
  });

  it("zod rejects freeText > 2000 chars", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        reasonTags: ["too_expensive"],
        freeText: "x".repeat(2001),
        retentionOfferShown: false,
      }),
    ).rejects.toThrow();
  });

  it("rejects photo_url with disallowed host (defense against URL injection)", async () => {
    const { db } = createDbMock([[tenantRow()]]);
    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        reasonTags: ["confusing_ui"],
        photoUrl: "https://evil.example.com/leak.png",
        retentionOfferShown: false,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "photo_url_invalid_host",
    });
  });

  it("accepts photo_url from WORKER_PUBLIC_URL host", async () => {
    const { db, insertCalls, updateCalls } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockResolvedValueOnce({
      id: SUB_ID,
      cancel_at_period_end: true,
      current_period_end: NOW + 7 * 86400,
    });

    const caller = ownerCaller(db);
    const res = await caller.confirmCancellation({
      tenantId: TENANT,
      reasonTags: ["confusing_ui"],
      photoUrl: "https://worker.test/r2/t/t_demo/cancellation_feedback-abc.png",
      retentionOfferShown: true,
    });

    expect(res.ok).toBe(true);
    expect(res.cancelAt).toBe(NOW + 7 * 86400);
    expect(insertCalls[0]!.values).toMatchObject({
      tenantId: TENANT,
      photoUrl: "https://worker.test/r2/t/t_demo/cancellation_feedback-abc.png",
      retentionOfferShown: 1,
      retentionOfferAccepted: 0,
    });
    // tenants.cancel_at_period_end mirrored locally
    expect(updateCalls.some((c) => c.values.cancelAtPeriodEnd === 1)).toBe(true);
  });

  it("writes the DB row BEFORE calling Stripe (audit-first)", async () => {
    const callOrder: string[] = [];
    const { db } = createDbMock([[tenantRow()]]);
    db.insert = vi.fn(() => ({
      values: vi.fn(() => {
        callOrder.push("db.insert");
        return { onConflictDoUpdate: vi.fn(), then: (r: any) => Promise.resolve({ ok: true }).then(r) };
      }),
    })) as any;
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockImplementationOnce(async () => {
      callOrder.push("stripe.cancel");
      return { id: SUB_ID, cancel_at_period_end: true, current_period_end: NOW + 7 * 86400 };
    });

    const caller = ownerCaller(db);
    await caller.confirmCancellation({
      tenantId: TENANT,
      reasonTags: ["too_expensive"],
      retentionOfferShown: false,
    });

    expect(callOrder).toEqual(["db.insert", "stripe.cancel"]);
  });

  it("Stripe failure → DB row stays but mutation throws (no orphan reconciliation)", async () => {
    const { db, insertCalls, updateCalls } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockRejectedValueOnce(
      new Error("Stripe network error"),
    );

    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: TENANT,
        reasonTags: ["bad_support"],
        retentionOfferShown: false,
      }),
    ).rejects.toThrow(/Stripe/);

    // DB row was written; tenants.cancel_at_period_end mirror was NOT
    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(0);
  });

  it("fires sendSubscriptionCancelledEmail to billingEmail (fire-and-forget)", async () => {
    const { db } = createDbMock([[tenantRow({ billingEmail: "owner@salon.com" })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockResolvedValueOnce({
      id: SUB_ID,
      cancel_at_period_end: true,
      current_period_end: NOW + 7 * 86400,
    });

    const caller = ownerCaller(db);
    await caller.confirmCancellation({
      tenantId: TENANT,
      reasonTags: ["temporary_break"],
      retentionOfferShown: false,
    });

    // Need a microtask flush for the fire-and-forget catch chain
    await new Promise((r) => setTimeout(r, 0));
    expect(sendSubscriptionCancelledEmail).toHaveBeenCalledWith("owner@salon.com", "en");
  });

  it("falls back to the caller's webUser.email when tenant.billingEmail is null", async () => {
    const { db } = createDbMock([[tenantRow({ billingEmail: null })]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockResolvedValueOnce({
      id: SUB_ID,
      cancel_at_period_end: true,
      current_period_end: NOW + 7 * 86400,
    });

    const caller = ownerCaller(db);
    await caller.confirmCancellation({
      tenantId: TENANT,
      reasonTags: ["no_clients"],
      retentionOfferShown: false,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendSubscriptionCancelledEmail).toHaveBeenCalledWith("owner@test.com", "en");
  });

  it("stores reason_tags as JSON-encoded array", async () => {
    const { db, insertCalls } = createDbMock([[tenantRow()]]);
    vi.mocked(retrieveSubscription).mockResolvedValueOnce({
      id: SUB_ID,
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    vi.mocked(cancelSubscriptionAtPeriodEnd).mockResolvedValueOnce({
      id: SUB_ID,
      cancel_at_period_end: true,
      current_period_end: NOW + 7 * 86400,
    });

    const caller = ownerCaller(db);
    await caller.confirmCancellation({
      tenantId: TENANT,
      reasonTags: ["too_expensive", "no_clients", "switched_competitor"],
      retentionOfferShown: false,
    });

    expect(JSON.parse(String(insertCalls[0]!.values.reasonTags))).toEqual([
      "too_expensive",
      "no_clients",
      "switched_competitor",
    ]);
  });

  it("calls assertTenantOwner — cross-tenant probe is rejected", async () => {
    vi.mocked(assertTenantOwner).mockRejectedValueOnce(
      Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" }),
    );
    const { db } = createDbMock([[tenantRow()]]);
    const caller = ownerCaller(db);
    await expect(
      caller.confirmCancellation({
        tenantId: "t_someoneelse",
        reasonTags: ["too_expensive"],
        retentionOfferShown: false,
      }),
    ).rejects.toThrow();
    expect(assertTenantOwner).toHaveBeenCalled();
  });
});
