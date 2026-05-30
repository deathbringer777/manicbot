/**
 * Mute: per-member thread mute helpers + muteThread/unmuteThread router gates.
 * Mock pattern mirrors messenger-router.test.ts (chainable Drizzle stub).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { isMuted, filterActiveRecipients, MUTE_FOREVER } from "~/server/api/messenger/mute";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

const clientThread = (tenantId = "t_a") => ({
  id: "th_1",
  tenantId,
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
const ownerMember = () => ({
  threadId: "th_1",
  memberKind: "web_user",
  memberRef: "w_owner",
  role: "member",
  joinedAt: 1,
  mutedUntil: null,
  lastReadMessageId: null,
  lastReadAt: null,
});

// ─── Pure helpers ────────────────────────────────────────────────────────

describe("mute helpers", () => {
  const now = 1000;
  it("isMuted: future until → muted", () => expect(isMuted(2000, now)).toBe(true));
  it("isMuted: past until → not muted", () => expect(isMuted(500, now)).toBe(false));
  it("isMuted: null/undefined → not muted", () => {
    expect(isMuted(null, now)).toBe(false);
    expect(isMuted(undefined, now)).toBe(false);
  });
  it("isMuted: MUTE_FOREVER → muted", () => expect(isMuted(MUTE_FOREVER, now)).toBe(true));
  it("filterActiveRecipients drops muted, keeps expired + unset", () => {
    const out = filterActiveRecipients(
      [
        { memberRef: "a", mutedUntil: null },
        { memberRef: "b", mutedUntil: MUTE_FOREVER },
        { memberRef: "c", mutedUntil: 500 },
      ],
      now,
    );
    expect(out).toEqual(["a", "c"]);
  });
});

// ─── muteThread / unmuteThread auth + behavior ────────────────────────────

describe("messengerRouter.muteThread / unmuteThread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.muteThread({ tenantId: "t_a", threadId: "th_1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects muting a thread in a different tenant", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.muteThread({ tenantId: "t_b", threadId: "th_1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member (master not in the thread)", async () => {
    const { db } = createDbMock([[clientThread()], []]);
    const caller = createCaller(makeMasterCtx(db, "t_a") as never);
    await expect(
      caller.muteThread({ tenantId: "t_a", threadId: "th_1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("muteThread (no until) sets a far-future mutedUntil", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember()]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.muteThread({ tenantId: "t_a", threadId: "th_1" });
    expect(out.ok).toBe(true);
    expect(dbMock.updateCalls.length).toBe(1);
    const v = dbMock.updateCalls[0]!.values as Record<string, unknown>;
    expect(v.mutedUntil).toBe(MUTE_FOREVER);
  });

  it("muteThread honors an explicit until", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember()]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const until = Math.floor(Date.now() / 1000) + 3600;
    await caller.muteThread({ tenantId: "t_a", threadId: "th_1", until });
    const v = dbMock.updateCalls[0]!.values as Record<string, unknown>;
    expect(v.mutedUntil).toBe(until);
  });

  it("unmuteThread clears mutedUntil to null", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember()]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.unmuteThread({ tenantId: "t_a", threadId: "th_1" });
    expect(out.ok).toBe(true);
    const v = dbMock.updateCalls[0]!.values as Record<string, unknown>;
    expect(v.mutedUntil).toBeNull();
  });
});
