/**
 * Migration 0049 + tRPC `updateCalendarVisibility` procedure.
 *
 * The master themselves owns this setting. The salon owner cannot flip it
 * for the master (Booksy did the opposite and it was a UX problem). Only
 * the master OR system_admin may write.
 *
 * Salon-owner read access is unaffected — owner always sees all masters'
 * calendars regardless of this flag (enforced elsewhere via
 * `assertTenantOwner`). This setting only governs peer-to-peer visibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { masterRouter } from "~/server/api/routers/masterRouter";
import {
  createDbMock,
  makeMasterCtx,
  makeTenantOwnerCtx,
  makeAdminCtx,
} from "./helpers/db-mock";

describe("masterRouter.updateCalendarVisibility (#0049)", () => {
  const createCaller = createCallerFactory(masterRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("master can flip their own visibility to salon_and_peers", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    const r = await caller.updateCalendarVisibility({
      tenantId: "t_alice",
      masterId: 100,
      visibility: "salon_and_peers",
    });
    expect(r).toEqual({ success: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values).toEqual({ calendarVisibility: "salon_and_peers" });
  });

  it("master can opt back into salon_only", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await caller.updateCalendarVisibility({
      tenantId: "t_alice",
      masterId: 100,
      visibility: "salon_only",
    });
    expect(updateCalls[0]!.values).toEqual({ calendarVisibility: "salon_only" });
  });

  it("master cannot flip another master's visibility (IDOR)", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateCalendarVisibility({
        tenantId: "t_alice",
        masterId: 200,
        visibility: "salon_and_peers",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tenant_owner cannot override a master's visibility (master owns the toggle)", async () => {
    const { db } = createDbMock([]);
    const ctx = makeTenantOwnerCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateCalendarVisibility({
        tenantId: "t_alice",
        masterId: 100,
        visibility: "private",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin can override (support escalation path)", async () => {
    const { db, updateCalls } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeAdminCtx(db);
    const caller = createCaller(ctx as never);
    const r = await caller.updateCalendarVisibility({
      tenantId: "t_alice",
      masterId: 100,
      visibility: "private",
    });
    expect(r).toEqual({ success: true });
    expect(updateCalls[0]!.values).toEqual({ calendarVisibility: "private" });
  });

  it("rejects invalid enum values at the zod boundary", async () => {
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateCalendarVisibility({
        tenantId: "t_alice",
        masterId: 100,
        // @ts-expect-error — intentional boundary check
        visibility: "public",
      }),
    ).rejects.toBeDefined();
  });
});
