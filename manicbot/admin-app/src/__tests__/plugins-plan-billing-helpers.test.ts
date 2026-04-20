/**
 * Unit tests for the pure helpers from assertPluginEnabled.ts.
 * Full D1-integration tests for `assertPluginEnabled` live in the Sprint 1
 * tRPC test file (plugins-router.test.ts) — those need a real db.
 */

import { describe, it, expect } from "vitest";
import {
  meetsPlanGate,
  billingStateAllows,
  roleMatches,
} from "~/server/plugins/assertPluginEnabled";
import type { PluginManifest, PluginBillingState } from "@plugins/types";

describe("meetsPlanGate", () => {
  it("minPlan=any always passes", () => {
    expect(meetsPlanGate("start", "any")).toBe(true);
    expect(meetsPlanGate(null, "any")).toBe(true);
  });

  it("minPlan=start passes for start/pro/max", () => {
    expect(meetsPlanGate("start", "start")).toBe(true);
    expect(meetsPlanGate("pro", "start")).toBe(true);
    expect(meetsPlanGate("max", "start")).toBe(true);
  });

  it("minPlan=pro blocks start, allows pro/max", () => {
    expect(meetsPlanGate("start", "pro")).toBe(false);
    expect(meetsPlanGate("pro", "pro")).toBe(true);
    expect(meetsPlanGate("max", "pro")).toBe(true);
  });

  it("minPlan=max only allows max", () => {
    expect(meetsPlanGate("start", "max")).toBe(false);
    expect(meetsPlanGate("pro", "max")).toBe(false);
    expect(meetsPlanGate("max", "max")).toBe(true);
  });

  it("null/unknown plan blocks everything above any", () => {
    expect(meetsPlanGate(null, "start")).toBe(false);
    expect(meetsPlanGate("unknown", "pro")).toBe(false);
  });
});

describe("billingStateAllows", () => {
  const free: PluginManifest["billing"] = { model: "free" };
  const included: PluginManifest["billing"] = { model: "included_in_plan", featureKey: "ai" };
  const monthly: PluginManifest["billing"] = { model: "paid_addon_monthly", stripePriceIdEnv: "X" };
  const onetime: PluginManifest["billing"] = { model: "paid_addon_onetime", stripePriceIdEnv: "Y" };

  const states: PluginBillingState[] = [
    "not_applicable", "included", "paid", "trialing", "past_due", "canceled",
  ];

  it.each(states)("free plugins allow state %s except canceled", (state) => {
    expect(billingStateAllows(free, state)).toBe(state !== "canceled");
  });

  it.each(states)("included_in_plan allows state %s except canceled", (state) => {
    expect(billingStateAllows(included, state)).toBe(state !== "canceled");
  });

  it("paid_addon_monthly allows paid + trialing", () => {
    expect(billingStateAllows(monthly, "paid")).toBe(true);
    expect(billingStateAllows(monthly, "trialing")).toBe(true);
    expect(billingStateAllows(monthly, "past_due")).toBe(false);
    expect(billingStateAllows(monthly, "canceled")).toBe(false);
    expect(billingStateAllows(monthly, "not_applicable")).toBe(false);
  });

  it("paid_addon_onetime allows only paid", () => {
    expect(billingStateAllows(onetime, "paid")).toBe(true);
    expect(billingStateAllows(onetime, "trialing")).toBe(false);
    expect(billingStateAllows(onetime, "past_due")).toBe(false);
    expect(billingStateAllows(onetime, "canceled")).toBe(false);
  });
});

describe("roleMatches", () => {
  it("returns true when role is in allowed list", () => {
    expect(roleMatches("tenant_owner", ["tenant_owner", "master"])).toBe(true);
    expect(roleMatches("system_admin", ["system_admin"])).toBe(true);
  });

  it("returns false when role is not in allowed list", () => {
    expect(roleMatches("support", ["tenant_owner", "master"])).toBe(false);
  });

  it("returns false for empty allowed list", () => {
    expect(roleMatches("system_admin", [])).toBe(false);
  });
});
