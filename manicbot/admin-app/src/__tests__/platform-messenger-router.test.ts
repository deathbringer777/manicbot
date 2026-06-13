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
import {
  platformMessengerRouter,
  isFakeRecipientEmail,
} from "~/server/api/routers/platformMessenger";
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

  it("listThreads allows system_admin and returns rows (single joined query)", async () => {
    // listThreads now joins web_users (+ tenants) in ONE query and returns flat
    // rows already carrying recipient name/email/isTest — no second round-trip.
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
          recipientEmail: "a@x.com",
          recipientName: "Owner A",
          userTenantId: "t_a",
          tenantIsTest: 0,
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
          recipientEmail: "b@x.com",
          recipientName: "Owner B",
          userTenantId: "t_b",
          tenantIsTest: 0,
        },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listThreads({});
    expect(out.items).toHaveLength(2);
    expect(out.items[0]?.recipientName).toBe("Owner A");
    expect(out.items[0]?.recipientEmail).toBe("a@x.com");
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
        { id: "w_owner_a", email: "a@x.com", name: "A", tenantId: "t_a", plan: "pro", role: "tenant_owner" },
        { id: "w_owner_b", email: "b@x.com", name: "B", tenantId: "t_b", plan: "start", role: "tenant_owner" },
        { id: "w_owner_c", email: "c@x.com", name: "C", tenantId: "t_c", plan: "max", role: "tenant_manager" },
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
        { id: "w_a", email: "a@x.com", name: "A", tenantId: "t_a", plan: "pro", role: "tenant_owner" },
        { id: "w_b", email: "b@x.com", name: "B", tenantId: "t_b", plan: "max", role: "tenant_owner" },
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

// ─── multi-line body structure survives to storage ──────────────────────
//
// Regression for the "wall of text" bug: operator-composed bodies must keep
// their paragraph breaks (\n\n) all the way into platform_thread_messages.body
// and platform_broadcasts.body. The render layer is already whitespace-pre-wrap;
// the write path used to flatten newlines via sanitizeText. sanitizeMessageBody
// preserves them.

describe("platformMessengerRouter preserves multi-line body structure", () => {
  beforeEach(() => vi.clearAllMocks());

  const MULTILINE = "Hi {salon_name}!\n\nNews here.\n\nCheck it 👉";

  it("sendDirectMessage stores the body with paragraph breaks intact", async () => {
    const { db, insertCalls } = createDbMock([
      // recipient lookup
      [{ id: "w_owner", email: "owner@gmail.com", tenantId: "t_a", role: "tenant_owner" }],
      // ensureThread → existing thread (no insert race)
      [{ id: "pt_1" }],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await caller.sendDirectMessage({ recipientWebUserId: "w_owner", body: MULTILINE });

    const msg = insertCalls.find((c) => typeof c.values.body === "string");
    expect(msg).toBeTruthy();
    expect(msg!.values.body).toContain("\n\n");
    expect(msg!.values.body).toContain("Check it 👉");
    // Token left verbatim for delivery-time substitution.
    expect(msg!.values.body).toContain("{salon_name}");
  });

  it("broadcast stores both the audit row body and the per-recipient message body with breaks", async () => {
    const { db, insertCalls } = createDbMock([
      // resolveAudience (scope: all) → one real owner
      [{ id: "w_owner", email: "owner@gmail.com", name: "Owner", tenantId: "t_a", plan: "pro", role: "tenant_owner" }],
      // ensureThread → existing thread
      [{ id: "pt_1" }],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await caller.broadcast({ body: MULTILINE, audience: { scope: "all" } });

    const bodies = insertCalls
      .map((c) => c.values.body)
      .filter((b): b is string => typeof b === "string");
    // broadcast audit row + one recipient message — both keep \n\n.
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const b of bodies) expect(b).toContain("\n\n");
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

// ─── Test / synthetic / master exclusion ────────────────────────────────
//
// Regression: a `scope: "all"` broadcast used to fan out to every verified
// salon-side account — including synthetic *.salon.manicbot.local staff
// mailboxes and *.test.manicbot.local test-tenant accounts — flooding the
// sysadmin inbox with one thread per fake account. Broadcasts now target
// real owners/managers only, and both the broadcast audience and the inbox
// list exclude fake addresses. The SQL WHERE does the real filtering; a
// defensive JS filter mirrors it so the behaviour is observable here (the
// mock DB ignores WHERE clauses and returns queued rows verbatim).

describe("isFakeRecipientEmail", () => {
  it("flags synthetic salon + test-tenant mailboxes", () => {
    expect(isFakeRecipientEmail("anna.95np@salon.manicbot.local")).toBe(true);
    expect(isFakeRecipientEmail("master-pro@test.manicbot.local")).toBe(true);
    expect(isFakeRecipientEmail("ANNA@SALON.MANICBOT.LOCAL")).toBe(true);
  });

  it("treats real addresses as legitimate", () => {
    expect(isFakeRecipientEmail("owner@gmail.com")).toBe(false);
    expect(isFakeRecipientEmail("a@x.com")).toBe(false);
    // Not a fake unless it actually ends in the internal domain.
    expect(isFakeRecipientEmail("manicbot.local@gmail.com")).toBe(false);
    expect(isFakeRecipientEmail(null)).toBe(false);
    expect(isFakeRecipientEmail("")).toBe(false);
  });
});

describe("platformMessengerRouter audience excludes fake + master recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previewAudience drops synthetic, test, and master rows — keeps real owner/manager", async () => {
    const { db } = createDbMock([
      [
        { id: "w_real_owner", email: "owner@gmail.com", name: "Real", tenantId: "t_real", plan: "pro", role: "tenant_owner" },
        { id: "w_real_mgr", email: "mgr@gmail.com", name: "Mgr", tenantId: "t_real", plan: "pro", role: "tenant_manager" },
        { id: "w_syn", email: "anna.95np@salon.manicbot.local", name: "Synthetic", tenantId: "t_real", plan: "pro", role: "master" },
        { id: "w_test", email: "master-pro@test.manicbot.local", name: "Test", tenantId: "t_test", plan: "max", role: "tenant_owner" },
        { id: "w_master_real", email: "stylist@gmail.com", name: "Real Master", tenantId: "t_real", plan: "pro", role: "master" },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.previewAudience({ audience: { scope: "all" } });
    // Only the real owner + real manager survive: synthetic + test emails and
    // every master role are excluded.
    expect(out.count).toBe(2);
    const ids = out.sample.map((s) => s.id);
    expect(ids).toContain("w_real_owner");
    expect(ids).toContain("w_real_mgr");
    expect(ids).not.toContain("w_syn");
    expect(ids).not.toContain("w_test");
    expect(ids).not.toContain("w_master_real");
  });

  it("broadcast to an all-fake audience throws BAD_REQUEST (zero real recipients)", async () => {
    const { db, insertCalls } = createDbMock([
      [
        { id: "w_syn", email: "x.ab12@salon.manicbot.local", name: "Syn", tenantId: "t_real", plan: "pro", role: "master" },
        { id: "w_test", email: "salon-max@test.manicbot.local", name: "Test", tenantId: "t_test", plan: "max", role: "tenant_owner" },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(
      caller.broadcast({ body: "announce", audience: { scope: "all" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // No audit row, no messages: nothing was written for a fake-only audience.
    expect(insertCalls.length).toBe(0);
  });
});

// ─── retractBroadcast (purge a broadcast + recompute thread headers) ─────
//
// Mirrors the Worker seam retract (src/services/platformRetract.js). The mock
// DB records delete/update calls and serves a FIFO of select results: the
// procedure first selects the affected thread ids, then (per distinct thread)
// selects the newest remaining message to recompute the denormalized header.

describe("platformMessengerRouter.retractBroadcast", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects tenant_owner (sysadmin-only)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.retractBroadcast({ broadcastId: "bc_x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deletes message copies + the audit row and reports deduped counts", async () => {
    const { db, deleteCalls } = createDbMock([
      // 1. affected threads (pt_a appears twice → deduped)
      [{ threadId: "pt_a" }, { threadId: "pt_b" }, { threadId: "pt_a" }],
      // 2. recompute pt_a → newest remaining
      [{ body: "новое", senderKind: "platform", createdAt: 200 }],
      // 3. recompute pt_b → empty
      [],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.retractBroadcast({ broadcastId: "bc_x" });
    expect(out.removed).toBe(3);
    expect(out.threadsTouched).toBe(2);
    // two deletes: platform_thread_messages copies + the platform_broadcasts row
    expect(deleteCalls.length).toBe(2);
    expect(deleteCalls.every((d) => d.whereCalled)).toBe(true);
  });

  it("recomputes the header to the newest remaining message (newer-message case)", async () => {
    const { db, updateCalls } = createDbMock([
      [{ threadId: "pt_a" }],
      [{ body: "новое объявление", senderKind: "platform", createdAt: 200 }],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await caller.retractBroadcast({ broadcastId: "bc_x" });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.values).toMatchObject({
      lastMessageAt: 200,
      lastMessagePreview: "новое объявление",
      lastSenderKind: "platform",
    });
  });

  it("nulls the header when no message remains (empty case)", async () => {
    const { db, updateCalls } = createDbMock([
      [{ threadId: "pt_b" }],
      [],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    await caller.retractBroadcast({ broadcastId: "bc_x" });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.values).toMatchObject({
      lastMessageAt: null,
      lastMessagePreview: null,
      lastSenderKind: null,
    });
  });

  it("unknown broadcast → 0 removed, no recompute", async () => {
    const { db, updateCalls } = createDbMock([
      [], // no copies
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.retractBroadcast({ broadcastId: "bc_none" });
    expect(out.removed).toBe(0);
    expect(out.threadsTouched).toBe(0);
    expect(updateCalls.length).toBe(0);
  });
});

describe("platformMessengerRouter.listThreads excludes fake recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("omits synthetic / test-tenant threads, keeps real-email threads", async () => {
    const { db } = createDbMock([
      [
        {
          id: "pt_real",
          recipientWebUserId: "w_real",
          recipientTenantId: "t_real",
          lastMessageAt: 300,
          lastMessagePreview: "hi",
          lastSenderKind: "platform",
          recipientLastReadAt: null,
          platformLastReadAt: 300,
          archived: 0,
          createdAt: 100,
          recipientEmail: "owner@gmail.com",
          recipientName: "Real Owner",
          userTenantId: "t_real",
          tenantIsTest: 0,
        },
        {
          id: "pt_syn",
          recipientWebUserId: "w_syn",
          recipientTenantId: "t_real",
          lastMessageAt: 250,
          lastMessagePreview: "тест",
          lastSenderKind: "platform",
          recipientLastReadAt: null,
          platformLastReadAt: 250,
          archived: 0,
          createdAt: 90,
          recipientEmail: "ffdfdf.hz6z@salon.manicbot.local",
          recipientName: "ffdfdf",
          userTenantId: "t_real",
          tenantIsTest: 0,
        },
        {
          id: "pt_test",
          recipientWebUserId: "w_test",
          recipientTenantId: "t_test",
          lastMessageAt: 200,
          lastMessagePreview: "тест",
          lastSenderKind: "platform",
          recipientLastReadAt: null,
          platformLastReadAt: 200,
          archived: 0,
          createdAt: 80,
          recipientEmail: "master-pro@test.manicbot.local",
          recipientName: "Test Майстер Pro",
          userTenantId: "t_test",
          tenantIsTest: 1,
        },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listThreads({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe("pt_real");
    expect(out.items[0]?.recipientEmail).toBe("owner@gmail.com");
  });
});
