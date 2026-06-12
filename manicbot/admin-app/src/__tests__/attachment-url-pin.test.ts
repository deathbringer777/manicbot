/**
 * Chat/ticket attachment URLs pinned to the CDN path (audit 2026-06-12, IU-1).
 *
 * messenger.sendMessage attachments and support ticket attachmentUrl used to
 * accept ANY https:// URL, which the counterparty's browser then fetched as
 * an inline <img src> and exposed as an <a target=_blank> — a tracking-pixel
 * / phishing surface (not XSS: schemes were already constrained). Now the
 * URL must match the shape our own upload flow mints:
 *   https://<host>/cdn/t/<tenantId>/chat_attachment-<sha>.<webp|jpg|jpeg|png>
 * and for messenger the <tenantId> segment must equal the message's tenant.
 *
 * Prod data check 2026-06-12: zero existing rows with attachments in
 * thread_messages and zero attachment_url in platform_ticket_messages —
 * the pin cannot break legacy content.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
  assertEmailVerified: vi.fn(async () => {}),
}));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
  },
}));

import { isChatAttachmentCdnUrl, chatAttachmentUrlTenant } from "~/server/lib/url";
import { createCallerFactory } from "~/server/api/trpc";
import { messengerRouter } from "~/server/api/routers/messenger";
import { supportRouter } from "~/server/api/routers/support";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const callMessenger = createCallerFactory(messengerRouter);
const callSupport = createCallerFactory(supportRouter);

const TENANT = "t_pin";
const GOOD_URL = `https://worker.test/cdn/t/${TENANT}/chat_attachment-0123abcd4567.webp`;
const FOREIGN_TENANT_URL = "https://worker.test/cdn/t/t_other/chat_attachment-0123abcd4567.webp";
const EVIL_URL = "https://evil.example/track.png";

const thread = () => ({
  id: "th_1", tenantId: TENANT, kind: "staff_dm", title: null,
  clientConversationId: null, dmKey: "w_owner:w_other",
  createdByWebUserId: "w_owner", createdAt: 1, lastMessageAt: 2,
  lastMessagePreview: null, archived: 0,
});
const member = () => ({
  threadId: "th_1", memberKind: "web_user", memberRef: "w_owner",
  role: "member", joinedAt: 1, mutedUntil: null,
  lastReadMessageId: null, lastReadAt: null,
});

describe("isChatAttachmentCdnUrl — unit", () => {
  it("accepts the canonical minted shape", () => {
    expect(isChatAttachmentCdnUrl(GOOD_URL)).toBe(true);
    expect(chatAttachmentUrlTenant(GOOD_URL)).toBe(TENANT);
  });
  it("rejects foreign hosts / paths / kinds / schemes", () => {
    expect(isChatAttachmentCdnUrl(EVIL_URL)).toBe(false);
    expect(isChatAttachmentCdnUrl("https://worker.test/cdn/t/t_pin/client_avatar-0123abcd4567.webp")).toBe(false);
    expect(isChatAttachmentCdnUrl("http://worker.test/cdn/t/t_pin/chat_attachment-0123abcd4567.webp")).toBe(false);
    expect(isChatAttachmentCdnUrl("https://worker.test/cdn/t/t_pin/chat_attachment-0123abcd4567.svg")).toBe(false);
    expect(isChatAttachmentCdnUrl("https://worker.test/x/../cdn/t/t_pin/chat_attachment-0123abcd4567.webp")).toBe(false);
  });

  it("V-2: rejects an attacker host with a PATH-VALID URL (host must be pinned, not just the path)", () => {
    // The regex shape alone is satisfied — the host is the only thing keeping
    // this from rendering as a tracking pixel at the counterparty. WORKER_PUBLIC_URL
    // is mocked to https://worker.test, so any other host must be rejected.
    expect(
      isChatAttachmentCdnUrl("https://evil.example/cdn/t/t_pin/chat_attachment-0123abcd4567.png"),
    ).toBe(false);
    expect(
      isChatAttachmentCdnUrl("https://worker.test.evil.com/cdn/t/t_pin/chat_attachment-0123abcd4567.png"),
    ).toBe(false);
    // userinfo trick: real host is evil.com, worker.test is just credentials.
    expect(
      isChatAttachmentCdnUrl("https://worker.test@evil.com/cdn/t/t_pin/chat_attachment-0123abcd4567.png"),
    ).toBe(false);
  });
});

describe("messenger.sendMessage — attachment URL pin (IU-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an arbitrary https host with BAD_REQUEST", async () => {
    const { db } = createDbMock([[thread()], [member()]]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.sendMessage({
        tenantId: TENANT, threadId: "th_1", body: "hi",
        attachments: [{ url: EVIL_URL, kind: "image" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a CDN URL whose tenant segment differs from the message tenant", async () => {
    const { db } = createDbMock([[thread()], [member()]]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.sendMessage({
        tenantId: TENANT, threadId: "th_1", body: "hi",
        attachments: [{ url: FOREIGN_TENANT_URL, kind: "image" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts the canonical same-tenant CDN URL (no BAD_REQUEST)", async () => {
    const { db } = createDbMock([[thread()], [member()]]);
    const caller = callMessenger(makeTenantOwnerCtx(db, TENANT) as never);
    try {
      await caller.sendMessage({
        tenantId: TENANT, threadId: "th_1", body: "hi",
        attachments: [{ url: GOOD_URL, kind: "image" }],
      });
    } catch (e) {
      expect((e as { code?: string }).code).not.toBe("BAD_REQUEST");
    }
  });
});

describe("support ticket replies — attachment URL pin (IU-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replyToMyTicket rejects an arbitrary https host with BAD_REQUEST", async () => {
    const { db } = createDbMock([]);
    const caller = callSupport(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.replyToMyTicket({ ticketId: "pt_1", text: "x", attachmentUrl: EVIL_URL }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("replyToMyTicket accepts a CDN-shaped URL (no BAD_REQUEST)", async () => {
    const { db } = createDbMock([[{ id: "pt_1", status: "open" }]]);
    const caller = callSupport(makeTenantOwnerCtx(db, TENANT) as never);
    try {
      await caller.replyToMyTicket({ ticketId: "pt_1", text: "x", attachmentUrl: GOOD_URL });
    } catch (e) {
      expect((e as { code?: string }).code).not.toBe("BAD_REQUEST");
    }
  });
});
