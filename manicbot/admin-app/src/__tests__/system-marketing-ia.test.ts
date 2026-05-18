/**
 * Marketing IA pin: salon-owner surface (`/marketing/*`) vs platform marketing
 * center (`/system/marketing/*`).
 *
 * Pre-Phase-1, `god.marketing` nav entry pointed to `/marketing` — the same
 * URL the salon-owner uses. `useMarketingScope` silently flipped sysadmin's
 * view to cross-tenant data on that URL, so the separation between the two
 * audiences was invisible in the IA. Phase 1 of the marketing roadmap splits
 * them apart:
 *
 *   - `god.marketing` now points to `/system/marketing` (sysadmin-only
 *     platform-marketing center alongside `/system/providers` and `/system`);
 *   - `salon.marketing` continues to point to `/marketing` (unchanged);
 *   - `MarketingShell` renders a redirect banner to `/system/marketing` when
 *     a sysadmin is on `/marketing` without an active tenant preview.
 *
 * This file pins the contract. A future PR that re-merges the surfaces or
 * accidentally links the sysadmin nav back into the tenant URL will fail
 * these asserts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("system/marketing IA pin", () => {
  it("navConfig — god.marketing points to /system/marketing under platform group", () => {
    const src = read("lib/nav/navConfig.ts");
    const idx = src.indexOf('id: "god.marketing"');
    expect(idx).toBeGreaterThan(0);
    const row = src.slice(idx, idx + 400);
    expect(row).toMatch(/href:\s*"\/system\/marketing"/);
    expect(row).toMatch(/roles:\s*\[\s*"system_admin"\s*\]/);
    expect(row).toMatch(/group:\s*"platform"/);
  });

  it("navConfig — salon.marketing still points to /marketing", () => {
    const src = read("lib/nav/navConfig.ts");
    const idx = src.indexOf('id: "salon.marketing"');
    expect(idx).toBeGreaterThan(0);
    const row = src.slice(idx, idx + 400);
    expect(row).toMatch(/href:\s*"\/marketing"/);
    expect(row).toMatch(/roles:\s*\[\s*"tenant_owner"\s*\]/);
  });

  it("/system/marketing — page.tsx + SystemMarketingClient.tsx exist with the standard shape", () => {
    const page = path.join(ROOT, "app/(dashboard)/system/marketing/page.tsx");
    const client = path.join(ROOT, "app/(dashboard)/system/marketing/SystemMarketingClient.tsx");
    expect(existsSync(page)).toBe(true);
    expect(existsSync(client)).toBe(true);
    const src = readFileSync(page, "utf8");
    expect(src).toMatch(/runtime\s*=\s*"edge"/);
    expect(src).toMatch(/export\s*\{\s*default\s*\}\s*from\s*"\.\/SystemMarketingClient"/);
  });

  it("SystemMarketingClient — admin gate via useRole, calls api.marketing.* and never marketingTenant", () => {
    const src = read("app/(dashboard)/system/marketing/SystemMarketingClient.tsx");
    expect(src).toMatch(/useRole\b/);
    // Sysadmin surface ONLY hits the cross-tenant router.
    expect(src).toMatch(/api\.marketing\.[a-zA-Z]/);
    expect(src).not.toMatch(/api\.marketingTenant\.[a-zA-Z]/);
    // Must not use the scope-helper (that's for the dual-mode tenant surface).
    expect(src).not.toMatch(/useMarketingScope/);
  });

  it("/system/marketing sub-pages — campaigns + leads + sends each have page.tsx + dedicated client", () => {
    // Phase 1 shipped Overview / Campaigns / Leads. Phase 2B adds Sends
    // alongside the Resend webhook that closes the delivery loop on
    // `marketing_sends` (delivered / opened / clicked / bounced / complained).
    const sub = [
      { slug: "campaigns", client: "SystemMarketingCampaignsClient" },
      { slug: "leads", client: "SystemMarketingLeadsClient" },
      { slug: "sends", client: "SystemMarketingSendsClient" },
    ];
    for (const { slug, client } of sub) {
      const page = path.join(ROOT, `app/(dashboard)/system/marketing/${slug}/page.tsx`);
      const clientPath = path.join(ROOT, `app/(dashboard)/system/marketing/${slug}/${client}.tsx`);
      expect(existsSync(page), `missing /system/marketing/${slug}/page.tsx`).toBe(true);
      expect(existsSync(clientPath), `missing ${client}.tsx`).toBe(true);
      const src = readFileSync(page, "utf8");
      expect(src).toMatch(/runtime\s*=\s*"edge"/);
      expect(src).toMatch(new RegExp(`export\\s*\\{\\s*default\\s*\\}\\s*from\\s*"\\./${client}"`));
      // Each sub-client must hit api.marketing.*, never the tenant router.
      const clientSrc = readFileSync(clientPath, "utf8");
      expect(clientSrc).not.toMatch(/api\.marketingTenant\.[a-zA-Z]/);
    }
  });

  it("SystemMarketingShell — sub-nav stays scoped under /system/marketing", () => {
    const src = read("app/(dashboard)/system/marketing/SystemMarketingShell.tsx");
    // Must not link to the tenant surface.
    expect(src).not.toMatch(/href:\s*"\/marketing"/);
    expect(src).not.toMatch(/href:\s*"\/marketing\//);
    // Overview + the two sub-routes.
    expect(src).toMatch(/href:\s*"\/system\/marketing"/);
    expect(src).toMatch(/href:\s*"\/system\/marketing\/campaigns"/);
    expect(src).toMatch(/href:\s*"\/system\/marketing\/leads"/);
    expect(src).toMatch(/href:\s*"\/system\/marketing\/sends"/);
  });

  it("MarketingShell — banner link points sysadmin-without-preview to /system/marketing", () => {
    const src = read("app/(dashboard)/marketing/MarketingShell.tsx");
    // The banner is rendered when useMarketingScope reports admin mode.
    // The string must be present in source for the redirect to be reachable.
    expect(src).toMatch(/\/system\/marketing/);
  });

  it("navLabels — 'Marketing Center' label is localized in all four languages", () => {
    const src = read("lib/nav/navLabels.ts");
    const matches = src.match(/"Marketing Center":\s*"[^"]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("system/marketing directory exists", () => {
    const dir = path.join(ROOT, "app/(dashboard)/system/marketing");
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
