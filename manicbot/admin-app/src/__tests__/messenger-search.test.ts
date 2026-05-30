/**
 * Message search (FTS5, migration 0096). The membership-leak guard is the
 * security-critical contract: a non-admin caller may only match messages in
 * threads they belong to; a caller with no threads gets nothing (never an
 * unconstrained tenant-wide match).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { sanitizeFtsQuery, buildMessageSearchSql } from "~/server/api/messenger/ftsQuery";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

// ─── sanitizeFtsQuery (pure) ──────────────────────────────────────────────

describe("sanitizeFtsQuery", () => {
  it("tokenizes + quotes + prefix-matches", () => {
    expect(sanitizeFtsQuery("анна теле")).toBe('"анна"* "теле"*');
  });
  it("strips FTS metacharacters", () => {
    expect(sanitizeFtsQuery('a"b')).toBe('"ab"*');
    expect(sanitizeFtsQuery("foo*")).toBe('"foo"*');
    expect(sanitizeFtsQuery("-bar")).toBe('"bar"*');
  });
  it("treats operators as literal tokens (no injection)", () => {
    expect(sanitizeFtsQuery("AND OR")).toBe('"and"* "or"*');
  });
  it("returns null when nothing usable remains", () => {
    expect(sanitizeFtsQuery("   ")).toBeNull();
    expect(sanitizeFtsQuery('"*:^')).toBeNull();
    expect(sanitizeFtsQuery("")).toBeNull();
  });
});

// ─── buildMessageSearchSql (pure, security contract) ──────────────────────

describe("buildMessageSearchSql", () => {
  it("non-admin: constrains to caller thread ids via IN (?, ?)", () => {
    const { sql, binds } = buildMessageSearchSql({
      tenantId: "t_a",
      threadIds: ["th_1", "th_2"],
      match: '"x"*',
      limit: 20,
    });
    expect(sql).toContain("f.thread_id IN (?, ?)");
    expect(sql).toContain("f.tenant_id = ?");
    expect(sql).toContain("f.body MATCH ?");
    expect(sql).toContain("m.deleted_at IS NULL");
    expect(binds).toEqual(["t_a", "th_1", "th_2", '"x"*', 20]);
  });

  it("admin (threadIds null): omits the thread filter, tenant-scoped only", () => {
    const { sql, binds } = buildMessageSearchSql({
      tenantId: "t_a",
      threadIds: null,
      match: '"x"*',
      limit: 10,
    });
    expect(sql).not.toContain("thread_id IN");
    expect(sql).toContain("f.tenant_id = ?");
    expect(binds).toEqual(["t_a", '"x"*', 10]);
  });
});

// ─── searchMessages procedure ─────────────────────────────────────────────

describe("messenger.searchMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.searchMessages({ tenantId: "t_a", query: "hello" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects searching a different tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.searchMessages({ tenantId: "t_b", query: "hello" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a too-short query (zod)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.searchMessages({ tenantId: "t_a", query: "a" })).rejects.toThrow();
  });

  it("member with NO threads → empty (no unconstrained leak)", async () => {
    // thread_members lookup returns [] → short-circuit, db.run never reached.
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.searchMessages({ tenantId: "t_a", query: "hello" });
    expect(out.items).toEqual([]);
  });

  it("member with threads → returns matched rows", async () => {
    const hit = {
      id: "m1",
      threadId: "th_1",
      senderKind: "external_client",
      senderRef: "tg:1",
      body: "hello there",
      createdAt: 5,
      isInternalNote: 0,
    };
    // 1) caller thread ids, 2) db.run FTS rows
    const { db } = createDbMock([[{ threadId: "th_1" }], [hit]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.searchMessages({ tenantId: "t_a", query: "hello" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe("m1");
  });

  it("system_admin searches tenant-wide (skips membership)", async () => {
    const hit = { id: "m9", threadId: "th_x", senderKind: "web_user", senderRef: "w", body: "hi", createdAt: 1, isInternalNote: 0 };
    const { db } = createDbMock([[hit]]); // only the db.run result; no membership lookup
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.searchMessages({ tenantId: "t_a", query: "hi there" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe("m9");
  });
});
