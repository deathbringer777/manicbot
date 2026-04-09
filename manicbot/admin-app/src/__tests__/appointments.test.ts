import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

// Must be mocked before importing the router so notifyWorker picks up test values
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import {
  createDbMock,
  makeAdminCtx,
  makeTgAdminCtx,
  makeUnauthCtx,
  makeForbiddenWebCtx,
} from "./helpers/db-mock";

describe("appointmentsRouter", () => {
  const createCaller = createCallerFactory(appointmentsRouter);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Auth guard ──────────────────────────────────────────────────────────
  describe("adminProcedure auth guard", () => {
    it("throws UNAUTHORIZED when no user and no webUser", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      await expect(caller.getAll({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws FORBIDDEN when webUser is not system_admin", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeForbiddenWebCtx(db) as never);
      await expect(caller.getAll({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── getAll ───────────────────────────────────────────────────────────────
  describe("getAll", () => {
    it("returns appointments and total count with no filters", async () => {
      const apt = { id: "apt_1", status: "pending", cancelled: 0 };
      // baseQuery is created first (select #0 = rows), then count is select #1
      const dbMock = createDbMock([[apt], [{ count: 1 }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.getAll({});

      expect(result.appointments).toEqual([apt]);
      expect(result.total).toBe(1);
    });

    it("calls select twice in total for rows and count", async () => {
      const dbMock = createDbMock([[], [{ count: 0 }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.getAll({ tenantId: "t_demo" });

      expect(dbMock.db.select).toHaveBeenCalledTimes(2);
    });

    it("returns total=0 when count query returns empty array", async () => {
      const dbMock = createDbMock([[], []]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.getAll({});

      expect(result.total).toBe(0);
    });

    it("returns empty appointments when DB has no rows", async () => {
      const dbMock = createDbMock([[], [{ count: 0 }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.getAll({ status: "confirmed" });

      expect(result.appointments).toEqual([]);
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────
  describe("getStats", () => {
    it("returns zeros when all DB queries return empty arrays", async () => {
      const dbMock = createDbMock([[], [], [], [], [], [], []]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const stats = await caller.getStats({});

      expect(stats).toEqual({
        total: 0,
        today: 0,
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        done: 0,
        noShow: 0,
      });
    });

    it("returns correct counts from DB results", async () => {
      const dbMock = createDbMock([
        [{ count: 100 }], // total
        [{ count: 5 }],   // today
        [{ count: 3 }],   // pending
        [{ count: 8 }],   // confirmed
        [{ count: 2 }],   // cancelled
        [{ count: 7 }],   // done
        [{ count: 1 }],   // noShow
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const stats = await caller.getStats({});

      expect(stats).toEqual({ total: 100, today: 5, pending: 3, confirmed: 8, cancelled: 2, done: 7, noShow: 1 });
    });

    it("makes 7 parallel select calls when tenantId is provided", async () => {
      const dbMock = createDbMock([[], [], [], [], [], [], []]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.getStats({ tenantId: "t_demo" });

      expect(dbMock.db.select).toHaveBeenCalledTimes(7);
    });
  });

  // ── updateStatus — confirmed (Telegram admin, so adminId is set) ─────────
  describe("updateStatus — confirmed", () => {
    it("sets confirmedBy to Telegram admin id and status=confirmed", async () => {
      const dbMock = createDbMock([
        [{ masterId: null }],      // masterId check (for TG admin path)
        [{ tenantId: "t_demo" }],  // tenantId for notifyWorker
      ]);
      const caller = createCaller(makeTgAdminCtx(dbMock.db) as never);

      const result = await caller.updateStatus({ id: "apt_1", status: "confirmed" });

      expect(result.success).toBe(true);
      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        status: "confirmed",
        confirmedBy: 12345,
      });
    });

    it("sets masterId to adminId when masterId is currently null", async () => {
      const dbMock = createDbMock([
        [{ masterId: null }],
        [{ tenantId: "t_demo" }],
      ]);
      const caller = createCaller(makeTgAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "confirmed" });

      expect(dbMock.updateCalls[0]?.values).toMatchObject({ masterId: 12345 });
    });

    it("does NOT overwrite masterId when already assigned", async () => {
      const dbMock = createDbMock([
        [{ masterId: 999 }],       // existing master
        [{ tenantId: "t_demo" }],
      ]);
      const caller = createCaller(makeTgAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "confirmed" });

      expect(dbMock.updateCalls[0]?.values.masterId).toBeUndefined();
    });

    it("calls notifyWorker with action=confirm and correct tenantId", async () => {
      const dbMock = createDbMock([
        [{ masterId: null }],
        [{ tenantId: "t_demo" }],
      ]);
      const caller = createCaller(makeTgAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "confirmed" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/admin/appointment-action"),
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.action).toBe("confirm");
      expect(body.tenantId).toBe("t_demo");
    });

    it("does NOT call notifyWorker when tenantId is not found", async () => {
      const dbMock = createDbMock([
        [{ masterId: null }],
        [],  // empty → no tenantId
      ]);
      const caller = createCaller(makeTgAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "confirmed" });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus — cancelled ──────────────────────────────────────────────
  describe("updateStatus — cancelled", () => {
    it("sets cancelled=1, cancelledBy=admin, cancelReason, cancelledAt", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "cancelled", comment: "no-show" });

      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.status).toBe("cancelled");
      expect(vals.cancelled).toBe(1);
      expect(vals.cancelledBy).toBe("admin");
      expect(vals.cancelReason).toBe("no-show");
      expect(Number(vals.cancelledAt)).toBeGreaterThanOrEqual(before);
    });

    it("calls notifyWorker with action=cancel", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "cancelled" });

      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.action).toBe("cancel");
    });
  });

  // ── updateStatus — rejected ───────────────────────────────────────────────
  describe("updateStatus — rejected", () => {
    it("sets rejectComment from comment input", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "rejected", comment: "not available" });

      expect(dbMock.updateCalls[0]?.values.rejectComment).toBe("not available");
    });

    it("sets empty rejectComment when comment is omitted", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "rejected" });

      expect(dbMock.updateCalls[0]?.values.rejectComment).toBe("");
    });

    it("calls notifyWorker with action=reject", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "rejected" });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.action).toBe("reject");
    });
  });

  // ── updateStatus — done ───────────────────────────────────────────────────
  describe("updateStatus — done", () => {
    it("sets only status=done with no extra cancellation fields", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "done" });

      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.status).toBe("done");
      expect(vals.cancelled).toBeUndefined();
      expect(vals.rejectComment).toBeUndefined();
    });

    it("does NOT call notifyWorker for done status (no Worker action mapping)", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ id: "apt_1", status: "done" });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── markNoShow ────────────────────────────────────────────────────────────
  describe("markNoShow", () => {
    it("returns success=false when appointment is not found", async () => {
      const dbMock = createDbMock([[]]); // empty → no aptRow
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.markNoShow({ id: "apt_x", noShowBy: "client" });

      expect(result).toEqual({ success: false });
      expect(dbMock.updateCalls).toHaveLength(0);
    });

    it("sets noShow=1, status=no_show, noShowBy, cancelReason when found", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.markNoShow({
        id: "apt_1",
        noShowBy: "master",
        comment: "never came",
      });

      expect(result.success).toBe(true);
      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        noShow: 1,
        status: "no_show",
        noShowBy: "master",
        cancelReason: "never came",
      });
    });

    it("sets cancelReason=null when comment is omitted", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.markNoShow({ id: "apt_1", noShowBy: "client" });

      expect(dbMock.updateCalls[0]?.values.cancelReason).toBeNull();
    });
  });
});
