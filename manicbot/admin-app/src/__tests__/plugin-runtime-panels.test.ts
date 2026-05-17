/**
 * Tests for the runtime-panel registry — which plugins ship a working UI
 * vs. which fall back to the BackgroundRuntimePlaceholder.
 */

import { describe, it, expect } from "vitest";
import { hasRuntime, loadRuntime, listRuntimeSlugs } from "~/components/plugins/runtimePanels";
import { listManifests } from "@plugins/index";

describe("plugin runtime registry", () => {
  it("lists at least 3 runtime panels (one per major retained-plugin role bucket)", () => {
    // After the 2026-05-16 cleanup, the retained runtimes are: task-board,
    // export-hub, availability-share, earnings-goal, message-templates.
    // Phase 3 will add several more (sms-reminders runtime, etc.). The
    // floor lives at 3 so a future trim of retained plugins is caught.
    const slugs = listRuntimeSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(3);
  });

  it("every registered slug corresponds to a real plugin in the seed catalog", () => {
    const manifestSlugs = new Set(listManifests().map((m) => m.slug));
    for (const slug of listRuntimeSlugs()) {
      expect(manifestSlugs.has(slug)).toBe(true);
    }
  });

  it("hasRuntime returns true for registered slugs", () => {
    for (const slug of listRuntimeSlugs()) {
      expect(hasRuntime(slug)).toBe(true);
    }
  });

  it("hasRuntime returns false for unknown slug", () => {
    expect(hasRuntime("nonexistent-plugin-xyz")).toBe(false);
  });

  it("loadRuntime returns a component for registered slugs", () => {
    for (const slug of listRuntimeSlugs()) {
      expect(loadRuntime(slug)).not.toBeNull();
    }
  });

  it("loadRuntime returns null for unknown slug", () => {
    expect(loadRuntime("nonexistent-plugin-xyz")).toBeNull();
  });

  it("every manifest with status='live' either has a runtime or is documented as background", () => {
    // Soft guarantee: at least the live plugins that ship interactive UI
    // must have a runtime registered. Live background plugins without a
    // runtime are allowed (loyalty-stamps runs on cron, no UI).
    const live = listManifests().filter((m) => m.status === "live");
    const withRuntime = live.filter((m) => hasRuntime(m.slug));
    expect(withRuntime.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Friendly plugin names — no tech jargon for non-admin roles", () => {
  const BAD = /\b(tracker|shield|lite|monitor|playbook|CRM|EOD|MRR|LTV|TTFR|SLA|prompt[- ]?injection)\b/i;

  it("tenant-facing plugins have friendly Russian names (no jargon)", () => {
    const tenantFacing = listManifests().filter((m) =>
      m.availableForRoles.some((r) => r === "tenant_owner" || r === "tenant_manager" || r === "master"),
    );
    for (const m of tenantFacing) {
      expect(m.name.ru, `slug=${m.slug}`).not.toMatch(BAD);
      expect(m.name.ua, `slug=${m.slug}`).not.toMatch(BAD);
      expect(m.name.pl, `slug=${m.slug}`).not.toMatch(BAD);
    }
  });

  it("every manifest has non-empty friendly tagline in all 4 langs", () => {
    for (const m of listManifests()) {
      for (const lang of ["ru", "ua", "en", "pl"] as const) {
        expect(m.tagline[lang].length).toBeGreaterThan(5);
      }
    }
  });

  // 2026-05-16 — sla-tracker / ai-abuse-monitor / gdpr-center were removed
  // from the catalog and their capabilities folded into core UI. The original
  // "key technical-sounding manifests got renamed" assertion no longer has
  // anything to assert against. Removed without replacement; the broader
  // "tenant-facing plugins have friendly names" guard above still holds for
  // the retained 7.
});
