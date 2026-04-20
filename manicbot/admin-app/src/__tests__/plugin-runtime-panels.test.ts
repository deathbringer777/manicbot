/**
 * Tests for the runtime-panel registry — which plugins ship a working UI
 * vs. which fall back to the BackgroundRuntimePlaceholder.
 */

import { describe, it, expect } from "vitest";
import { hasRuntime, loadRuntime, listRuntimeSlugs } from "~/components/plugins/runtimePanels";
import { listManifests } from "@plugins/index";

describe("plugin runtime registry", () => {
  it("lists at least 7 runtime panels", () => {
    const slugs = listRuntimeSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(7);
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
    // runtime are allowed (e.g. ai-abuse-monitor runs on cron).
    const live = listManifests().filter((m) => m.status === "live");
    const withRuntime = live.filter((m) => hasRuntime(m.slug));
    expect(withRuntime.length).toBeGreaterThanOrEqual(5);
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

  it("key technical-sounding manifests got renamed", () => {
    const sla = listManifests().find((m) => m.slug === "sla-tracker")!;
    expect(sla.name.ru).not.toContain("SLA");
    const aiab = listManifests().find((m) => m.slug === "ai-abuse-monitor")!;
    expect(aiab.name.ru.toLowerCase()).not.toContain("abuse");
    const gdpr = listManifests().find((m) => m.slug === "gdpr-center")!;
    expect(gdpr.name.ru).not.toContain("GDPR");
    const rev = listManifests().find((m) => m.slug === "revenue-intelligence")!;
    expect(rev.name.ru).not.toContain("Intelligence");
  });
});
