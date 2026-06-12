/**
 * plugins.checkoutAddon — write-scope gate (audit 2026-06-12, AG-1).
 *
 * Every other mutating procedure in the plugins router calls
 * assertCanWriteScope (owner / personal-master / sysadmin); checkoutAddon —
 * a BILLING action that mints a Stripe Checkout URL for the tenant — was the
 * one exception, letting a tenant_manager or salon-employed master start a
 * paid-addon checkout. The guard must run before any other work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginsRouter } from "~/server/api/routers/plugins";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeTenantManagerCtx,
  makeMasterCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(pluginsRouter);
const TENANT = "t_addon";
const INPUT = { slug: "no-such-plugin", cycle: "monthly" as const };

describe("plugins.checkoutAddon — assertCanWriteScope (AG-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FORBIDDEN for tenant_manager (billing action is owner-level)", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantManagerCtx(db, TENANT) as never);
    await expect(caller.checkoutAddon(INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("FORBIDDEN for a salon-employed master (non-personal tenant)", async () => {
    // assertCanWriteScope's master branch reads tenants.isPersonal.
    const { db } = createDbMock([[{ isPersonal: 0 }]]);
    const caller = createCaller(makeMasterCtx(db, TENANT) as never);
    await expect(caller.checkoutAddon(INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tenant_owner passes the scope gate (unknown slug then yields NOT_FOUND, not FORBIDDEN)", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(caller.checkoutAddon(INPUT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("personal master passes the scope gate", async () => {
    const { db } = createDbMock([[{ isPersonal: 1 }]]);
    const caller = createCaller(makeMasterCtx(db, TENANT) as never);
    await expect(caller.checkoutAddon(INPUT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
