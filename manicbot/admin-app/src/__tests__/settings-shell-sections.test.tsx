// @vitest-environment happy-dom
/**
 * Section-contract lock for `/settings`.
 *
 * The "8 sections for tenant_owner with top-tab nav" structure is the
 * headline ask of PR #92 — these tests fail if anyone silently drops one of
 * the sections, swaps roles, or regresses the layout to a left-rail.
 *
 * The shell is rendered with each role; we assert (a) the exact section set
 * by data-section-id and (b) that the strip is rendered as a horizontal
 * scrollable bar (top-tab, not left-rail).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

import { SettingsShell } from "~/components/settings/SettingsShell";
import { RoleContext, type RoleContextValue } from "~/components/RoleContext";
import type { AppRole } from "~/server/api/routers/auth";
import { LangContext } from "~/components/LangContext";

beforeAll(() => {
  // Stub IntersectionObserver / ResizeObserver — happy-dom is missing them.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

function roleValue(role: AppRole): RoleContextValue {
  return {
    role,
    tenantId: "t_demo",
    tenantName: "Demo",
        tenantLogo: null,
        masterAvatarUrl: null,
        masterAvatarEmoji: null,
    userId: 1,
    webUserId: "owner-uid",
    createdAt: 0,
    hasPassword: true,
    emailVerified: true,
    isPersonalTenant: false,
    permissions: [],
    billingStatus: "active",
    isTrialExpired: false,
    previewRole: null,
    previewTenantId: null,
    setPreviewRole: () => {},
    previewMasterId: null,
    previewMasterWebUserId: null,
    setPreviewMaster: () => {},
  };
}

function mount(role: AppRole) {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <RoleContext.Provider value={roleValue(role)}>
        <SettingsShell activeSection="account" onSectionChange={() => {}}>
          <div data-testid="content" />
        </SettingsShell>
      </RoleContext.Provider>
    </LangContext.Provider>,
  );
}

function sectionIds() {
  return Array.from(document.querySelectorAll("[data-section-id]")).map(
    (el) => el.getAttribute("data-section-id")!,
  );
}

describe("SettingsShell — section contract by role", () => {
  afterEach(cleanup);

  it("tenant_owner sees the 10 headline sections in order (notifications between billing and appearance)", () => {
    mount("tenant_owner");
    expect(sectionIds()).toEqual([
      "account",
      "salon",
      "public",
      "team",
      "channels",
      "billing",
      "notifications",
      "appearance",
      "referrals",
      "help",
    ]);
  });

  it("tenant_manager inherits the tenant_owner section set", () => {
    mount("tenant_manager");
    expect(sectionIds()).toEqual([
      "account",
      "salon",
      "public",
      "team",
      "channels",
      "billing",
      "notifications",
      "appearance",
      "referrals",
      "help",
    ]);
  });

  it("master sees a 5-section subset including profile + notifications", () => {
    mount("master");
    expect(sectionIds()).toEqual(["account", "profile", "notifications", "appearance", "help"]);
  });

  it("support sees account / notifications / appearance / help", () => {
    mount("support");
    expect(sectionIds()).toEqual(["account", "notifications", "appearance", "help"]);
  });

  it("technical_support sees account / notifications / appearance / help", () => {
    mount("technical_support");
    expect(sectionIds()).toEqual(["account", "notifications", "appearance", "help"]);
  });

  it("system_admin sees account/notifications/appearance/help/platform (no billing in God Mode)", () => {
    mount("system_admin");
    expect(sectionIds()).toEqual(["account", "notifications", "appearance", "help", "platform"]);
  });
});

describe("SettingsShell — layout discipline", () => {
  afterEach(cleanup);

  it("renders a horizontal scrollable strip (top-tab), not a left rail", () => {
    mount("tenant_owner");
    // The scroll container is the parent of all section buttons. It must
    // have overflow-x-auto applied (Tailwind class). A left-rail layout
    // would use w-56 instead.
    const firstBtn = document.querySelector("[data-section-id]");
    expect(firstBtn).toBeTruthy();
    const scrollParent = firstBtn!.parentElement!;
    expect(scrollParent.className).toMatch(/overflow-x-auto/);
    // Not w-56 (the previous left-rail width)
    expect(document.body.innerHTML).not.toMatch(/w-56/);
  });
});

