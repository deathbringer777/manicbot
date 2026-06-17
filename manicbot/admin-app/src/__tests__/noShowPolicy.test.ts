import { describe, it, expect } from "vitest";
import {
  DEFAULT_NO_SHOW_POLICY,
  normalizeNoShowPolicy,
  evaluateNoShowPolicy,
  NO_SHOW_POLICY_KEY,
} from "~/server/policy/noShowPolicy";

// Admin-app twin of manicbot/test/no-show-policy.test.js — must stay in sync.
describe("noShowPolicy (admin twin)", () => {
  it("normalizes null/garbage to neutral defaults", () => {
    expect(normalizeNoShowPolicy(null)).toEqual(DEFAULT_NO_SHOW_POLICY);
    expect(normalizeNoShowPolicy({ notifyTone: "wat", prepayment: "btc" })).toMatchObject({
      notifyTone: "neutral",
      prepayment: "none",
    });
  });

  it("clamps graceMinutes into [0,240]", () => {
    expect(normalizeNoShowPolicy({ graceMinutes: 9999 }).graceMinutes).toBe(240);
    expect(normalizeNoShowPolicy({ graceMinutes: -1 }).graceMinutes).toBe(0);
  });

  it("allows a client with no prior no-shows", () => {
    expect(evaluateNoShowPolicy(null, { noShowCount: 0 }).decision).toBe("allow");
  });

  it("warns (no enforcement) below threshold", () => {
    const r = evaluateNoShowPolicy({ afterCount: 3, autoAction: "auto_block" }, { noShowCount: 2 });
    expect(r.decision).toBe("warn");
    expect(r.triggered).toBe(false);
  });

  it("escalates with correct precedence at/above threshold", () => {
    expect(evaluateNoShowPolicy({ afterCount: 2, prepayment: "deposit50" }, { noShowCount: 2 }).decision)
      .toBe("require_prepayment");
    expect(evaluateNoShowPolicy({ afterCount: 2, prepayment: "deposit50", autoAction: "auto_block" }, { noShowCount: 2 }).decision)
      .toBe("blocked");
    expect(evaluateNoShowPolicy({ afterCount: 2, autoAction: "require_confirm" }, { noShowCount: 2 }).decision)
      .toBe("require_confirm");
  });

  it("exposes the tenant_config key", () => {
    expect(NO_SHOW_POLICY_KEY).toBe("no_show_policy");
  });
});
