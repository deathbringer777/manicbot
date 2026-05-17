/**
 * Tests for the messenger router: auth gating, tenant scoping, DM dedup, and
 * the system_admin bypass on thread membership.
 *
 * Same mock pattern as marketingTenant-router.test.ts: createDbMock supplies
 * a chainable Drizzle stub whose `.select(...)` calls return canned rows in
 * the order the procedure issues them.
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

// ─── Auth gating ─────────────────────────────────────────────────────────

describe("messengerRouter auth gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers on listThreads", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.listThreads({ tenantId: "t_a" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects tenant_owner reading a DIFFERENT tenant's inbox", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.listThreads({ tenantId: "t_b" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects tenant_owner sendMessage on a thread in a different tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.sendMessage({ tenantId: "t_b", threadId: "th_x", body: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects empty tenantId on listThreads", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.listThreads({ tenantId: "" })).rejects.toThrow();
  });
});

// ─── listThreads happy path ─────────────────────────────────────────────

describe("messengerRouter.listThreads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("system_admin sees all tenant threads without member filter", async () => {
    // For admin path: skip member-id lookup, single thread fetch, no unread joins
    const { db } = createDbMock([
      // direct fetch of threads (admin bypass — no inArray on member ids)
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey: "w_a:w_b",
          createdByWebUserId: "w_a",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: "hello",
          archived: 0,
        },
      ],
    ]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const out = await caller.listThreads({ tenantId: "t_a" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe("th_1");
    expect(out.items[0]?.unreadCount).toBe(0);
  });

  it("returns empty when caller is not a member of any thread (non-admin)", async () => {
    // Non-admin path: first query is member-thread-ids lookup → empty
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.listThreads({ tenantId: "t_a" });
    expect(out.items).toEqual([]);
  });
});

// ─── createStaffDm ──────────────────────────────────────────────────────

describe("messengerRouter.createStaffDm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects DMing yourself", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.createStaffDm({ tenantId: "t_a", otherWebUserId: "w_owner" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects DMing a web_user from a different tenant", async () => {
    const { db } = createDbMock([
      // lookup of other user → different tenant
      [{ id: "w_other", tenantId: "t_OTHER", name: "Other" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.createStaffDm({ tenantId: "t_a", otherWebUserId: "w_other" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns existing thread id when DM already exists (dedup)", async () => {
    const { db } = createDbMock([
      // 1. lookup other user — same tenant, OK
      [{ id: "w_other", tenantId: "t_a", name: "Other" }],
      // 2. existing thread by dmKey lookup → found
      [
        {
          id: "th_existing",
          tenantId: "t_a",
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey: "w_other:w_owner",
          createdByWebUserId: "w_owner",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.createStaffDm({ tenantId: "t_a", otherWebUserId: "w_other" });
    expect(out.threadId).toBe("th_existing");
    expect(out.created).toBe(false);
  });

  it("creates a new DM thread when none exists, inserting 2 member rows", async () => {
    const dbMock = createDbMock([
      // 1. other user lookup — same tenant
      [{ id: "w_other", tenantId: "t_a", name: "Other" }],
      // 2. existing DM lookup — none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.createStaffDm({ tenantId: "t_a", otherWebUserId: "w_other" });
    expect(out.created).toBe(true);
    expect(out.threadId.startsWith("th_")).toBe(true);

    // Two inserts: threads (1 row), thread_members (2 rows in an array)
    expect(dbMock.insertCalls.length).toBe(2);

    const threadInsert = dbMock.insertCalls[0]!.values as Record<string, unknown>;
    expect(threadInsert.kind).toBe("staff_dm");
    expect(threadInsert.dmKey).toBe("w_other:w_owner"); // sorted lexicographically

    const membersInsert = dbMock.insertCalls[1]!.values as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(membersInsert)).toBe(true);
    expect(membersInsert).toHaveLength(2);
    const refs = membersInsert.map((m) => m.memberRef).sort();
    expect(refs).toEqual(["w_other", "w_owner"]);
    for (const m of membersInsert) {
      expect(m.memberKind).toBe("web_user");
    }
  });
});

// ─── createStaffGroup ───────────────────────────────────────────────────

describe("messengerRouter.createStaffGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when a proposed member isn't in the tenant", async () => {
    const { db } = createDbMock([
      // Tenant lookup returns FEWER users than requested → mismatch → FORBIDDEN
      [{ id: "w_owner" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.createStaffGroup({
        tenantId: "t_a",
        title: "Salon team",
        memberWebUserIds: ["w_owner", "w_outsider"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates group with caller as 'owner' and other members as 'member'", async () => {
    const dbMock = createDbMock([
      // tenant user verification — both present
      [{ id: "w_owner" }, { id: "w_m1" }, { id: "w_m2" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.createStaffGroup({
      tenantId: "t_a",
      title: "Salon team",
      memberWebUserIds: ["w_m1", "w_m2"],
    });
    expect(out.threadId.startsWith("th_")).toBe(true);

    // First insert: thread; second insert: members array
    expect(dbMock.insertCalls.length).toBe(2);
    const threadInsert = dbMock.insertCalls[0]!.values as Record<string, unknown>;
    expect(threadInsert.kind).toBe("staff_group");
    expect(threadInsert.title).toBe("Salon team");

    const membersInsert = dbMock.insertCalls[1]!.values as unknown as Array<Record<string, unknown>>;
    expect(membersInsert).toHaveLength(3); // creator + 2
    const ownerRow = membersInsert.find((m) => m.memberRef === "w_owner");
    expect(ownerRow?.role).toBe("owner");
    const memberRow = membersInsert.find((m) => m.memberRef === "w_m1");
    expect(memberRow?.role).toBe("member");
  });

  it("rejects empty title (after trim)", async () => {
    const { db } = createDbMock([[{ id: "w_owner" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.createStaffGroup({
        tenantId: "t_a",
        title: "   ",
        memberWebUserIds: ["w_owner"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── sendMessage ────────────────────────────────────────────────────────

describe("messengerRouter.sendMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when caller is not a thread member", async () => {
    const { db } = createDbMock([
      // assertThreadMember: 1. thread row (in correct tenant)
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey: "x:y",
          createdByWebUserId: "w_x",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      // 2. member row lookup → empty
      [],
    ]);
    const caller = createCaller(makeMasterCtx(db, "t_a") as never);
    await expect(
      caller.sendMessage({ tenantId: "t_a", threadId: "th_1", body: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns FORBIDDEN when thread belongs to a different tenant", async () => {
    const { db } = createDbMock([
      // assertThreadMember: thread lookup constrained by tenantId → no row
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    // Caller passes tenantId=t_a; thread "th_other" supposedly lives in t_b.
    // The thread row select is constrained to t_a, returns nothing → NOT_FOUND.
    await expect(
      caller.sendMessage({ tenantId: "t_a", threadId: "th_other", body: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("system_admin can sendMessage to any thread in a tenant (support escalation)", async () => {
    const dbMock = createDbMock([
      // 1. thread row found in tenant
      [
        {
          id: "th_1",
          tenantId: "t_arbitrary",
          kind: "staff_group",
          title: "Help",
          clientConversationId: null,
          dmKey: null,
          createdByWebUserId: "w_x",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      // NOTE: admin path SKIPS the member-row lookup (early return), so we
      // don't queue a second result.
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    const out = await caller.sendMessage({
      tenantId: "t_arbitrary",
      threadId: "th_1",
      body: "support reply",
    });
    expect(out.id.length).toBe(26); // ULID
    // The insert into thread_messages must have happened
    const messageInsert = dbMock.insertCalls.find((c) => {
      const v = c.values as Record<string, unknown>;
      return v.threadId === "th_1" && v.body === "support reply";
    });
    expect(messageInsert).toBeDefined();
    expect((messageInsert!.values as Record<string, unknown>).senderRef).toBe("w_admin");
  });

  it("coerces is_internal_note=true to 0 on non-client_conv threads", async () => {
    const dbMock = createDbMock([
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_dm", // not client_conv
          title: null,
          clientConversationId: null,
          dmKey: "x:y",
          createdByWebUserId: "w_x",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      // member row found
      [
        {
          threadId: "th_1",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "member",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    await caller.sendMessage({
      tenantId: "t_a",
      threadId: "th_1",
      body: "internal? no.",
      isInternalNote: true,
    });
    const insert = dbMock.insertCalls.find((c) => {
      const v = c.values as Record<string, unknown>;
      return v.body === "internal? no.";
    });
    expect((insert!.values as Record<string, unknown>).isInternalNote).toBe(0);
  });

  it("does NOT relay to Worker for staff_dm threads (no client_conv)", async () => {
    const dbMock = createDbMock([
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey: "x:y",
          createdByWebUserId: "w_x",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      [
        {
          threadId: "th_1",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "member",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.sendMessage({
      tenantId: "t_a",
      threadId: "th_1",
      body: "staff to staff",
    });
    // staff_dm never relays → relay must be null
    expect(out.relay).toBeNull();
  });

  it("relay fires for client_conv when isInternalNote=false; returns relay_not_configured when env unset", async () => {
    // The test setup mocks `~/env` without WORKER_PUBLIC_URL / ADMIN_KEY, so
    // relayToWorker short-circuits to { ok: false, error: 'relay_not_configured' }.
    const dbMock = createDbMock([
      [
        {
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
        },
      ],
      [
        {
          threadId: "th_c",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "member",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.sendMessage({
      tenantId: "t_a",
      threadId: "th_c",
      body: "ping the client",
    });
    expect(out.relay).toEqual({ ok: false, error: "relay_not_configured" });
  });

  it("relay is NULL when isInternalNote=true on client_conv (internal notes never relay)", async () => {
    const dbMock = createDbMock([
      [
        {
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
        },
      ],
      [
        {
          threadId: "th_c",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "member",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.sendMessage({
      tenantId: "t_a",
      threadId: "th_c",
      body: "secret staff note",
      isInternalNote: true,
    });
    expect(out.relay).toBeNull();
  });

  it("preserves is_internal_note=1 on client_conv threads", async () => {
    const dbMock = createDbMock([
      [
        {
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
        },
      ],
      [
        {
          threadId: "th_c",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "member",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    await caller.sendMessage({
      tenantId: "t_a",
      threadId: "th_c",
      body: "internal staff note",
      isInternalNote: true,
    });
    const insert = dbMock.insertCalls.find((c) => {
      const v = c.values as Record<string, unknown>;
      return v.body === "internal staff note";
    });
    expect((insert!.values as Record<string, unknown>).isInternalNote).toBe(1);
  });
});

// ─── listStaff ──────────────────────────────────────────────────────────

describe("messengerRouter.listStaff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { candidates, pendingInviteCount } with self filtered out", async () => {
    // Query order inside listStaff:
    //   1. web_users WHERE tenantId = X       (candidate pool, owner + other staff)
    //   2. masters WHERE tenantId = X         (display-name fallback)
    //   3. master_invitations pending count   (drives the empty-state hint)
    const { db } = createDbMock([
      // 1. web_users in this tenant
      [
        { id: "w_owner", name: "Owner", email: "o@x.com", role: "tenant_owner" },
        { id: "w_m1", name: "Master 1", email: "m1@x.com", role: "master" },
      ],
      // 2. masters table (active rows) — display-name fallback only
      [{ webUserId: "w_m1", name: "Master One (salon display)" }],
      // 3. pending invitations count
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.listStaff({ tenantId: "t_a" });
    expect(out.pendingInviteCount).toBe(0);
    expect(out.candidates.map((u) => u.id)).toEqual(["w_m1"]); // owner is self
    expect(out.candidates[0]?.name).toBe("Master 1"); // web_users.name wins over masters.name
  });

  it("surfaces pendingInviteCount when no candidates and there are pending email invites", async () => {
    const { db } = createDbMock([
      // 1. web_users — only the caller themselves
      [{ id: "w_owner", name: "Owner", email: "o@x.com", role: "tenant_owner" }],
      // 2. masters — empty
      [],
      // 3. pending invitations count — 3 pending
      [{ count: 3 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.listStaff({ tenantId: "t_a" });
    expect(out.candidates).toEqual([]);
    expect(out.pendingInviteCount).toBe(3);
  });

  it("falls back through web_users.name → masters.name → email → id", async () => {
    const { db } = createDbMock([
      // 1. web_users
      [
        { id: "w_owner", name: "Owner", email: "o@x.com", role: "tenant_owner" },
        { id: "w_a", name: null, email: "a@x.com", role: "master" },
        { id: "w_b", name: null, email: "b@x.com", role: "master" },
        { id: "w_c", name: null, email: null, role: "master" },
      ],
      // 2. masters — name fallback for w_a + w_c; w_b not present
      [
        { webUserId: "w_a", name: "Salon Display A" },
        { webUserId: "w_c", name: null },
      ],
      // 3. pending count
      [{ count: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    const out = await caller.listStaff({ tenantId: "t_a" });
    const byId = Object.fromEntries(out.candidates.map((u) => [u.id, u.name]));
    expect(byId.w_a).toBe("Salon Display A"); // masters.name fallback
    expect(byId.w_b).toBe("b@x.com");          // email fallback
    expect(byId.w_c).toBe("w_c");              // id fallback
  });
});
