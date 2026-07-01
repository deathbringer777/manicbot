import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
// CS-1 (audit 2026-06-12): high-value mutations now run a server-side billing
// SELECT (assertTenantBillingActive). This file tests other concerns, so the
// billing check is neutralized to keep the mock-db select queue stable.
// Billing-gate behavior itself is pinned in billing-server-gate.test.ts.
vi.mock("~/server/api/tenantAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/tenantAccess")>()),
  assertTenantBillingActive: vi.fn(async () => {}),
  assertEmailVerified: vi.fn(async () => {}),
}));

// rescheduleAppointment tests mock slotsBusy directly so the conflict
// behaviour is exercised without seeding a fake appointments+blocks
// schema in the in-memory db mock.
const slotsBusyMock = vi.fn();
vi.mock("~/server/api/slotsBusy", () => ({
  slotsBusy: (...args: any[]) => slotsBusyMock(...args),
}));

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
  makeUnauthCtx,
  makeForbiddenWebCtx,
  makeTenantOwnerCtx,
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

      // Rows are enriched with resolved display names; the source fields survive.
      expect(result.appointments).toMatchObject([{ id: "apt_1", status: "pending", cancelled: 0 }]);
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

  // ── updateStatus — confirmed ────────────────────────────────────────────
  describe("updateStatus — confirmed", () => {
    it("sets status=confirmed (confirmedBy null for web God Mode sessions)", async () => {
      const dbMock = createDbMock([
        [{ tenantId: "t_demo" }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "confirmed" });

      expect(result.success).toBe(true);
      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        status: "confirmed",
      });
    });

    it("calls notifyWorker with action=confirm and correct tenantId", async () => {
      const dbMock = createDbMock([
        [{ tenantId: "t_demo" }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "confirmed" });

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
        [],  // empty → no tenantId
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "confirmed" });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus — cancelled ──────────────────────────────────────────────
  describe("updateStatus — cancelled", () => {
    it("sets cancelled=1, cancelledBy=admin, cancelReason, cancelledAt", async () => {
      const before = Math.floor(Date.now() / 1000);
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "cancelled", comment: "no-show" });

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

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "cancelled" });

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

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "rejected", comment: "not available" });

      expect(dbMock.updateCalls[0]?.values.rejectComment).toBe("not available");
    });

    it("sets empty rejectComment when comment is omitted", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "rejected" });

      expect(dbMock.updateCalls[0]?.values.rejectComment).toBe("");
    });

    it("calls notifyWorker with action=reject", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "rejected" });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.action).toBe("reject");
    });
  });

  // ── updateStatus — done ───────────────────────────────────────────────────
  describe("updateStatus — done", () => {
    it("sets only status=done with no extra cancellation fields", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "done" });

      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.status).toBe("done");
      expect(vals.cancelled).toBeUndefined();
      expect(vals.rejectComment).toBeUndefined();
    });

    it("does NOT call notifyWorker for done status (no Worker action mapping)", async () => {
      const dbMock = createDbMock([[{ tenantId: "t_demo" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.updateStatus({ tenantId: "t_demo", id: "apt_1", status: "done" });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── markNoShow (idempotent conditional-claim, #463 contract) ───────────────
  describe("markNoShow", () => {
    it("returns success=false when nothing is flipped (missing/foreign or already no_show)", async () => {
      // The guarded UPDATE (… AND noShow = 0) claims nothing → .returning() is
      // empty. No separate existence SELECT — the claim itself is the gate.
      const dbMock = createDbMock([], [[] /* returning: 0 rows */]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.markNoShow({ tenantId: "t_demo", id: "apt_x", noShowBy: "client" });

      expect(result).toEqual({ success: false });
    });

    it("sets noShow=1, status=no_show, noShowBy, cancelReason when it claims the flip", async () => {
      const dbMock = createDbMock([], [[{ id: "apt_1" }] /* returning: claimed */]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.markNoShow({
        tenantId: "t_demo",
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
      const dbMock = createDbMock([], [[{ id: "apt_1" }]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.markNoShow({ tenantId: "t_demo", id: "apt_1", noShowBy: "client" });

      expect(dbMock.updateCalls[0]?.values.cancelReason).toBeNull();
    });

    it("is idempotent — a re-mark of an already-no_show row claims nothing", async () => {
      // First call wins the flip; second call's guarded UPDATE matches 0 rows.
      const dbMock = createDbMock([], [[{ id: "apt_1" }], [] /* second: 0 rows */]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const first = await caller.markNoShow({ tenantId: "t_demo", id: "apt_1", noShowBy: "client" });
      const second = await caller.markNoShow({ tenantId: "t_demo", id: "apt_1", noShowBy: "client" });

      expect(first.success).toBe(true);
      expect(second).toEqual({ success: false });
    });
  });

  // ── rescheduleAppointment ────────────────────────────────────────────────
  //
  // Powers Google-Calendar-style drag-to-reschedule from the salon
  // dashboard. The matrix: terminal-row guard, NOT_FOUND, slot conflict,
  // master role scoping, no-op short-circuit, and the happy path that
  // resets Google Calendar sync + reminder flags.
  describe("rescheduleAppointment", () => {
    beforeEach(() => {
      // Default: slot is free unless a test overrides.
      slotsBusyMock.mockReset().mockResolvedValue({ busy: false });
    });

    const baseApt = {
      id: "apt_1",
      tenantId: "t_demo",
      date: "2026-05-20",
      time: "10:00",
      ts: 0,
      masterId: 100,
      svcId: "manicure",
      status: "confirmed",
      cancelled: 0,
      noShow: 0,
    };

    it("updates date/time/masterId and resets Google + reminder flags on the happy path", async () => {
      const dbMock = createDbMock([
        [baseApt],
        [{ svcId: "manicure", duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const res = await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-21",
        newTime: "14:30",
        newMasterId: 200,
      });

      expect(res.ok).toBe(true);
      expect(res.unchanged).toBe(false);
      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.date).toBe("2026-05-21");
      expect(vals.time).toBe("14:30");
      expect(vals.masterId).toBe(200);
      // Google Calendar sync reset so phaseGcalSync re-syncs the event.
      expect(vals.syncRetries).toBe(0);
      expect(vals.syncRetryAfter).toBeNull();
      expect(vals.syncLastError).toBeNull();
      // Reminders re-armed so they fire at the new time, not the old one.
      expect(vals.remH24).toBe(0);
      expect(vals.remH2).toBe(0);
      // ts recomputed from new date+time (UTC) — should be a positive int.
      expect(typeof vals.ts).toBe("number");
      expect(vals.ts).toBeGreaterThan(0);
    });

    it("fires a silent sync_calendar push with the NEW slot so the Google event moves (C4)", async () => {
      const dbMock = createDbMock([
        [{ ...baseApt, googleEventId: "gcal_evt_123", googleCalendarId: "cal_1", googleIntegrationId: 7 }],
        [{ svcId: "manicure", duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-21",
        newTime: "14:30",
        newMasterId: 200,
      });

      // The calendar-only `sync_calendar` action must be pushed to the Worker
      // with the NEW slot — this is what actually moves the linked Google event
      // (the ≤15-min phaseGcalSync cron never re-picks a row that already has a
      // google_event_id). Silent by design: no client "moved" message.
      const syncCall = fetchMock.mock.calls.find(([, opts]) => {
        try {
          return JSON.parse((opts as RequestInit).body as string).action === "sync_calendar";
        } catch {
          return false;
        }
      });
      expect(syncCall).toBeTruthy();
      const body = JSON.parse((syncCall![1] as RequestInit).body as string);
      expect(body.apt.date).toBe("2026-05-21");
      expect(body.apt.time).toBe("14:30");
      expect(body.apt.masterId).toBe(200);
      // googleEventId forwarded so the Worker PATCHes the existing event
      // (a payload without it would CREATE a duplicate under read-after-write).
      expect(body.apt.googleEventId).toBe("gcal_evt_123");
    });

    it("keeps existing masterId when newMasterId is omitted", async () => {
      const dbMock = createDbMock([
        [baseApt],
        [{ svcId: "manicure", duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-21",
        newTime: "11:00",
      });

      expect(dbMock.updateCalls[0]?.values.masterId).toBe(100);
    });

    it("short-circuits when nothing actually changed", async () => {
      const dbMock = createDbMock([[baseApt]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const res = await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: baseApt.date,
        newTime: baseApt.time,
        newMasterId: baseApt.masterId,
      });

      expect(res.ok).toBe(true);
      expect(res.unchanged).toBe(true);
      expect(dbMock.updateCalls).toHaveLength(0);
      expect(slotsBusyMock).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when the appointment doesn't exist", async () => {
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.rescheduleAppointment({
          tenantId: "t_demo",
          appointmentId: "apt_missing",
          newDate: "2026-05-21",
          newTime: "10:00",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses to move terminal rows (cancelled / rejected / no_show / done)", async () => {
      for (const terminal of [
        { ...baseApt, cancelled: 1 },
        { ...baseApt, noShow: 1 },
        { ...baseApt, status: "rejected" },
        { ...baseApt, status: "done" },
      ]) {
        const dbMock = createDbMock([[terminal]]);
        const caller = createCaller(makeAdminCtx(dbMock.db) as never);
        await expect(
          caller.rescheduleAppointment({
            tenantId: "t_demo",
            appointmentId: "apt_1",
            newDate: "2026-05-21",
            newTime: "10:00",
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "appointment_terminal" });
      }
    });

    it("throws CONFLICT when slotsBusy reports a collision and skips the UPDATE", async () => {
      slotsBusyMock.mockResolvedValueOnce({
        busy: true,
        conflict: { kind: "appointment", id: "apt_other" },
      });
      const dbMock = createDbMock([
        [baseApt],
        [{ svcId: "manicure", duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.rescheduleAppointment({
          tenantId: "t_demo",
          appointmentId: "apt_1",
          newDate: "2026-05-21",
          newTime: "14:30",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "slot_conflict" });
      expect(dbMock.updateCalls).toHaveLength(0);
    });

    it("passes excludeAppointmentId so the row doesn't collide with itself", async () => {
      const dbMock = createDbMock([
        [baseApt],
        [{ svcId: "manicure", duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-21",
        newTime: "10:30",
      });

      expect(slotsBusyMock).toHaveBeenCalledWith(
        expect.objectContaining({ excludeAppointmentId: "apt_1" }),
      );
    });

    it("falls back to a 60-min default when the service is missing from the catalog", async () => {
      const dbMock = createDbMock([
        [baseApt],
        [], // services SELECT returns empty
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-21",
        newTime: "10:30",
      });

      expect(slotsBusyMock).toHaveBeenCalledWith(
        expect.objectContaining({ durationMin: 60 }),
      );
    });

    it("moves an UNASSIGNED (no-master) booking without master_required and skips the conflict check", async () => {
      // One shared calendar: master_id NULL must be draggable. Previously this
      // threw master_required; now the row just moves and slotsBusy is skipped
      // (no per-master schedule to collide with — overlaps are allowed).
      const unassigned = { ...baseApt, masterId: null };
      const dbMock = createDbMock([[unassigned]]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const res = await caller.rescheduleAppointment({
        tenantId: "t_demo",
        appointmentId: "apt_1",
        newDate: "2026-05-20",
        newTime: "15:00",
        // newMasterId omitted → stays unassigned
      });

      expect(res.ok).toBe(true);
      expect(res.unchanged).toBe(false);
      expect(slotsBusyMock).not.toHaveBeenCalled();
      const vals = dbMock.updateCalls[0]?.values!;
      expect(vals.time).toBe("15:00");
      expect(vals.masterId).toBeNull();
    });

    // ── resize — drag the bottom edge to change duration (Q1: appointments
    //   get a custom stored duration decoupled from the service nominal).
    describe("resize via newDurationMin", () => {
      const sizedApt = { ...baseApt, duration: 60 };

      it("writes the new duration and uses it for the conflict window", async () => {
        const dbMock = createDbMock([
          [sizedApt],
          [{ svcId: "manicure", duration: 60 }],
        ]);
        const caller = createCaller(makeAdminCtx(dbMock.db) as never);

        const res = await caller.rescheduleAppointment({
          tenantId: "t_demo",
          appointmentId: "apt_1",
          newDate: sizedApt.date,
          newTime: sizedApt.time,
          newMasterId: sizedApt.masterId,
          newDurationMin: 90,
        });

        expect(res.ok).toBe(true);
        expect(res.unchanged).toBe(false);
        // Conflict window uses the NEW duration, not the service's nominal 60.
        expect(slotsBusyMock).toHaveBeenCalledWith(
          expect.objectContaining({ durationMin: 90 }),
        );
        // The new duration is persisted (decoupled from the service).
        expect(dbMock.updateCalls[0]?.values.duration).toBe(90);
      });

      it("treats a duration-only change as a real change (not a no-op)", async () => {
        const dbMock = createDbMock([
          [sizedApt],
          [{ svcId: "manicure", duration: 60 }],
        ]);
        const caller = createCaller(makeAdminCtx(dbMock.db) as never);

        const res = await caller.rescheduleAppointment({
          tenantId: "t_demo",
          appointmentId: "apt_1",
          newDate: sizedApt.date,
          newTime: sizedApt.time,
          newMasterId: sizedApt.masterId,
          newDurationMin: 120,
        });

        expect(res.unchanged).toBe(false);
        expect(dbMock.updateCalls).toHaveLength(1);
      });

      it("does NOT write duration when newDurationMin is omitted (plain move)", async () => {
        const dbMock = createDbMock([
          [sizedApt],
          [{ svcId: "manicure", duration: 60 }],
        ]);
        const caller = createCaller(makeAdminCtx(dbMock.db) as never);

        await caller.rescheduleAppointment({
          tenantId: "t_demo",
          appointmentId: "apt_1",
          newDate: "2026-05-21",
          newTime: "10:30",
        });

        expect(dbMock.updateCalls[0]?.values.duration).toBeUndefined();
      });

      it("rejects a resize that overlaps the next booking (CONFLICT, no UPDATE)", async () => {
        slotsBusyMock.mockResolvedValueOnce({
          busy: true,
          conflict: { kind: "appointment", id: "apt_next" },
        });
        const dbMock = createDbMock([
          [sizedApt],
          [{ svcId: "manicure", duration: 60 }],
        ]);
        const caller = createCaller(makeAdminCtx(dbMock.db) as never);

        await expect(
          caller.rescheduleAppointment({
            tenantId: "t_demo",
            appointmentId: "apt_1",
            newDate: sizedApt.date,
            newTime: sizedApt.time,
            newMasterId: sizedApt.masterId,
            newDurationMin: 180,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT", message: "slot_conflict" });
        expect(dbMock.updateCalls).toHaveLength(0);
      });
    });
  });

  // ── update — tenant-scoped explicit save (reschedule + change master /
  //   service + opt-in client notify). Separate from rescheduleAppointment
  //   above which is the silent drag-to-move path.
  describe("update", () => {
    beforeEach(() => {
      // slotsBusy is mocked at file scope; reset per test.
      slotsBusyMock.mockReset().mockResolvedValue({ busy: false });
    });

    const baseRow = {
      id: "apt_1",
      tenantId: "t_demo",
      date: "2026-05-16",
      time: "14:00",
      masterId: 5,
      svcId: "svc_classic",
    };

    it("throws NOT_FOUND when the appointment does not exist", async () => {
      const dbMock = createDbMock([[]]); // empty fetch
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.update({ id: "apt_missing", time: "15:00" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws FORBIDDEN when caller is a tenant_owner of a different tenant", async () => {
      const dbMock = createDbMock([[{ ...baseRow, tenantId: "t_other" }]]);
      // makeForbiddenWebCtx has tenantId='t_demo' — mismatch with t_other.
      const caller = createCaller(makeForbiddenWebCtx(dbMock.db) as never);

      await expect(
        caller.update({ id: "apt_1", time: "15:00" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects master assignment when masterId is not in the appointment's tenant", async () => {
      const dbMock = createDbMock([
        [baseRow], // fetch current
        [],        // master cross-tenant select → empty
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.update({ id: "apt_1", masterId: 99 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects service assignment when serviceId is not in the appointment's tenant", async () => {
      const dbMock = createDbMock([
        [baseRow], // fetch current
        [],        // service cross-tenant select → empty
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.update({ id: "apt_1", serviceId: "svc_unknown" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("no-op save (every field matches current) does NOT trigger a Worker notify", async () => {
      const dbMock = createDbMock([
        [baseRow], // fetch current — nothing else (no slot check, no x-tenant)
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.update({
        id: "apt_1",
        date: baseRow.date,
        time: baseRow.time,
        masterId: baseRow.masterId,
        serviceId: baseRow.svcId,
      });

      expect(result.notified).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(slotsBusyMock).not.toHaveBeenCalled();
    });

    it("rescheduling (date change only) fires Worker notify with action=reschedule + prior date/time", async () => {
      const dbMock = createDbMock([
        [baseRow],            // fetch current
        [{ duration: 60 }],   // fallback service-duration lookup for slot check
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.update({ id: "apt_1", date: "2026-05-18" });

      expect(result.notified).toBe(true);
      // notifyWorker is fire-and-forget — let the microtask queue drain.
      await new Promise((r) => setTimeout(r, 0));
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/admin/appointment-action"),
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.action).toBe("reschedule");
      expect(body.appointmentId).toBe("apt_1");
      expect(body.tenantId).toBe("t_demo");
      expect(body.oldDate).toBe(baseRow.date);
      expect(body.oldTime).toBe(baseRow.time);
    });

    it("update sets ts to the recomputed UTC milliseconds (Warsaw wall-clock) for the new date+time", async () => {
      const dbMock = createDbMock([
        [baseRow],
        [{ duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await caller.update({ id: "apt_1", date: "2026-05-18", time: "10:30" });

      // BUG-01/04/06: `ts` is epoch MILLISECONDS for the Warsaw wall clock,
      // matching the Worker contract (warsawToUtcMs). 2026-05-18 10:30 in
      // Warsaw is CEST (UTC+2) → 08:30 UTC.
      const ts = Date.UTC(2026, 4 /* May */, 18, 8, 30);
      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        date: "2026-05-18",
        time: "10:30",
        ts,
      });
    });

    it("throws CONFLICT when slotsBusy reports a collision (and skips the UPDATE)", async () => {
      slotsBusyMock.mockResolvedValueOnce({
        busy: true,
        conflict: { kind: "appointment", id: "apt_other" },
      });
      const dbMock = createDbMock([
        [baseRow],
        [{ duration: 60 }],
      ]);
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      await expect(
        caller.update({ id: "apt_1", time: "16:00" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "slot_conflict" });
      expect(dbMock.updateCalls).toHaveLength(0);
    });

    it("system_admin caller bypasses tenant-owner cross-check (assertTenantOwner short-circuits)", async () => {
      const dbMock = createDbMock([
        [{ ...baseRow, tenantId: "t_unrelated" }],
        [{ duration: 30 }],
      ]);
      // makeAdminCtx is system_admin — assertTenantOwner returns immediately
      const caller = createCaller(makeAdminCtx(dbMock.db) as never);

      const result = await caller.update({ id: "apt_1", time: "16:00" });

      expect(result.ok).toBe(true);
      expect(result.notified).toBe(true);
    });

    it("tenant_owner with matching tenantId can update (no Forbidden)", async () => {
      const dbMock = createDbMock([
        [baseRow],
        [{ duration: 60 }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_demo") as never);

      const result = await caller.update({ id: "apt_1", time: "16:30" });

      expect(result.ok).toBe(true);
    });
  });
});
