/**
 * editMessage / deleteMessage — author-only, soft delete, relayed + window guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { createDbMock, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);
const nowSec = () => Math.floor(Date.now() / 1000);

const dmThread = () => ({
  id: "th_dm",
  tenantId: "t_a",
  kind: "staff_dm",
  title: null,
  clientConversationId: null,
  dmKey: "w_owner:w_other",
  createdByWebUserId: "w_owner",
  createdAt: 1,
  lastMessageAt: 2,
  lastMessagePreview: null,
  archived: 0,
});
const ownerMember = () => ({
  threadId: "th_dm",
  memberKind: "web_user",
  memberRef: "w_owner",
  role: "member",
  joinedAt: 1,
  mutedUntil: null,
  lastReadMessageId: null,
  lastReadAt: null,
});
const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  tenantId: "t_a",
  threadId: "th_dm",
  senderKind: "web_user",
  senderRef: "w_owner",
  body: "old",
  attachmentsJson: null,
  isInternalNote: 0,
  externalMsgId: null,
  replyToMessageId: null,
  createdAt: nowSec() - 10,
  editedAt: null,
  deletedAt: null,
  deliveryState: null,
  deliveryError: null,
  ...over,
});

describe("messenger.editMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.editMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1", body: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-author", async () => {
    const { db } = createDbMock([[dmThread()], [ownerMember()], [msg({ senderRef: "w_other" })]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.editMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1", body: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects editing a relayed message", async () => {
    const { db } = createDbMock([[dmThread()], [ownerMember()], [msg({ externalMsgId: "wamid.X" })]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.editMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1", body: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "cannot_edit_relayed" });
  });

  it("rejects editing past the 24h window", async () => {
    const { db } = createDbMock([[dmThread()], [ownerMember()], [msg({ createdAt: nowSec() - 90000 })]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.editMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1", body: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "edit_window_expired" });
  });

  it("edits an own recent message → sets editedAt + new body", async () => {
    const dbMock = createDbMock([[dmThread()], [ownerMember()], [msg()]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.editMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1", body: "new text" });
    expect(out.ok).toBe(true);
    const edit = dbMock.updateCalls.find((c) => "editedAt" in (c.values as object));
    expect((edit!.values as Record<string, unknown>).body).toBe("new text");
    expect(typeof (edit!.values as Record<string, unknown>).editedAt).toBe("number");
  });
});

describe("messenger.deleteMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-author", async () => {
    const { db } = createDbMock([[dmThread()], [ownerMember()], [msg({ senderRef: "w_other" })]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.deleteMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("soft-deletes (sets deletedAt; no hard delete)", async () => {
    const dbMock = createDbMock([[dmThread()], [ownerMember()], [msg()]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.deleteMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1" });
    expect(out.ok).toBe(true);
    expect(out.relayedWarning).toBe(false);
    const del = dbMock.updateCalls.find((c) => "deletedAt" in (c.values as object));
    expect(typeof (del!.values as Record<string, unknown>).deletedAt).toBe("number");
    expect(dbMock.deleteCalls.length).toBe(0); // soft only
  });

  it("flags relayedWarning when the message was relayed to a channel", async () => {
    const dbMock = createDbMock([[dmThread()], [ownerMember()], [msg({ externalMsgId: "wamid.X" })]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.deleteMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1" });
    expect(out.relayedWarning).toBe(true);
  });
});
