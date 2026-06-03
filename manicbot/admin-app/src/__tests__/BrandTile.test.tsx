// @vitest-environment happy-dom
/**
 * BrandTile — sidebar/header brand glyph.
 *
 * Pins the resolution priority that drives the personalized branding in
 * the shell (Settings → Salon → Logo + Masters → Avatar):
 *
 *   role=master         → master.avatarUrl > master.avatarEmoji > tenant.logo > 💅
 *   role=tenant_owner   → tenant.logo > 💅
 *   role=tenant_manager → tenant.logo > 💅
 *   role=system_admin   → 💅 (no personal salon binding)
 *   role=support        → 💅
 *
 * A photo wins the entire slot (rendered edge-to-edge). An emoji renders on
 * the neutral elevated surface used by the sidebar's other icon chips.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoleContext, type RoleContextValue } from "~/components/RoleContext";
import { BrandTile } from "~/components/layout/BrandTile";

const BASE: RoleContextValue = {
  role: null,
  tenantId: null,
  tenantName: null,
  tenantLogo: null,
  masterAvatarUrl: null,
  masterAvatarEmoji: null,
  userId: null,
  webUserId: null,
  createdAt: null,
  emailVerified: true,
  hasPassword: true,
  isPersonalTenant: false,
  isTest: false,
  permissions: [],
  billingStatus: null,
  isTrialExpired: false,
};

function renderWith(overrides: Partial<RoleContextValue>) {
  return render(
    <RoleContext.Provider value={{ ...BASE, ...overrides }}>
      <BrandTile />
    </RoleContext.Provider>,
  );
}

afterEach(() => cleanup());

describe("BrandTile — master role", () => {
  it("renders master photo when avatarUrl is set", () => {
    renderWith({
      role: "master",
      masterAvatarUrl: "https://cdn.example.com/m.jpg",
      masterAvatarEmoji: "👩",
      tenantLogo: "https://cdn.example.com/salon.png",
    });
    const photo = screen.getByTestId("brand-tile-photo");
    expect(photo).toBeTruthy();
    const img = photo.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/m.jpg");
  });

  it("falls back to master emoji when no photo set", () => {
    renderWith({
      role: "master",
      masterAvatarUrl: null,
      masterAvatarEmoji: "👸",
      tenantLogo: "https://cdn.example.com/salon.png",
    });
    expect(screen.queryByTestId("brand-tile-photo")).toBeNull();
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("👸");
  });

  it("falls back to tenant logo when master has neither photo nor emoji", () => {
    renderWith({
      role: "master",
      tenantLogo: "https://cdn.example.com/salon.png",
    });
    const photo = screen.getByTestId("brand-tile-photo");
    const img = photo.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/salon.png");
  });

  it("falls back to 💅 when nothing is set", () => {
    renderWith({ role: "master" });
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("💅");
  });
});

describe("BrandTile — tenant roles", () => {
  it("tenant_owner renders salon logo when set", () => {
    renderWith({ role: "tenant_owner", tenantLogo: "https://cdn.example.com/salon.png" });
    const photo = screen.getByTestId("brand-tile-photo");
    const img = photo.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/salon.png");
  });

  it("tenant_manager renders salon logo when set", () => {
    renderWith({ role: "tenant_manager", tenantLogo: "https://cdn.example.com/salon.png" });
    const photo = screen.getByTestId("brand-tile-photo");
    const img = photo.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/salon.png");
  });

  it("tenant_owner falls back to 💅 when no logo set", () => {
    renderWith({ role: "tenant_owner" });
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("💅");
  });

  it("tenant_owner ignores any master fields", () => {
    renderWith({
      role: "tenant_owner",
      masterAvatarUrl: "https://cdn.example.com/m.jpg",
      masterAvatarEmoji: "👸",
    });
    expect(screen.queryByTestId("brand-tile-photo")).toBeNull();
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("💅");
  });
});

describe("BrandTile — platform staff", () => {
  it("system_admin always renders 💅 even if tenant fields leak", () => {
    renderWith({
      role: "system_admin",
      tenantLogo: "https://cdn.example.com/salon.png",
      masterAvatarUrl: "https://cdn.example.com/m.jpg",
    });
    expect(screen.queryByTestId("brand-tile-photo")).toBeNull();
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("💅");
  });

  it("support always renders 💅", () => {
    renderWith({ role: "support", tenantLogo: "https://cdn.example.com/salon.png" });
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.textContent).toBe("💅");
  });
});

describe("BrandTile — styling contract", () => {
  it("photo path renders an <img>, glyph path renders a <span>", () => {
    const { unmount } = renderWith({
      role: "tenant_owner",
      tenantLogo: "https://cdn.example.com/salon.png",
    });
    const photo = screen.getByTestId("brand-tile-photo");
    expect(photo.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    unmount();
    renderWith({ role: "tenant_owner" });
    const glyph = screen.getByTestId("brand-tile-glyph");
    expect(glyph.querySelector("span")).toBeTruthy();
  });

  it("glyph tile uses theme-adaptive surface class", () => {
    renderWith({ role: "tenant_owner" });
    const glyph = screen.getByTestId("brand-tile-glyph");
    // Migrated from the #f3f4f6 literal to the semantic surface token (warm
    // muted surface inside the authed scope).
    expect(glyph.className).toContain("bg-surface-muted");
    expect(glyph.className).toContain("dark:bg-white/[0.06]");
  });
});
