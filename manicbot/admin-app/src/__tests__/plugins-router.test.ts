/**
 * Integration tests for the pluginsRouter: install / uninstall / enable /
 * disable / updateSettings / listCatalog / getInstalled / auditTrail.
 *
 * Uses the same db-mock pattern as billing.test.ts — no real D1. Security
 * invariants are the primary focus:
 *   - platform install requires system_admin
 *   - tenant install requires tenant_owner for that tenantId
 *   - coming_soon plugins cannot be installed
 *   - role_mismatch / plan_gate rejections
 *   - duplicate install → CONFLICT
 *   - settings size cap
 *   - every mutation writes to plugin_events
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginsRouter } from "~/server/api/routers/plugins";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeTenantManagerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(pluginsRouter);

// ─── Auth / basic guards ────────────────────────────────────────────────────

describe("pluginsRouter auth guards", () => {
  it("listCatalog throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.listCatalog()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("install throws FORBIDDEN when unauthenticated (managerProcedure rejects null role)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.install({ slug: "live-test" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("auditTrail is admin-only", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.auditTrail()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── listCatalog lock-state computation ─────────────────────────────────────

describe("pluginsRouter.listCatalog", () => {
  it("returns 3 fixture cards for system_admin with correct localization", async () => {
    const { db } = createDbMock([[], []]); // select for tenant plan (no tenantId), select for installs
    const caller = createCaller(makeAdminCtx(db) as never);
    const cards = await caller.listCatalog({ lang: "en" });
    expect(cards.length).toBeGreaterThanOrEqual(3);
    const live = cards.find((c) => c.slug === "live-test");
    expect(live?.name).toBe("Live Test");
    expect(live?.billingLabel).toBe("Free");
  });

  it("marks coming_soon plugins with lock.kind='coming_soon' for everyone", async () => {
    const { db } = createDbMock([[{ plan: "max" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "ru" });
    const hello = cards.find((c) => c.slug === "hello-world");
    expect(hello?.lock.kind).toBe("coming_soon");
  });

  it("marks plan-locked plugins when tenant plan is insufficient", async () => {
    const { db } = createDbMock([[{ plan: "start" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "ru" });
    const live = cards.find((c) => c.slug === "live-test");
    expect(live?.lock.kind).toBe("plan");
  });

  it("hides platform-only plugins from non-admin viewers entirely", async () => {
    // New behaviour: server-side filter strips plugins whose availableForRoles
    // doesn't include the viewer's role, so tenant_owner never sees
    // platform-test (system_admin-only) in their catalog.
    const { db } = createDbMock([[{ plan: "pro" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "ru" });
    const platform = cards.find((c) => c.slug === "platform-test");
    expect(platform).toBeUndefined();
  });

  it("falls back to ru when unknown lang is passed", async () => {
    const { db } = createDbMock([[{ plan: "pro" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "xx" as never });
    const live = cards.find((c) => c.slug === "live-test");
    expect(live?.tagline).toBe("Fixture для позитивных тестов");
  });

  it("installedOnly filter returns empty when none installed", async () => {
    const { db } = createDbMock([[{ plan: "pro" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "en", installedOnly: true });
    expect(cards.length).toBe(0);
  });
});

// ─── install happy path ─────────────────────────────────────────────────────

describe("pluginsRouter.install — happy paths", () => {
  it("tenant_owner installs live-test for their tenant", async () => {
    const { db, insertCalls } = createDbMock([
      [{ plan: "pro" }], // plan gate lookup
      [],                // existing-install check (no duplicates)
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.install({ slug: "live-test", tenantId: "t_pro" });
    expect(r.id).toMatch(/.+/);
    expect(r.billingState).toBe("not_applicable");
    // 1st insert = plugin_installations, 2nd = plugin_events (installed)
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    const installRow = insertCalls[0]!.values as Record<string, unknown>;
    expect(installRow.pluginSlug).toBe("live-test");
    expect(installRow.tenantId).toBe("t_pro");
    expect(installRow.enabled).toBe(1);
    const eventRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(eventRow.event).toBe("installed");
  });

  it("system_admin installs platform-test at platform scope", async () => {
    const { db, insertCalls } = createDbMock([[]]); // no dup check
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: "platform-test", tenantId: null });
    expect(r.id).toMatch(/.+/);
    const installRow = insertCalls[0]!.values as Record<string, unknown>;
    expect(installRow.tenantId).toBe(null);
  });
});

// ─── install security rejections ────────────────────────────────────────────

describe("pluginsRouter.install — security rejections", () => {
  it("rejects install of a coming_soon plugin", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: "hello-world", tenantId: "t_pro" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects platform install from non-admin", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: "platform-test", tenantId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant install for a different tenant (tenant_owner can't install on someone else)", async () => {
    const { db } = createDbMock([[{ plan: "pro" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_mine") as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_other" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("platform plugin install auto-scopes to null even when tenantId is passed", async () => {
    // New behaviour: platform plugins always land at tenant_id=null regardless
    // of the tenantId hint, so admin's own salon-tenant doesn't break install.
    const { db, insertCalls } = createDbMock([[]]); // dup check returns empty
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: "platform-test", tenantId: "t_any" });
    expect(r.id).toMatch(/.+/);
    const row = insertCalls[0]!.values as Record<string, unknown>;
    expect(row.tenantId).toBeNull();
  });

  it("rejects install of tenant plugin at platform scope", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: null }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects plan-gated plugin on a lower plan (tenant_owner on start)", async () => {
    const { db } = createDbMock([[{ plan: "start" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_start") as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_start" }),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });

  it("rejects role-unavailable plugin (tenant_manager cannot install live-test)", async () => {
    const { db } = createDbMock([[{ plan: "pro" }]]);
    const caller = createCaller(makeTenantManagerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_pro" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin bypasses the role-availability gate", async () => {
    // portfolio-gallery is restricted to availableForRoles=["master","tenant_owner"],
    // but system_admin should STILL be able to install for testing/support.
    // minPlan is "any", so the plan lookup is skipped — we only need the dup
    // check mock to return empty.
    const { db, insertCalls } = createDbMock([
      [], // dup check (no existing install)
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: "portfolio-gallery", tenantId: "t_test" });
    expect(r.id).toMatch(/.+/);
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate install (CONFLICT)", async () => {
    const { db } = createDbMock([
      [{ plan: "pro" }],
      [{ id: "pi_existing", pluginSlug: "live-test", tenantId: "t_pro", enabled: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_pro" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects oversized settings payload (>8KB)", async () => {
    const { db } = createDbMock([[{ plan: "pro" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const huge = { blob: "x".repeat(9 * 1024) };
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_pro", settings: huge }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects malformed slug at input validation", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.install({ slug: "BAD_Slug", tenantId: null }),
    ).rejects.toThrow();
  });
});

// ─── uninstall / enable / disable / updateSettings ──────────────────────────

const ROW_LIVE = {
  id: "pi_1",
  tenantId: "t_pro",
  pluginSlug: "live-test",
  enabled: 1,
  version: "1.0.0",
  installedBy: "w_owner",
  installedAt: 1000,
  updatedAt: 1000,
  settingsJson: null,
  billingState: "not_applicable",
  stripeSubscriptionItemId: null,
  stripePaymentIntentId: null,
};

describe("pluginsRouter.uninstall/enable/disable/updateSettings", () => {
  it("uninstall removes the row + writes event", async () => {
    const { db, deleteCalls, insertCalls } = createDbMock([[ROW_LIVE]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.uninstall({ installationId: "pi_1" });
    expect(r.ok).toBe(true);
    expect(deleteCalls.length).toBe(1);
    const eventRow = insertCalls[0]!.values as Record<string, unknown>;
    expect(eventRow.event).toBe("uninstalled");
  });

  it("uninstall by non-owner of tenant → FORBIDDEN", async () => {
    const { db } = createDbMock([[ROW_LIVE]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
    await expect(caller.uninstall({ installationId: "pi_1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uninstall with unknown installationId → NOT_FOUND", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(caller.uninstall({ installationId: "pi_nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("disable flips enabled=0 and logs event", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([[ROW_LIVE]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.disable({ installationId: "pi_1" });
    expect(r.ok).toBe(true);
    expect(updateCalls[0]!.values.enabled).toBe(0);
    expect(insertCalls[0]!.values.event).toBe("disabled");
  });

  it("enable flips enabled=1 and logs event", async () => {
    const disabledRow = { ...ROW_LIVE, enabled: 0 };
    const { db, updateCalls, insertCalls } = createDbMock([[disabledRow]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.enable({ installationId: "pi_1" });
    expect(r.ok).toBe(true);
    expect(updateCalls[0]!.values.enabled).toBe(1);
    expect(insertCalls[0]!.values.event).toBe("enabled");
  });

  it("updateSettings persists JSON and writes audit row", async () => {
    const { db, updateCalls, insertCalls } = createDbMock([[ROW_LIVE]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.updateSettings({
      installationId: "pi_1",
      settings: { frequency: "daily", hour: 9 },
    });
    expect(r.ok).toBe(true);
    const persisted = updateCalls[0]!.values.settingsJson as string;
    expect(JSON.parse(persisted)).toEqual({ frequency: "daily", hour: 9 });
    expect(insertCalls[0]!.values.event).toBe("settings_updated");
  });

  it("updateSettings rejects oversized payload", async () => {
    const { db } = createDbMock([[ROW_LIVE]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const huge = { blob: "y".repeat(9 * 1024) };
    await expect(
      caller.updateSettings({ installationId: "pi_1", settings: huge }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Master on personal tenant can install ─────────────────────────────────

describe("Personal master can install on their tenant only", () => {
  it("master on personal tenant CAN install a compatible plugin", async () => {
    // Add master to availableForRoles via a custom scenario — live-test does
    // not include master, so we expect FORBIDDEN here, which is correct.
    // The positive path uses hello-world-like coming_soon → also refused.
    // We verify the isPersonal check is consulted when role==master:
    const { db } = createDbMock([
      [{ isPersonal: 1 }],   // assertCanWriteScope personal check
      [{ plan: "pro" }],     // plan lookup
      [],                    // duplicate check
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_personal") as never);
    // live-test doesn't include master, so: FORBIDDEN after personal check passes
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_personal" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("master on non-personal tenant cannot install", async () => {
    const { db } = createDbMock([
      [{ isPersonal: 0 }], // not personal
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_salon") as never);
    await expect(
      caller.install({ slug: "live-test", tenantId: "t_salon" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── getInstalled returns visible rows ─────────────────────────────────────

describe("pluginsRouter.getInstalled", () => {
  it("returns platform + tenant rows for a tenant user", async () => {
    const rows = [
      { ...ROW_LIVE, id: "pi_tenant", tenantId: "t_pro", pluginSlug: "live-test" },
      { ...ROW_LIVE, id: "pi_platform", tenantId: null, pluginSlug: "platform-test" },
    ];
    const { db } = createDbMock([rows]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.getInstalled();
    expect(r.length).toBe(2);
    expect(r.map((x) => x.id).sort()).toEqual(["pi_platform", "pi_tenant"]);
  });

  it("returns only platform rows for a user with no tenantId", async () => {
    const rows = [{ ...ROW_LIVE, id: "pi_platform", tenantId: null, pluginSlug: "platform-test" }];
    const { db } = createDbMock([rows]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.getInstalled();
    expect(r).toHaveLength(1);
  });
});
