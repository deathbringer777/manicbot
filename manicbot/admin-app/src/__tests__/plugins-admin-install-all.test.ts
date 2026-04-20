/**
 * Tests for plugins.adminInstallAll — system_admin only bulk installer.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginsRouter } from "~/server/api/routers/plugins";
import { createDbMock, makeAdminCtx, makeTenantOwnerCtx } from "./helpers/db-mock";
import { listManifests } from "@plugins/index";

const createCaller = createCallerFactory(pluginsRouter);

describe("plugins.adminInstallAll", () => {
  it("is admin-only", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.adminInstallAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bulk-installs non-coming_soon plugins and returns counts", async () => {
    const real = listManifests().filter((m) => m.status !== "coming_soon");
    // Each plugin triggers one duplicate check (selectResults). All empty → all get inserted.
    const selectResults: unknown[][] = real.map(() => []);
    const { db, insertCalls } = createDbMock(selectResults);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.adminInstallAll();
    expect(r.ok).toBe(true);
    expect(r.inserted + r.skipped).toBe(real.length);
    expect(r.total).toBe(real.length);
    // 2 inserts per installed plugin: plugin_installations + plugin_events
    expect(insertCalls.length).toBeGreaterThanOrEqual(r.inserted * 2);
  });

  it("is idempotent — re-running skips already-installed rows", async () => {
    const real = listManifests().filter((m) => m.status !== "coming_soon");
    // Pretend EVERY dup check finds an existing row
    const selectResults: unknown[][] = real.map((m) => [{ id: "pi_" + m.slug }]);
    const { db, insertCalls } = createDbMock(selectResults);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.adminInstallAll();
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(0);
    expect(r.skipped).toBe(real.length);
    expect(insertCalls.length).toBe(0);
  });

  it("admin without tenant skips tenant-only plugins that have no scope", async () => {
    // Admin with tenantId=null; tenant-only plugins require a tenant and are
    // skipped (falls to 'skipped' bucket).
    const real = listManifests().filter((m) => m.status !== "coming_soon");
    const tenantOnly = real.filter((m) => m.scope === "tenant");
    const nonTenantOnly = real.filter((m) => m.scope !== "tenant");
    // Non-tenant-only plugins each get a dup-check (empty array)
    const selectResults: unknown[][] = nonTenantOnly.map(() => []);
    const { db } = createDbMock(selectResults);
    const caller = createCaller(makeAdminCtx(db) as never);
    const r = await caller.adminInstallAll();
    // skipped ≥ count of tenant-only plugins that require a non-null tenant
    expect(r.skipped).toBeGreaterThanOrEqual(tenantOnly.length);
  });
});
