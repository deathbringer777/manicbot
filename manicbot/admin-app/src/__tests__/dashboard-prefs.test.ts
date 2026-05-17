import { describe, it, expect } from "vitest";
import { applyTabPrefs, MAX_PINNED_TABS } from "~/lib/useDashboardPrefs";

const ALL = ["overview", "appointments", "services", "masters", "clients", "billing", "channels", "analytics", "reviews", "marketing"];

describe("applyTabPrefs", () => {
  it("returns input order when no prefs are set", () => {
    expect(applyTabPrefs(ALL, { tabOrder: [], pinnedTabs: [], hiddenTabs: [] })).toEqual(ALL);
  });

  it("filters out hidden tabs by default", () => {
    const out = applyTabPrefs(ALL, { tabOrder: [], pinnedTabs: [], hiddenTabs: ["analytics", "marketing"] });
    expect(out).not.toContain("analytics");
    expect(out).not.toContain("marketing");
    expect(out).toContain("clients");
  });

  it("keeps alwaysVisible tabs even when listed as hidden", () => {
    const out = applyTabPrefs(ALL, { tabOrder: [], pinnedTabs: [], hiddenTabs: ["overview"] }, { alwaysVisible: ["overview"] });
    expect(out[0]).toBe("overview");
  });

  it("pinned tabs come first and in pin-order", () => {
    const out = applyTabPrefs(ALL, { tabOrder: [], pinnedTabs: ["marketing", "billing"], hiddenTabs: [] });
    expect(out.slice(0, 2)).toEqual(["marketing", "billing"]);
  });

  it("non-pinned ordered tabs come after pins", () => {
    const out = applyTabPrefs(ALL, {
      tabOrder: ["channels", "services"],
      pinnedTabs: ["marketing"],
      hiddenTabs: [],
    });
    expect(out.slice(0, 3)).toEqual(["marketing", "channels", "services"]);
  });

  it("unrecognised ids are dropped from order / pins", () => {
    const out = applyTabPrefs(ALL, {
      tabOrder: ["ghost-tab", "services"],
      pinnedTabs: ["bogus", "marketing"],
      hiddenTabs: [],
    });
    expect(out).not.toContain("ghost-tab");
    expect(out).not.toContain("bogus");
    expect(out[0]).toBe("marketing");
  });

  it("tabs not mentioned anywhere keep definition order at the end", () => {
    const out = applyTabPrefs(ALL, {
      tabOrder: ["channels"],
      pinnedTabs: ["marketing"],
      hiddenTabs: [],
    });
    // pinned: marketing; ordered: channels; remaining: overview, appointments, services, masters, clients, billing, analytics, reviews
    expect(out).toEqual([
      "marketing",
      "channels",
      "overview", "appointments", "services", "masters", "clients", "billing", "analytics", "reviews",
    ]);
  });

  it("can disable hidden filter (for the Appearance editor itself)", () => {
    const out = applyTabPrefs(ALL, { tabOrder: [], pinnedTabs: [], hiddenTabs: ["analytics"] }, { applyHidden: false });
    expect(out).toContain("analytics");
  });

  it("MAX_PINNED_TABS is 5", () => {
    expect(MAX_PINNED_TABS).toBe(5);
  });
});
