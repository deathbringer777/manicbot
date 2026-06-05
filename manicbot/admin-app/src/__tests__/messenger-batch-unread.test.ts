/**
 * messenger router — N+1 unread-badge COUNT fix (fix #3 P1).
 *
 * listThreads used to issue one COUNT per thread in a for-loop to compute
 * unread badges. The fix uses a single grouped COUNT query with a JOIN to
 * resolve all unread counts in one round-trip.
 *
 * This test verifies:
 *   1. For N threads, the unread-count lookup issues exactly 1 extra SELECT
 *      (the batch group-by), not N.
 *   2. Unread counts are correctly returned per thread.
 *   3. When there are no threads, the extra SELECT is not issued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "admin",
    WS_TOKEN_SECRET: "ws-secret",
    UPLOAD_TOKEN_SECRET: "upload-secret",
  },
}));

vi.mock("~/lib/wsToken", () => ({ mintWsToken: vi.fn(async () => "tok") }));
vi.mock("~/lib/ulid", () => ({ ulid: () => "test-ulid" }));
vi.mock("~/server/services/notifyWebUser", () => ({ notifyManyWebUsers: vi.fn(async () => {}) }));
vi.mock("~/server/lib/uploadToken", () => ({ signUploadToken: vi.fn(async () => "upload-tok") }));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_test";
const WEB_USER_ID = "w_owner";

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
    groupBy: () => chain,
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

describe("messengerRouter.listThreads — batch unread COUNT (fix #3)", () => {
  const createCaller = createCallerFactory(messengerRouter);
  beforeEach(() => vi.clearAllMocks());

  it("issues constant SELECTs regardless of thread count (no N+1) and resolves DM titles", async () => {
    // Non-admin: a CONSTANT number of selects (never per-thread):
    //   1. threadMembers (member thread ids)
    //   2. threads (main query)
    //   3. threadMembers (caller's last_read per thread, for unread batch)
    //   4. ONE batch unread count query (not N individual COUNTs)
    //   5. threadMembers (DM counterparts, for staff_dm title resolution)
    //   6. web_users (counterpart names) — only when there are web_user DM peers
    const memberRows = [
      { threadId: "th_1" },
      { threadId: "th_2" },
      { threadId: "th_3" },
    ];
    const threadRows = [
      { id: "th_1", tenantId: TENANT, kind: "staff_dm", title: null, archived: 0, lastMessageAt: 1000, createdAt: 900 },
      { id: "th_2", tenantId: TENANT, kind: "staff_dm", title: null, archived: 0, lastMessageAt: 999, createdAt: 898 },
      { id: "th_3", tenantId: TENANT, kind: "staff_group", title: "Команда", archived: 0, lastMessageAt: 998, createdAt: 897 },
    ];
    const callerMemberRows = [
      { threadId: "th_1", lastRead: "msg_10" },
      { threadId: "th_2", lastRead: null },
      { threadId: "th_3", lastRead: "msg_5" },
    ];
    // Batch unread result: one row per thread
    const batchUnreadRows = [
      { threadId: "th_1", unreadCount: 3 },
      { threadId: "th_2", unreadCount: 7 },
      { threadId: "th_3", unreadCount: 0 },
    ];
    // DM counterpart members (the non-caller side of each staff_dm).
    const dmMemberRows = [
      { threadId: "th_1", memberKind: "web_user", memberRef: "w_bob" },
      { threadId: "th_2", memberKind: "web_user", memberRef: "w_carol" },
    ];
    const dmNameRows = [
      { id: "w_bob", name: "Bob", email: null },
      { id: "w_carol", name: "Carol", email: null },
    ];

    const { db, selectSpy } = buildDb([
      memberRows,        // 1: member thread ids
      threadRows,        // 2: threads
      callerMemberRows,  // 3: caller's last_read
      batchUnreadRows,   // 4: batch unread counts
      dmMemberRows,      // 5: DM counterpart members
      dmNameRows,        // 6: counterpart names
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.listThreads({ tenantId: TENANT });

    // Constant query count regardless of N threads — NOT N+1
    expect(selectSpy).toHaveBeenCalledTimes(6);
    expect(result.items).toHaveLength(3);
    // Unread counts correctly plumbed through
    const th1 = result.items.find((i) => i.id === "th_1");
    const th2 = result.items.find((i) => i.id === "th_2");
    const th3 = result.items.find((i) => i.id === "th_3");
    expect(th1?.unreadCount).toBe(3);
    expect(th2?.unreadCount).toBe(7);
    expect(th3?.unreadCount).toBe(0);
    // staff_dm titles resolved to the counterpart's name (Telegram-style);
    // an explicitly-titled group is left untouched.
    expect(th1?.title).toBe("Bob");
    expect(th2?.title).toBe("Carol");
    expect(th3?.title).toBe("Команда");
  });

  it("returns empty list quickly when member has no threads (0 selects after membership check)", async () => {
    const { db, selectSpy } = buildDb([
      [], // memberThreadIds is empty → early return
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.listThreads({ tenantId: TENANT });

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(0);
  });
});
