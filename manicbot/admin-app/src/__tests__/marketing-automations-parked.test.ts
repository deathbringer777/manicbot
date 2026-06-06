/**
 * Regression for the PARKED Marketing → Automations tab.
 *
 * The Automations sub-tab is hidden behind MARKETING_AUTOMATIONS_ENABLED
 * (see ~/lib/featureFlags) until the cron trigger-engine is built. This test
 * pins the pure visibility helper so the tab can't silently reappear — and so
 * the other five tabs can't silently vanish — while the feature is parked.
 */

import { describe, it, expect } from "vitest";
import { MARKETING_SUB_NAV, getMarketingTabs } from "~/lib/nav/marketingTabs";
import { MARKETING_AUTOMATIONS_ENABLED } from "~/lib/featureFlags";

const AUTOMATIONS_HREF = "/marketing/automations";

describe("getMarketingTabs — parked Automations tab", () => {
  it("defines all six marketing sub-tabs in the canonical list", () => {
    expect(MARKETING_SUB_NAV).toHaveLength(6);
    expect(MARKETING_SUB_NAV.map((t) => t.href)).toContain(AUTOMATIONS_HREF);
  });

  it("hides Automations when the flag is off", () => {
    const tabs = getMarketingTabs(false);
    expect(tabs.map((t) => t.href)).not.toContain(AUTOMATIONS_HREF);
    expect(tabs).toHaveLength(5);
  });

  it("keeps the other five tabs intact, in order, when Automations is hidden", () => {
    expect(getMarketingTabs(false).map((t) => t.href)).toEqual([
      "/marketing",
      "/marketing/contacts",
      "/marketing/campaigns",
      "/marketing/sms",
      "/marketing/templates",
    ]);
  });

  it("restores Automations when the flag is unlocked", () => {
    const tabs = getMarketingTabs(true);
    expect(tabs.map((t) => t.href)).toContain(AUTOMATIONS_HREF);
    expect(tabs).toHaveLength(6);
  });

  it("is currently parked (flag off) — flip the flag only when the cron engine ships", () => {
    expect(MARKETING_AUTOMATIONS_ENABLED).toBe(false);
  });
});
