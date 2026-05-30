/**
 * Tests for the platform messenger router (migration 0076).
 *
 * Critical invariants:
 *   - Owner can ONLY read their OWN platform_threads row. No probing other
 *     owners' threads by id.
 *   - system_admin can read/write any platform_threads row, but the surface
 *     procedures used by owners (getMyThread / markMyThreadRead) still scope
 *     by ctx.webUser.id — even if sysadmin calls them, they touch only their
 *     own (effectively empty) thread.
 *   - broadcast and listThreads + sendDirectMessage are sysadmin-only.
 *   - sendMyReply is DISABLED: the ManicBot channel is read-only (one-way,
 *     like a broadcast channel). Owner replies are rejected with FORBIDDEN.
 *     Support lives elsewhere (Settings → Help → "Write to support").
 *
 * Mock pattern mirrors messenger-router.test.ts: createDbMock seeds a FIFO
 * queue of select results matching the order the procedure issues them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));
vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: vi.fn(async () => ({ ok: true, id: "n_test" })),
  notifyManyWebUsers: vi.fn(async () => ({ ok: 1, deduped: 0, failed: 0 })),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { platformMessengerRouter } from "~/server/api/routers/platformMessenger";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(platformMessengerRouter);

// ─── Auth gating ────────────────────────────────────────────────────────

describe("platformMessengerRouter auth gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers on getMyThread", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.getMyThread()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated callers on sendMyReply (auth gate runs before the read-only guard)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.sendMyReply()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects tenant_owner from listThreads (sysadmin-only)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.listThreads({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_owner from broadcast", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.broadcast({ body: "hi", audience: { scope: "all" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_owner from sendDirectMessage", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.sendDirectMessage({ recipientWebUserId: "w_owner_2", body: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects support staff (non-system_admin) from broadcast", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    await expect(
      caller.broadcast({ body: "hi", audience: { scope: "all" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects technical_support from sendDirectMessage", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeSupportCtx(db, "technical_support") as never);
    await expect(
      caller.sendDirectMessage({ recipientWebUserId: "w_x", body: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_owner from previewAudience", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.previewAudience({ audience: { scope: "all" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── Tenant isolation (owner can only see THEIR thread) ─────────────────

describe("platformMessengerRouter tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getMyThread scopes by ctx.webUser.id (cannot probe other thread ids)", async () => {
    // Even if the DB had owner_B's row, the WHERE clause uses ctx.webUser.id
    // so the mock returns [] (nothing matches w_owner's id under this filter).
    const { db } = createDbMock([
      // platform_threads SELECT — nothing for this caller
      [],
      // messages SELECT (only fires if thread exists) — also empty
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.getMyThread();
    expect(out.thread).toBeNull();
    expect(out.messages).toEqual([]);
  });

  it("returns owner's own thread when it exists", async () => {
    const { db } = createDbMock([
      [
        {
          id: "pt_1",
          recipientWebUserId: "w_owner",
          recipientTenantId: "t_a",
          lastMessageAt: 100,
          lastMessagePreview: "hi from platform",
          lastSenderKind: "platform",
          recipientLastReadAt: null,
          platformLastReadAt: 100,
          archived: 0,
          createdAt: 50,
        },
      ],
      [
        {
          id: "m_1",
          threadId: "pt_1",
          senderKind: "platform",
          senderWebUserId: "w_admin",
          body: "hi from platform",
          attachmentsJson: null,
          broadcastId: null,
          createdAt: 100,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.getMyThread();
    expect(out.thread?.id).toBe("pt_1");
    expect(out.thread?.recipientWebUserId).toBe("w_owner");
    expect(out.messages).toHaveLength(1);
    expect(out.unreadCount).toBe(1);
  });

  it("master role can also have a platform thread (web_user-scoped, not role-scoped)", async () => {
    const { db } = createDbMock([
      [
        {
          id: "pt_m",
          recipientWebUserId: "w_master",
          recipientTenantId: "t_a",
          lastMessageAt: 200,
          lastMessagePreview: "welcome",
          lastSenderKind: "platform",
          recipientLastReadAt: 200,
          platformLastReadAt: 200,
          archived: 0,
          createdAt: 100,
        },
      ],
      [],
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_a") as never);
    const out = await caller.getMyThread();
    expect(out.thread?.id).toBe("pt_m");
    expect(out.unreadCount).toBe(0);
  });

  it("sendMyReply is disabled — read-only channel rejects authenticated owners with FORBIDDEN", async () => {
    const { db, insertCalls } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.sendMyReply()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // No write side effects: the channel never accepts owner messages.
    expect(insertCalls.length).toBe(0);
  });
});

// ─── sysadmin happy path ────────────────────────────────────────────────

describe("platformMessengerRouter sysadmin operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listThreads allows system_admin and returns rows", async () => {
    const { db } = createDbMock([
      [
        {
          id: "pt_a",
          recipientWebUserId: "w_owner_a",
          recipientTenantId: "t_a",
          lastMessageAt: 200,
          lastMessagePreview: "...",
          lastSenderKind: "owner",
          recipientLastReadAt: 200,
          platformLastReadAt: null,
          archived: 0,
          createdAt: 100,
        },
        {
          id: "pt_b",
          recipientWebUserId: "w_owner_b",
          recipientTenantId: "t_b",
          lastMessageAt: 150,
          lastMessagePreview: "hello",
          lastSenderKind: "platform",
          recipientLastReadAt: null,
          platformLastReadAt: 150,
          archived: 0,
          createdAt: 90,
        },
      ],
      // Recipient enrichment SELECT (web_users JOIN)
      [
        { id: "w_owner_a", email: "a@x.com", name: "Owner A", tenantId: "t_a" },
        { id: "w_owner_b", email: "b@x.com", name: "Owner B", tenantId: "t_b" },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listThreads({});
    expect(out.items).toHaveLength(2);
    expect(out.items[0]?.recipientName).toBe("Owner A");
  });

  it("sendDirectMessage to non-existent recipient throws NOT_FOUND", async () => {
    const { db } = createDbMock([
      // recipient lookup → not found
      [],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.sendDirectMessage({ recipientWebUserId: "w_ghost", body: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("previewAudience returns count for scope=all", async () => {
    const { db } = createDbMock([
      // recipients query
      [
        { id: "w_owner_a", email: "a@x.com", name: "A", tenantId: "t_a", plan: "pro" },
        { id: "w_owner_b", email: "b@x.com", name: "B", tenantId: "t_b", plan: "start" },
        { id: "w_owner_c", email: "c@x.com", name: "C", tenantId: "t_c", plan: "max" },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.previewAudience({ audience: { scope: "all" } });
    expect(out.count).toBe(3);
    expect(out.sample.length).toBe(3);
  });

  it("previewAudience filters by plan", async () => {
    const { db } = createDbMock([
      // 1. matching tenants by plan
      [{ id: "t_a" }, { id: "t_b" }],
      // 2. webUsers filtered by those tenants
      [
        { id: "w_a", email: "a@x.com", name: "A", tenantId: "t_a", plan: "pro" },
        { id: "w_b", email: "b@x.com", name: "B", tenantId: "t_b", plan: "max" },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.previewAudience({
      audience: { scope: "by_plan", plans: ["pro", "max"] },
    });
    expect(out.count).toBe(2);
  });

  it("broadcast rejects empty body", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.broadcast({ body: "   ", audience: { scope: "all" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("broadcast with no recipients throws BAD_REQUEST (don't write empty audit row)", async () => {
    const { db } = createDbMock([
      // recipients lookup → none match filter
      [],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.broadcast({
        body: "announce",
        audience: { scope: "by_plan", plans: ["pro"] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── markMyThreadRead idempotency ────────────────────────────────────────

describe("platformMessengerRouter markMyThreadRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when caller has no thread (idempotent)", async () => {
    const { db } = createDbMock([
      // thread lookup → none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.markMyThreadRead();
    expect(out.ok).toBe(true);
  });

  it("bumps recipient_last_read_at when thread exists", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "pt_1", recipientWebUserId: "w_owner" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.markMyThreadRead();
    expect(out.ok).toBe(true);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.values.recipientLastReadAt).toBeTypeOf("number");
  });
});

// ─── listBroadcasts (sysadmin history) ──────────────────────────────────

describe("platformMessengerRouter.listBroadcasts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects tenant_owner", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.listBroadcasts({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns rows for system_admin ordered newest first", async () => {
    const { db } = createDbMock([
      [
        {
          id: "b_2",
          senderWebUserId: "w_admin",
          title: "New billing",
          body: "We're rolling out v2 plans...",
          audienceFilterJson: '{"scope":"all"}',
          recipientsCount: 47,
          createdAt: 200,
        },
        {
          id: "b_1",
          senderWebUserId: "w_admin",
          title: null,
          body: "Welcome to ManicBot",
          audienceFilterJson: '{"scope":"all"}',
          recipientsCount: 12,
          createdAt: 100,
        },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listBroadcasts({});
    expect(out.items).toHaveLength(2);
    expect(out.items[0]?.id).toBe("b_2");
    expect(out.items[0]?.recipientsCount).toBe(47);
  });
});
