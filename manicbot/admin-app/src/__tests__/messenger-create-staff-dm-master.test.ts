/**
 * `messenger.createStaffDm` — extension for opening a DM with a master who
 * has NO web account yet (Telegram-only or invite-pending).
 *
 * Why:
 *   Even before the master joins web, the owner needs a place to write down
 *   notes / instructions / agreed terms. We create a "placeholder thread"
 *   immediately. The master row is recorded in `thread_members` with
 *   member_kind='master' + member_ref=String(masters.chat_id). When the
 *   master eventually creates a web account (invite accept / Telegram-→-web
 *   pairing), a backfill helper swaps that row to member_kind='web_user' +
 *   recomputes the dm_key — and the master sees the full history.
 *
 * Input shape (extended):
 *   - Existing branch: { tenantId, otherWebUserId }
 *   - New branch:      { tenantId, otherMasterChatId }
 *   Exactly one of the two `other*` keys must be provided.
 *
 * dm_key convention:
 *   - web_user × web_user → unchanged: sorted("a:b") of the two UUIDs.
 *   - web_user × master   → sorted with "m:<chatId>" sentinel so the
 *     master ref doesn't collide with a real web_user UUID. After backfill
 *     swaps the placeholder to a real web_user, the dm_key is recomputed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

describe("messenger.createStaffDm — master placeholder branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when both otherWebUserId AND otherMasterChatId are supplied", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    await expect(
      caller.createStaffDm({
        tenantId: "t_salon",
        otherWebUserId: "w_x",
        otherMasterChatId: "555000111",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when neither otherWebUserId nor otherMasterChatId is supplied", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    await expect(
      caller.createStaffDm({ tenantId: "t_salon" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("creates a placeholder thread for a telegram-only master (no web account)", async () => {
    const dbMock = createDbMock([
      // 1. lookup master row by (tenantId, chatId)
      [
        {
          chatId: 555_000_111,
          name: "Olena",
          webUserId: null,
          archivedAt: null,
          isSynthetic: 0,
        },
      ],
      // 2. existing thread by dmKey lookup → none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_salon") as never);
    const out = await caller.createStaffDm({
      tenantId: "t_salon",
      otherMasterChatId: "555000111",
    });
    expect(out.created).toBe(true);
    expect(out.threadId.startsWith("th_")).toBe(true);

    // Two inserts: threads (1), thread_members (2 rows)
    expect(dbMock.insertCalls.length).toBe(2);
    const threadInsert = dbMock.insertCalls[0]!.values as Record<string, unknown>;
    expect(threadInsert.kind).toBe("staff_dm");
    // dm_key uses "m:<chatId>" sentinel for the master, sorted.
    expect(threadInsert.dmKey).toMatch(/(^m:555000111:|:m:555000111$)/);

    const membersInsert = dbMock.insertCalls[1]!.values as unknown as Array<
      Record<string, unknown>
    >;
    expect(membersInsert).toHaveLength(2);
    const callerRow = membersInsert.find((m) => m.memberKind === "web_user");
    expect(callerRow?.memberRef).toBe("w_owner");
    const masterRow = membersInsert.find((m) => m.memberKind === "master");
    expect(masterRow?.memberRef).toBe("555000111");
  });

  it("dedupes — returns existing placeholder thread when one already exists", async () => {
    const dbMock = createDbMock([
      // 1. master row found
      [
        {
          chatId: 555_000_111,
          name: "Olena",
          webUserId: null,
          archivedAt: null,
          isSynthetic: 0,
        },
      ],
      // 2. existing thread by dmKey → found
      [
        {
          id: "th_existing_placeholder",
          tenantId: "t_salon",
          kind: "staff_dm",
          title: null,
          clientConversationId: null,
          dmKey: "m:555000111:w_owner",
          createdByWebUserId: "w_owner",
          createdAt: 1,
          lastMessageAt: 2,
          lastMessagePreview: null,
          archived: 0,
        },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_salon") as never);
    const out = await caller.createStaffDm({
      tenantId: "t_salon",
      otherMasterChatId: "555000111",
    });
    expect(out.threadId).toBe("th_existing_placeholder");
    expect(out.created).toBe(false);
    // No inserts for the dedup path.
    expect(dbMock.insertCalls.length).toBe(0);
  });

  it("rejects when master row doesn't exist in this tenant (FORBIDDEN)", async () => {
    const { db } = createDbMock([
      // 1. master lookup → none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    await expect(
      caller.createStaffDm({
        tenantId: "t_salon",
        otherMasterChatId: "555000111",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when master row exists but is archived", async () => {
    const { db } = createDbMock([
      // 1. master lookup — archived row returned, then SQL filter rejects it
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_salon") as never);
    await expect(
      caller.createStaffDm({
        tenantId: "t_salon",
        otherMasterChatId: "555000111",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("redirects to web_user DM when the master row HAS a web account", async () => {
    // Edge case: someone calls with `otherMasterChatId` but the master
    // already has a web_user_id. We DM the web_user instead so we don't
    // create a duplicate (orphan) placeholder thread.
    const dbMock = createDbMock([
      // 1. master lookup — already linked to a web_user
      [
        {
          chatId: 10_000_000_001,
          name: "Linked",
          webUserId: "w_linked",
          archivedAt: null,
          isSynthetic: 1,
        },
      ],
      // 2. existing web_user DM lookup → none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_salon") as never);
    const out = await caller.createStaffDm({
      tenantId: "t_salon",
      otherMasterChatId: "10000000001",
    });
    expect(out.created).toBe(true);

    const threadInsert = dbMock.insertCalls[0]!.values as Record<string, unknown>;
    // dm_key uses real web_user IDs, NOT the master sentinel.
    expect(threadInsert.dmKey).toBe("w_linked:w_owner");
    const membersInsert = dbMock.insertCalls[1]!.values as unknown as Array<
      Record<string, unknown>
    >;
    for (const m of membersInsert) {
      expect(m.memberKind).toBe("web_user");
    }
  });
});

describe("messenger.createStaffDm — relaxed cross-tenant guard for web_user branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows DM with a web_user whose web_users.tenant_id is DIFFERENT, when they're linked to a master in this salon", async () => {
    // Scenario: master self-registered → personal tenant → accepted email
    // invite into salon. Their web_users.tenantId is still personal. The
    // old strict guard rejected this DM (FORBIDDEN). New guard accepts it
    // when masters.web_user_id matches in the salon.
    const dbMock = createDbMock([
      // 1. lookup other web_user
      [{ id: "w_iryna", tenantId: "t_iryna_personal", name: "Iryna" }],
      // 2. masters.web_user_id check for this salon → found
      [{ chatId: 10_000_000_001 }],
      // 3. existing DM lookup → none
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_salon") as never);
    const out = await caller.createStaffDm({
      tenantId: "t_salon",
      otherWebUserId: "w_iryna",
    });
    expect(out.created).toBe(true);
  });

  it("rejects DM with a stranger (no masters row in this salon, no owner row)", async () => {
    const dbMock = createDbMock([
      // 1. lookup other web_user — different tenant
      [{ id: "w_stranger", tenantId: "t_other_salon", name: "Stranger" }],
      // 2. masters.web_user_id check → not found
      [],
      // 3. owner check — not the owner of this salon
      [],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_salon") as never);
    await expect(
      caller.createStaffDm({ tenantId: "t_salon", otherWebUserId: "w_stranger" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
