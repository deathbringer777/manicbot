import { describe, it, expect } from "vitest";
import {
  evaluateTrialState,
  shouldShowBillingGate,
  isBillingGatedRole,
  isGateBypassPath,
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

  it("does NOT mark isTrialExpired when tenant has a Stripe customer (in grace, churned, etc.)", () => {
    // billingStatus=inactive but they paid before — BillingSection treats this
    // as a churned customer, not an expired-trial gate trigger.
    const r = evaluateTrialState(
      { billingStatus: "inactive", trialEndsAt: NOW - 86400, stripeCustomerId: "cus_456" },
      NOW,
    );
    expect(r.isTrialExpired).toBe(false);
  });

  it("marks isTrialExpired when status is already inactive and no Stripe customer (cron-flipped case)", () => {
    const r = evaluateTrialState(
      { billingStatus: "inactive", trialEndsAt: NOW - 86400 * 10, stripeCustomerId: null },
      NOW,
    );
    expect(r.shouldPersistFlip).toBe(false);
    expect(r.isTrialExpired).toBe(true);
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
  it("allows /billing (the only place to fix the gate)", () => {
    expect(isGateBypassPath("/billing")).toBe(true);
    expect(isGateBypassPath("/billing/invoices")).toBe(true);
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

  it("hides gate: tenant_owner with expired trial on /billing", () => {
    expect(
      shouldShowBillingGate({ role: "tenant_owner", isTrialExpired: true, pathname: "/billing" }),
    ).toBe(false);
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
