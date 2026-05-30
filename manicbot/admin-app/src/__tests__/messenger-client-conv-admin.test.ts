/**
 * God-Mode cross-tenant client inbox: `messenger.listClientConvAdmin`.
 *
 * This is the consolidated replacement for the retired `/conversations`
 * God-Mode surface. It MUST be system_admin-only and MUST only return
 * client_conv threads (never staff DMs/groups), enriched with the salon name.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

const row = (id: string, tenantId: string, tenantName: string, lastMessageAt: number) => ({
  id,
  tenantId,
  title: null,
  lastMessageAt,
  lastMessagePreview: "hi",
  archived: 0,
  tenantName,
});

describe("messengerRouter.listClientConvAdmin — auth gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.listClientConvAdmin({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects tenant_owner (not system_admin)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.listClientConvAdmin({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects master (not system_admin)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeMasterCtx(db, "t_a") as never);
    await expect(caller.listClientConvAdmin({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("messengerRouter.listClientConvAdmin — results", () => {
  beforeEach(() => vi.clearAllMocks());

  it("system_admin gets cross-tenant client_conv threads with salon name", async () => {
    const { db } = createDbMock([
      [row("th_1", "t_a", "Salon A", 5), row("th_2", "t_b", "Salon B", 4)],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listClientConvAdmin({});
    expect(out.items).toHaveLength(2);
    expect(out.items[0]?.tenantName).toBe("Salon A");
    expect(new Set(out.items.map((i) => i.tenantId))).toEqual(new Set(["t_a", "t_b"]));
  });

  it("returns a nextCursor when the page is full", async () => {
    const full = Array.from({ length: 40 }, (_, i) =>
      row(`th_${i}`, "t_a", "Salon A", 100 - i),
    );
    const { db } = createDbMock([full]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listClientConvAdmin({ limit: 40 });
    expect(out.items).toHaveLength(40);
    expect(out.nextCursor).toBe(61); // lastMessageAt of the 40th row (100 - 39)
  });

  it("no nextCursor when the page is not full", async () => {
    const { db } = createDbMock([[row("th_1", "t_a", "Salon A", 5)]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listClientConvAdmin({ limit: 40 });
    expect(out.nextCursor).toBeUndefined();
  });
});
