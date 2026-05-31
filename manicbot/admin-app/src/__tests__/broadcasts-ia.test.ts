/**
 * IA + isolation guard for the God-Mode «Рассылки» surface.
 *
 * The broadcasts panel must live under /system/* (system_admin-only by URL
 * convention + shell re-gate) and must NOT leak into the tenant-facing
 * /marketing surface — otherwise a salon owner could reach operator→tenant
 * tooling.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(import.meta.dirname, "..", p), "utf8");

describe("broadcasts IA", () => {
  it("is registered in the God-Mode marketing sub-nav under /system/*", () => {
    const shell = read("app/(dashboard)/system/marketing/SystemMarketingShell.tsx");
    expect(shell).toContain("/system/marketing/broadcasts");
    expect(shell).toContain("Рассылки");
  });

  it("page.tsx is an edge shim re-exporting the client", () => {
    const page = read("app/(dashboard)/system/marketing/broadcasts/page.tsx");
    expect(page).toMatch(/runtime\s*=\s*["']edge["']/);
    expect(page).toMatch(/export\s*\{\s*default\s*\}\s*from\s*["']\.\/BroadcastsClient["']/);
  });

  it("client wraps SystemMarketingShell and talks only to api.platformBroadcasts", () => {
    const client = read("app/(dashboard)/system/marketing/broadcasts/BroadcastsClient.tsx");
    expect(client).toContain("SystemMarketingShell");
    expect(client).toContain("api.platformBroadcasts.");
    // Must NOT pull in the tenant-facing marketing surface.
    expect(client).not.toMatch(/useMarketingScope/);
    expect(client).not.toMatch(/api\.marketingTenant\b/);
  });

  it("no tenant-role nav exposes a /system/marketing route", () => {
    // The dashboard sidebar config must never route tenant users into /system/*.
    const navCandidates = [
      "components/layout/navConfig.ts",
      "lib/nav/navConfig.ts",
      "components/layout/Sidebar.tsx",
    ];
    for (const rel of navCandidates) {
      let src = "";
      try { src = read(rel); } catch { continue; }
      // If a nav file references /system/marketing, it must be under a
      // system_admin gate — we conservatively assert tenant role arrays don't
      // include the broadcasts route literal.
      expect(src).not.toContain("/system/marketing/broadcasts");
    }
  });
});
