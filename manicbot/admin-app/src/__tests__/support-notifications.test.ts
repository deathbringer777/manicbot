/**
 * support router — notification fan-out tests (PR1 of the notification
 * center upgrade).
 *
 * Pins the three new in-app writers:
 *   1. support.replyToTicket  → notifyWebUser to the ticket owner
 *   2. support.createTicket   → notifyManyWebUsers to all support staff
 *      (excluding the creator if they happen to be staff themselves)
 *   3. support.replyToMyTicket → notifyManyWebUsers to all support staff
 *
 * All writers are fire-and-forget (`void ...`), so the assertions await a
 * microtask + macrotask flush before reading mock call counts.
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
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));
const sendSupportReplyEmailMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock("~/server/email/emailService", () => ({
  sendSupportReplyEmail: (...args: unknown[]) => sendSupportReplyEmailMock(...args),
}));

const notifyWebUserMock = vi.fn().mockResolvedValue({ ok: true, id: "n_1" });
const notifyManyMock = vi.fn().mockResolvedValue({ ok: 1, deduped: 0, failed: 0 });
vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: (...args: unknown[]) => notifyWebUserMock(...args),
  notifyManyWebUsers: (...args: unknown[]) => notifyManyMock(...args),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { supportRouter } from "~/server/api/routers/support";
import {
  makeAwaitableChain,
  makeSupportCtx,
  makeTenantOwnerCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(supportRouter);

// Drain microtasks + 1 macrotask so the void-fire notify call lands.
async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0));
}

function buildDb(opts: {
  ticketRow?: any;
  webUserRow?: any;
  myTicketRow?: any;
  supportStaffRows?: any[];
}) {
  // Order matters: replyToTicket → SELECT ticket → SELECT webUsers.
  // createTicket / replyToMyTicket → SELECT myTicket (optional) →
  //   notifyPlatformSupportStaff → SELECT webUsers (support staff list).
  const queue: any[] = [];
  if (opts.myTicketRow !== undefined) queue.push([opts.myTicketRow]);
  if (opts.ticketRow !== undefined) queue.push([opts.ticketRow]);
  if (opts.webUserRow !== undefined) queue.push([opts.webUserRow]);
  if (opts.supportStaffRows !== undefined) queue.push(opts.supportStaffRows);

  const db: any = {
    select: vi.fn(() => makeAwaitableChain(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve({ ok: true })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({ ok: true })),
      })),
    })),
  };
  return db;
}

describe("support.replyToTicket → notifyWebUser fan-out", () => {
  beforeEach(() => {
    notifyWebUserMock.mockClear();
    notifyManyMock.mockClear();
  });

  it("fires in-app notification for the ticket owner (email + tenantId resolved)", async () => {
    const db = buildDb({
      ticketRow: { clientName: "owner@test.com", tenantId: "t_demo" },
      webUserRow: { id: "w_owner_5", lang: "ru" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    const r = await caller.replyToTicket({ ticketId: "pt_abc", text: "Привет, разобрались" });
    // #3 — return shape now also carries `emailSent` (await + surface result).
    expect(r).toEqual({ ok: true, emailSent: true });
    await flushAsync();

    expect(notifyWebUserMock).toHaveBeenCalledTimes(1);
    const args = notifyWebUserMock.mock.calls[0]![1] as any;
    expect(args.webUserId).toBe("w_owner_5");
    expect(args.tenantId).toBe("t_demo");
    expect(args.kind).toBe("support.reply");
    expect(args.title).toBe("Новый ответ поддержки");
    expect(args.body).toBe("Привет, разобрались");
    expect(args.link).toBe("/settings?section=help&ticket=pt_abc");
    expect(args.sourceSlug).toBe("support");
    expect(args.sourceId).toMatch(/^pt_abc:\d+$/);
  });

  it("localizes title by recipient lang", async () => {
    const db = buildDb({
      ticketRow: { clientName: "owner@test.com", tenantId: null },
      webUserRow: { id: "w_owner_5", lang: "pl" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    await caller.replyToTicket({ ticketId: "pt_pl", text: "ok" });
    await flushAsync();
    expect(notifyWebUserMock).toHaveBeenCalledTimes(1);
    expect((notifyWebUserMock.mock.calls[0]![1] as any).title).toBe("Nowa odpowiedź wsparcia");
  });

  it("does not fire notification when ticket owner has no web_users row", async () => {
    const db = buildDb({
      ticketRow: { clientName: "ghost@test.com", tenantId: null },
      webUserRow: null,
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    await caller.replyToTicket({ ticketId: "pt_ghost", text: "hi" });
    await flushAsync();
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });

  it("does not fire notification when clientName is not an email", async () => {
    const db = buildDb({
      ticketRow: { clientName: "not-an-email", tenantId: null },
      webUserRow: { id: "w1", lang: "en" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    await caller.replyToTicket({ ticketId: "pt_bad", text: "hi" });
    await flushAsync();
    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });
});

describe("#3 — support.replyToTicket AWAITS the email + surfaces emailSent", () => {
  beforeEach(() => {
    notifyWebUserMock.mockClear();
    notifyManyMock.mockClear();
    sendSupportReplyEmailMock.mockClear();
    sendSupportReplyEmailMock.mockResolvedValue({ ok: true });
  });

  it("awaits the send and reports emailSent: true on success", async () => {
    const db = buildDb({
      ticketRow: { clientName: "owner@test.com", tenantId: "t_demo" },
      webUserRow: { id: "w_owner_5", lang: "en" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    const r = (await caller.replyToTicket({ ticketId: "pt_e", text: "fixed" })) as {
      ok: boolean;
      emailSent: boolean;
    };
    // No flush needed — if the send is awaited it has already resolved.
    expect(sendSupportReplyEmailMock).toHaveBeenCalledTimes(1);
    expect(sendSupportReplyEmailMock.mock.calls[0]![0]).toBe("owner@test.com");
    expect(r.ok).toBe(true);
    expect(r.emailSent).toBe(true);
  });

  it("does not resolve until the send settles (await semantics)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let settled = false;
    sendSupportReplyEmailMock.mockImplementation(async () => {
      await gate;
      settled = true;
      return { ok: true };
    });
    const db = buildDb({
      ticketRow: { clientName: "owner@test.com", tenantId: "t_demo" },
      webUserRow: { id: "w_owner_5", lang: "en" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    const p = caller.replyToTicket({ ticketId: "pt_gate", text: "wait" });
    let resolvedEarly = false;
    void p.then(() => (resolvedEarly = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(resolvedEarly).toBe(false);
    expect(settled).toBe(false);
    release();
    await p;
    expect(settled).toBe(true);
  });

  it("reports emailSent: false when the transport fails (reply still ok)", async () => {
    sendSupportReplyEmailMock.mockResolvedValue({ ok: false, error: "resend_500" });
    const db = buildDb({
      ticketRow: { clientName: "owner@test.com", tenantId: "t_demo" },
      webUserRow: { id: "w_owner_5", lang: "en" },
    });
    const caller = createCaller(makeSupportCtx(db, "support") as never);
    const r = (await caller.replyToTicket({ ticketId: "pt_fail", text: "x" })) as {
      ok: boolean;
      emailSent: boolean;
    };
    expect(r.ok).toBe(true);
    expect(r.emailSent).toBe(false);
  });
});

describe("support.createTicket → fan-out to support staff", () => {
  beforeEach(() => {
    notifyWebUserMock.mockClear();
    notifyManyMock.mockClear();
  });

  it("notifies every support staff web_user except the creator", async () => {
    const db = buildDb({
      supportStaffRows: [
        { id: "w_owner" }, // creator — must be filtered out
        { id: "w_support_a" },
        { id: "w_support_b" },
        { id: "w_admin" },
      ],
    });
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.createTicket({ subject: "Help", message: "All slots are double-booked" });
    expect(r.ticketId).toMatch(/^pt_/);
    await flushAsync();

    expect(notifyManyMock).toHaveBeenCalledTimes(1);
    const [, targets, payload] = notifyManyMock.mock.calls[0] as unknown as [any, string[], any];
    expect(targets).toEqual(["w_support_a", "w_support_b", "w_admin"]);
    expect(payload.kind).toBe("support.ticket.new");
    expect(payload.title).toBe("Новый тикет: Help");
    expect(payload.body).toBe("All slots are double-booked");
    expect(payload.link).toBe(`/?ticket=${r.ticketId}`);
    expect(payload.sourceSlug).toBe("support");
    expect(payload.sourceId).toBe(r.ticketId);
  });

  it("skips fan-out when no support staff exist", async () => {
    const db = buildDb({ supportStaffRows: [] });
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    await caller.createTicket({ subject: "Q", message: "anyone?" });
    await flushAsync();
    expect(notifyManyMock).not.toHaveBeenCalled();
  });
});

describe("support.replyToMyTicket → fan-out to support staff", () => {
  beforeEach(() => {
    notifyWebUserMock.mockClear();
    notifyManyMock.mockClear();
  });

  it("notifies support staff that the client has replied", async () => {
    const db = buildDb({
      myTicketRow: { id: "pt_x", status: "open", clientChatId: 0, clientName: "owner@test.com" },
      supportStaffRows: [
        { id: "w_support_a" },
        { id: "w_admin" },
      ],
    });
    const caller = createCaller(makeTenantOwnerCtx(db, "t_demo") as never);
    const r = await caller.replyToMyTicket({ ticketId: "pt_x", text: "ещё одна деталь" });
    expect(r).toEqual({ ok: true });
    await flushAsync();

    expect(notifyManyMock).toHaveBeenCalledTimes(1);
    const [, targets, payload] = notifyManyMock.mock.calls[0] as unknown as [any, string[], any];
    expect(targets).toContain("w_support_a");
    expect(targets).toContain("w_admin");
    expect(payload.kind).toBe("support.ticket.reply");
    expect(payload.title).toBe("Клиент ответил в тикете");
    expect(payload.body).toBe("ещё одна деталь");
    expect(payload.sourceId).toMatch(/^pt_x:reply:\d+$/);
  });
});
