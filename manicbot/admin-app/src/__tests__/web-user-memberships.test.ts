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

describe("mergeMemberships — owned secondary salons (multi-salon)", () => {
  const home = { tenantId: "t_home", role: "tenant_owner", tenantName: "Мой салон", isPersonal: false };
  const owned = (id: string, name: string) => ({ tenantId: id, role: "tenant_owner", tenantName: name, isPersonal: false });

  it("appends owned salons after home, flagged isHome:false with the owner role", () => {
    const out = mergeMemberships(home, [], [owned("t_two", "Second")]);
    expect(out.map((m) => m.tenantId)).toEqual(["t_home", "t_two"]);
    const two = out.find((m) => m.tenantId === "t_two")!;
    expect(two.role).toBe("tenant_owner");
    expect(two.isHome).toBe(false);
  });

  it("dedupes an owned salon that equals home (home wins, stays first)", () => {
    const out = mergeMemberships(home, [], [owned("t_home", "Мой салон")]);
    expect(out.map((m) => m.tenantId)).toEqual(["t_home"]);
    expect(out[0]!.isHome).toBe(true);
  });

  it("merges home + master + owned, deduping by tenant (first occurrence wins)", () => {
    const out = mergeMemberships(
      home,
      [{ tenantId: "t_master", role: "master", tenantName: "Where I work", isPersonal: false }],
      [owned("t_owned", "My second salon"), owned("t_master", "dupe")],
    );
    expect(out.map((m) => m.tenantId)).toEqual(["t_home", "t_master", "t_owned"]);
    // t_master keeps its master role (added before the owned dupe).
    expect(out.find((m) => m.tenantId === "t_master")!.role).toBe("master");
  });

  it("supports an owner-only-of-secondaries user with no home tenant", () => {
    const out = mergeMemberships(null, [], [owned("t_two", "Second")]);
    expect(out).toEqual([
      { tenantId: "t_two", role: "tenant_owner", tenantName: "Second", isPersonal: false, isHome: false },
    ]);
  });

  it("is backward-compatible when ownedRows is omitted", () => {
    expect(mergeMemberships(home, [])).toEqual([{ ...home, isHome: true }]);
  });
});

describe("pickActiveMembership — active OWNED secondary salon", () => {
  const base = { homeTenantId: "t_home", homeRole: "tenant_owner" };
  it("resolves tenant_owner for an active owned secondary salon", () => {
    expect(pickActiveMembership({ ...base, activeTenantId: "t_two", activeMasterRole: "tenant_owner" })).toEqual({
      tenantId: "t_two",
      role: "tenant_owner",
      needsHeal: false,
    });
  });
});
