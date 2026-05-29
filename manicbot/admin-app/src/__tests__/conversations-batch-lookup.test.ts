/**
 * conversations router — N+1 batch fix for user-name lookups (fix #2 P1).
 *
 * listAdmin and list used to issue one SELECT per internalUserId via a
 * for-loop. The fix batches all lookups into a single IN-query.
 *
 * This test verifies:
 *   1. For N conversations with internalUserId, only ONE additional SELECT
 *      is issued (the batch IN-query), not N.
 *   2. The returned items still include displayName resolved from users.
 *   3. When no rows have internalUserId, the extra SELECT is not issued at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { conversationsRouter } from "~/server/api/routers/conversations";
import { makeAdminCtx, makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_test";

function makeAwaitableChain(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const selectSpy = vi.fn(() => makeAwaitableChain(queue.shift() ?? []));
  const db: any = {
    select: selectSpy,
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  };
  return { db, selectSpy };
}

describe("conversationsRouter — batch user-name lookup (fix #2)", () => {
  const createCaller = createCallerFactory(conversationsRouter);
  beforeEach(() => vi.clearAllMocks());

  describe("listAdmin", () => {
    it("issues exactly 2 SELECTs total for N conversations (1 main + 1 batch)", async () => {
      const convRows = [
        { id: "c1", tenantId: TENANT, channelType: "telegram", channelUserId: "100",
          internalUserId: "200", status: "open", lastMessageAt: 1000, createdAt: 900, tenantName: "Salon" },
        { id: "c2", tenantId: TENANT, channelType: "whatsapp", channelUserId: "101",
          internalUserId: "201", status: "open", lastMessageAt: 999, createdAt: 898, tenantName: "Salon" },
        { id: "c3", tenantId: TENANT, channelType: "instagram", channelUserId: "102",
          internalUserId: "202", status: "open", lastMessageAt: 998, createdAt: 897, tenantName: "Salon" },
      ];
      const userRows = [
        { tenantId: TENANT, chatId: 200, name: "Alice", tgUsername: null },
        { tenantId: TENANT, chatId: 201, name: "Bob", tgUsername: "bob" },
        { tenantId: TENANT, chatId: 202, name: null, tgUsername: "carol" },
      ];
      // Only 2 selects: main conversations query, batch user lookup
      const { db, selectSpy } = buildDb([convRows, userRows]);
      const caller = createCaller(makeAdminCtx(db) as never);
      const result = await caller.listAdmin({ channelType: "all", status: "all" });

      // Constant query count regardless of row count
      expect(selectSpy).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(3);
      // Names resolved correctly
      expect(result.items[0]!.displayName).toBe("Alice");
      expect(result.items[1]!.displayName).toBe("Bob");
      expect(result.items[2]!.displayName).toBe("@carol");
    });

    it("issues only 1 SELECT when no row has internalUserId", async () => {
      const convRows = [
        { id: "c1", tenantId: TENANT, channelType: "telegram", channelUserId: "100",
          internalUserId: null, status: "open", lastMessageAt: 1000, createdAt: 900, tenantName: "Salon" },
      ];
      const { db, selectSpy } = buildDb([convRows]);
      const caller = createCaller(makeAdminCtx(db) as never);
      const result = await caller.listAdmin({ channelType: "all", status: "all" });

      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(result.items[0]!.displayName).toBeNull();
    });
  });

  describe("list", () => {
    it("issues exactly 2 SELECTs total for N conversations (1 main + 1 batch)", async () => {
      const convRows = [
        { id: "c1", tenantId: TENANT, channelType: "telegram", channelUserId: "100",
          internalUserId: "200", status: "open", lastMessageAt: 1000, createdAt: 900 },
        { id: "c2", tenantId: TENANT, channelType: "telegram", channelUserId: "101",
          internalUserId: "201", status: "open", lastMessageAt: 999, createdAt: 898 },
      ];
      const userRows = [
        { tenantId: TENANT, chatId: 200, name: "Alice", tgUsername: null },
        { tenantId: TENANT, chatId: 201, name: "Bob", tgUsername: null },
      ];
      const { db, selectSpy } = buildDb([convRows, userRows]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      const result = await caller.list({ tenantId: TENANT, channelType: "all", status: "all" });

      expect(selectSpy).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.displayName).toBe("Alice");
      expect(result.items[1]!.displayName).toBe("Bob");
    });

    it("deduplicates duplicate internalUserId values — still only 1 batch SELECT", async () => {
      const convRows = [
        { id: "c1", tenantId: TENANT, channelType: "telegram", channelUserId: "100",
          internalUserId: "200", status: "open", lastMessageAt: 1000, createdAt: 900 },
        { id: "c2", tenantId: TENANT, channelType: "telegram", channelUserId: "101",
          internalUserId: "200", status: "open", lastMessageAt: 999, createdAt: 898 },
      ];
      const userRows = [
        { tenantId: TENANT, chatId: 200, name: "Alice", tgUsername: null },
      ];
      const { db, selectSpy } = buildDb([convRows, userRows]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await caller.list({ tenantId: TENANT, channelType: "all", status: "all" });

      // Only 2 selects despite two rows having the same internalUserId
      expect(selectSpy).toHaveBeenCalledTimes(2);
    });
  });
});
