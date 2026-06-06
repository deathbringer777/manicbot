/**
 * Default staff group ("Команда") — auto-seeded per tenant.
 *
 * Surfaces:
 *   1. `ensureDefaultStaffGroup(db, tenantId)` — internal helper, find-or-create.
 *      Idempotent. Adds the tenant_owner as the only initial member (role='owner').
 *   2. `addMasterToDefaultGroup(db, tenantId, masterChatId)` — internal helper.
 *      Picks `web_user` kind when the master already has a web account,
 *      `master` kind otherwise (Telegram-only). Idempotent via PK conflict.
 *   3. `messenger.removeStaffMember` — owner-only mutation that drops a row
 *      from `thread_members` AND posts a "user was removed" system message.
 *      Refuses to remove the owner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import {
  ensureDefaultStaffGroup,
  addMasterToDefaultGroup,
} from "~/server/messenger/defaultStaffGroup";
import { createDbMock, makeTenantOwnerCtx, makeMasterCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

describe("defaultStaffGroup — ensureDefaultStaffGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the existing default group when one already exists for the tenant", async () => {
    const { db, insertCalls } = createDbMock([
      // SELECT existing default group → found
      [{ id: "th_existing" }],
    ]);
    const out = await ensureDefaultStaffGroup(db as never, "t_salon");
    expect(out.threadId).toBe("th_existing");
    expect(out.created).toBe(false);
    expect(insertCalls).toHaveLength(0);
  });

  it("creates a new default group and seeds the owner when none exists", async () => {
    const { db, insertCalls } = createDbMock([
      // SELECT existing default group → none
      [],
      // SELECT tenant (parent_tenant_id) → primary salon (no parent)
      [{ parentTenantId: null }],
      // SELECT tenant_owner → owner row
      [{ id: "w_owner" }],
    ]);
    const out = await ensureDefaultStaffGroup(db as never, "t_salon");
    expect(out.threadId).toMatch(/^th_/);
    expect(out.created).toBe(true);

    // The threads INSERT must mark isDefaultGroup=1.
    const threadInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).kind === "staff_group",
    );
    expect(threadInsert).toBeDefined();
    expect((threadInsert!.values as Record<string, unknown>).isDefaultGroup).toBe(1);
    expect((threadInsert!.values as Record<string, unknown>).tenantId).toBe("t_salon");

    // The thread_members INSERT must seed the owner with role='owner'.
    const ownerInsert = insertCalls.find(
      (c) =>
        (c.values as Record<string, unknown>).memberKind === "web_user" &&
        (c.values as Record<string, unknown>).memberRef === "w_owner",
    );
    expect(ownerInsert).toBeDefined();
    expect((ownerInsert!.values as Record<string, unknown>).role).toBe("owner");
  });

  it("does not throw if tenant has no resolvable owner (degraded but safe)", async () => {
    // Edge case: brand-new tenant or owner row missing — function still
    // creates the group so subsequent master adds don't crash; owner row
    // is omitted.
    const { db, insertCalls } = createDbMock([
      [], // no existing group
      [{ parentTenantId: null }], // tenant lookup → primary salon
      [], // no owner found
    ]);
    const out = await ensureDefaultStaffGroup(db as never, "t_salon");
    expect(out.created).toBe(true);
    // No owner member insert.
    const ownerInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).role === "owner",
    );
    expect(ownerInsert).toBeUndefined();
  });

  it("resolves the owner via parent_tenant_id for a secondary salon (0117)", async () => {
    // A secondary salon has no web_users row of its own — the owner lives on the
    // HOME tenant. ensureDefaultStaffGroup must follow parent_tenant_id so the
    // group is still seeded with its owner.
    const { db, insertCalls } = createDbMock([
      [], // no existing group
      [{ parentTenantId: "t_home" }], // this salon is a secondary of t_home
      [{ id: "w_owner" }], // owner found in the parent (home) tenant
    ]);
    const out = await ensureDefaultStaffGroup(db as never, "t_secondary");
    expect(out.created).toBe(true);
    const ownerInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).memberRef === "w_owner",
    );
    expect(ownerInsert).toBeDefined();
    expect((ownerInsert!.values as Record<string, unknown>).role).toBe("owner");
  });
});

describe("defaultStaffGroup — addMasterToDefaultGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a master with webUserId as member_kind='web_user'", async () => {
    const { db, insertCalls } = createDbMock([
      // SELECT default group → exists
      [{ id: "th_def" }],
      // SELECT master row → has webUserId
      [{ chatId: 10_000_000_001, webUserId: "w_master" }],
    ]);
    await addMasterToDefaultGroup(db as never, "t_salon", 10_000_000_001);
    const memberInsert = insertCalls.find(
      (c) =>
        (c.values as Record<string, unknown>).memberKind === "web_user" &&
        (c.values as Record<string, unknown>).memberRef === "w_master",
    );
    expect(memberInsert).toBeDefined();
    expect((memberInsert!.values as Record<string, unknown>).threadId).toBe("th_def");
    expect((memberInsert!.values as Record<string, unknown>).role).toBe("member");
  });

  it("adds a telegram-only master as member_kind='master' with chatId string ref", async () => {
    const { db, insertCalls } = createDbMock([
      [{ id: "th_def" }],
      [{ chatId: 555_000_111, webUserId: null }],
    ]);
    await addMasterToDefaultGroup(db as never, "t_salon", 555_000_111);
    const memberInsert = insertCalls.find(
      (c) =>
        (c.values as Record<string, unknown>).memberKind === "master" &&
        (c.values as Record<string, unknown>).memberRef === "555000111",
    );
    expect(memberInsert).toBeDefined();
    expect((memberInsert!.values as Record<string, unknown>).threadId).toBe("th_def");
  });

  it("auto-creates the default group on first call when missing", async () => {
    const { db, insertCalls } = createDbMock([
      // SELECT default group → none → ensure triggers
      [],
      // SELECT tenant (parent_tenant_id) → primary salon
      [{ parentTenantId: null }],
      // SELECT tenant_owner → owner row
      [{ id: "w_owner" }],
      // SELECT master row → has webUserId
      [{ chatId: 10_000_000_001, webUserId: "w_master" }],
    ]);
    await addMasterToDefaultGroup(db as never, "t_salon", 10_000_000_001);
    const threadInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).kind === "staff_group",
    );
    expect(threadInsert).toBeDefined();
    const memberInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).memberRef === "w_master",
    );
    expect(memberInsert).toBeDefined();
  });

  it("returns silently when master row is missing (best-effort)", async () => {
    const { db, insertCalls } = createDbMock([
      [{ id: "th_def" }],
      [], // master not found
    ]);
    await expect(
      addMasterToDefaultGroup(db as never, "t_salon", 999_999),
    ).resolves.toBeUndefined();
    const memberInsert = insertCalls.find(
      (c) =>
        (c.values as Record<string, unknown>).memberKind === "master" ||
        (c.values as Record<string, unknown>).memberKind === "web_user",
    );
    // Allow the owner-seed insert from an empty-group path; only the
    // master-targeted insert is forbidden.
    if (memberInsert) {
      expect((memberInsert.values as Record<string, unknown>).memberRef).not.toBe("999999");
    }
  });

  it("swallows DB errors so the parent mutation never aborts", async () => {
    // Force the master lookup to throw — the helper must absorb it.
    const throwingDb = {
      select: vi.fn(() => {
        throw new Error("boom");
      }),
      insert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    };
    await expect(
      addMasterToDefaultGroup(throwingDb as never, "t_salon", 1),
    ).resolves.toBeUndefined();
  });
});

describe("messenger.removeStaffMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-owner callers with FORBIDDEN", async () => {
    // tenantOwnerProcedure middleware rejects before any DB call.
    const { db } = createDbMock();
    const ctx = makeMasterCtx(db as never, "t_salon");
    const caller = createCaller(ctx as never);
    await expect(
      caller.removeStaffMember({
        tenantId: "t_salon",
        threadId: "th_def",
        memberKind: "web_user",
        memberRef: "w_other",
      } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to remove a member with role='owner' (BAD_REQUEST)", async () => {
    // assertTenantMember short-circuits for tenant_owner (no DB call), so the
    // first mock result feeds the thread SELECT directly.
    const { db } = createDbMock([
      // SELECT thread → exists in tenant
      [{ id: "th_def", tenantId: "t_salon", kind: "staff_group" }],
      // SELECT target member → role 'owner'
      [{ role: "owner" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db as never, "t_salon") as never);
    await expect(
      caller.removeStaffMember({
        tenantId: "t_salon",
        threadId: "th_def",
        memberKind: "web_user",
        memberRef: "w_other_owner",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when the thread does not belong to the caller's tenant", async () => {
    const { db } = createDbMock([
      // SELECT thread → none (lookup is scoped by tenantId)
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db as never, "t_salon") as never);
    await expect(
      caller.removeStaffMember({
        tenantId: "t_salon",
        threadId: "th_other_tenant",
        memberKind: "web_user",
        memberRef: "w_x",
      } as never),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes the member row and posts a 'removed by owner' system message", async () => {
    const { db, deleteCalls, insertCalls } = createDbMock([
      // thread lookup
      [{ id: "th_def", tenantId: "t_salon", kind: "staff_group" }],
      // target member
      [{ role: "member" }],
      // display-name lookup (web_users for web_user kind)
      [{ name: "Peer" }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db as never, "t_salon") as never);
    await caller.removeStaffMember({
      tenantId: "t_salon",
      threadId: "th_def",
      memberKind: "web_user",
      memberRef: "w_peer",
    } as never);
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    const sysMsg = insertCalls.find(
      (c) => (c.values as Record<string, unknown>).senderKind === "system",
    );
    expect(sysMsg).toBeDefined();
    expect((sysMsg!.values as Record<string, unknown>).threadId).toBe("th_def");
  });
});
