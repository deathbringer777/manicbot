/**
 * Single source of truth for business-metric math.
 *
 * These tests pin the *correct* behavior the owner asked for:
 *  - test tenants (is_test) never count toward any business bucket;
 *  - expired trials are NOT "trialing" — they are churned;
 *  - a granted/promo account (active billing_status with NO real Stripe
 *    subscription) is "comped", contributes 0 MRR, and is counted apart
 *    from real paying customers;
 *  - the status taxonomy is normalized: the code writes `grace_period`
 *    (never `grace`), and `inactive` / `unpaid` are real churned states.
 */
import { describe, it, expect } from "vitest";
import {
  classifyTenant,
  normalizeBillingStatus,
  planPricePln,
} from "~/server/metrics/status";
import { getPlatformMetrics } from "~/server/metrics/platform";
import { getTenantMetrics } from "~/server/metrics/tenant";
import { createDbMock } from "./helpers/db-mock";

const NOW = 1_700_000_000;
const FUTURE = NOW + 7 * 86400;
const PAST = NOW - 7 * 86400;

describe("planPricePln", () => {
  it("matches the single PLN catalog (money.ts)", () => {
    expect(planPricePln("start")).toBe(45);
    expect(planPricePln("pro")).toBe(60);
    expect(planPricePln("max")).toBe(90);
    expect(planPricePln(null)).toBe(0);
    expect(planPricePln("enterprise")).toBe(0);
  });
});

describe("classifyTenant", () => {
  it("real paying: active + Stripe subscription + non-test → paying with MRR", () => {
    const c = classifyTenant(
      { plan: "pro", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_X", isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("paying");
    expect(c.mrrPln).toBe(60);
    expect(c.isComped).toBe(false);
  });

  it("comped: active + NO Stripe subscription (grant/promo code) → comped, 0 MRR", () => {
    const c = classifyTenant(
      { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("comped");
    expect(c.mrrPln).toBe(0);
    expect(c.isComped).toBe(true);
  });

  it("test tenant never counts — even if active with a real subscription", () => {
    const c = classifyTenant(
      { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_X", isTest: 1 },
      NOW,
    );
    expect(c.bucket).toBe("none");
    expect(c.mrrPln).toBe(0);
    expect(c.isTest).toBe(true);
  });

  it("active trial: trialing + trial_ends_at in the future → trialing", () => {
    const c = classifyTenant(
      { plan: "start", billingStatus: "trialing", trialEndsAt: FUTURE, stripeSubscriptionId: null, isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("trialing");
    expect(c.isActiveTrial).toBe(true);
    expect(c.mrrPln).toBe(0);
  });

  it("expired trial: trialing + trial_ends_at in the past → churned (NOT trialing)", () => {
    const c = classifyTenant(
      { plan: "start", billingStatus: "trialing", trialEndsAt: PAST, stripeSubscriptionId: null, isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("churned");
    expect(c.isActiveTrial).toBe(false);
  });

  it("trial with no end date is treated as expired (cannot be an active trial)", () => {
    const c = classifyTenant(
      { plan: "start", billingStatus: "trialing", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("churned");
  });

  it("grace_period with a real subscription is still paying (fixes the grace vs grace_period bug)", () => {
    const c = classifyTenant(
      { plan: "pro", billingStatus: "grace_period", trialEndsAt: null, stripeSubscriptionId: "sub_X", isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("paying");
    expect(c.mrrPln).toBe(60);
  });

  it("past_due with a real subscription is still paying", () => {
    const c = classifyTenant(
      { plan: "start", billingStatus: "past_due", trialEndsAt: null, stripeSubscriptionId: "sub_X", isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("paying");
    expect(c.mrrPln).toBe(45);
  });

  it.each(["expired", "canceled", "cancelled", "inactive", "unpaid"])(
    "dead state %s → churned",
    (status) => {
      const c = classifyTenant(
        { plan: "pro", billingStatus: status, trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 },
        NOW,
      );
      expect(c.bucket).toBe("churned");
      expect(c.mrrPln).toBe(0);
    },
  );

  it("null / unknown status → none", () => {
    expect(classifyTenant({ plan: "pro", billingStatus: null, trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, NOW).bucket).toBe("none");
    expect(classifyTenant({ plan: "pro", billingStatus: "weird", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, NOW).bucket).toBe("none");
  });

  it("paying state with unknown plan contributes 0 MRR but is still counted as paying", () => {
    const c = classifyTenant(
      { plan: "enterprise", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_X", isTest: 0 },
      NOW,
    );
    expect(c.bucket).toBe("paying");
    expect(c.mrrPln).toBe(0);
  });
});

describe("normalizeBillingStatus", () => {
  it("maps the real written vocabulary into coarse families", () => {
    expect(normalizeBillingStatus("active")).toBe("paying");
    expect(normalizeBillingStatus("grace_period")).toBe("paying");
    expect(normalizeBillingStatus("past_due")).toBe("paying");
    expect(normalizeBillingStatus("trialing")).toBe("trialing");
    expect(normalizeBillingStatus("expired")).toBe("churned");
    expect(normalizeBillingStatus("inactive")).toBe("churned");
    expect(normalizeBillingStatus("unpaid")).toBe("churned");
    expect(normalizeBillingStatus(null)).toBe("none");
    expect(normalizeBillingStatus("")).toBe("none");
  });
});

describe("getPlatformMetrics", () => {
  it("excludes test/expired/comped from MRR and separates buckets", async () => {
    // One join query returns the (already SQL is_test=0-filtered) owner+tenant rows.
    // We include a test row anyway to prove the JS classifier double-guards it.
    const rows = [
      { plan: "pro", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", isTest: 0 }, // paying +60
      { plan: "start", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_2", isTest: 0 }, // paying +45
      { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // comped (grant)
      { plan: "pro", billingStatus: "trialing", trialEndsAt: FUTURE, stripeSubscriptionId: null, isTest: 0 }, // active trial
      { plan: "pro", billingStatus: "trialing", trialEndsAt: PAST, stripeSubscriptionId: null, isTest: 0 }, // expired → churned
      { plan: "max", billingStatus: "canceled", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // churned
      { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_T", isTest: 1 }, // test → none
    ];
    const { db } = createDbMock([rows]);
    const m = await getPlatformMetrics(db, NOW);
    expect(m.paying).toBe(2);
    expect(m.mrrPln).toBe(105);
    expect(m.arrPln).toBe(105 * 12);
    expect(m.comped).toBe(1);
    expect(m.activeTrials).toBe(1);
    expect(m.churned).toBe(2);
    // ourCustomers = real (non-test) owner accounts surfaced by the join.
    expect(m.ourCustomers).toBe(6);
  });

  it("returns clean zeros when there are no real tenants", async () => {
    const { db } = createDbMock([[]]);
    const m = await getPlatformMetrics(db, NOW);
    expect(m).toMatchObject({ ourCustomers: 0, paying: 0, comped: 0, activeTrials: 0, churned: 0, mrrPln: 0, arrPln: 0 });
  });
});

describe("getTenantMetrics", () => {
  it("counts distinct clients + total + 30d appointments for one tenant", async () => {
    const { db } = createDbMock([
      [{ count: 12 }], // distinct clients
      [{ count: 40 }], // appointments total (non-cancelled)
      [{ count: 7 }], // appointments last 30d
    ]);
    const m = await getTenantMetrics(db, "t1", NOW);
    expect(m.clientsProcessed).toBe(12);
    expect(m.appointmentsTotal).toBe(40);
    expect(m.appointmentsThisMonth).toBe(7);
  });
});
