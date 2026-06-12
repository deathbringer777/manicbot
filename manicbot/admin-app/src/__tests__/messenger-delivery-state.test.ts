/**
 * Delivery-state lifecycle on thread_messages (migration 0095).
 *
 * sendMessage: client_conv outbound rows start 'pending'; the relay result
 * advances to 'sent' or 'failed' (persisted so failures survive reload).
 * retryMessage: re-relays a 'failed' row, gated to sender-relevant client_conv.
 *
 * The test env mocks ~/env WITHOUT WORKER_PUBLIC_URL/ADMIN_KEY, so relayToWorker
 * short-circuits to { ok:false, error:'relay_not_configured' } — i.e. every
 * client_conv send/retry here ends 'failed', which is exactly the path we must
 * persist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
// IU-6 (audit 2026-06-12): messenger/support writes now consult a per-user
// rate limiter (one extra D1 SELECT). Neutralized here to keep the mock-db
// select queue stable; the limiter wiring is pinned in
// messenger-support-rate-limit.test.ts.
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));
// CS-1 (audit 2026-06-12): high-value mutations now run a server-side billing
// SELECT (assertTenantBillingActive). This file tests other concerns, so the
// billing check is neutralized to keep the mock-db select queue stable.
// Billing-gate behavior itself is pinned in billing-server-gate.test.ts.
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
}));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(messengerRouter);

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
const staffThread = () => ({ ...clientThread(), id: "th_dm", kind: "staff_dm", clientConversationId: null });
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

function deliveryUpdate(dbMock: ReturnType<typeof createDbMock>) {
  return dbMock.updateCalls.find((c) => "deliveryState" in (c.values as object));
}

describe("messenger.sendMessage — delivery_state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("client_conv outbound inserts deliveryState='pending'", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember("th_c")], []]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    await caller.sendMessage({ tenantId: "t_a", threadId: "th_c", body: "ping the client" });
    const insert = dbMock.insertCalls.find((c) => (c.values as Record<string, unknown>).body === "ping the client");
    expect((insert!.values as Record<string, unknown>).deliveryState).toBe("pending");
  });

  it("persists deliveryState='failed' + error when the relay fails", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember("th_c")], []]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.sendMessage({ tenantId: "t_a", threadId: "th_c", body: "ping the client" });
    expect(out.relay).toEqual({ ok: false, error: "relay_not_configured" });
    const upd = deliveryUpdate(dbMock);
    expect(upd?.values.deliveryState).toBe("failed");
    expect(upd?.values.deliveryError).toBe("relay_not_configured");
  });

  it("staff_dm gets deliveryState=null and no delivery update", async () => {
    const dbMock = createDbMock([[staffThread()], [ownerMember("th_dm")], []]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    await caller.sendMessage({ tenantId: "t_a", threadId: "th_dm", body: "staff to staff" });
    const insert = dbMock.insertCalls.find((c) => (c.values as Record<string, unknown>).body === "staff to staff");
    expect((insert!.values as Record<string, unknown>).deliveryState).toBeNull();
    expect(deliveryUpdate(dbMock)).toBeUndefined();
  });

  it("internal note on client_conv gets deliveryState=null (never relays)", async () => {
    const dbMock = createDbMock([[clientThread()], [ownerMember("th_c")], []]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    await caller.sendMessage({ tenantId: "t_a", threadId: "th_c", body: "secret", isInternalNote: true });
    const insert = dbMock.insertCalls.find((c) => (c.values as Record<string, unknown>).body === "secret");
    expect((insert!.values as Record<string, unknown>).deliveryState).toBeNull();
  });
});

describe("messenger.retryMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.retryMessage({ tenantId: "t_a", threadId: "th_c", messageId: "m1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects retry on a non-client_conv thread", async () => {
    const { db } = createDbMock([[staffThread()], [ownerMember("th_dm")]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.retryMessage({ tenantId: "t_a", threadId: "th_dm", messageId: "m1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects retry of a non-failed message", async () => {
    const sentMsg = { id: "m1", tenantId: "t_a", threadId: "th_c", body: "hi", deliveryState: "sent", replyToMessageId: null };
    const { db } = createDbMock([[clientThread()], [ownerMember("th_c")], [sentMsg]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.retryMessage({ tenantId: "t_a", threadId: "th_c", messageId: "m1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("re-relays a failed message: flips to pending then back to failed when relay unset", async () => {
    const failedMsg = { id: "m1", tenantId: "t_a", threadId: "th_c", body: "hi", deliveryState: "failed", replyToMessageId: null };
    const dbMock = createDbMock([[clientThread()], [ownerMember("th_c")], [failedMsg]]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_a") as never);
    const out = await caller.retryMessage({ tenantId: "t_a", threadId: "th_c", messageId: "m1" });
    expect(out.ok).toBe(true);
    const states = dbMock.updateCalls
      .filter((c) => "deliveryState" in (c.values as object))
      .map((c) => (c.values as Record<string, unknown>).deliveryState);
    expect(states).toEqual(["pending", "failed"]);
  });
});
