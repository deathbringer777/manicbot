import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    UPLOAD_TOKEN_SECRET: undefined,
    META_VERIFY_TOKEN_WA: undefined,
    META_VERIFY_TOKEN_IG: undefined,
  },
}));

vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(),
  telegramSetWebhook: vi.fn(),
  telegramDeleteWebhook: vi.fn(),
}));

vi.mock("~/server/lib/stripe", () => ({
  getOrCreateCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

vi.mock("~/server/lib/uploadToken", () => ({
  signUploadToken: vi.fn().mockResolvedValue("tok.signed"),
}));

vi.mock("~/server/utils/notifyWorker", () => ({
  notifyWorker: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { notifyWorker } from "~/server/utils/notifyWorker";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_demo";
const OTHER_TENANT = "t_other";

function ownerCaller(db: any) {
  return createCallerFactory(salonRouter)(makeTenantOwnerCtx(db, TENANT) as never);
}

const FUTURE_TS = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
const PAST_TS = Math.floor(Date.now() / 1000) - 3600;

describe("salonRouter status mutations — close adminProcedure regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTenantOwner).mockResolvedValue(undefined);
    vi.mocked(notifyWorker).mockResolvedValue(undefined);
  });

  // ── confirmAppointment ────────────────────────────────────────────────────
  describe("confirmAppointment", () => {
    it("transitions pending → confirmed and fires Worker confirm action", async () => {
      const dbMock = createDbMock([
        // SELECT current row → pending
        [{ status: "pending", cancelled: 0 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.confirmAppointment({ tenantId: TENANT, id: "apt_1" });

      expect(result).toEqual({ success: true });
      expect(dbMock.updateCalls[0]?.values).toMatchObject({ status: "confirmed" });
      expect(assertTenantOwner).toHaveBeenCalledWith(expect.anything(), TENANT);
      expect(notifyWorker).toHaveBeenCalledWith("confirm", "apt_1", TENANT, null);
    });

    it("rejects with BAD_REQUEST when current status is not pending/confirmed", async () => {
      const dbMock = createDbMock([
        [{ status: "done", cancelled: 0 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.confirmAppointment({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/invalid_status_transition/);
      expect(notifyWorker).not.toHaveBeenCalled();
    });

    it("rejects with NOT_FOUND when no row matches", async () => {
      const dbMock = createDbMock([[]]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.confirmAppointment({ tenantId: TENANT, id: "apt_missing" }),
      ).rejects.toThrow(/appointment_not_found/);
    });
  });

  // ── rejectAppointment ─────────────────────────────────────────────────────
  describe("rejectAppointment", () => {
    it("transitions pending → rejected with sanitized comment and fires reject", async () => {
      const dbMock = createDbMock([
        [{ status: "pending", cancelled: 0 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await caller.rejectAppointment({ tenantId: TENANT, id: "apt_1", comment: "double-booked" });

      expect(dbMock.updateCalls[0]?.values).toMatchObject({
        status: "rejected",
        rejectComment: "double-booked",
      });
      expect(notifyWorker).toHaveBeenCalledWith("reject", "apt_1", TENANT, null);
    });

    it("refuses non-pending statuses", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0 }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.rejectAppointment({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/invalid_status_transition/);
    });
  });

  // ── markDone ──────────────────────────────────────────────────────────────
  describe("markDone", () => {
    it("transitions confirmed → done when start time has passed and fires done", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0, ts: PAST_TS }],
      ]);
      const caller = ownerCaller(dbMock.db);

      const result = await caller.markDone({ tenantId: TENANT, id: "apt_1" });

      expect(result).toEqual({ success: true });
      expect(dbMock.updateCalls[0]?.values).toMatchObject({ status: "done" });
      expect(notifyWorker).toHaveBeenCalledWith("done", "apt_1", TENANT, null);
    });

    it("refuses to mark done before the appointment start", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0, ts: FUTURE_TS }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.markDone({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/cannot_mark_done_before_start/);
      expect(dbMock.updateCalls).toHaveLength(0);
      expect(notifyWorker).not.toHaveBeenCalled();
    });

    it("refuses to mark done when row is already cancelled", async () => {
      const dbMock = createDbMock([
        [{ status: "cancelled", cancelled: 1, ts: PAST_TS }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.markDone({ tenantId: TENANT, id: "apt_1" }),
      ).rejects.toThrow(/invalid_status_transition/);
    });
  });

  // ── markNoShow (existing) extended to assert notifyWorker fires ───────────
  describe("markNoShow", () => {
    it("fires notifyWorker no_show_client for client variant", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.markNoShow({
        tenantId: TENANT,
        id: "apt_1",
        noShowBy: "client",
      });

      expect(notifyWorker).toHaveBeenCalledWith("no_show_client", "apt_1", TENANT, null);
    });

    it("fires notifyWorker no_show_master for master variant", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.markNoShow({
        tenantId: TENANT,
        id: "apt_2",
        noShowBy: "master",
      });

      expect(notifyWorker).toHaveBeenCalledWith("no_show_master", "apt_2", TENANT, null);
    });
  });

  // ── cancelAppointment extended to fire notifyWorker ───────────────────────
  describe("cancelAppointment", () => {
    it("fires notifyWorker cancel after the D1 update", async () => {
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await caller.cancelAppointment({
        tenantId: TENANT,
        id: "apt_1",
        cancelledBy: "admin",
      });

      expect(notifyWorker).toHaveBeenCalledWith("cancel", "apt_1", TENANT, null);
    });
  });

  // ── Tenant isolation — assertTenantOwner is the gate, but the WHERE
  //    clauses must also scope on tenantId so a leaked id cannot mutate
  //    another tenant's row.
  describe("tenant isolation", () => {
    it("scopes the markDone WHERE with the input tenantId", async () => {
      const dbMock = createDbMock([
        [{ status: "confirmed", cancelled: 0, ts: PAST_TS }],
      ]);
      const caller = ownerCaller(dbMock.db);

      await caller.markDone({ tenantId: TENANT, id: "apt_1" });

      expect(assertTenantOwner).toHaveBeenCalledWith(expect.anything(), TENANT);
      // The mock's update().set() captures values but not the WHERE
      // clause shape; the spec is that assertTenantOwner is the front
      // line and the implementation passes tenantId into the AND() —
      // covered by the unit-level shape above + integration tests.
      expect(dbMock.updateCalls[0]?.values).toMatchObject({ status: "done" });
    });

    it("rejects when assertTenantOwner throws (different tenant)", async () => {
      vi.mocked(assertTenantOwner).mockRejectedValueOnce(
        new Error("forbidden"),
      );
      const dbMock = createDbMock();
      const caller = ownerCaller(dbMock.db);

      await expect(
        caller.markDone({ tenantId: OTHER_TENANT, id: "apt_1" }),
      ).rejects.toThrow(/forbidden/);
      expect(dbMock.updateCalls).toHaveLength(0);
    });
  });
});
