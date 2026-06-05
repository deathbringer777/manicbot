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
 *
 * 2026-06-05 cull notes:
 *   - All retained plugins are tenant-scoped, `minPlan: "any"`,
 *     `billing.model: "free"`. Fixture slugs after the cull:
 *       TENANT_PLUGIN     = task-board     (owner + manager + master)
 *       ROLE_GATED_PLUGIN = loyalty-stamps (owner + manager; excludes master)
 *     The role-gate test now asserts a *master* is rejected from an
 *     owner+manager-only plugin (no retained plugin is master-only anymore).
 *   - Tests that require a plan-gated plugin (`minPlan != "any"`), a
 *     `system_admin`-only plugin, or a `scope: "platform"` plugin are
 *     marked `it.skip` with a TODO pointing to Phase 3. They come back to
 *     life once real paid / platform plugins land.
 *   - For `free` plugins, the initial billing state is `not_applicable`
 *     (only `included_in_plan` returns `included`).
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
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(pluginsRouter);

// Slugs used across the suite. Keeping these as named constants makes future
// substitutions a one-line change instead of a sed pass.
const TENANT_PLUGIN = "task-board";        // tenant_owner + tenant_manager + master, free, scope=tenant
const ROLE_GATED_PLUGIN = "loyalty-stamps"; // tenant_owner + tenant_manager only (excludes master) — for role-gate tests

// ─── Auth / basic guards ────────────────────────────────────────────────────

