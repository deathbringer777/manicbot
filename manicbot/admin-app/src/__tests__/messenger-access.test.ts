/**
 * Tests for messenger access guards (composition of assertTenantMember +
 * thread membership check).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import {
  assertMessengerTenantAccess,
  assertThreadMember,
} from "~/server/api/messenger/access";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

describe("assertMessengerTenantAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows system_admin on any tenant", async () => {
    const { db } = createDbMock();
    await expect(
      assertMessengerTenantAccess(makeAdminCtx(db), "t_anywhere"),
    ).resolves.toBeUndefined();
  });

  it("allows tenant_owner on their tenant", async () => {
    const { db } = createDbMock();
    await expect(
      assertMessengerTenantAccess(makeTenantOwnerCtx(db, "t_a"), "t_a"),
    ).resolves.toBeUndefined();
  });

  it("blocks tenant_owner on a different tenant", async () => {
    const { db } = createDbMock();
    await expect(
      assertMessengerTenantAccess(makeTenantOwnerCtx(db, "t_a"), "t_b"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks unauthenticated", async () => {
    const { db } = createDbMock();
    await expect(
      assertMessengerTenantAccess(makeUnauthCtx(db), "t_a"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks master on a NON-personal tenant", async () => {
    // assertTenantMember reads tenants.isPersonal for masters
    const { db } = createDbMock([
      [{ isPersonal: 0 }], // not personal → forbidden
    ]);
    await expect(
      assertMessengerTenantAccess(makeMasterCtx(db, "t_salon"), "t_salon"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows master on their personal tenant", async () => {
    const { db } = createDbMock([
      [{ isPersonal: 1 }],
    ]);
    await expect(
      assertMessengerTenantAccess(makeMasterCtx(db, "t_personal"), "t_personal"),
    ).resolves.toBeUndefined();
  });
});

describe("assertThreadMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FORBIDDEN if thread is in a different tenant (NOT_FOUND, in fact)", async () => {
    const { db } = createDbMock([
      // The thread row lookup is constrained by tenant_id → returns nothing
      [],
    ]);
    await expect(
      assertThreadMember(makeTenantOwnerCtx(db, "t_a"), "t_a", "th_x"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns thread + member when caller is a member", async () => {
    const { db } = createDbMock([
      // thread lookup
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_group",
          title: "Hi",
          clientConversationId: null,
          dmKey: null,
          createdByWebUserId: "w_owner",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      // member row lookup → present
      [
        {
          threadId: "th_1",
          memberKind: "web_user",
          memberRef: "w_owner",
          role: "owner",
          joinedAt: 1,
          mutedUntil: null,
          lastReadMessageId: null,
          lastReadAt: null,
        },
      ],
    ]);
    const out = await assertThreadMember(
      makeTenantOwnerCtx(db, "t_a"),
      "t_a",
      "th_1",
    );
    expect(out.thread.id).toBe("th_1");
    expect(out.member?.memberRef).toBe("w_owner");
  });

  it("FORBIDDEN when thread exists but caller is not a member (non-admin)", async () => {
    const { db } = createDbMock([
      // thread lookup → present in tenant
      [
        {
          id: "th_1",
          tenantId: "t_a",
          kind: "staff_group",
          title: null,
          clientConversationId: null,
          dmKey: null,
          createdByWebUserId: "w_other",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
      // member row lookup → empty
      [],
    ]);
    await expect(
      assertThreadMember(makeTenantOwnerCtx(db, "t_a"), "t_a", "th_1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin bypasses the membership check (support escalation)", async () => {
    const { db } = createDbMock([
      [
        {
          id: "th_1",
          tenantId: "t_some",
          kind: "client_conv",
          title: null,
          clientConversationId: "conv_z",
          dmKey: null,
          createdByWebUserId: null,
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
    ]);
    const out = await assertThreadMember(makeAdminCtx(db), "t_some", "th_1");
    expect(out.thread.id).toBe("th_1");
    expect(out.member).toBeNull(); // admin bypass — no member row
  });

  it("rejects empty threadId / tenantId", async () => {
    const { db } = createDbMock();
    await expect(
      assertThreadMember(makeTenantOwnerCtx(db, "t_a"), "t_a", ""),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      assertThreadMember(makeTenantOwnerCtx(db, "t_a"), "", "th_1"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
