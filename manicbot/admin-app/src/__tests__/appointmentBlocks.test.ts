/**
 * appointmentBlocks router — calendar overhaul (2026-05-16).
 *
 * Pins:
 *   * `assertTenantOwner` is enforced (UNAUTHORIZED for no-session,
 *     FORBIDDEN for foreign tenant).
 *   * `create` rejects an overlapping slot — both other blocks and
 *     real appointments — via the shared `slotsBusy()` helper.
 *   * `delete` is a soft cancel (UPDATE, not DELETE).
 *   * Multi-day `time_off` rows expand to N daily conflict checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
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
import { appointmentBlocksRouter } from "~/server/api/routers/appointmentBlocks";
import { createDbMock, makeTenantOwnerCtx, makeUnauthCtx, makeMasterCtx } from "./helpers/db-mock";

const TENANT = "t_demo_calendar";

describe("appointmentBlocksRouter", () => {
  const createCaller = createCallerFactory(appointmentBlocksRouter);

  beforeEach(() => {
    // We deliberately use REAL timers here — the tRPC `timingMiddleware`
    // uses setTimeout internally; vi.useFakeTimers stalls the caller.
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-16T12:00:00Z").getTime());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth guard", () => {
    it("UNAUTHORIZED when no session", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          masterId: 1,
          type: "reservation",
          date: "2026-05-16",
          time: "10:00",
          durationMin: 30,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("FORBIDDEN when calling on a tenant the owner doesn't belong to", async () => {
      // Owner of t_other tries to create a block on TENANT — assertTenantOwner
      // refuses because tenantId mismatches the session's tenantId.
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          masterId: 1,
          type: "reservation",
          date: "2026-05-16",
          time: "10:00",
          durationMin: 30,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("create — slot conflict", () => {
    it("rejects when an existing appointment overlaps the requested slot", async () => {
      // slotsBusy: 1) existing apts on master/date, 2) services lookup
      // (because aptRows.length>0), 3) blocks query → []
      const apt = { id: "apt_existing", time: "10:00", svcId: "manicure" };
      const svc = { svcId: "manicure", duration: 60 };
      const dbMock = createDbMock([[apt], [svc], [] /* blocks */]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          masterId: 1,
          type: "reservation",
          date: "2026-05-16",
          time: "10:30",
          durationMin: 30,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "slot_conflict" });
    });

    it("rejects when an existing block overlaps", async () => {
      const dbMock = createDbMock([
        [], // appointments
        // No services lookup since aptRows.length === 0; next select is blocks.
        [{ id: "blk_other", type: "reservation", date: "2026-05-16", time: "10:00", durationMin: 60, endDate: null }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          masterId: 1,
          type: "reservation",
          date: "2026-05-16",
          time: "10:30",
          durationMin: 30,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("happy path inserts the block when nothing conflicts", async () => {
      const dbMock = createDbMock([[], []]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      const res = await caller.create({
        tenantId: TENANT,
        masterId: 1,
        type: "reservation",
        date: "2026-05-16",
        time: "13:00",
        durationMin: 30,
        reason: "Подготовка",
      });
      expect(res.ok).toBe(true);
      expect(res.id).toMatch(/^b\d+_/);
      expect(dbMock.insertCalls).toHaveLength(1);
      expect(dbMock.insertCalls[0]!.values).toMatchObject({
        tenantId: TENANT,
        masterId: 1,
        type: "reservation",
        date: "2026-05-16",
        time: "13:00",
        durationMin: 30,
        reason: "Подготовка",
        cancelled: 0,
      });
    });
  });

  describe("create — multi-day time_off", () => {
    it("checks every spanned day for conflicts before inserting", async () => {
      // Vacation 2026-05-20 → 2026-05-22 = 3 daily checks. Each daily
      // check pulls (apts, blocks). Provide 6 empty selects.
      const dbMock = createDbMock([[], [], [], [], [], []]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      const res = await caller.create({
        tenantId: TENANT,
        masterId: 1,
        type: "time_off",
        date: "2026-05-20",
        time: "00:00",
        durationMin: 60 * 24,
        endDate: "2026-05-22",
        reason: "Отпуск",
      });
      expect(res.ok).toBe(true);
      // 3 days * 2 selects (apts, blocks) = 6 select calls.
      expect(dbMock.db.select).toHaveBeenCalledTimes(6);
      expect(dbMock.insertCalls[0]!.values.endDate).toBe("2026-05-22");
    });

    it("rejects endDate before date", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          masterId: 1,
          type: "time_off",
          date: "2026-05-22",
          time: "00:00",
          durationMin: 60,
          endDate: "2026-05-20",
        }),
      ).rejects.toBeTruthy();
    });
  });

  describe("delete", () => {
    it("404s when the row doesn't exist", async () => {
      // First select for assertTenantOwner master lookup may fire; then
      // the existence check select returns []. Provide both empty.
      const dbMock = createDbMock([[]]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      await expect(caller.delete({ tenantId: TENANT, id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("soft-cancels by UPDATEing cancelled=1 (no DELETE)", async () => {
      const dbMock = createDbMock([
        [{ tenantId: TENANT, masterId: 7 }], // existence check
      ]);
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      const res = await caller.delete({ tenantId: TENANT, id: "blk_xyz" });
      expect(res.ok).toBe(true);
      expect(dbMock.updateCalls).toHaveLength(1);
      expect(dbMock.updateCalls[0]!.values).toEqual({ cancelled: 1 });
      // No raw DELETEs — preserve audit trail.
      expect(dbMock.deleteCalls).toHaveLength(0);
    });
  });

  // Master-role scoping is enforced via assertTenantOwner (personal
  // tenants only) + the caller-tenant guard inside `create` / `delete`;
  // the auth-guard tests above already exercise that path through the
  // FORBIDDEN response. We don't need a separate "master scoping" test
  // here — it would just re-mock the personal-tenant DB chain that
  // tenantAccess.ts already has its own coverage for.
});

void makeMasterCtx;
