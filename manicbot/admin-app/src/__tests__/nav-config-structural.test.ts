/**
 * Nav-config + IA structural pin.
 *
 * Phase 2 cleanup — replaces marketing-providers-ia.test.ts (and absorbs the
 * navConfig-structural assertions that previously lived inside several
 * separate IA-style files).
 *
 * Single source of truth for:
 *   • Marketing-vs-System Providers IA (vendor plumbing lives at
 *     /system/providers, NOT inside MarketingShell).
 *   • Per-role nav entry roster (god.*, salon.*, master.*, support.*).
 *   • Group + role + URL invariants for every navConfig entry.
 *
 * A future PR that re-introduces Providers under /marketing/* — OR adds a
 * platform-only entry under the salon-owner group — will fail these asserts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { NAV_ITEMS, SETTINGS_ITEM } from "~/lib/nav/navConfig";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ─── (1) Marketing → System Providers IA pin ──────────────────────────────────

describe("marketing → system providers IA", () => {
  it("MarketingShell.tsx — no /marketing/providers entry, no adminOnly knob", () => {
    const src = read("app/(dashboard)/marketing/MarketingShell.tsx");
    expect(src).not.toMatch(/href:\s*"\/marketing\/providers"/);
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
    const src = readFileSync(page, "utf8");
    expect(src).toMatch(/runtime\s*=\s*"edge"/);
    expect(src).toMatch(/export\s*\{\s*default\s*\}\s*from\s*"\.\/ProvidersClient"/);
  });

  it("/system/providers/ProvidersClient.tsx — admin gate via useRole, not useMarketingScope", () => {
    const src = read("app/(dashboard)/system/providers/ProvidersClient.tsx");
    expect(src).toMatch(/useRole\b/);
    expect(src).not.toMatch(/useMarketingScope/);
    expect(src).not.toMatch(/api\.marketingTenant\.providersList\.[a-zA-Z]/);
  });

  it("/marketing/providers/page.tsx — server redirect to /system/providers, no client logic", () => {
    const src = read("app/(dashboard)/marketing/providers/page.tsx");
    expect(src).toMatch(/from\s+"next\/navigation"/);
    expect(src).toMatch(/redirect\(\s*"\/system\/providers"\s*\)/);
    const oldClient = path.join(ROOT, "app/(dashboard)/marketing/providers/ProvidersClient.tsx");
    expect(existsSync(oldClient)).toBe(false);
  });

  it("system/providers directory — exists with both source files", () => {
    const dir = path.join(ROOT, "app/(dashboard)/system/providers");
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});

// ─── (2) navConfig entries — every row obeys the shape contract ───────────────

describe("navConfig structural invariants", () => {
  it("every entry has id, href, icon, labelKey, roles array, non-empty roles", () => {
    for (const item of NAV_ITEMS) {
      expect(item.id, `entry ${item.id ?? "?"}: id is empty`).toBeTruthy();
      expect(item.href, `entry ${item.id}: href is empty`).toBeTruthy();
      expect(item.icon, `entry ${item.id}: icon is empty`).toBeTruthy();
      expect(item.labelKey, `entry ${item.id}: labelKey is empty`).toBeTruthy();
      expect(Array.isArray(item.roles), `entry ${item.id}: roles is not array`).toBe(true);
      expect(item.roles.length, `entry ${item.id}: roles is empty`).toBeGreaterThan(0);
    }
  });

  it("ids are unique across NAV_ITEMS", () => {
    const seen = new Set<string>();
    for (const item of NAV_ITEMS) {
      expect(seen.has(item.id), `duplicate id: ${item.id}`).toBe(false);
      seen.add(item.id);
    }
  });

  it("god.* entries are system_admin only", () => {
    for (const item of NAV_ITEMS) {
      if (item.id.startsWith("god.")) {
        expect(item.roles, `god.* leak: ${item.id}`).toEqual(["system_admin"]);
      }
    }
  });

  it("salon.* entries are tenant_owner only", () => {
    for (const item of NAV_ITEMS) {
      if (item.id.startsWith("salon.")) {
        expect(item.roles, `salon.* role mismatch: ${item.id}`).toContain("tenant_owner");
      }
    }
  });

  it("master.* entries are master only", () => {
    for (const item of NAV_ITEMS) {
      if (item.id.startsWith("master.")) {
        expect(item.roles, `master.* role mismatch: ${item.id}`).toEqual(["master"]);
      }
    }
  });

  it("support.* entries serve both support roles", () => {
    for (const item of NAV_ITEMS) {
      if (item.id.startsWith("support.")) {
        expect(item.roles, `support.* role mismatch: ${item.id}`).toEqual([
          "support",
          "technical_support",
        ]);
      }
    }
  });
});

// ─── (3) god.providers — exact placement (security-sensitive) ─────────────────

describe("god.providers entry — placement + role gate", () => {
  it("exists in NAV_ITEMS", () => {
    const row = NAV_ITEMS.find((i) => i.id === "god.providers");
    expect(row, "god.providers entry missing").toBeDefined();
  });

  it("href = /system/providers, group = platform, roles = [system_admin]", () => {
    const row = NAV_ITEMS.find((i) => i.id === "god.providers")!;
    expect(row.href).toBe("/system/providers");
    expect(row.group).toBe("platform");
    expect(row.roles).toEqual(["system_admin"]);
  });
});

// ─── (4) god.marketing — moved from /marketing to /system/marketing ───────────

describe("god.marketing entry — points to /system/marketing", () => {
  it("href = /system/marketing, group = platform", () => {
    const row = NAV_ITEMS.find((i) => i.id === "god.marketing");
    expect(row, "god.marketing entry missing").toBeDefined();
    expect(row!.href).toBe("/system/marketing");
    expect(row!.group).toBe("platform");
  });
});

// ─── (5) SETTINGS_ITEM — common across every role ─────────────────────────────

describe("SETTINGS_ITEM — common across every role", () => {
  it("includes all 5 first-class roles", () => {
    expect(SETTINGS_ITEM.id).toBe("common.settings");
    expect(SETTINGS_ITEM.roles).toEqual(
      expect.arrayContaining([
        "system_admin",
        "tenant_owner",
        "master",
        "support",
        "technical_support",
      ]),
    );
  });
});

// ─── (6) navLabels — all four locales carry every labelKey used by NAV_ITEMS ──

describe("navLabels structural pin", () => {
  it("Providers label is localized for all four languages", () => {
    const src = read("lib/nav/navLabels.ts");
    const matches = src.match(/"Providers":\s*"[^"]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
