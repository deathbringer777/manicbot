import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { supportRouter } from "~/server/api/routers/support";
import {
  createDbMock,
  makeUnauthCtx,
  makeSupportCtx,
  makeTenantOwnerCtx,
} from "./helpers/db-mock";

describe("supportRouter", () => {
  const createCaller = createCallerFactory(supportRouter);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── assertSupport guard ──────────────────────────────────────────────────
  describe("assertSupport guard", () => {
    it("throws UNAUTHORIZED when no user and no webUser", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      await expect(caller.getOpenTickets()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws FORBIDDEN when webUser has role=tenant_owner", async () => {
      const { db } = createDbMock();
      const caller = createCaller({
        db,
        user: null,
        webUser: { id: "w1", email: "owner@test.com", tenantId: "t_demo", webRole: "tenant_owner" },
        headers: new Headers(),
      } as never);
      await expect(caller.getOpenTickets()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("allows webUser with role=support", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeSupportCtx(dbMock.db, "support") as never);
      await expect(caller.getOpenTickets()).resolves.toEqual([]);
    });

    it("allows webUser with role=technical_support", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeSupportCtx(dbMock.db, "technical_support") as never);
      await expect(caller.getOpenTickets()).resolves.toEqual([]);
    });

    it("allows webUser with role=system_admin", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeSupportCtx(dbMock.db, "system_admin") as never);
      await expect(caller.getOpenTickets()).resolves.toEqual([]);
    });

    it("throws FORBIDDEN when webUser has non-support role", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_demo") as never);
      await expect(caller.getOpenTickets()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── getOpenTickets ────────────────────────────────────────────────────────
  describe("getOpenTickets", () => {
    it("returns open tickets from DB", async () => {
      const ticket = { id: "tkt_1", status: "open", clientName: "Anna" };
      const dbMock = createDbMock([[ticket]]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getOpenTickets();

      expect(result).toEqual([ticket]);
    });

    it("returns empty array when no open tickets", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      expect(await caller.getOpenTickets()).toEqual([]);
    });
  });

  // ── getAllTickets ─────────────────────────────────────────────────────────
  describe("getAllTickets", () => {
    it("returns all tickets when no filters", async () => {
      const tickets = [
        { id: "tkt_1", status: "open" },
        { id: "tkt_2", status: "closed" },
      ];
      const dbMock = createDbMock([tickets]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getAllTickets({});

      expect(result).toEqual(tickets);
    });

    it("filters by status in-memory after DB fetch", async () => {
      const tickets = [
        { id: "tkt_1", status: "open" },
        { id: "tkt_2", status: "closed" },
        { id: "tkt_3", status: "open" },
      ];
      const dbMock = createDbMock([tickets]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getAllTickets({ status: "open" });

      expect(result).toHaveLength(2);
      expect(result.every((t: any) => t.status === "open")).toBe(true);
    });

    it("performs DB search when query is provided", async () => {
      const dbMock = createDbMock([[{ id: "tkt_abc", clientName: "Anna", status: "open" }]]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getAllTickets({ q: "Anna" });

      // Only one select called for the search path
      expect(dbMock.db.select).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it("applies status filter on top of search results", async () => {
      const tickets = [
        { id: "tkt_1", clientName: "Anna", status: "open" },
        { id: "tkt_2", clientName: "Anna", status: "closed" },
      ];
      const dbMock = createDbMock([tickets]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getAllTickets({ q: "Anna", status: "closed" });

      expect(result).toEqual([{ id: "tkt_2", clientName: "Anna", status: "closed" }]);
    });
  });

  // ── getTicket ─────────────────────────────────────────────────────────────
  describe("getTicket", () => {
    it("returns ticket and messages", async () => {
      const ticket = { id: "tkt_1", status: "open" };
      const messages = [{ id: "msg_1", ticketId: "tkt_1", text: "hello" }];
      // getTicket uses Promise.all([ticket_select, messages_select])
      const dbMock = createDbMock([[ticket], messages]);
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.getTicket({ ticketId: "tkt_1" });

      expect(result.ticket).toEqual(ticket);
      expect(result.messages).toEqual(messages);
    });

    it("throws NOT_FOUND when ticket does not exist", async () => {
      const dbMock = createDbMock([[], []]); // empty ticket result
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      await expect(caller.getTicket({ ticketId: "tkt_x" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ── replyToTicket ─────────────────────────────────────────────────────────
  describe("replyToTicket", () => {
    it("inserts message with senderId=support:web:{id} for web user", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      await caller.replyToTicket({ ticketId: "tkt_1", text: "We are looking into it" });

      expect(dbMock.insertCalls[0]?.values.sender).toBe("support:web:w_support");
      expect(dbMock.insertCalls[0]?.values.text).toBe("We are looking into it");
    });

    it("sets attachmentUrl from input when provided", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      // IU-1 (audit 2026-06-12): attachment URLs are pinned to the CDN shape
      // minted by mintTicketUploadToken — arbitrary hosts are rejected by zod.
      const cdnUrl = "https://worker.test/cdn/t/t_a/chat_attachment-deadbeef.png";
      await caller.replyToTicket({
        ticketId: "tkt_1",
        text: "See attachment",
        attachmentUrl: cdnUrl,
      });

      expect(dbMock.insertCalls[0]?.values.attachmentUrl).toBe(cdnUrl);
    });

    it("sets attachmentUrl=null when not provided", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      await caller.replyToTicket({ ticketId: "tkt_1", text: "Ok" });

      expect(dbMock.insertCalls[0]?.values.attachmentUrl).toBeNull();
    });

    it("updates ticket updatedAt after inserting the message", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      await caller.replyToTicket({ ticketId: "tkt_1", text: "Reply" });

      expect(dbMock.updateCalls).toHaveLength(1);
      expect(Number(dbMock.updateCalls[0]?.values.updatedAt)).toBeGreaterThanOrEqual(before);
    });
  });

  // ── claimTicket ───────────────────────────────────────────────────────────
  describe("claimTicket", () => {
    it("sets claimedBy=null and claimedByWebUserId for web user", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      await caller.claimTicket({ ticketId: "tkt_1" });

      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.claimedByWebUserId).toBe("w_support");
      expect(vals.claimedBy).toBeNull();
      expect(vals.status).toBe("claimed");
    });

  });

  // ── closeTicket / escalateTicket ──────────────────────────────────────────
  describe("closeTicket", () => {
    it("sets status=closed and updates updatedAt", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.closeTicket({ ticketId: "tkt_1" });

      expect(result).toEqual({ ok: true });
      expect(dbMock.updateCalls[0]?.values.status).toBe("closed");
      expect(Number(dbMock.updateCalls[0]?.values.updatedAt)).toBeGreaterThanOrEqual(before);
    });
  });

  describe("escalateTicket", () => {
    it("sets status=escalated and updates updatedAt", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock();
      const caller = createCaller(makeSupportCtx(dbMock.db) as never);

      const result = await caller.escalateTicket({ ticketId: "tkt_1" });

      expect(result).toEqual({ ok: true });
      expect(dbMock.updateCalls[0]?.values.status).toBe("escalated");
      expect(Number(dbMock.updateCalls[0]?.values.updatedAt)).toBeGreaterThanOrEqual(before);
    });
  });
});
