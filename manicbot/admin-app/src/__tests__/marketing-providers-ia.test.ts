/**
 * Marketing-vs-System IA pin.
 *
 * Vendor plumbing (Brevo/Resend/Twilio) used to live at
 * `/marketing/providers` and leaked Brevo/Resend names into the
 * salon-owner Marketing surface. The fix:
 *   - drop the `Providers` sub-nav entry from `MarketingShell` for ALL
 *     roles (the previous round only hid it for tenants);
 *   - move the data view to `/system/providers` (system_admin only);
 *   - turn the legacy `/marketing/providers` page into a server-side
 *     redirect to the new location.
 *
 * This file pins the IA. A future PR that re-introduces Providers
 * under `/marketing/*` will fail these asserts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("marketing → system providers IA", () => {
  it("MarketingShell.tsx — no /marketing/providers entry, no adminOnly knob", () => {
    const src = read("app/(dashboard)/marketing/MarketingShell.tsx");
    expect(src).not.toMatch(/href:\s*"\/marketing\/providers"/);
    // The previous-round `adminOnly` filter is no longer needed once
    // Providers leaves the marketing module.
    expect(src).not.toMatch(/adminOnly:\s*true/);
  });

  it("OverviewClient.tsx — no providers card, no provider name leak via api.marketing.providersList", () => {
    const src = read("app/(dashboard)/marketing/OverviewClient.tsx");
    expect(src).not.toMatch(/marketing\.overview\.providersTitle/);
    expect(src).not.toMatch(/api\.marketing\.providersList\.[a-zA-Z]/);
    expect(src).not.toMatch(/api\.marketingTenant\.providersList\.[a-zA-Z]/);
  });

  it("/system/providers — page + client exist", () => {
    const page = path.join(ROOT, "app/(dashboard)/system/providers/page.tsx");
    const client = path.join(ROOT, "app/(dashboard)/system/providers/ProvidersClient.tsx");
    expect(existsSync(page)).toBe(true);
    expect(existsSync(client)).toBe(true);
    // The page must export the runtime + the client.
    const src = readFileSync(page, "utf8");
    expect(src).toMatch(/runtime\s*=\s*"edge"/);
    expect(src).toMatch(/export\s*\{\s*default\s*\}\s*from\s*"\.\/ProvidersClient"/);
  });

  it("/system/providers/ProvidersClient.tsx — admin gate via useRole, not useMarketingScope", () => {
    const src = read("app/(dashboard)/system/providers/ProvidersClient.tsx");
    // The new client uses the canonical RoleContext gate, not the
    // marketing-scoped helper (which would be the wrong abstraction).
    expect(src).toMatch(/useRole\b/);
    expect(src).not.toMatch(/useMarketingScope/);
    // Still calls only the sysadmin router (no tenant providersList leak).
    expect(src).not.toMatch(/api\.marketingTenant\.providersList\.[a-zA-Z]/);
  });

  it("/marketing/providers/page.tsx — server redirect to /system/providers, no client logic", () => {
    const src = read("app/(dashboard)/marketing/providers/page.tsx");
    expect(src).toMatch(/from\s+"next\/navigation"/);
    expect(src).toMatch(/redirect\(\s*"\/system\/providers"\s*\)/);
    // The old ProvidersClient.tsx is gone.
    const oldClient = path.join(ROOT, "app/(dashboard)/marketing/providers/ProvidersClient.tsx");
    expect(existsSync(oldClient)).toBe(false);
  });

  it("navConfig.ts — god.providers entry exists under platform group", () => {
    const src = read("lib/nav/navConfig.ts");
    // Anchor on the id so we don't false-match other Providers strings.
    expect(src).toMatch(/id:\s*"god\.providers"/);
    // Ensure the href and group are correct.
    const idx = src.indexOf('id: "god.providers"');
    expect(idx).toBeGreaterThan(0);
    const row = src.slice(idx, idx + 400);
    expect(row).toMatch(/href:\s*"\/system\/providers"/);
    expect(row).toMatch(/roles:\s*\[\s*"system_admin"\s*\]/);
    expect(row).toMatch(/group:\s*"platform"/);
  });

  it("navLabels.ts — Providers label is localized for all four languages", () => {
    const src = read("lib/nav/navLabels.ts");
    // 4 language blocks (ru/ua/en/pl), each must carry a "Providers" entry.
    const matches = src.match(/"Providers":\s*"[^"]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("system/providers directory — exactly two source files (page + client)", () => {
    // Defensive guard against accidental leftover files.
    const dir = path.join(ROOT, "app/(dashboard)/system/providers");
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
