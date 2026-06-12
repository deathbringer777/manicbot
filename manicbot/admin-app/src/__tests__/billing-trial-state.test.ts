import { describe, it, expect } from "vitest";
import {
  evaluateTrialState,
  shouldShowBillingGate,
  isBillingGatedRole,
  isGateBypassPath,
  isCompedTenant,
} from "~/lib/billing/trialState";

const NOW = 1_700_000_000; // arbitrary fixed Unix seconds

describe("evaluateTrialState — lazy flip", () => {
  it("flips trialing → inactive when trialEndsAt is in the past", () => {
    const r = evaluateTrialState(
      { billingStatus: "trialing", trialEndsAt: NOW - 86400, stripeCustomerId: null },
      NOW,
    );
    expect(r.effectiveBillingStatus).toBe("inactive");
    expect(r.shouldPersistFlip).toBe(true);
    expect(r.isTrialExpired).toBe(true);
  });

  it("does NOT flip when trial is still running", () => {
    const r = evaluateTrialState(
      { billingStatus: "trialing", trialEndsAt: NOW + 86400, stripeCustomerId: null },
      NOW,
    );
    expect(r.effectiveBillingStatus).toBe("trialing");
    expect(r.shouldPersistFlip).toBe(false);
    expect(r.isTrialExpired).toBe(false);
  });

  it("does NOT flip when trialEndsAt is missing (defensive)", () => {
    const r = evaluateTrialState(
      { billingStatus: "trialing", trialEndsAt: null, stripeCustomerId: null },
      NOW,
    );
    expect(r.shouldPersistFlip).toBe(false);
    expect(r.isTrialExpired).toBe(false);
  });

  it("does NOT mark isTrialExpired for active paying tenants", () => {
    const r = evaluateTrialState(
      { billingStatus: "active", trialEndsAt: NOW - 86400, stripeCustomerId: "cus_123" },
      NOW,
    );
    expect(r.isTrialExpired).toBe(false);
  });

  it("LOCKS a churned paying customer (inactive + had a Stripe customer)", () => {
    // billingStatus=inactive AND a Stripe customer exists — they paid before and
    // lapsed (cancelled/period-ended). The old behaviour left their dashboard
    // fully open forever; now they are locked just like an expired trial.
    const r = evaluateTrialState(
      { billingStatus: "inactive", trialEndsAt: NOW - 86400, stripeCustomerId: "cus_456", stripeSubscriptionId: null },
      NOW,
    );
    expect(r.isTrialExpired).toBe(true);
  });

  it("marks isTrialExpired when status is already inactive and no Stripe customer (cron-flipped case)", () => {
    const r = evaluateTrialState(
      { billingStatus: "inactive", trialEndsAt: NOW - 86400 * 10, stripeCustomerId: null },
      NOW,
    );
    expect(r.shouldPersistFlip).toBe(false);
    expect(r.isTrialExpired).toBe(true);
  });

  it("LOCKS a canceled subscription", () => {
    const r = evaluateTrialState(
      { billingStatus: "canceled", trialEndsAt: null, stripeCustomerId: "cus_y", stripeSubscriptionId: "sub_y" },
      NOW,
    );
    expect(r.isTrialExpired).toBe(true);
  });

  it("does NOT lock an active paying subscription", () => {
    const r = evaluateTrialState(
      { billingStatus: "active", trialEndsAt: null, stripeCustomerId: "cus_z", stripeSubscriptionId: "sub_z" },
      NOW,
    );
    expect(r.isTrialExpired).toBe(false);
  });

  it("does NOT lock a comped grant (active, no subscription, no trial) even past currentPeriodEnd", () => {
    // The 4 free MAX grants in prod: active + no Stripe subscription + no trial.
    // They must stay open — never auto-locked.
    const r = evaluateTrialState(
      { billingStatus: "active", trialEndsAt: null, stripeCustomerId: "cus_demo", stripeSubscriptionId: null },
      NOW,
    );
    expect(r.isTrialExpired).toBe(false);
    expect(isCompedTenant({ billingStatus: "active", trialEndsAt: null, stripeCustomerId: "cus_demo", stripeSubscriptionId: null })).toBe(true);
  });
});

describe("isCompedTenant", () => {
  it("is true for a free grant: active + no subscription + no trial", () => {
    expect(isCompedTenant({ billingStatus: "active", trialEndsAt: null, stripeCustomerId: null, stripeSubscriptionId: null })).toBe(true);
    // Demo grant variant: customer exists but still no subscription.
    expect(isCompedTenant({ billingStatus: "active", trialEndsAt: null, stripeCustomerId: "cus_demo", stripeSubscriptionId: null })).toBe(true);
  });

  it("is false for a real paying subscription", () => {
    expect(isCompedTenant({ billingStatus: "active", trialEndsAt: null, stripeCustomerId: "cus_p", stripeSubscriptionId: "sub_p" })).toBe(false);
  });

  it("is false for a trial (trialEndsAt set)", () => {
    expect(isCompedTenant({ billingStatus: "trialing", trialEndsAt: NOW + 1000, stripeCustomerId: null, stripeSubscriptionId: null })).toBe(false);
    // active but with a trial timestamp still set is not a comp
    expect(isCompedTenant({ billingStatus: "active", trialEndsAt: NOW + 1000, stripeCustomerId: null, stripeSubscriptionId: null })).toBe(false);
  });

  it("is false for inactive / canceled", () => {
    expect(isCompedTenant({ billingStatus: "inactive", trialEndsAt: null, stripeCustomerId: null, stripeSubscriptionId: null })).toBe(false);
    expect(isCompedTenant({ billingStatus: "canceled", trialEndsAt: null, stripeCustomerId: null, stripeSubscriptionId: null })).toBe(false);
  });

  it("defaults to trialing when billingStatus is null (fresh tenants pre-cron)", () => {
    const r = evaluateTrialState(
      { billingStatus: null, trialEndsAt: NOW + 86400, stripeCustomerId: null },
      NOW,
    );
    expect(r.effectiveBillingStatus).toBe("trialing");
    expect(r.isTrialExpired).toBe(false);
  });
});