describe("pluginsRouter auth guards", () => {
  it("listCatalog throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.listCatalog()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("install throws UNAUTHORIZED when unauthenticated (L-F: managerProcedure flips null caller to UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.install({ slug: TENANT_PLUGIN }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("auditTrail is admin-only", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.auditTrail()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── listCatalog lock-state computation ─────────────────────────────────────

describe("pluginsRouter.listCatalog", () => {
  it("returns production cards for system_admin with correct localization", async () => {
    const { db } = createDbMock([[], []]); // select for tenant plan (no tenantId), select for installs
    const caller = createCaller(makeAdminCtx(db) as never);
    const cards = await caller.listCatalog({ lang: "en" });
    expect(cards.length).toBeGreaterThanOrEqual(3);
    const card = cards.find((c) => c.slug === TENANT_PLUGIN);
    expect(card?.name).toBe("Task Board");
    expect(card?.billingLabel).toBe("Free");
  });

  it.skip("[Phase 3] marks plan-locked plugins when tenant plan is insufficient", async () => {
    // No retained plugin has `minPlan != "any"`. Phase 3 ships sms-reminders
    // (paid addon) and several included_in_plan plugins — re-enable then.
    const { db } = createDbMock([[{ plan: "start" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "ru" });
    const planGated = cards.find((c) => c.lock.kind === "plan");
    expect(planGated).toBeDefined();
  });

  it.skip("[Phase 3] hides system_admin-only plugins from non-admin viewers", async () => {
    // No retained plugin is system_admin-only after the Phase 1 cleanup.
    // gdpr-center was the only one and it was folded into core /admin/gdpr.
    const { db } = createDbMock([[{ plan: "pro" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "ru" });
    expect(cards.every((c) => c.slug !== "some-future-system-admin-plugin")).toBe(true);
  });

  it("falls back to ru when unknown lang is passed", async () => {
    const { db } = createDbMock([[{ plan: "pro" }], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    const cards = await caller.listCatalog({ lang: "xx" as never });
    const card = cards.find((c) => c.slug === TENANT_PLUGIN);
    expect(card?.tagline).toBe("Kanban для внутренних дел салона");
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
  it("tenant_owner installs a tenant-scoped plugin for their tenant", async () => {
    // TENANT_PLUGIN has minPlan="any", so no plan-gate select fires.
    // Only the duplicate-check select runs before the install inserts.
    const { db, insertCalls } = createDbMock([
      [], // existing-install check (no duplicates)
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.install({ slug: TENANT_PLUGIN, tenantId: "t_pro" });
    expect(r.id).toMatch(/.+/);
    // Free plugin → initial billing state is "not_applicable" (only
    // included_in_plan returns "included"; only paid addons return "trialing").
    expect(r.billingState).toBe("not_applicable");
    // 1st insert = plugin_installations, 2nd = plugin_events (installed)
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    const installRow = insertCalls[0]!.values as Record<string, unknown>;
    expect(installRow.pluginSlug).toBe(TENANT_PLUGIN);
    expect(installRow.tenantId).toBe("t_pro");
    expect(installRow.enabled).toBe(1);
    const eventRow = insertCalls[1]!.values as Record<string, unknown>;
    expect(eventRow.event).toBe("installed");
  });

  it.skip("[Phase 3] system_admin installs a platform-scoped plugin", async () => {
    // No retained plugin has scope=platform. Phase 3 may add one.
    const { db, insertCalls } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: "some-platform-plugin-from-phase-3", tenantId: null });
    expect(r.id).toMatch(/.+/);
    const installRow = insertCalls[0]!.values as Record<string, unknown>;
    expect(installRow.tenantId).toBe(null);
  });
});

// ─── install security rejections ────────────────────────────────────────────

describe("pluginsRouter.install — security rejections", () => {
  it.skip("[Phase 3] rejects platform install from non-admin", async () => {
    // Requires a scope=platform plugin in the registry. None retained.
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: "some-platform-plugin-from-phase-3", tenantId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant install for a different tenant (tenant_owner can't install on someone else)", async () => {
    const { db } = createDbMock([[{ plan: "pro" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_mine") as never);
    await expect(
      caller.install({ slug: TENANT_PLUGIN, tenantId: "t_other" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.skip("[Phase 3] platform plugin install auto-scopes to null even when tenantId is passed", async () => {
    // Requires a scope=platform plugin. None retained.
    const { db, insertCalls } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: "some-platform-plugin-from-phase-3", tenantId: "t_any" });
    expect(r.id).toMatch(/.+/);
    const row = insertCalls[0]!.values as Record<string, unknown>;
    expect(row.tenantId).toBeNull();
  });

  it("rejects install of tenant plugin at platform scope", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.install({ slug: TENANT_PLUGIN, tenantId: null }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it.skip("[Phase 3] rejects plan-gated plugin on a lower plan", async () => {
    // No retained plugin has minPlan != "any". Phase 3 sms-reminders /
    // multi-location etc. are paid addons that re-enable this test.
    const { db } = createDbMock([[{ plan: "start" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_start") as never);
    await expect(
      caller.install({ slug: "some-pro-only-plugin-from-phase-3", tenantId: "t_start" }),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });

  it("rejects role-unavailable plugin (master cannot install an owner+manager-only plugin)", async () => {
    // ROLE_GATED_PLUGIN (loyalty-stamps) is restricted to availableForRoles=
    // ["tenant_owner", "tenant_manager"]. A master is not in that list, so even
    // on their own personal tenant the role gate rejects with FORBIDDEN.
    // assertCanWriteScope runs first (personal-tenant check = one isPersonal
    // select), then the role gate fires.
    const { db } = createDbMock([[{ isPersonal: 1 }]]);
    const caller = createCaller(makeMasterCtx(db, "t_personal") as never);
    await expect(
      caller.install({ slug: ROLE_GATED_PLUGIN, tenantId: "t_personal" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin bypasses the role-availability gate", async () => {
    // ROLE_GATED_PLUGIN (loyalty-stamps) is restricted to availableForRoles=
    // ["tenant_owner", "tenant_manager"], but system_admin should STILL be able
    // to install it for testing/support. minPlan is "any", so the plan lookup
    // is skipped — we only need the dup check mock to return empty.
    const { db, insertCalls } = createDbMock([
      [], // dup check (no existing install)
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.install({ slug: ROLE_GATED_PLUGIN, tenantId: "t_test" });
    expect(r.id).toMatch(/.+/);
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate install (CONFLICT)", async () => {
    const { db } = createDbMock([
      [{ plan: "pro" }],
      [{ id: "pi_existing", pluginSlug: TENANT_PLUGIN, tenantId: "t_pro", enabled: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    await expect(
      caller.install({ slug: TENANT_PLUGIN, tenantId: "t_pro" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects oversized settings payload (>8KB)", async () => {
    const { db } = createDbMock([[{ plan: "pro" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const huge = { blob: "x".repeat(9 * 1024) };
    await expect(
      caller.install({ slug: TENANT_PLUGIN, tenantId: "t_pro", settings: huge }),
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
  pluginSlug: TENANT_PLUGIN,
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
  it("master on personal tenant can install a compatible plugin", async () => {
    // TENANT_PLUGIN includes master in availableForRoles; minPlan="any".
    // Personal tenant isPersonal=1 allows the master to write to their own tenant.
    // No plan-gate select fires because minPlan="any".
    const { db, insertCalls } = createDbMock([
      [{ isPersonal: 1 }],   // assertCanWriteScope personal check
      [],                    // duplicate check
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_personal") as never);
    const r = await caller.install({ slug: TENANT_PLUGIN, tenantId: "t_personal" });
    expect(r.id).toMatch(/.+/);
    expect(insertCalls[0]!.values.pluginSlug).toBe(TENANT_PLUGIN);
  });

  it("master on non-personal tenant cannot install", async () => {
    const { db } = createDbMock([
      [{ isPersonal: 0 }], // not personal
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_salon") as never);
    await expect(
      caller.install({ slug: TENANT_PLUGIN, tenantId: "t_salon" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── getInstalled returns visible rows ─────────────────────────────────────

describe("pluginsRouter.getInstalled", () => {
  it("returns tenant rows for a tenant user", async () => {
    const rows = [
      { ...ROW_LIVE, id: "pi_tenant_a", tenantId: "t_pro", pluginSlug: TENANT_PLUGIN },
      { ...ROW_LIVE, id: "pi_tenant_b", tenantId: "t_pro", pluginSlug: ROLE_GATED_PLUGIN },
    ];
    const { db } = createDbMock([rows]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_pro") as never);
    const r = await caller.getInstalled();
    expect(r.length).toBe(2);
    expect(r.map((x) => x.id).sort()).toEqual(["pi_tenant_a", "pi_tenant_b"]);
  });

  it.skip("[Phase 3] returns only platform rows for a user with no tenantId", async () => {
    // Requires a scope=platform plugin in the registry. None retained.
    const rows = [{ ...ROW_LIVE, id: "pi_platform", tenantId: null, pluginSlug: "some-platform-plugin-from-phase-3" }];
    const { db } = createDbMock([rows]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.getInstalled();
    expect(r).toHaveLength(1);
  });
});
