/**
 * Tests for the chat-attachment upload token mutations:
 *
 *   - support.mintTicketUploadToken    (ticket image attachments)
 *   - messenger.mintAttachmentUploadToken (DM/group/client-conv attachments)
 *
 * Plus the wiring extensions:
 *   - support.replyToMyTicket persists `attachmentUrl`
 *   - messenger.sendMessage persists `attachmentsJson`
 *
 * Mock pattern follows support.test.ts + messenger-router.test.ts:
 *   - `createDbMock` for chainable Drizzle stubs
 *   - canned select results in order issued
 *   - env is mocked at the top of the file so UPLOAD_TOKEN_SECRET +
 *     WORKER_PUBLIC_URL are present for the happy path; tests that need
 *     them absent override via `vi.doMock` (cf. final block).
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

// The mock factory is wrapped in a function so a few tests can swap env
// values per-suite (e.g. "missing UPLOAD_TOKEN_SECRET" path).
const envMock: Record<string, string | undefined> = {
  ADMIN_CHAT_ID: "12345",
  AUTH_SECRET: "test",
  TELEGRAM_BOT_TOKEN: "0:TEST",
  UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  WORKER_PUBLIC_URL: "https://worker.test.local",
};

vi.mock("~/env", () => ({
  get env() {
    return envMock;
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { supportRouter } from "~/server/api/routers/support";
import { messengerRouter } from "~/server/api/routers/messenger";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const supportCaller = createCallerFactory(supportRouter);
const messengerCaller = createCallerFactory(messengerRouter);

const TENANT_ID = "t_attachments_test";
const TICKET_ID = "pt_attachments_test";
const THREAD_ID = "th_attachments_test";
const OWNER_EMAIL = "owner@test.com";

// ─── support.mintTicketUploadToken ───────────────────────────────────────

describe("support.mintTicketUploadToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UNAUTHORIZED when no webUser", async () => {
    const { db } = createDbMock();
    const caller = supportCaller(makeUnauthCtx(db) as never);
    await expect(caller.mintTicketUploadToken({ ticketId: TICKET_ID })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("NOT_FOUND when ticket does not exist", async () => {
    const { db } = createDbMock([[]]); // ticket lookup returns no rows
    const caller = supportCaller(makeTenantOwnerCtx(db, TENANT_ID) as never);
    await expect(caller.mintTicketUploadToken({ ticketId: TICKET_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("FORBIDDEN when caller is a tenant_owner of the WRONG tenant", async () => {
    // Ticket belongs to t_x; caller owns t_y. Caller is not support staff
    // and their email !== ticket.clientName → should be denied.
    const ticket = { id: TICKET_ID, tenantId: "t_x", clientName: "other@test.com" };
    const { db } = createDbMock([[ticket]]);
    const caller = supportCaller(makeTenantOwnerCtx(db, "t_y") as never);
    await expect(caller.mintTicketUploadToken({ ticketId: TICKET_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows the ticket owner (matched via clientName == webUser.email)", async () => {
    const ticket = { id: TICKET_ID, tenantId: TENANT_ID, clientName: OWNER_EMAIL };
    const { db } = createDbMock([[ticket]]);
    const caller = supportCaller({
      db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    const result = await caller.mintTicketUploadToken({ ticketId: TICKET_ID });
    expect(result.token).toBeTypeOf("string");
    expect(result.token.length).toBeGreaterThan(20);
    expect(result.uploadUrl).toMatch(/^https:\/\/worker\.test\.local\/upload\/asset\?t=/);
    expect(result.uploadUrl).toContain("kind=chat_attachment");
  });

  it("allows platform support staff regardless of ticket clientName", async () => {
    const ticket = { id: TICKET_ID, tenantId: TENANT_ID, clientName: "someone-else@test.com" };
    const { db } = createDbMock([[ticket]]);
    const caller = supportCaller(makeSupportCtx(db, "support") as never);

    const result = await caller.mintTicketUploadToken({ ticketId: TICKET_ID });
    expect(result.token).toBeTypeOf("string");
    expect(result.uploadUrl).toContain("kind=chat_attachment");
  });

  it("allows system_admin (god mode)", async () => {
    const ticket = { id: TICKET_ID, tenantId: TENANT_ID, clientName: "owner@somewhere.com" };
    const { db } = createDbMock([[ticket]]);
    const caller = supportCaller(makeSupportCtx(db, "system_admin") as never);
    const result = await caller.mintTicketUploadToken({ ticketId: TICKET_ID });
    expect(result.token).toBeTypeOf("string");
  });

  it("falls back to `_platform` sentinel when ticket has no tenantId", async () => {
    // Platform tickets (created by support staff for internal use) may have
    // null tenantId. The token still mints — R2 path becomes
    // `t/_platform/chat_attachment-{sha}.{ext}`.
    const ticket = { id: TICKET_ID, tenantId: null, clientName: "irrelevant@test.com" };
    const { db } = createDbMock([[ticket]]);
    const caller = supportCaller(makeSupportCtx(db, "system_admin") as never);
    const result = await caller.mintTicketUploadToken({ ticketId: TICKET_ID });
    expect(result.token).toBeTypeOf("string");
  });
});

// ─── support.replyToMyTicket attachment persistence ──────────────────────

describe("support.replyToMyTicket — attachmentUrl persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists attachmentUrl into platform_ticket_messages.attachment_url", async () => {
    const ticket = { id: TICKET_ID, status: "open", clientName: OWNER_EMAIL };
    const dbMock = createDbMock([[ticket]]); // ticket lookup
    const caller = supportCaller({
      db: dbMock.db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    await caller.replyToMyTicket({
      ticketId: TICKET_ID,
      text: "see screenshot",
      attachmentUrl: "https://worker.test.local/cdn/t/abc/chat_attachment-deadbeef.png",
    });

    // First insert is into platform_ticket_messages — that's the one we care about.
    const insert = dbMock.insertCalls[0];
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      ticketId: TICKET_ID,
      text: "see screenshot",
      attachmentUrl: "https://worker.test.local/cdn/t/abc/chat_attachment-deadbeef.png",
    });
  });

  it("stores null when attachmentUrl is omitted", async () => {
    const ticket = { id: TICKET_ID, status: "open", clientName: OWNER_EMAIL };
    const dbMock = createDbMock([[ticket]]);
    const caller = supportCaller({
      db: dbMock.db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    await caller.replyToMyTicket({ ticketId: TICKET_ID, text: "no attachment" });

    expect(dbMock.insertCalls[0]!.values.attachmentUrl).toBeNull();
  });
});

// ─── messenger.mintAttachmentUploadToken ─────────────────────────────────

describe("messenger.mintAttachmentUploadToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UNAUTHORIZED when no webUser", async () => {
    const { db } = createDbMock();
    const caller = messengerCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.mintAttachmentUploadToken({ tenantId: TENANT_ID, threadId: THREAD_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("FORBIDDEN when caller is a tenant_owner of a different tenant", async () => {
    const { db } = createDbMock();
    const caller = messengerCaller(makeTenantOwnerCtx(db, "t_other") as never);
    await expect(
      caller.mintAttachmentUploadToken({ tenantId: TENANT_ID, threadId: THREAD_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("happy path: returns token + uploadUrl for a thread member", async () => {
    const thread = { id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" };
    const member = { threadId: THREAD_ID, memberKind: "web_user", memberRef: "w_owner" };
    const { db } = createDbMock([
      [thread],   // thread lookup inside assertThreadMember
      [member],   // member lookup inside assertThreadMember
    ]);
    const caller = messengerCaller({
      db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    const result = await caller.mintAttachmentUploadToken({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
    });
    expect(result.token).toBeTypeOf("string");
    expect(result.uploadUrl).toMatch(/^https:\/\/worker\.test\.local\/upload\/asset\?t=/);
    expect(result.uploadUrl).toContain("kind=chat_attachment");
  });

  it("system_admin bypass: works on any thread inside the tenant", async () => {
    const thread = { id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" };
    const { db } = createDbMock([[thread]]); // member lookup is SKIPPED for system_admin
    const caller = messengerCaller(makeAdminCtx(db) as never);

    const result = await caller.mintAttachmentUploadToken({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
    });
    expect(result.token).toBeTypeOf("string");
  });
});

// ─── messenger.sendMessage — attachments persistence ─────────────────────

describe("messenger.sendMessage — attachments JSON persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists attachments_json as a wrapped object so the schema can extend", async () => {
    const thread = { id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" };
    const member = { threadId: THREAD_ID, memberKind: "web_user", memberRef: "w_owner" };
    const dbMock = createDbMock([[thread], [member]]);
    const caller = messengerCaller({
      db: dbMock.db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    await caller.sendMessage({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      body: "look at this",
      attachments: [
        { url: "https://worker.test.local/cdn/t/abc/chat_attachment-1.png", kind: "image" },
      ],
    });

    const insert = dbMock.insertCalls[0];
    expect(insert).toBeDefined();
    expect(insert!.values.attachmentsJson).toBeTypeOf("string");
    const parsed = JSON.parse(insert!.values.attachmentsJson as string) as {
      attachments: Array<{ url: string; kind: string }>;
    };
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]!.url).toBe(
      "https://worker.test.local/cdn/t/abc/chat_attachment-1.png",
    );
    expect(parsed.attachments[0]!.kind).toBe("image");
  });

  it("stores null when attachments is empty / omitted", async () => {
    const thread = { id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" };
    const member = { threadId: THREAD_ID, memberKind: "web_user", memberRef: "w_owner" };
    const dbMock = createDbMock([[thread], [member]]);
    const caller = messengerCaller({
      db: dbMock.db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    await caller.sendMessage({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      body: "no images",
    });

    expect(dbMock.insertCalls[0]!.values.attachmentsJson).toBeNull();
  });

  it("rejects more than 4 attachments (zod cap)", async () => {
    const { db } = createDbMock([[{ id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" }]]);
    const caller = messengerCaller({
      db,
      webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
      headers: new Headers(),
    } as never);

    const tooMany = Array.from({ length: 5 }, (_, i) => ({
      url: `https://worker.test.local/cdn/t/abc/x-${i}.png`,
      kind: "image" as const,
    }));
    await expect(
      caller.sendMessage({ tenantId: TENANT_ID, threadId: THREAD_ID, body: "x", attachments: tooMany }),
    ).rejects.toThrow();
  });
});

// ─── env-missing edge cases ─────────────────────────────────────────────

describe("upload token env-missing edges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("support.mintTicketUploadToken throws INTERNAL_SERVER_ERROR when UPLOAD_TOKEN_SECRET is unset", async () => {
    const prev = envMock.UPLOAD_TOKEN_SECRET;
    envMock.UPLOAD_TOKEN_SECRET = undefined;
    try {
      const ticket = { id: TICKET_ID, tenantId: TENANT_ID, clientName: OWNER_EMAIL };
      const { db } = createDbMock([[ticket]]);
      const caller = supportCaller({
        db,
        webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
        headers: new Headers(),
      } as never);
      await expect(caller.mintTicketUploadToken({ ticketId: TICKET_ID })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    } finally {
      envMock.UPLOAD_TOKEN_SECRET = prev;
    }
  });

  it("messenger.mintAttachmentUploadToken throws INTERNAL_SERVER_ERROR when WORKER_PUBLIC_URL is unset", async () => {
    const prev = envMock.WORKER_PUBLIC_URL;
    envMock.WORKER_PUBLIC_URL = undefined;
    try {
      const thread = { id: THREAD_ID, tenantId: TENANT_ID, kind: "staff_dm" };
      const member = { threadId: THREAD_ID, memberKind: "web_user", memberRef: "w_owner" };
      const { db } = createDbMock([[thread], [member]]);
      const caller = messengerCaller({
        db,
        webUser: { id: "w_owner", email: OWNER_EMAIL, tenantId: TENANT_ID, webRole: "tenant_owner" },
        headers: new Headers(),
      } as never);
      await expect(
        caller.mintAttachmentUploadToken({ tenantId: TENANT_ID, threadId: THREAD_ID }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    } finally {
      envMock.WORKER_PUBLIC_URL = prev;
    }
  });
});
