/**
 * Header salon control — single source of truth (regression guard).
 *
 * Before: WebShell rendered TWO header elements — <TenantSwitcher/> (clickable
 * dropdown, 2+ memberships) AND a standalone, NON-clickable purple master
 * badge. A master who also owned a salon saw a dead pill and no way to switch
 * (the switcher was hidden by a stale listMyTenants). The badge now lives
 * INSIDE TenantSwitcher so there is exactly one salon control in the header.
 *
 * Source-level guard (mirrors shell-topbar.test.tsx) — pins the contract so a
 * future refactor can't silently re-introduce the dead twin badge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SWITCHER = readFileSync(
  join(__dirname, "..", "components", "layout", "TenantSwitcher.tsx"),
  "utf8",
);
const SHELL = readFileSync(
  join(__dirname, "..", "components", "layout", "WebShell.tsx"),
  "utf8",
);

describe("TenantSwitcher — consolidated header salon control", () => {
  it("reads role + tenantName from useRole (for the single-salon master label)", () => {
    expect(SWITCHER).toMatch(/useRole\(\)/);
    expect(SWITCHER).toMatch(/\brole\b/);
    expect(SWITCHER).toMatch(/\btenantName\b/);
  });

  it("renders a non-interactive salon label when a master has nothing to switch to", () => {
    expect(SWITCHER).toMatch(/items\.length\s*<\s*2/);
    expect(SWITCHER).toMatch(/role\s*===\s*["']master["']/);
    expect(SWITCHER).toMatch(/data-testid=["']tenant-salon-label["']/);
  });

  it("still renders the clickable switcher dropdown wired to switchTenant", () => {
    expect(SWITCHER).toMatch(/data-testid=["']tenant-switcher["']/);
    expect(SWITCHER).toMatch(/switchTenant/);
  });
});

describe("WebShell — no standalone master badge twin", () => {
  it("does not re-introduce the standalone `role === 'master' && tenantName` badge", () => {
    expect(SHELL).not.toMatch(/role\s*===\s*["']master["']\s*&&\s*tenantName/);
  });

  it("no longer imports Building2 (it was only used by that removed badge)", () => {
    expect(SHELL).not.toMatch(/\bBuilding2\b/);
  });

  it("renders the single TenantSwitcher control and the invitations section", () => {
    expect(SHELL).toMatch(/<TenantSwitcher\s*\/>/);
    expect(SHELL).toMatch(/<InvitationsNavSection/);
  });
});
