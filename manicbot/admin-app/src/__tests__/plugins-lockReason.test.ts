/**
 * Pure tests for `computeLockReason`.
 * Covers: coming_soon precedence, role_mismatch, plan_gate, platform_only.
 */

import { describe, it, expect } from "vitest";
import { computeLockReason } from "~/server/plugins/lockReason";
import type { PluginManifest, PluginRole } from "@plugins/types";

function m(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    slug: "x",
    version: "1.0.0",
    vendor: "manicbot",
    category: "productivity",
    status: "live",
    scope: "tenant",
    icon: { name: "Package", tint: "#3b82f6" },
    name: { ru: "X", ua: "X", en: "X", pl: "X" },
    tagline: { ru: "x", ua: "x", en: "x", pl: "x" },
    description: { ru: "x", ua: "x", en: "x", pl: "x" },
    keywords: { ru: ["x"], ua: ["x"], en: ["x"], pl: ["x"] },
    availableForRoles: ["tenant_owner"],
    minPlan: "any",
    billing: { model: "free" },
    permissions: [],
    capabilities: {},
    lifecycle: {},
    ...overrides,
  };
}

describe("computeLockReason", () => {
  it("coming_soon wins over everything", () => {
    const r = computeLockReason(m({ status: "coming_soon", availableForRoles: ["master"] }), {
      role: "tenant_owner",
      tenantPlan: "max",
      tenantId: "t_1",
    });
    expect(r.kind).toBe("coming_soon");
  });

  it("role_mismatch when viewer role not in availableForRoles", () => {
    const r = computeLockReason(m({ availableForRoles: ["system_admin"] }), {
      role: "master" as PluginRole,
      tenantPlan: "max",
      tenantId: "t_1",
    });
    expect(r.kind).toBe("role_mismatch");
  });

  it("platform_only when scope=platform and viewer is not system_admin", () => {
    const r = computeLockReason(m({ scope: "platform", availableForRoles: ["system_admin", "tenant_owner"] }), {
      role: "tenant_owner",
      tenantPlan: "max",
      tenantId: "t_1",
    });
    // role passes (tenant_owner included), but scope blocks
    expect(r.kind).toBe("platform_only");
  });

  it("plan gate triggers when minPlan > current", () => {
    const r = computeLockReason(m({ minPlan: "pro" }), {
      role: "tenant_owner",
      tenantPlan: "start",
      tenantId: "t_1",
    });
    expect(r.kind).toBe("plan");
  });

  it("plan gate does not trigger when viewer has no tenant context", () => {
    const r = computeLockReason(m({ minPlan: "pro", availableForRoles: ["system_admin"] }), {
      role: "system_admin",
      tenantPlan: null,
      tenantId: null,
    });
    expect(r.kind).toBe("none");
  });

  it("returns 'none' when all gates pass", () => {
    const r = computeLockReason(m({ minPlan: "pro", availableForRoles: ["tenant_owner"] }), {
      role: "tenant_owner",
      tenantPlan: "pro",
      tenantId: "t_1",
    });
    expect(r.kind).toBe("none");
  });

  it("returns 'none' for unauthenticated viewer (role=null)", () => {
    const r = computeLockReason(m(), {
      role: null,
      tenantPlan: null,
      tenantId: null,
    });
    expect(r.kind).toBe("none");
  });

  it("system_admin bypasses role_mismatch and plan gates", () => {
    const r1 = computeLockReason(m({ availableForRoles: ["master"] }), {
      role: "system_admin",
      tenantPlan: "start",
      tenantId: "t_1",
    });
    expect(r1.kind).toBe("none");

    const r2 = computeLockReason(m({ minPlan: "max" }), {
      role: "system_admin",
      tenantPlan: "start",
      tenantId: "t_1",
    });
    expect(r2.kind).toBe("none");

    const r3 = computeLockReason(m({ scope: "platform", availableForRoles: ["tenant_owner"] }), {
      role: "system_admin",
      tenantPlan: null,
      tenantId: null,
    });
    expect(r3.kind).toBe("none");
  });

  it("system_admin still sees coming_soon lock (feature not ready)", () => {
    const r = computeLockReason(m({ status: "coming_soon" }), {
      role: "system_admin",
      tenantPlan: null,
      tenantId: null,
    });
    expect(r.kind).toBe("coming_soon");
  });
});
