/**
 * Multi-tenant membership logic — the security-critical core of the salon
 * switcher. A web user's ACTIVE tenant/role is switchable across their
 * memberships; the active role is always re-derived from the DB (never trusted
 * from the client), and a stale active pointer self-heals back to the home
 * tenant.
 *
 * These tests pin the PURE decision logic (the DB wrappers in memberships.ts
 * are thin shells around these). D1 bindings are unavailable under vitest, so
 * we exercise the transform/decision directly — same pattern as the
 * public-salon-* tests.
 */
import { describe, it, expect } from "vitest";
import {
  syntheticChatIdForWebUser,
  mergeMemberships,
  pickActiveMembership,
} from "~/server/auth/memberships";

describe("syntheticChatIdForWebUser", () => {
  const id = "25c95dc5-99f7-46bd-91bf-d5ad16a8860c";

  it("is deterministic and inside the synthetic chat-id range", () => {
    const a = syntheticChatIdForWebUser(id);
    expect(syntheticChatIdForWebUser(id)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(10_000_000_000);
    expect(a).toBeLessThan(11_000_000_000);
  });

  it("matches the legacy inline formula used by accept/createMasterAccount", () => {
    const expected =
      10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
    expect(syntheticChatIdForWebUser(id)).toBe(expected);
  });
});

describe("mergeMemberships", () => {
  const home = { tenantId: "t_home", role: "tenant_owner", tenantName: "Мой салон", isPersonal: false };

  it("lists the home tenant first and flags it isHome", () => {
    expect(mergeMemberships(home, [])).toEqual([{ ...home, isHome: true }]);
  });

  it("appends master memberships and dedups the home tenant (home role wins)", () => {
    const out = mergeMemberships(home, [
      { tenantId: "t_demo", role: "master", tenantName: "Demo", isPersonal: false },
      { tenantId: "t_home", role: "master", tenantName: "Мой салон", isPersonal: false },
    ]);
    expect(out.map((m) => m.tenantId)).toEqual(["t_home", "t_demo"]);
    expect(out.find((m) => m.tenantId === "t_home")!.role).toBe("tenant_owner");
    expect(out.find((m) => m.tenantId === "t_home")!.isHome).toBe(true);
    expect(out.find((m) => m.tenantId === "t_demo")!.isHome).toBe(false);
  });

  it("supports a master-only user with no home tenant", () => {
    expect(
      mergeMemberships(null, [{ tenantId: "t_demo", role: "master", tenantName: "Demo", isPersonal: false }]),
    ).toEqual([{ tenantId: "t_demo", role: "master", tenantName: "Demo", isPersonal: false, isHome: false }]);
  });
});

describe("pickActiveMembership", () => {
  const base = { homeTenantId: "t_home", homeRole: "tenant_owner" };

  it("returns home when there is no active pointer", () => {
    expect(pickActiveMembership({ ...base, activeTenantId: null, activeMasterRole: null })).toEqual({
      tenantId: "t_home",
      role: "tenant_owner",
      needsHeal: false,
    });
  });

  it("returns home when active === home (and never heals it)", () => {
    expect(pickActiveMembership({ ...base, activeTenantId: "t_home", activeMasterRole: null })).toEqual({
      tenantId: "t_home",
      role: "tenant_owner",
      needsHeal: false,
    });
  });

  it("returns the active master membership when authoritatively proven", () => {
    expect(pickActiveMembership({ ...base, activeTenantId: "t_demo", activeMasterRole: "master" })).toEqual({
      tenantId: "t_demo",
      role: "master",
      needsHeal: false,
    });
  });

  it("self-heals to home when the active pointer is no longer a valid membership", () => {
    expect(pickActiveMembership({ ...base, activeTenantId: "t_demo", activeMasterRole: null })).toEqual({
      tenantId: "t_home",
      role: "tenant_owner",
      needsHeal: true,
    });
  });

  it("supports a master-only user (null home) switching nowhere", () => {
    expect(pickActiveMembership({ homeTenantId: null, homeRole: "master", activeTenantId: null, activeMasterRole: null })).toEqual({
      tenantId: null,
      role: "master",
      needsHeal: false,
    });
  });
});
