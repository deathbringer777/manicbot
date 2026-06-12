/**
 * Rate limits on messenger/support write endpoints (audit 2026-06-12, IU-6).
 *
 * messenger.sendMessage / messenger.mintAttachmentUploadToken and
 * support.createTicket / support.replyToMyTicket / support.mintTicketUploadToken
 * had no per-user limiter — an authenticated user could spam messages/tickets
 * (D1 row bloat + bell fan-out per message) and mint unbounded upload tokens.
 *
 * These tests pin the WIRING: each endpoint consults checkRateLimit keyed by
 * the caller's web_users.id and throws TOO_MANY_REQUESTS when the limiter
 * says no. The limiter algorithm itself is covered by its own callers' tests
 * (reset-password-bruteforce et al.).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    UPLOAD_TOKEN_SECRET: "u".repeat(64),
  },
}));
// CS-1 billing gate is orthogonal here — neutralize its SELECT.
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
  assertEmailVerified: vi.fn(async () => {}),
}));

const mockCheckRateLimit = vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 }));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: (...args: unknown[]) => (mockCheckRateLimit as (...a: unknown[]) => unknown)(...args),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { supportRouter } from "~/server/api/routers/support";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const callMessenger = createCallerFactory(messengerRouter);
const callSupport = createCallerFactory(supportRouter);
const TENANT = "t_rl";

const denied = { allowed: false, remaining: 0, resetAt: 9_999_999_999 };

describe("IU-6 — rate limits wired into write endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
  });

  it("messenger.sendMessage → TOO_MANY_REQUESTS when limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied as never);
    const { db } = createDbMock([]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.sendMessage({ tenantId: TENANT, threadId: "th_1", body: "spam" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(), "w_owner", "messenger_send", expect.any(Number), expect.any(Number),
    );
  });

  it("messenger.mintAttachmentUploadToken → TOO_MANY_REQUESTS when limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied as never);
    const { db } = createDbMock([]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.mintAttachmentUploadToken({ tenantId: TENANT, threadId: "th_1" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(), "w_owner", "messenger_mint_upload", expect.any(Number), expect.any(Number),
    );
  });

  it("support.createTicket → TOO_MANY_REQUESTS when limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied as never);
    const { db } = createDbMock([]);
    const caller = callSupport(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.createTicket({ subject: "s", message: "m" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(), "w_owner", "support_ticket_create", expect.any(Number), expect.any(Number),
    );
  });

  it("support.replyToMyTicket → TOO_MANY_REQUESTS when limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied as never);
    const { db } = createDbMock([]);
    const caller = callSupport(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.replyToMyTicket({ ticketId: "pt_1", text: "spam" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(), "w_owner", "support_ticket_reply", expect.any(Number), expect.any(Number),
    );
  });

  it("support.mintTicketUploadToken → TOO_MANY_REQUESTS when limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied as never);
    const { db } = createDbMock([]);
    const caller = callSupport(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.mintTicketUploadToken({ ticketId: "pt_1" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(), "w_owner", "support_mint_upload", expect.any(Number), expect.any(Number),
    );
  });

  it("allowed=true proceeds past the limiter (failure, if any, is not TOO_MANY_REQUESTS)", async () => {
    const { db } = createDbMock([]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    try {
      await caller.sendMessage({ tenantId: TENANT, threadId: "th_1", body: "ok" });
    } catch (e) {
      expect((e as { code?: string }).code).not.toBe("TOO_MANY_REQUESTS");
    }
  });
});