describe("isBillingGatedRole", () => {
  it("gates tenant_owner / tenant_manager / master", () => {
    expect(isBillingGatedRole("tenant_owner")).toBe(true);
    expect(isBillingGatedRole("tenant_manager")).toBe(true);
    expect(isBillingGatedRole("master")).toBe(true);
  });

  it("does NOT gate platform staff", () => {
    expect(isBillingGatedRole("system_admin")).toBe(false);
    expect(isBillingGatedRole("support")).toBe(false);
    expect(isBillingGatedRole("technical_support")).toBe(false);
  });

  it("does NOT gate unauthenticated", () => {
    expect(isBillingGatedRole(null)).toBe(false);
  });
});

describe("isGateBypassPath", () => {
  it("blocks /billing — god-mode page, NOT the tenant resolve path (DC-14)", () => {
    // The tenant-facing billing UI lives at /settings?section=billing (the
    // BillingGate CTAs route there). /billing is not in
    // FULL_PAGE_ROUTE_PREFIXES, so for a gated tenant role it swaps in
    // SalonDashboard — listing it as a bypass rendered the FULL dashboard
    // for a locked tenant who simply typed /billing in the URL bar.
    expect(isGateBypassPath("/billing")).toBe(false);
    expect(isGateBypassPath("/billing/invoices")).toBe(false);
  });

  it("allows /settings (account escape hatch)", () => {
    expect(isGateBypassPath("/settings")).toBe(true);
    expect(isGateBypassPath("/settings?section=account")).toBe(false); // path only, query handled by Next router
  });

  it("allows /plugins and /plugin/* (unsubscribe from paid add-ons)", () => {
    expect(isGateBypassPath("/plugins")).toBe(true);
    expect(isGateBypassPath("/plugins/marketing")).toBe(true);
    expect(isGateBypassPath("/plugin/marketing")).toBe(true);
  });

  it("blocks dashboard / appointments / masters / channels / etc.", () => {
    expect(isGateBypassPath("/")).toBe(false);
    expect(isGateBypassPath("/dashboard")).toBe(false);
    expect(isGateBypassPath("/appointments")).toBe(false);
    expect(isGateBypassPath("/channels")).toBe(false);
    expect(isGateBypassPath("/marketing")).toBe(false);
  });
});

describe("shouldShowBillingGate — integration of role + state + path", () => {
  it("shows gate: tenant_owner with expired trial on /dashboard", () => {
    expect(
      shouldShowBillingGate({ role: "tenant_owner", isTrialExpired: true, pathname: "/dashboard" }),
    ).toBe(true);
  });

  it("shows gate: tenant_owner with expired trial on /billing (DC-14 regression)", () => {
    expect(
      shouldShowBillingGate({ role: "tenant_owner", isTrialExpired: true, pathname: "/billing" }),
    ).toBe(true);
  });

  it("hides gate: tenant_owner with expired trial on /settings", () => {
    expect(
      shouldShowBillingGate({ role: "tenant_owner", isTrialExpired: true, pathname: "/settings" }),
    ).toBe(false);
  });

  it("hides gate: master on personal tenant with active trial", () => {
    expect(
      shouldShowBillingGate({ role: "master", isTrialExpired: false, pathname: "/dashboard" }),
    ).toBe(false);
  });

  it("hides gate: system_admin even with isTrialExpired=true (impossible state, but defensive)", () => {
    expect(
      shouldShowBillingGate({ role: "system_admin", isTrialExpired: true, pathname: "/dashboard" }),
    ).toBe(false);
  });

  it("hides gate: support staff", () => {
    expect(
      shouldShowBillingGate({ role: "support", isTrialExpired: true, pathname: "/dashboard" }),
    ).toBe(false);
  });

  it("hides gate: unauthenticated (covered by login redirect upstream)", () => {
    expect(
      shouldShowBillingGate({ role: null, isTrialExpired: true, pathname: "/dashboard" }),
    ).toBe(false);
  });

  it("shows gate: tenant_manager with expired trial on /marketing", () => {
    expect(
      shouldShowBillingGate({ role: "tenant_manager", isTrialExpired: true, pathname: "/marketing" }),
    ).toBe(true);
  });

  it("shows gate: master with expired trial on personal-tenant /appointments", () => {
    expect(
      shouldShowBillingGate({ role: "master", isTrialExpired: true, pathname: "/appointments" }),
    ).toBe(true);
  });
});
