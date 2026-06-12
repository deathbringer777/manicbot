/**
 * Monotonic / terminal-state guards on messenger writes (review B2 + B3).
 *
 * B2 — sendMessage relay-success UPDATE that advances delivery_state to 'sent'
 *   must be TERMINAL-GUARDED with `delivery_state = 'pending'`. Otherwise a
 *   concurrent Meta 'delivered' webhook receipt gets clobbered back to 'sent'.
 *
 * B3 — markRead must MONOTONIC-GUARD last_read_message_id so the read pointer
 *   only moves forward. Opening an old paginated view must not drag it backwards
 *   (which would resurrect already-cleared unread badges). ULIDs sort
 *   lexicographically by creation time, so a plain `<` compare is valid.
 *
 * Both guards live in the UPDATE's WHERE clause, so this file captures the
 * Drizzle condition objects passed to `.where()` and walks their `queryChunks`
 * tree to assert the guard column is present. Pre-fix the guard column is
 * absent → the relevant assertion fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
  assertEmailVerified: vi.fn(async () => {}),
}));
// WORKER_PUBLIC_URL + ADMIN_KEY present → relayToWorker reaches fetch (mocked
// below) and the SUCCESS branch fires, exercising the B2-guarded 'sent' UPDATE.
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

/** Walk a Drizzle SQL/condition tree and report whether `colName` appears. */
function whereContainsColumn(arg: unknown, colName: string): boolean {
  function walk(node: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    const obj = node as { name?: unknown; queryChunks?: unknown[] };
    if (obj.name === colName) return true;
    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) {
        if (walk(c)) return true;
      }
    }
    return false;
  }
  return walk(arg);
}

/**
 * Mock db that records every UPDATE as `{ values, where }` so a test can both
 * read the SET payload and inspect the captured WHERE condition tree.
 */
function makeGuardDb(selectResults: unknown[]) {
  const queue = [...selectResults];
  const updateCalls: Array<{ values: Record<string, unknown>; where: unknown }> = [];

  function makeChain(result: unknown): any {
    const limitChain: any = {
      offset: () => Promise.resolve(result),
      then: (r: any, j?: any) => Promise.resolve(result).then(r, j),
    };
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => limitChain,
      then: (r: any, j?: any) => Promise.resolve(result).then(r, j),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn((where: unknown) => {
          updateCalls.push({ values, where });
          return {
            returning: vi.fn(async () => []),
            then: (r: any, j?: any) => Promise.resolve({ ok: true }).then(r, j),
          };
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => {
        const chain: any = {
          onConflictDoUpdate: vi.fn().mockResolvedValue({ ok: true }),
          then: (r: any, j?: any) => Promise.resolve({ ok: true }).then(r, j),
        };
        chain.onConflictDoNothing = vi.fn(() => chain);
        return chain;
      }),
    })),
  };
  return { db, updateCalls };
}

const clientThread = () => ({
  id: "th_c",
  tenantId: "t_a",
  kind: "client_conv",
  title: null,
  clientConversationId: "conv_1",
  dmKey: null,
  createdByWebUserId: null,
  createdAt: 1,
  lastMessageAt: 2,
  lastMessagePreview: null,
  archived: 0,
});
const ownerMember = (threadId: string) => ({
  threadId,
  memberKind: "web_user",
  memberRef: "w_owner",
  role: "member",
  joinedAt: 1,
  mutedUntil: null,
  lastReadMessageId: null,
  lastReadAt: null,
});

describe("B2 — sendMessage relay-success advance is terminal-guarded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the 'sent' UPDATE only advances a still-'pending' row (delivery_state in WHERE)", async () => {
    // Relay succeeds → success-branch UPDATE (deliveryState:'sent') fires.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, external_msg_id: "ext_1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { db, updateCalls } = makeGuardDb([[clientThread()], [ownerMember("th_c")], []]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.sendMessage({ tenantId: "t_a", threadId: "th_c", body: "ping the client" });
    expect(out.relay).toEqual({ ok: true, externalMsgId: "ext_1" });

    const sentUpdate = updateCalls.find((c) => c.values.deliveryState === "sent");
    expect(sentUpdate, "a 'sent' UPDATE should have fired on relay success").toBeDefined();
    // The guard: the WHERE must reference delivery_state so a row already moved
    // to a terminal state (e.g. 'delivered') is NOT clobbered back to 'sent'.
    expect(whereContainsColumn(sentUpdate!.where, "delivery_state")).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("B3 — markRead read pointer is monotonic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the last_read_message_id UPDATE guards on the current pointer (no backward move)", async () => {
    const { db, updateCalls } = makeGuardDb([[clientThread()], [ownerMember("th_c")]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await caller.markRead({ tenantId: "t_a", threadId: "th_c", lastSeenMessageId: "01J000000000000000000000AA" });

    const readUpdate = updateCalls.find((c) => "lastReadMessageId" in c.values);
    expect(readUpdate, "markRead should issue a last_read_message_id UPDATE").toBeDefined();
    // The guard: WHERE must reference last_read_message_id (the monotonic
    // `IS NULL OR last_read_message_id < ?` clause) so an older view can't
    // drag the pointer backwards.
    expect(whereContainsColumn(readUpdate!.where, "last_read_message_id")).toBe(true);
  });
});
